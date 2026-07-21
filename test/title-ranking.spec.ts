import { GazetteerIndex, GazetteerResolver } from '@term-extractor/gazetteer';
import { describe, expect, it } from 'vitest';
import type { OpenSearchClient } from '../src/matchers/types.ts';
import { resolveTitle, type Verifier } from '../src/profiles/title.ts';
import type { BucketName } from '../src/types.ts';

/**
 * These tests exercise the title profile's *ranking* contract end-to-end through
 * resolveTitle, not a mock of the internals:
 *   - residual (modifier-peeled core) outranks a higher-scored full-clause fuzzy hit
 *   - an exact (grounded) full-clause match still beats the residual
 *   - --verify stamps a dense-agreement score on OS rows, and never on location
 *
 * The fake OS client resolves each query by the surface embedded in it
 * (query_text: item.surface), longest match wins — so the same title fans out to
 * different keys per candidate exactly as the live index would.
 */

type Hit = { key: string; name: string; score: number; aliases?: string[] };
const respOf = (hits: Hit[]) => ({
  hits: {
    hits: hits.map((h) => ({
      _score: h.score,
      _source: {
        canonical_key: h.key,
        value: h.name,
        display_name: h.name,
        aliases: h.aliases ?? [],
        language_code: 'en',
      },
    })),
  },
});

// (bucket, surface-substring) → canned hits. Longest matching surface wins, so a
// full clause ("senior python developer") and its residual ("python developer")
// resolve to different keys.
const TABLE: { bucket: string; surface: string; hits: Hit[] }[] = [
  {
    bucket: 'occupation',
    surface: 'senior python developer',
    hits: [{ key: 'occupation:sensor_engineer', name: 'sensor engineer', score: 50 }],
  },
  {
    bucket: 'occupation',
    surface: 'python developer',
    hits: [{ key: 'occupation:software_developer', name: 'software developer', score: 9 }],
  },
  {
    bucket: 'occupation',
    surface: 'lead nurse',
    hits: [{ key: 'occupation:registered_nurse', name: 'registered nurse', score: 100, aliases: ['lead nurse'] }],
  },
  { bucket: 'occupation', surface: 'nurse', hits: [{ key: 'occupation:nurse_aide', name: 'nurse aide', score: 40 }] },
  {
    bucket: 'occupation',
    surface: 'developer',
    hits: [{ key: 'occupation:software_developer', name: 'software developer', score: 9 }],
  },
  {
    bucket: 'occupation',
    surface: 'office assistant',
    hits: [
      {
        key: 'occupation:office_administrator',
        name: 'office administrator',
        score: 120,
        aliases: ['office assistant'],
      },
    ],
  },
  {
    bucket: 'occupation',
    surface: 'assistant',
    hits: [{ key: 'occupation:podiatry_assistant', name: 'podiatry assistant', score: 80 }],
  },
  {
    bucket: 'capabilities',
    surface: 'python',
    hits: [{ key: 'capability:knowledge:python', name: 'Python', score: 90, aliases: ['python'] }],
  },
  {
    bucket: 'level',
    surface: 'senior',
    hits: [{ key: 'level:senior', name: 'Senior', score: 80, aliases: ['senior'] }],
  },
  { bucket: 'level', surface: 'lead', hits: [{ key: 'level:lead', name: 'Lead', score: 80, aliases: ['lead'] }] },
  {
    bucket: 'occupation',
    surface: 'accountant',
    hits: [{ key: 'occupation:accountant', name: 'Accountant', score: 70, aliases: ['accountant'] }],
  },
];

// A tiny two-tier gazetteer (Cluj county → Cluj-Napoca) reused by the location-peel
// test below — a bare "Cluj" resolves because a deeper tier exists under it.
function clujGazetteer(): GazetteerResolver {
  return new GazetteerResolver(
    GazetteerIndex.fromTerms(
      [
        {
          canonicalKey: 'location:depth2:cluj',
          bucket: 'location',
          termType: 'depth2',
          displayName: 'Cluj',
          value: 'Cluj',
          languageCode: 'en',
          aliases: ['Cluj'],
        },
        {
          canonicalKey: 'location:depth3:cluj_napoca_cluj',
          bucket: 'location',
          termType: 'depth3',
          displayName: 'Cluj-Napoca, Cluj',
          value: 'Cluj-Napoca',
          languageCode: 'en',
          aliases: ['Cluj-Napoca'],
        },
      ],
      [{ parentKey: 'location:depth2:cluj', childKey: 'location:depth3:cluj_napoca_cluj' }],
    ),
  );
}

const fakeClient: OpenSearchClient = {
  queryModelId: async () => 'model-1',
  msearch: async (queries) =>
    queries.map((q) => {
      const bucket = (q as any).query.bool.filter[0].term.bucket as string;
      const json = JSON.stringify(q).toLowerCase();
      const hit = TABLE.filter((t) => t.bucket === bucket && json.includes(t.surface)).sort(
        (a, b) => b.surface.length - a.surface.length,
      )[0];
      return respOf(hit ? hit.hits : []);
    }),
};

