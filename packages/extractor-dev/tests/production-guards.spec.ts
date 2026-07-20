import { describe, expect, it } from 'vitest';
import { getDefaultBucketConfigs } from '../src/buckets.ts';
import { isUsableTerm } from '../src/dictionary.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';
import { VectorStore } from '../src/vector-store.ts';

function term(
  canonicalKey: string,
  bucket: BucketName,
  displayName: string,
  languageCode: SupportedLanguage = 'en',
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 't', displayName, value: displayName, languageCode, aliases: [] };
}

describe('isUsableTerm (data-quality sanitizer)', () => {
  it('rejects URL / code display names', () => {
    expect(isUsableTerm(term('o:x', 'occupation', 'http://data.europa.eu/ux2/nace2.1/5224'))).toBe(false);
    expect(isUsableTerm(term('o:x', 'occupation', 'ftp://foo'))).toBe(false);
  });
  it('rejects empty / single-char display names', () => {
    expect(isUsableTerm(term('o:x', 'occupation', ''))).toBe(false);
    expect(isUsableTerm(term('o:x', 'occupation', 'a'))).toBe(false);
  });
  it('keeps normal display names', () => {
    expect(isUsableTerm(term('o:x', 'occupation', 'software developer'))).toBe(true);
  });
});

describe('bucket config', () => {
  it('marks occupation and level as title-anchored, others not', () => {
    const cfg = getDefaultBucketConfigs();
    expect(cfg.occupation.titleAnchored).toBe(true);
    expect(cfg.level.titleAnchored).toBe(true);
    expect(cfg.capabilities.titleAnchored).toBe(false);
    expect(cfg.location.titleAnchored).toBe(false);
  });
});

describe('title anchoring', () => {
  // occupation thresholds: title 0.50, description 0.50 + 0.07 = 0.57.
  // Every clause embeds so that cosine with the term = 0.54, which passes the
  // title bar but fails the description bar. (fromEntries has centering off.)
  const SCORE = 0.54;
  const vec = Float32Array.from([SCORE, Math.sqrt(1 - SCORE * SCORE)]);
  const TERMS = [term('occupation:widget_maker', 'occupation', 'widget maker')];
  const store = VectorStore.fromEntries('stub', 2, [{ term: TERMS[0], vector: Float32Array.from([1, 0]) }]);
  const lexical = LexicalIndex.fromTerms(TERMS);
  const embedder: TextEmbedder = {
    model: 'stub',
    async embed(texts) {
      return texts.map(() => vec);
    },
    async embedOne() {
      return vec;
    },
  };
  const extractor = TermExtractor.fromComponents({ store, lexical, embedder });

  it('accepts a title-sourced occupation at 0.68 (>= 0.64)', async () => {
    const r = await extractor.extract({ title: 'anything' });
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:widget_maker');
  });

  it('suppresses the same 0.68 match from the description (< 0.71)', async () => {
    const r = await extractor.extract({ description: 'anything' });
    expect(r.matchesByBucket.occupation).toBeUndefined();
  });
});

describe('embedding dimension guard', () => {
  const TERMS = [term('occupation:x', 'occupation', 'x')];
  const store = VectorStore.fromEntries('stub', 4, [{ term: TERMS[0], vector: Float32Array.from([1, 0, 0, 0]) }]);
  const badEmbedder: TextEmbedder = {
    model: 'wrong',
    async embed(texts) {
      return texts.map(() => Float32Array.from([1, 0])); // 2-d, index is 4-d
    },
    async embedOne() {
      return Float32Array.from([1, 0]);
    },
  };

  it('throws a clear error on dimension mismatch', async () => {
    const extractor = TermExtractor.fromComponents({
      store,
      lexical: LexicalIndex.fromTerms(TERMS),
      embedder: badEmbedder,
    });
    await expect(extractor.extract('some text')).rejects.toThrow(/dimension mismatch/i);
  });
});
