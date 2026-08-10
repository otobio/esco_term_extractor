import { describe, expect, it } from 'vitest';
import { OccupationCapabilityMap } from '../../../src/derive/capabilities.ts';
import { buildLexicalIndex } from '../../../test/support/lexical.ts';
import type { BucketName, DictionaryTerm } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

const term = (canonicalKey: string, bucket: BucketName, displayName: string, aliases: string[]): DictionaryTerm => ({
  canonicalKey,
  bucket,
  termType: bucket,
  displayName,
  value: displayName,
  languageCode: 'en',
  aliases,
});

const TERMS: DictionaryTerm[] = [
  term('occupation:nurse', 'occupation', 'nurse', ['registered nurse', 'nurse']),
  term('capability:knowledge:nursing_science', 'capabilities', 'nursing science', ['nursing science']),
  term('capability:skill:first_aid', 'capabilities', 'first aid', ['first aid']),
];
const V: Record<string, Float32Array> = {
  'occupation:nurse': Float32Array.from([1, 0, 0]),
  'capability:knowledge:nursing_science': Float32Array.from([0, 1, 0]),
  'capability:skill:first_aid': Float32Array.from([0, 0, 1]),
};
const vec = (t: string) => {
  const s = t.toLowerCase();
  if (s.includes('registered nurse') || s === 'nurse') return Float32Array.from([1, 0, 0]);
  if (s.includes('caregiver')) return Float32Array.from([0.8, 0.6, 0]); // weak semantic occupation
  return Float32Array.from([0, 0, 0]); // capability clauses -> lexical only
};
const embedder: TextEmbedder = {
  model: 'stub',
  async embed(ts) {
    return ts.map(vec);
  },
  async embedOne(t) {
    return vec(t);
  },
};

const occCaps = OccupationCapabilityMap.fromEntries({
  'occupation:nurse': { e: ['capability:knowledge:nursing_science'], o: [] }, // first_aid NOT essential
});

const extractor = TermExtractor.fromComponents({
  store: VectorStore.fromEntries(
    'stub',
    3,
    TERMS.map((t) => ({ term: t, vector: V[t.canonicalKey] })),
  ),
  lexical: buildLexicalIndex(TERMS),
  embedder,
  occCaps,
});

const capScore = (r: Awaited<ReturnType<typeof extractor.extract>>, key: string) =>
  r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === key)?.score ?? 0;

describe('capability consistency re-rank', () => {
  it('boosts a capability essential to a CONFIDENT occupation', async () => {
    const r = await extractor.extract('registered nurse. nursing science. first aid.', {
      targetBuckets: ['occupation', 'capabilities'],
    });
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:nurse');
    // nursing_science (essential) outranks first_aid (not essential), both same base.
    expect(capScore(r, 'capability:knowledge:nursing_science')).toBeGreaterThan(
      capScore(r, 'capability:skill:first_aid'),
    );
    const ns = r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === 'capability:knowledge:nursing_science');
    expect(ns?.evidence.some((e) => e.clause === 'consistent with occupation')).toBe(true);
  });

  it('does NOT boost when the occupation is only a weak guess (< 0.85)', async () => {
    const r = await extractor.extract('medical caregiver. nursing science. first aid.', {
      targetBuckets: ['occupation', 'capabilities'],
    });
    // occupation matched only semantically at 0.8 -> not confident -> no boost.
    expect(capScore(r, 'capability:knowledge:nursing_science')).toBeCloseTo(
      capScore(r, 'capability:skill:first_aid'),
      5,
    );
    const ns = r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === 'capability:knowledge:nursing_science');
    expect(ns?.evidence.some((e) => e.clause === 'consistent with occupation')).toBe(false);
  });
});

describe('essential capability backfill', () => {
  it('adds an essential capability of a CONFIDENT occupation even when the text never mentions it', async () => {
    const r = await extractor.extract('registered nurse. general ward duties.', {
      targetBuckets: ['occupation', 'capabilities'],
    });
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:nurse');
    const ns = r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === 'capability:knowledge:nursing_science');
    expect(ns).toBeDefined();
    expect(ns?.score).toBeCloseTo(0.4, 5);
    expect(ns?.evidence.some((e) => e.method === 'inferred' && e.clause.includes('essential capability of'))).toBe(
      true,
    );
    // first_aid is NOT essential for nurse in this fixture -> must not be backfilled.
    expect(r.matchesByBucket.capabilities?.some((t) => t.canonicalKey === 'capability:skill:first_aid')).toBe(false);
  });

  it('does NOT backfill when the occupation is only a weak guess (< 0.85)', async () => {
    const r = await extractor.extract('medical caregiver. general ward duties.', {
      targetBuckets: ['occupation', 'capabilities'],
    });
    // caregiver semantically bleeds into nursing_science's vector in this stub, so it may
    // still surface via a plain semantic hit — but never via the occupation-driven backfill.
    const ns = r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === 'capability:knowledge:nursing_science');
    expect(ns?.evidence.some((e) => e.method === 'inferred' && e.clause.includes('essential capability of'))).toBe(
      false,
    );
  });

  it('never lowers a text-grounded score, and text-grounded matches always outrank a backfill', async () => {
    const r = await extractor.extract('registered nurse. nursing science.', {
      targetBuckets: ['occupation', 'capabilities'],
    });
    const ns = r.matchesByBucket.capabilities?.find((t) => t.canonicalKey === 'capability:knowledge:nursing_science');
    // Lexically matched + consistency-boosted; must stay above the 0.4 backfill floor.
    expect(ns?.score).toBeGreaterThan(0.4);
  });
});