// Fake scan: emit a hit for each known token present in the clause, carrying its
// bucket. Drives peeling (level) and span-tagging (capabilities).
const KNOWN: { gram: string; bucket: BucketName }[] = [
  { gram: 'senior', bucket: 'level' },
  { gram: 'lead', bucket: 'level' },
  { gram: 'python', bucket: 'capabilities' },
  { gram: 'assistant', bucket: 'occupation' }, // bare generic head
  { gram: 'office assistant', bucket: 'occupation' }, // real compound
];
const fakeLexical = {
  lookupAll: (clause: string) => {
    const text = ` ${clause.toLowerCase()} `;
    return KNOWN.filter((k) => text.includes(` ${k.gram} `)).map((k) => ({
      gram: k.gram,
      words: 1,
      entry: { bucket: k.bucket } as any,
    }));
  },
} as any;

describe('title profile — ranking', () => {
  it('ranks the modifier-peeled residual above a higher-scored full-clause fuzzy hit', async () => {
    // "senior" peels (level) → residual "python developer" resolves to software_developer (9),
    // while the full clause fuzzy-matches sensor_engineer (50). Residual must win.
    const r = await resolveTitle('Senior Python Developer', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:software_developer');
    expect(r.byBucket.occupation?.[0]?.span).toBe('python developer');
    // the fuzzy full-clause hit is retained, just ranked below the residual
    expect(r.byBucket.occupation?.some((t) => t.key === 'occupation:sensor_engineer')).toBe(true);
    expect(r.byBucket.level?.[0]?.key).toBe('level:senior');
  });

  it('keeps an exact (grounded) full-clause match above the residual', async () => {
    // "lead" peels → residual "nurse" (nurse_aide, 40, soft). But the full clause
    // "lead nurse" EXACTLY matches an alias of registered_nurse (grounded) → it wins
    // despite the residual's higher source priority. Protects real compounds.
    const r = await resolveTitle('Lead Nurse', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:registered_nurse');
    expect(r.byBucket.occupation?.[0]?.span).toBe('Lead Nurse'); // grounded hit came from the whole clause (verbatim)
  });
});

describe('title profile — generic head skip', () => {
  it('skips a bare generic head span but keeps the compound containing it', async () => {
    // scan emits both "assistant" (bare generic head) and "office assistant". The
    // bare head is dropped as occupation noise; the compound resolves.
    const r = await resolveTitle('Office Assistant', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:office_administrator');
    expect(r.byBucket.occupation?.[0]?.span).toBe('office assistant');
    expect(r.byBucket.occupation?.every((t) => t.span !== 'assistant')).toBe(true);
  });

  it('yields no occupation for a standalone bare generic head', async () => {
    const r = await resolveTitle('Assistant', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.occupation).toBeUndefined();
  });
});

describe('title profile — verify stamp', () => {
  it('stamps dense agreement on OS rows and never calls it for location', async () => {
    const seen: { span: string; texts: string[] }[] = [];
    const verify: Verifier = async (pairs) => {
      seen.push(...pairs);
      return pairs.map(() => 0.9);
    };
    // 'en' gazetteer so the county resolves under the en locale gate.
    const gaz = clujGazetteer();
    const r = await resolveTitle('Developer Cluj county', {
      client: fakeClient,
      lexical: fakeLexical,
      gazetteer: gaz,
      locale: 'en',
      verify,
    });

    expect(r.byBucket.occupation?.[0]?.agreement).toBe(0.9);
    // verify compares against the term's SAME-LOCALE surfaces, not the display name
    expect(seen.some((p) => p.texts.includes('software developer'))).toBe(true);
    // location resolved but was excluded from verification (grounded locally)
    expect(r.byBucket.location?.some((t) => t.key === 'location:depth2:cluj')).toBe(true);
    expect(r.byBucket.location?.[0]?.agreement).toBeUndefined();
    expect(seen.some((p) => p.texts.includes('Cluj'))).toBe(false);
  });

  it('leaves agreement undefined when no verifier is supplied', async () => {
    const r = await resolveTitle('Senior Python Developer', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.occupation?.[0]?.agreement).toBeUndefined();
  });
});

describe('title profile — location peel', () => {
  it('peels a resolved location from the occupation residual, same as level/workplace/etc.', async () => {
    const r = await resolveTitle('Accountant Cluj County', {
      client: fakeClient,
      lexical: fakeLexical,
      gazetteer: clujGazetteer(),
      locale: 'en',
    });
    expect(r.byBucket.location?.some((t) => t.key === 'location:depth2:cluj')).toBe(true);
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:accountant');
    // grounded on the peeled residual "accountant" (exact alias match), not the
    // whole clause "Accountant Cluj County" — proves the location span was peeled
    // before occupation candidates were built, not just coincidentally resolved.
    expect(r.byBucket.occupation?.[0]?.span).toBe('accountant');
  });

  it('does not peel location when no gazetteer is configured (falls back to the whole clause)', async () => {
    const r = await resolveTitle('Accountant Cluj County', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    expect(r.byBucket.location).toBeUndefined();
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:accountant');
    expect(r.byBucket.occupation?.[0]?.span).toBe('Accountant Cluj County');
  });
});
