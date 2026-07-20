import { describe, expect, it } from 'vitest';
import { setOccupationResolver } from '../src/inference/occupation.ts';
import {
  analyzeJobListing,
  type CanonicalMatch,
  derive,
  deriveMany,
  explicitBuckets,
  type Runtime,
} from '../src/ingest/index.ts';
import type { OpenSearchClient } from '../src/matchers/types.ts';
import { ALL_BUCKETS } from '../src/types.ts';

/** Fake OS client: resolves every surface to `<bucket>:resolved` (bucket read off the query filter). */
function bucketOf(query: Record<string, unknown>): string {
  const filters = (query as any)?.query?.bool?.filter ?? [];
  return filters.find((f: any) => f?.term?.bucket)?.term?.bucket ?? 'occupation';
}
const fakeClient: OpenSearchClient = {
  queryModelId: async () => null,
  msearch: async (queries) =>
    queries.map((q) => ({
      hits: {
        hits: [
          {
            _score: 80,
            _source: { canonical_key: `${bucketOf(q)}:resolved`, value: 'x', language_code: 'en', aliases: [] },
          },
        ],
      },
    })),
};

const sparseClient: OpenSearchClient = {
  queryModelId: async () => null,
  msearch: async (queries) =>
    queries.map((q) => {
      const bucket = bucketOf(q);
      const hitsByBucket: Record<string, unknown[]> = {
        location: [],
        workplace: [],
        employment: [
          {
            _score: 80,
            _source: {
              canonical_key: 'employment:full_time',
              value: 'full time',
              language_code: 'en',
              aliases: [],
            },
          },
        ],
        level: [
          {
            _score: 80,
            _source: {
              canonical_key: 'level:mid_level',
              value: 'mid level',
              language_code: 'en',
              aliases: [],
            },
          },
        ],
      };

      return {
        hits: {
          hits: hitsByBucket[bucket] ?? [],
        },
      };
    }),
};
/** Fake gazetteer: resolves any non-empty text to `location:resolved` (structured or
 *  unstructured), so the gazetteer-owned location path is exercised without real data. */
const fakeGazetteer = {
  resolve: (clauses: { text: string }[], structured?: string, country?: string) => {
    const text = structured ?? clauses.map((c) => c.text).join(' ');
    if (!text.trim()) return [];
    return [
      {
        canonicalKey: 'location:resolved',
        displayName: 'Resolved',
        termType: 'city',
        languageCode: country ?? 'ro',
        score: 0.95,
        method: 'gazetteer',
        evidence: [{ clause: structured ?? text, method: 'gazetteer', score: 0.95 }],
      },
    ];
  },
} as any;

const runtime: Runtime = {
  client: fakeClient,
  lexical: async () => {
    throw new Error('lexical unused in this test');
  },
  gazetteer: async () => fakeGazetteer,
  collar: async () => undefined,
};
const sparseRuntime: Runtime = {
  client: sparseClient,
  lexical: async () => {
    throw new Error('lexical unused in this test');
  },
  gazetteer: async () => undefined,
  collar: async () => undefined,
};

const match = (over: Partial<CanonicalMatch>): CanonicalMatch => ({
  canonicalKey: 'occupation:a',
  bucket: 'occupation',
  termType: 'canonical',
  matchedAlias: 'a',
  sourceText: 'a',
  evidenceSignal: 'structured',
  evidenceMatchText: 'a',
  itemIndex: 0,
  propositionIndex: 0,
  confidence: 1,
  source: 'derived',
  isConditional: false,
  isPreferred: false,
  isOffered: false,
  structuralTrust: 1,
  legitimacyScore: 1,
  ...over,
});

