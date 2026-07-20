import { beforeEach, describe, expect, it } from 'vitest';
import { LexicalIndex } from '../../../src/lexical-index.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

// --- deterministic concept embedder (no model) --------------------------------
// Each text maps to a one-hot 5-d vector over {nurse, java, remote, hospitality, other}.
const CONCEPTS = ['nurse', 'java', 'remote', 'hospitality'];
function fakeVector(text: string): Float32Array {
  const t = text.toLowerCase();
  const vec = new Float32Array(5);
  const idx = CONCEPTS.findIndex((c) => t.includes(c));
  vec[idx >= 0 ? idx : 4] = 1;
  return vec;
}

class StubEmbedder implements TextEmbedder {
  readonly model = 'stub';
  calls = 0;
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map(fakeVector);
  }
  async embedOne(text: string): Promise<Float32Array> {
    this.calls++;
    return fakeVector(text);
  }
}

function term(
  canonicalKey: string,
  bucket: BucketName,
  languageCode: SupportedLanguage,
  displayName: string,
  aliases: string[] = [],
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 't', displayName, value: displayName, languageCode, aliases };
}

const TERMS: DictionaryTerm[] = [
  term('occupation:nurse', 'occupation', 'en', 'nurse', ['registered nurse', 'rn']),
  term('capabilities:java', 'capabilities', 'en', 'java', ['java programming']),
  term('workplace:remote', 'workplace', 'en', 'remote', ['work from home', 'wfh', 'remote']),
  term('employment:full_time', 'employment', 'global', 'full time', ['full-time']),
  term('company_type:hospitality', 'company_type', 'en', 'hospitality'),
];

let embedder: StubEmbedder;
let extractor: TermExtractor;

beforeEach(() => {
  embedder = new StubEmbedder();
  extractor = TermExtractor.fromComponents({
    store: VectorStore.fromEntries(
      'stub',
      5,
      TERMS.map((t) => ({ term: t, vector: fakeVector(t.displayName) })),
    ),
    lexical: LexicalIndex.fromTerms(TERMS),
    embedder,
  });
});

describe('unstructured extract', () => {
  it('extracts across buckets with semantic + lexical corroboration', async () => {
    const r = await extractor.extract('registered nurse. remote work. java programming.');
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:nurse');
    expect(r.matchesByBucket.occupation?.[0].method).toBe('both');
    expect(r.matchesByBucket.workplace?.[0].canonicalKey).toBe('workplace:remote');
    expect(r.matchesByBucket.capabilities?.[0].canonicalKey).toBe('capabilities:java');
  });

  it('rejects a unigram lexical hit that is not semantically corroborated', async () => {
    // "remote" appears but the clause embeds to the nurse concept -> workplace:remote
    // must be suppressed by corroboration.
    const r = await extractor.extract('remote nurse');
    expect(r.matchesByBucket.workplace).toBeUndefined();
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:nurse');
  });

  it('extractFromJobPost combines title and description', async () => {
    const r = await extractor.extractFromJobPost('registered nurse', 'java programming');
    expect(r.matchesByBucket.occupation?.[0].canonicalKey).toBe('occupation:nurse');
    expect(r.matchesByBucket.capabilities?.[0].canonicalKey).toBe('capabilities:java');
  });

  it('extracts finite facet labels from unstructured document text', async () => {
    const r = await extractor.extract('Turism HoReCa', { targetBuckets: ['company_type'], languages: ['ro'] });
    expect(r.matchesByBucket.company_type?.[0]).toMatchObject({
      canonicalKey: 'company_type:hospitality',
      method: 'inferred',
    });
  });

  it('respects locale filters for unstructured finite facets', async () => {
    const r = await extractor.extract('Turism HoReCa', { targetBuckets: ['company_type'], languages: ['en'] });
    expect(r.matchesByBucket.company_type).toBeUndefined();
  });
});

describe('structured resolveStructured', () => {
  it('resolves an exact alias without touching the embedder (fast path)', async () => {
    const r = await extractor.resolveStructured('employment', 'full-time');
    expect(r.matched).toBe(true);
    expect(r.method).toBe('lexical');
    expect(r.terms[0].canonicalKey).toBe('employment:full_time');
    expect(embedder.calls).toBe(0); // no embedding needed
  });

  it('always includes global terms when a language filter is given', async () => {
    const r = await extractor.resolveStructured('employment', 'full-time', { languages: ['ro'] });
    expect(r.matched).toBe(true); // full_time is a global term; ['ro'] must union global
  });

  it('falls back to semantic search when there is no exact alias', async () => {
    const r = await extractor.resolveStructured('capabilities', 'java developer skills');
    expect(r.method).toBe('semantic');
    expect(r.terms[0].canonicalKey).toBe('capabilities:java');
    expect(embedder.calls).toBe(1);
  });

  it('returns no match when nothing is close enough', async () => {
    const r = await extractor.resolveStructured('workplace', 'totally unrelated phrase');
    expect(r.matched).toBe(false);
    expect(r.method).toBe('none');
    expect(r.terms).toHaveLength(0);
  });

  it('resolves code-defined finite facets as structured matches', async () => {
    const r = await extractor.resolveStructured('company_type', 'Turism / HoReCa', { languages: ['ro'] });
    expect(r).toMatchObject({
      matched: true,
      method: 'structured',
    });
    expect(r.terms[0]).toMatchObject({
      canonicalKey: 'company_type:hospitality',
      method: 'structured',
    });
    expect(embedder.calls).toBe(0);
  });

  it('extracts structured finite facet fields as structured matches', async () => {
    const r = await extractor.extract(
      { structured: { company_type: 'Turism / HoReCa' } },
      { targetBuckets: ['company_type'], languages: ['ro'] },
    );
    expect(r.matchesByBucket.company_type?.[0]).toMatchObject({
      canonicalKey: 'company_type:hospitality',
      method: 'structured',
    });
    expect(embedder.calls).toBe(0);
  });

  it('does not resolve finite facets from the wrong locale', async () => {
    const r = await extractor.resolveStructured('company_type', 'Turism / HoReCa', {
      languages: ['en'],
      semanticFallback: false,
    });
    expect(r.matched).toBe(false);
    expect(r.method).toBe('none');
  });

  it('can disable semantic fallback', async () => {
    const r = await extractor.resolveStructured('capabilities', 'java developer skills', {
      semanticFallback: false,
    });
    expect(r.matched).toBe(false);
    expect(embedder.calls).toBe(0);
  });

  it('throws on an unknown bucket', async () => {
    await expect(extractor.resolveStructured('nope' as BucketName, 'x')).rejects.toThrow(/Unknown bucket/);
  });
});

describe('structured resolveStructuredMany', () => {
  it('preserves order and batches the embedder for fallbacks only', async () => {
    const r = await extractor.resolveStructuredMany('capabilities', ['java programming', 'java developer skills']);
    expect(r[0].method).toBe('lexical'); // exact alias
    expect(r[1].method).toBe('semantic'); // fallback
    expect(r.map((x) => x.terms[0]?.canonicalKey)).toEqual(['capabilities:java', 'capabilities:java']);
    expect(embedder.calls).toBe(1); // single batched embed call for the one fallback
  });
});
