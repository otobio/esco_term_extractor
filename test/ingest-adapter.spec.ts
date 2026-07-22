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

  it('routes a structured occupation field through the title-profile pipeline, keeping only occupation matches', async () => {
    // Alias-scan tags "senior" as a level span; computeResidual peels it off the
    // clause, so resolveTitle resolves BOTH level (from the span) and occupation
    // (from the peeled residual / whole-clause fallback) in one pass. deriveOccupation
    // must keep only the occupation bucket's matches, proving it delegates to the full
    // multi-bucket resolveTitle() rather than a raw single-surface OS query.
    const titleLexical = {
      lookupAll: (text: string) =>
        /senior/i.test(text)
          ? [
              {
                entry: {
                  canonicalKey: 'level:senior',
                  bucket: 'level' as const,
                  displayName: 'Senior',
                  termType: 'canonical',
                  languageCode: 'en' as const,
                },
                words: 1,
                gram: 'senior',
              },
            ]
          : [],
    };
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => titleLexical as any,
      gazetteer: async () => fakeGazetteer,
      collar: async () => undefined,
    };

    const matches = await derive('Senior React Developer', { runtime: occupationRuntime, bucket: 'occupation' });
    expect(matches.every((m) => m.bucket === 'occupation')).toBe(true);
    expect(matches.some((m) => m.canonicalKey === 'occupation:resolved')).toBe(true);
    // The real inferOccupation engine also runs (unstubbed here) and tags its own
    // output alt_occupation*; only the title-profile-sourced match is 'structured'.
    const nonAlt = matches.filter((m) => !m.evidenceSignal.startsWith('alt_occupation'));
    expect(nonAlt.length).toBeGreaterThan(0);
    expect(nonAlt.every((m) => m.evidenceSignal === 'structured')).toBe(true);
  });

  it('surfaces the alt occupation engine through the same structured-occupation path', async () => {
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => ({ lookupAll: () => [] }) as any,
      gazetteer: async () => fakeGazetteer,
      collar: async () => undefined,
    };
    setOccupationResolver(
      async () =>
        ({
          leafCanonicalTerms: [{ graphNodeId: 1, canonicalTerm: 'Software Engineer', confidence: 0.8 }],
          familyCanonicalTerms: [],
        }) as any,
    );
    try {
      const matches = await derive('Senior React Developer', {
        runtime: occupationRuntime,
        bucket: 'occupation',
        locale: 'en',
      });
      const alt = matches.find((m) => m.evidenceSignal === 'alt_occupation');
      expect(alt?.bucket).toBe('occupation');
      expect(alt?.canonicalKey).toBe('occupation:alt:software_engineer');
    } finally {
      setOccupationResolver(undefined);
    }
  });

  it('applies structured-occupation routing inside deriveMany alongside other buckets', async () => {
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => ({ lookupAll: () => [] }) as any,
      gazetteer: async () => fakeGazetteer,
      collar: async () => undefined,
    };
    const matches = await deriveMany(
      [
        { bucket: 'occupation', input: 'React Developer' },
        { bucket: 'level', input: 'senior' },
        { bucket: 'location', input: 'Cluj' },
      ],
      { runtime: occupationRuntime },
    );
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['occupation', 'level', 'location']));
    const occupation = matches.filter((m) => m.bucket === 'occupation' && !m.evidenceSignal.startsWith('alt_occupation'));
    expect(occupation.length).toBeGreaterThan(0);
    expect(occupation.every((m) => m.evidenceSignal === 'structured')).toBe(true);
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
    // one clause × every bucket except occupation → deduped to one match per bucket.
    // Occupation is never resolved from body text (needs the title-profile treatment
    // to be trustworthy, which isn't wired up for free-text clauses here).
    expect(new Set(matches.map((m) => m.bucket)).size).toBe(ALL_BUCKETS.length - 1);
    expect(matches.every((m) => m.bucket !== 'occupation')).toBe(true);
    expect(matches.every((m) => m.evidenceSignal === 'description')).toBe(true);
    expect(Array.isArray(salaryRanges)).toBe(true);
    expect(salaryRanges[0]?.currency).toBe('RON');
  });

  it('returns empty for blank text', async () => {
    expect(await analyzeJobListing('  ', { runtime })).toEqual({ matches: [], salaryRanges: [] });
  });

  it('narrows the OS cross product to the requested buckets when `buckets` is passed', async () => {
    // `location` isn't part of the OS cross product (it always resolves separately via
    // the gazetteer, over the whole body), so it's excluded here to isolate what `buckets` controls.
    const { matches } = await analyzeJobListing('Backend engineer with strong analytical skills.', {
      runtime,
      buckets: ['compensation', 'benefits'],
    });
    const osMatches = matches.filter((m) => m.bucket !== 'location');
    expect(new Set(osMatches.map((m) => m.bucket))).toEqual(new Set(['compensation', 'benefits']));
  });

  it('excludes occupation from the OS cross product even if explicitly requested in `buckets`', async () => {
    const { matches } = await analyzeJobListing('Backend engineer with strong analytical skills.', {
      runtime,
      buckets: ['occupation', 'level'],
    });
    const osMatches = matches.filter((m) => m.bucket !== 'location');
    expect(osMatches.every((m) => m.bucket === 'level')).toBe(true);
  });
});

