import { beforeEach, describe, expect, it } from 'vitest';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';
import { VectorStore } from '../src/vector-store.ts';

// Concept embedder: text/term -> unit vector over {remote, fulltime, senior}.
const CONCEPTS = ['remote', 'full', 'senior'];
function vec(text: string): Float32Array {
  const t = text.toLowerCase();
  const v = new Float32Array(4);
  // a "flexible workspace" phrase lands partway toward remote (dot 0.55).
  if (t.includes('flexible workspace')) {
    v[0] = 0.55;
    v[1] = Math.sqrt(1 - 0.55 * 0.55);
    return v;
  }
  const idx = CONCEPTS.findIndex((c) => t.includes(c));
  v[idx >= 0 ? idx : 3] = 1;
  return v;
}

function term(
  canonicalKey: string,
  bucket: BucketName,
  displayName: string,
  aliases: string[],
  languageCode: SupportedLanguage = 'en',
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 't', displayName, value: displayName, languageCode, aliases };
}

const TERMS: DictionaryTerm[] = [
  term('workplace:remote', 'workplace', 'Remote', ['remote', 'remote work', 'work from home', 'wfh']),
  term('employment:full_time', 'employment', 'Full Time', ['full time', 'full-time'], 'global'),
  term('level:senior', 'level', 'Senior', ['senior', 'sr']),
];

let embedder: TextEmbedder & { calls: number };
let extractor: TermExtractor;

beforeEach(() => {
  embedder = {
    model: 'stub',
    calls: 0,
    async embed(texts: string[]) {
      this.calls += texts.length;
      return texts.map(vec);
    },
    async embedOne(t: string) {
      this.calls += 1;
      return vec(t);
    },
  };
  extractor = TermExtractor.fromComponents({
    store: VectorStore.fromEntries(
      'stub',
      4,
      TERMS.map((t) => ({ term: t, vector: vec(t.displayName) })),
    ),
    lexical: LexicalIndex.fromTerms(TERMS),
    embedder,
  });
});

describe('structured-field fusion', () => {
  it('resolves a structured value to a canonical term (method structured)', async () => {
    const r = await extractor.extract({ structured: { employment: 'Full time' } }, { targetBuckets: ['employment'] });
    expect(r.matchesByBucket.employment?.[0].canonicalKey).toBe('employment:full_time');
    expect(r.matchesByBucket.employment?.[0].method).toBe('structured');
    expect(r.matchesByBucket.employment?.[0].score).toBeCloseTo(0.99, 2);
  });

  it('structured hit outranks / merges with a prose hit', async () => {
    const r = await extractor.extract(
      { description: 'remote work', structured: { workplace: 'work from home' } },
      { targetBuckets: ['workplace'] },
    );
    const remote = r.matchesByBucket.workplace?.find((t) => t.canonicalKey === 'workplace:remote');
    expect(remote?.method).toBe('structured'); // structured wins the label
  });
});

describe('negation guard', () => {
  it('suppresses a negated alias ("no remote work")', async () => {
    const r = await extractor.extract('no remote work at this company', { targetBuckets: ['workplace'] });
    expect(r.matchesByBucket.workplace).toBeUndefined();
  });

  it('still matches the positive statement ("fully remote")', async () => {
    const r = await extractor.extract('this is a fully remote role', { targetBuckets: ['workplace'] });
    expect(r.matchesByBucket.workplace?.[0].canonicalKey).toBe('workplace:remote');
  });

  it('handles Romanian negation ("fără")', async () => {
    const r = await extractor.extract('fără full time disponibil', { targetBuckets: ['employment'] });
    expect(r.matchesByBucket.employment).toBeUndefined();
  });
});

describe('controlled semantic backstop', () => {
  it('rejects a mid-similarity paraphrase below the strict controlled bar', async () => {
    // "flexible workspace" ~0.55 to remote; controlled bar = 0.50 + 0.12 = 0.62.
    const r = await extractor.extract('flexible workspace culture', { targetBuckets: ['workplace'] });
    expect(r.matchesByBucket.workplace).toBeUndefined();
  });

  it('accepts an exact alias regardless of the semantic bar', async () => {
    const r = await extractor.extract('work from home friendly', { targetBuckets: ['workplace'] });
    expect(r.matchesByBucket.workplace?.[0].canonicalKey).toBe('workplace:remote');
  });
});
