import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollarMap } from '../src/derive/collar.ts';
import { setOccupationResolver } from '../src/inference/occupation.ts';
import type { OpenSearchClient } from '../src/matchers/types.ts';
import { resolveTitle } from '../src/profiles/title.ts';

// Canned OS response per bucket (fake client resolves by the query's bucket filter).
const CANNED: Record<string, { key: string; name: string; score: number }> = {
  occupation: { key: 'occupation:software_developer', name: 'software developer', score: 8 },
  capabilities: { key: 'capability:knowledge:python', name: 'Python', score: 90 },
  workplace: { key: 'workplace:remote', name: 'Remote', score: 200 },
  sector: { key: 'sector:hospitality', name: 'Hospitality', score: 200 },
};

const resp = (hits: { key: string; name: string; score: number }[]) => ({
  hits: {
    hits: hits.map((h) => ({
      _score: h.score,
      _source: { canonical_key: h.key, value: h.name, display_name: h.name, aliases: [], language_code: 'en' },
    })),
  },
});

const fakeClient: OpenSearchClient = {
  queryModelId: async () => 'model-1',
  msearch: async (queries) =>
    queries.map((q) => {
      const bucket = (q as any).query.bool.filter[0].term.bucket as string;
      const c = CANNED[bucket];
      return c ? resp([c]) : resp([]);
    }),
};

// Fake lexical: one-pass scan finds `python` (capability) and `remote` (workplace),
// each hit carrying its bucket via entry.bucket.
const fakeLexical = {
  lookupAll: (_clause: string) => [
    { gram: 'python', words: 1, entry: { bucket: 'capabilities' } as any },
    { gram: 'remote', words: 1, entry: { bucket: 'workplace' } as any },
    { gram: 'Alimentație / HoReCa', words: 2, entry: { bucket: 'sector' } as any },
  ],
} as any;

describe('title profile', () => {
  // The alt occupation engine is now always-on inside resolveTitle; stub its global
  // resolver so tests never hit the real (in-dev) engine. Individual tests override.
  beforeEach(() => setOccupationResolver(async () => ({ leafCanonicalTerms: [], familyCanonicalTerms: [] }) as any));
  afterEach(() => setOccupationResolver(undefined));

  it('resolves occupation (clause) + capabilities (span) + workplace (span) from one title', async () => {
    const r = await resolveTitle('Fullstack Python Developer - Remote Work', {
      client: fakeClient,
      lexical: fakeLexical,
      locale: 'en',
    });
    expect(r.clauses).toEqual(['Fullstack Python Developer - Remote Work']); // spaced dash not split by current tokenizer
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:software_developer');
    expect(r.byBucket.capabilities?.some((t) => t.key === 'capability:knowledge:python')).toBe(true);
    expect(r.byBucket.workplace?.[0]?.key).toBe('workplace:remote');
    // span provenance: workplace came from the `remote` span; occupation from the
    // modifier-peeled residual (workplace `remote` removed), which the residual
    // priority ranks above the whole-clause candidate that resolves to the same key.
    expect(r.byBucket.workplace?.[0]?.span).toBe('remote');
    expect(r.byBucket.occupation?.[0]?.span).toBe('fullstack python developer');
  });

  it('gates the whole-clause fallback for a bucket already tagged by a span', async () => {
    // capabilities is tagged by the `python` span, so it must NOT also fire the
    // whole-clause candidate — it resolves once, from the span.
    const r = await resolveTitle('python', { client: fakeClient, lexical: fakeLexical, locale: 'en' });
    const caps = r.byBucket.capabilities ?? [];
    expect(caps).toHaveLength(1);
    expect(caps[0].span).toBe('python');
  });

  it('derives sector from code-defined finite title facets', async () => {
    const r = await resolveTitle('Alimentație / HoReCa', { client: fakeClient, lexical: fakeLexical, locale: 'ro' });
    expect(r.byBucket.sector?.[0]).toMatchObject({
      key: 'sector:hospitality',
      span: 'Alimentație / HoReCa',
      status: 'resolved',
    });
  });

  it('derives collar_kind from the resolved occupation via the graph edge', async () => {
    const collar = CollarMap.fromEntries({
      'occupation:software_developer': { collar: 'collar_kind:white_collar', confidence: 0.95 },
    });
    const r = await resolveTitle('Fullstack Python Developer - Remote Work', {
      client: fakeClient,
      lexical: fakeLexical,
      locale: 'en',
      collar,
    });
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:software_developer');
    expect(r.byBucket.collar_kind?.[0]).toMatchObject({ key: 'collar_kind:white_collar', status: 'resolved' });
  });

  it('does not derive collar_kind when no collar map is supplied', async () => {
    const r = await resolveTitle('Fullstack Python Developer - Remote Work', {
      client: fakeClient,
      lexical: fakeLexical,
      locale: 'en',
    });
    expect(r.byBucket.collar_kind).toBeUndefined();
  });

  it('surfaces the alt occupation engine output (leaves + family) beside its own occupation', async () => {
    setOccupationResolver(
      async () =>
        ({
          leafCanonicalTerms: [{ graphNodeId: 1001, canonicalTerm: 'Software Engineer', confidence: 0.91 }],
          familyCanonicalTerms: [{ graphNodeId: 2002, canonicalTerm: 'ICT Professionals', confidence: 0.8 }],
        }) as any,
    );
    const r = await resolveTitle('Fullstack Python Developer', {
      client: fakeClient,
      lexical: fakeLexical,
      locale: 'en',
    });
    // Own occupation is unchanged; the engine's output rides alongside, not merged in.
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:software_developer');
    expect(r.altOccupation?.map((t) => t.termType)).toEqual(['occupation', 'occupation_group']);
    expect(r.altOccupation?.find((t) => t.termType === 'occupation')?.canonicalKey).toBe('software_engineer');
  });

  it('degrades to no altOccupation (but still resolves the profile) when the engine is unavailable', async () => {
    setOccupationResolver(async () => {
      throw new Error('engine unavailable');
    });
    const r = await resolveTitle('Fullstack Python Developer', {
      client: fakeClient,
      lexical: fakeLexical,
      locale: 'en',
    });
    expect(r.altOccupation).toBeUndefined();
    expect(r.byBucket.occupation?.[0]?.key).toBe('occupation:software_developer');
  });

  it('returns an empty result for empty input', async () => {
    const r = await resolveTitle('', { client: fakeClient, lexical: fakeLexical });
    expect(r.clauses).toEqual([]);
    expect(r.byBucket).toEqual({});
  });
});