describe('derive / deriveMany (structured)', () => {
  it('resolves one structured field to a canonical match', async () => {
    const [m] = await derive('senior', { runtime, bucket: 'level' });
    expect(m.canonicalKey).toBe('level:resolved');
    expect(m.bucket).toBe('level');
    expect(m.confidence).toBe(1);
    expect(m.evidenceSignal).toBe('structured');
    expect(m.sourceText).toBe('senior');
  });

  it('batches many structured requests across buckets, routing location to the gazetteer', async () => {
    const matches = await deriveMany(
      [
        { bucket: 'level', input: 'senior' },
        { bucket: 'location', input: 'Cluj' },
        { bucket: 'qualifications', input: 'driving licence B', mode: 'lexical' },
      ],
      { runtime },
    );
    // Every requested bucket is represented; the OS (`:resolved`) and gazetteer
    // resolutions are present. Finite buckets may carry ADDITIONAL keys from the
    // rule-inference union — asserted structurally, not pinned to dictionary content.
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['level', 'location', 'qualifications']));
    const keys = matches.map((m) => m.canonicalKey);
    expect(keys).toContain('level:resolved');
    expect(keys).toContain('location:resolved');
    expect(keys).toContain('qualifications:resolved');
  });

  it('unions rule inference with OS, recovering a finite value past an OS miss', async () => {
    // sparseClient returns NO hits for company_type; the inference union must still
    // resolve it (the ingest structured path now mirrors the title profile).
    const matches = await deriveMany(
      [{ bucket: 'company_type', input: 'Banking, Finance & Insurance', locale: 'en' }],
      { runtime: sparseRuntime },
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.bucket === 'company_type')).toBe(true);
    expect(matches.every((m) => m.canonicalKey.startsWith('company_type:'))).toBe(true);
    expect(matches.every((m) => m.confidence === 1)).toBe(true);
  });

  it('keeps sourceText aligned to the originating request when earlier batched requests resolve nothing', async () => {
    const matches = await deriveMany(
      [
        { bucket: 'location', input: 'Lagos' },
        { bucket: 'workplace', input: 'Lagos' },
        { bucket: 'employment', input: 'Full Time' },
        { bucket: 'level', input: 'Mid level' },
      ],
      { runtime: sparseRuntime },
    );

    expect(matches).toEqual([
      expect.objectContaining({
        canonicalKey: 'employment:full_time',
        bucket: 'employment',
        sourceText: 'Full Time',
        evidenceMatchText: 'Full Time',
      }),
      expect.objectContaining({
        canonicalKey: 'level:mid_level',
        bucket: 'level',
        sourceText: 'Mid level',
        evidenceMatchText: 'Mid level',
      }),
    ]);
  });

  it('sends the alt occupation engine output through the title profile as alt signals', async () => {
    const altRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => ({ lookupAll: () => [] }) as any,
      gazetteer: async () => fakeGazetteer,
      collar: async () => undefined,
    };
    setOccupationResolver(
      async () =>
        ({
          leafCanonicalTerms: [{ graphNodeId: 1001, canonicalTerm: 'Software Engineer', confidence: 0.91 }],
          familyCanonicalTerms: [{ graphNodeId: 2002, canonicalTerm: 'ICT Professionals', confidence: 0.8 }],
        }) as any,
    );
    try {
      const matches = await deriveMany([{ profile: 'title', input: 'Backend Developer' }], {
        runtime: altRuntime,
        locale: 'en',
      });
      const alt = matches.filter((m) => m.evidenceSignal.startsWith('alt_occupation'));
      expect(alt.map((m) => m.evidenceSignal).sort()).toEqual(['alt_occupation', 'alt_occupation_family']);
      expect(alt.every((m) => m.bucket === 'occupation')).toBe(true);
      const leaf = alt.find((m) => m.evidenceSignal === 'alt_occupation');
      const family = alt.find((m) => m.evidenceSignal === 'alt_occupation_family');
      expect(leaf?.canonicalKey).toBe('occupation:alt:software_engineer');
      expect(family?.canonicalKey).toBe('occupation:alt_family:ict_professionals');
      expect(leaf?.confidence).toBeCloseTo(0.91, 5); // engine confidence preserved, not flattened to 1
    } finally {
      setOccupationResolver(undefined);
    }
  });

  it('skips empty input and requires a bucket or a profile', async () => {
    expect(await derive('   ', { runtime, bucket: 'level' })).toEqual([]);
    await expect(derive('x', { runtime })).rejects.toThrow(/bucket or a profile/);
    await expect(derive('x', { runtime, profile: 'nope' })).rejects.toThrow(/unknown profile/);
  });
});

describe('analyzeJobListing (unstructured)', () => {
  it('probes every bucket over the body and parses salary', async () => {
    const { matches, salaryRanges } = await analyzeJobListing('Backend engineer. Salariu 5000 - 7000 RON pe luna.', {
      runtime,
    });
    // one clause × every bucket → deduped to one match per bucket, plus whatever
    // the alt occupation engine (packages/occupation) independently guesses.
    expect(new Set(matches.map((m) => m.bucket)).size).toBe(ALL_BUCKETS.length);
    const nonAlt = matches.filter((m) => !m.evidenceSignal.startsWith('alt_occupation'));
    expect(nonAlt.every((m) => m.evidenceSignal === 'description')).toBe(true);
    expect(Array.isArray(salaryRanges)).toBe(true);
    expect(salaryRanges[0]?.currency).toBe('RON');
  });

  it('returns empty for blank text', async () => {
    expect(await analyzeJobListing('  ', { runtime })).toEqual({ matches: [], salaryRanges: [] });
  });
});

describe('explicitBuckets', () => {
  it('groups + dedupes per bucket, highest confidence wins', () => {
    const grouped = explicitBuckets([
      match({ canonicalKey: 'occupation:dev', bucket: 'occupation', confidence: 0.5 }),
      match({ canonicalKey: 'occupation:dev', bucket: 'occupation', confidence: 1 }),
      match({ canonicalKey: 'level:senior', bucket: 'level' }),
    ]);
    expect(grouped.occupation).toEqual(['occupation:dev']);
    expect(grouped.level).toEqual(['level:senior']);
    expect(grouped.capabilities).toEqual([]);
  });
});
