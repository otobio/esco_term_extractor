import { describe, expect, it } from 'vitest';
import { CollarMap } from '../../../src/derive/collar.ts';
import { LexicalIndex } from '../../../src/lexical-index.ts';
import type { BucketName, DictionaryTerm } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

const term = (
  canonicalKey: string,
  bucket: BucketName,
  displayName: string,
  aliases: string[] = [],
): DictionaryTerm => ({
  canonicalKey,
  bucket,
  termType: bucket,
  displayName,
  value: displayName,
  languageCode: 'en',
  aliases,
});

const TERMS: DictionaryTerm[] = [
  term('occupation:welder', 'occupation', 'welder', ['welder']),
  term('occupation:accountant', 'occupation', 'accountant', ['accountant']),
  term('collar_kind:blue_collar', 'collar_kind', 'Blue Collar', ['blue collar']),
  term('collar_kind:white_collar', 'collar_kind', 'White Collar', ['white collar']),
];

// Concept embedder so the occupation lexical unigram corroborates.
const vecOf = (t: string) => {
  const s = t.toLowerCase();
  if (s.includes('welder')) return Float32Array.from([1, 0]);
  if (s.includes('accountant')) return Float32Array.from([0, 1]);
  return Float32Array.from([0, 0]);
};
const embedder: TextEmbedder = {
  model: 'stub',
  async embed(ts) {
    return ts.map(vecOf);
  },
  async embedOne(t) {
    return vecOf(t);
  },
};

const collar = CollarMap.fromEntries({
  'occupation:welder': { collar: 'collar_kind:blue_collar', confidence: 0.95 },
  'occupation:accountant': { collar: 'collar_kind:white_collar', confidence: 0.95 },
});

const extractor = TermExtractor.fromComponents({
  store: VectorStore.fromEntries(
    'stub',
    2,
    TERMS.map((t) => ({ term: t, vector: vecOf(t.displayName) })),
  ),
  lexical: LexicalIndex.fromTerms(TERMS),
  embedder,
  collar,
});

describe('collar_kind derivation from occupation', () => {
  it('derives blue collar from a blue-collar occupation', async () => {
    const r = await extractor.extract('experienced welder needed', { targetBuckets: ['occupation', 'collar_kind'] });
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:welder');
    const c = r.matchesByBucket.collar_kind?.[0];
    expect(c?.canonicalKey).toBe('collar_kind:blue_collar');
    expect(c?.method).toBe('derived');
    expect(c?.score).toBeGreaterThan(0.8); // high when occupation is set
    expect(c?.displayName).toBe('Blue Collar');
  });

  it('derives white collar from a white-collar occupation', async () => {
    const r = await extractor.extract('senior accountant', { targetBuckets: ['occupation', 'collar_kind'] });
    expect(r.matchesByBucket.collar_kind?.[0].canonicalKey).toBe('collar_kind:white_collar');
  });

  it('produces no collar when no occupation is found', async () => {
    const r = await extractor.extract('some unrelated text', { targetBuckets: ['occupation', 'collar_kind'] });
    expect(r.matchesByBucket.collar_kind).toBeUndefined();
  });
});
