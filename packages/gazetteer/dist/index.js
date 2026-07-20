/**
 * @term-extractor/gazetteer — public API.
 *
 * Standalone Jobs-focused location gazetteer: resolver engine, the packed runtime
 * binary (+ openGazetteer/openGazetteerSync entry points), the legacy JSON index,
 * and the build-time dataset importer/enrichment/store. See README.md.
 */
export * from './gazetteer-bin.js';
export * from './gazetteer-index.js';
export * from './location-store.js';
export * from './patterns.js';
export * from './place.js';
export * from './resolver.js';
export { splitClauses } from './tokenizer.js';