describe('deriveLocation: cross-country structured field → workplace:abroad', () => {
  // A small synthetic country/place map (opaque to any real locale), behaving like the
  // real resolver: `country` gates by filtering out mentions whose languageCode differs
  // (see resolver.ts `resolve()`), so a structured field naming a foreign place resolves
  // to nothing on the filtered (location) call but is still visible on the unfiltered
  // (abroad-check) call.
  function fakeCountryGazetteer() {
    const places: Record<string, string> = { cluj: 'ro', paris: 'fr', london: 'gb' };
    return {
      resolve: (clauses: { text: string }[], structured?: string, country?: string) => {
        const text = (structured ?? clauses.map((c) => c.text).join(' ')).toLowerCase().trim();
        const cc = places[text];
        if (!cc) return [];
        if (country && cc !== country) return [];
        return [
          {
            canonicalKey: `location:${text}`,
            displayName: text,
            termType: 'city',
            languageCode: cc,
            score: 0.95,
            method: 'gazetteer',
            evidence: [{ clause: text, method: 'gazetteer', score: 0.95 }],
          },
        ];
      },
    } as any;
  }
  const countryRuntime = (): Runtime => ({
    client: fakeClient,
    lexical: async () => {
      throw new Error('lexical unused in this test');
    },
    gazetteer: async () => fakeCountryGazetteer(),
    collar: async () => undefined,
  });

  it('emits workplace:abroad (not location) when the structured field resolves only to a foreign country', async () => {
    const matches = await derive('Paris', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([
      expect.objectContaining({ canonicalKey: 'workplace:abroad', bucket: 'workplace', sourceText: 'Paris' }),
    ]);
  });

  it('emits no abroad signal when the structured field resolves to the listing\'s own country', async () => {
    const matches = await derive('Cluj', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([expect.objectContaining({ canonicalKey: 'location:cluj', bucket: 'location' })]);
  });

  it('emits nothing for a field the gazetteer cannot resolve at all', async () => {
    const matches = await derive('Nowhereville', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([]);
  });

  it('applies the same behavior via deriveMany, and does not affect analyzeJobListing (unstructured) bodies', async () => {
    const many = await deriveMany([{ bucket: 'location', input: 'London', countryCode: 'ro' }], {
      runtime: countryRuntime(),
    });
    expect(many).toEqual([
      expect.objectContaining({ canonicalKey: 'workplace:abroad', bucket: 'workplace', sourceText: 'London' }),
    ]);

    // Free-text body mentioning a foreign place is NOT a structured field — no cross-check.
    const { matches } = await analyzeJobListing('We are hiring, based near Paris office sometimes.', {
      runtime: countryRuntime(),
      countryCode: 'ro',
    });
    expect(matches.some((m) => m.canonicalKey === 'workplace:abroad')).toBe(false);
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
