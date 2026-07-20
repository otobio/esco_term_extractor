/**
 * @term-extractor/gazetteer — public API.
 *
 * Standalone Jobs-focused location gazetteer: resolver engine, the packed runtime
 * binary (+ openGazetteer/openGazetteerSync entry points), the legacy JSON index,
 * and the build-time dataset importer/enrichment/store. See README.md.
 */

export * from './gazetteer-bin.ts';
export * from './gazetteer-index.ts';
export * from './location-store.ts';
export * from './patterns.ts';
export * from './place.ts';
export * from './resolver.ts';
export { splitClauses } from './tokenizer.ts';
export type { Clause, DictionaryTerm, ExtractedTerm, MatchEvidence, SupportedLanguage } from './types.ts';
