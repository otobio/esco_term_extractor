/**
 * @term-extractor/extractor-dev
 *
 * Dev-only embedding term extractor: TermExtractor + the sentence-transformer
 * Embedder it depends on. Not used by the production ingest path (see
 * `esco-term-extractor/ingest`), which resolves purely via OpenSearch +
 * rule inference. See ../../../README.md for the build + query workflow.
 */

export type { EmbedderOptions, TextEmbedder } from './embedder.ts';
export { DEFAULT_MODEL, EMBEDDING_DIM, Embedder } from './embedder.ts';
export type { TermExtractorComponents, TermExtractorOptions } from './extractor.ts';
export { TermExtractor } from './extractor.ts';
