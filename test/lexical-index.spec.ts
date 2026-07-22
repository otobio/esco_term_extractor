import { describe, expect, it } from 'vitest';
import { buildLexicalIndex } from './support/lexical.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';

function term(
  canonicalKey: string,
  bucket: BucketName,
  languageCode: SupportedLanguage,
  displayName: string,
  aliases: string[] = [],
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 't', displayName, value: displayName, languageCode, aliases };
}

const index = buildLexicalIndex([
  term('workplace:remote', 'workplace', 'en', 'Remote', ['work from home', 'wfh', 'remote']),
  term('capabilities:java', 'capabilities', 'en', 'Java', ['java programming']),
  term('capabilities:design', 'capabilities', 'en', 'Creativity', ['design']), // "design" is a stopword
  term('employment:full_time', 'employment', 'global', 'Full Time', ['full-time']),
  term('location:cluj', 'location', 'ro', 'Cluj-Napoca', ['cluj napoca', 'cluj']),
]);

describe('LexicalIndex.lookup', () => {
  it('reports multi-word alias hits with their word count', () => {
    const hits = index.lookup('experience with java programming', 'capabilities');
    const java = hits.find((h) => h.entry.canonicalKey === 'capabilities:java');
    expect(java?.words).toBe(2);
  });

  it('matches distinctive unigram aliases', () => {
    const hits = index.lookup('fully wfh position', 'workplace');
    expect(hits.map((h) => h.entry.canonicalKey)).toContain('workplace:remote');
  });

  it('drops stopword unigrams before matching', () => {
    const hits = index.lookup('we value design thinking', 'capabilities');
    // "design" is a stopword, so capabilities:design must not fire on it.
    expect(hits.map((h) => h.entry.canonicalKey)).not.toContain('capabilities:design');
  });

  it('filters by bucket and language', () => {
    expect(index.lookup('cluj napoca office', 'location', ['ro'])).toHaveLength(1);
    expect(index.lookup('cluj napoca office', 'location', ['hu'])).toHaveLength(0);
  });
});

describe('LexicalIndex.lookupExact', () => {
  it('matches the whole normalized value only', () => {
    expect(index.lookupExact('full-time', 'employment').map((e) => e.canonicalKey)).toEqual(['employment:full_time']);
    // A substring of a longer phrase is NOT an exact match.
    expect(index.lookupExact('full-time role available', 'employment')).toHaveLength(0);
  });

  it('honors the bucket', () => {
    expect(index.lookupExact('remote', 'capabilities')).toHaveLength(0);
    expect(index.lookupExact('remote', 'workplace').map((e) => e.canonicalKey)).toEqual(['workplace:remote']);
  });
});
