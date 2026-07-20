import { describe, expect, it } from 'vitest';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';
import { VectorStore } from '../src/vector-store.ts';

function term(
  canonicalKey: string,
  bucket: BucketName,
  languageCode: SupportedLanguage,
  displayName = canonicalKey,
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 't', displayName, value: displayName, languageCode, aliases: [] };
}
const v = (...xs: number[]) => Float32Array.from(xs);

function store(): VectorStore {
  return VectorStore.fromEntries('stub', 3, [
    { term: term('occupation:nurse', 'occupation', 'en'), vector: v(1, 0, 0) },
    { term: term('occupation:nurse', 'occupation', 'ro'), vector: v(0.8, 0.6, 0) },
    { term: term('occupation:doctor', 'occupation', 'en'), vector: v(0, 1, 0) },
    { term: term('capabilities:java', 'capabilities', 'en'), vector: v(0, 0, 1) },
  ]);
}

describe('VectorStore', () => {
  it('lists buckets and exposes term metadata', () => {
    const s = store();
    expect(s.buckets().sort()).toEqual(['capabilities', 'occupation']);
    expect(s.size).toBe(4);
  });

  it('searchBest returns the closest term within a bucket', () => {
    const best = store().searchBest(v(1, 0, 0), 'occupation');
    expect(best).not.toBeNull();
    expect(store().term(best!.index).canonicalKey).toBe('occupation:nurse');
    expect(best!.score).toBeCloseTo(1, 5);
  });

  it('searchTopK de-duplicates by canonical key across languages', () => {
    const hits = store().searchTopK(v(1, 0, 0), 'occupation', 5);
    // nurse (en+ro collapse to one, best score 1) then doctor (0).
    expect(hits.map((h) => store().term(h.index).canonicalKey)).toEqual(['occupation:nurse', 'occupation:doctor']);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it('respects a language filter', () => {
    const hits = store().searchTopK(v(1, 0, 0), 'occupation', 5, ['ro']);
    expect(hits).toHaveLength(1); // only the ro nurse row; doctor is en-only
    expect(store().term(hits[0].index).canonicalKey).toBe('occupation:nurse');
    expect(hits[0].score).toBeCloseTo(0.8, 5);
  });

  it('similarityTo scores a specific term, honoring language', () => {
    const s = store();
    expect(s.similarityTo(v(1, 0, 0), 'occupation:nurse')).toBeCloseTo(1, 5);
    expect(s.similarityTo(v(1, 0, 0), 'occupation:nurse', 'ro')).toBeCloseTo(0.8, 5);
    expect(s.similarityTo(v(1, 0, 0), 'occupation:missing')).toBeNull();
  });

  it('hubness centering demotes a term that sits near the global centroid', () => {
    // Three vectors point at [1,0] (so the centroid leans that way) and one at
    // [0,1]. A 45° query ties on raw dot, but the "hub" (near centroid) is demoted.
    const entries = [
      { term: term('occupation:hub', 'occupation', 'en'), vector: v(1, 0) },
      { term: term('occupation:f1', 'occupation', 'en'), vector: v(1, 0) },
      { term: term('occupation:f2', 'occupation', 'en'), vector: v(1, 0) },
      { term: term('occupation:specific', 'occupation', 'en'), vector: v(0, 1) },
    ];
    const query = v(Math.SQRT1_2, Math.SQRT1_2);

    const raw = VectorStore.fromEntries('stub', 2, entries, 0);
    const centered = VectorStore.fromEntries('stub', 2, entries, 1);

    // Without centering the hub-direction term wins (ties broken by first seen).
    expect(raw.term(raw.searchBest(query, 'occupation')!.index).canonicalKey).toBe('occupation:hub');
    // With centering the non-hub specific term wins.
    expect(centered.term(centered.searchBest(query, 'occupation')!.index).canonicalKey).toBe('occupation:specific');
  });
});
