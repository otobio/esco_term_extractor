import { type DictionaryTerm, GazetteerIndex, GazetteerResolver } from '@term-extractor/gazetteer';
import { describe, expect, it } from 'vitest';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import { VectorStore } from '../src/vector-store.ts';

// Synthetic 2-tier country: Metropolis (container) + Downtown (leaf). The extractor
// installs this resolver as the inferLocation global via fromComponents.
const TERMS: DictionaryTerm[] = [
  {
    canonicalKey: 'a:metro',
    bucket: 'location',
    termType: 'depth1',
    displayName: 'Metropolis',
    value: 'Metropolis',
    languageCode: 'ro',
    aliases: ['Metropolis'],
  },
  {
    canonicalKey: 'a:metro:leaf',
    bucket: 'location',
    termType: 'depth2',
    displayName: 'Downtown',
    value: 'Downtown',
    languageCode: 'ro',
    aliases: ['Downtown'],
  },
];
const EDGES = [{ parentKey: 'a:metro', childKey: 'a:metro:leaf' }];
const gazetteer = () => new GazetteerResolver(GazetteerIndex.fromTerms(TERMS, EDGES));

describe('extractor dispatches location to the gazetteer (via inferLocation)', () => {
  it('resolves location without invoking the embedder', async () => {
    const throwingEmbedder: TextEmbedder = {
      model: 'stub',
      async embed() {
        throw new Error('embedder must not be called for a gazetteer-only extraction');
      },
      async embedOne() {
        throw new Error('embedder must not be called');
      },
    };
    const extractor = TermExtractor.fromComponents({
      store: VectorStore.fromEntries('stub', 2, []),
      lexical: LexicalIndex.fromTerms([]),
      embedder: throwingEmbedder,
      gazetteer: gazetteer(),
    });
    const r = await extractor.extract({ title: 'Job in Metropolis' }, { targetBuckets: ['location'] });
    expect(r.matchesByBucket.location?.map((t) => t.canonicalKey)).toContain('a:metro');
  });

  it('routes resolveStructured("location", …) through the gazetteer', async () => {
    const extractor = TermExtractor.fromComponents({
      store: VectorStore.fromEntries('stub', 2, []),
      lexical: LexicalIndex.fromTerms([]),
      embedder: {
        model: 'stub',
        async embed() {
          return [];
        },
        async embedOne() {
          return new Float32Array(2);
        },
      },
      gazetteer: gazetteer(),
    });
    const r = await extractor.resolveStructured('location', 'Metropolis');
    expect(r.method).toBe('gazetteer');
    expect(r.terms[0].canonicalKey).toBe('a:metro');
  });
});
