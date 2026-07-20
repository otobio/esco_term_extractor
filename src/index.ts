/**
 * esco-term-extractor
 *
 * Shared, production term-resolution modules (buckets, inference, gazetteer,
 * matchers, profiles) grounded in the canonical_runtime_terms dictionary.
 * The embedding-model extractor (`TermExtractor`/`Embedder`) is dev-only and
 * lives in `@term-extractor/extractor-dev`. See README.md for the workflow.
 */

export type { GazetteerConfig, GazetteerPlace, LocationEdge } from '@term-extractor/gazetteer';
export {
  GAZETTEER_CONFIG,
  GAZETTEER_SCHEMA_VERSION,
  GazetteerIndex,
  GazetteerResolver,
} from '@term-extractor/gazetteer';
export { getDefaultBucketConfigs, resolveBucketConfig } from './buckets.ts';
export { OccupationCapabilityMap } from './derive/capability-consistency.ts';
export { CollarMap } from './derive/collar.ts';
export { isUsableTerm, loadDictionary, serializeTerm } from './dictionary.ts';
export { inferCompanySize } from './inference/company-size.ts';
export { inferEmployment } from './inference/employment.ts';
export { inferLevel } from './inference/level.ts';
export { inferQualifications } from './inference/qualifications.ts';
export { inferSchedule } from './inference/schedule.ts';
export type { InferredTerm } from './inference/shared.ts';
export { resolveLanguages, SUPPORTED_LANGUAGES } from './languages.ts';
export type { LexicalEntry, LexicalHit } from './lexical-index.ts';
export { LexicalIndex } from './lexical-index.ts';
export { isNegated } from './negation.ts';
export { classifyClause } from './noise-guard.ts';
export { normalizeText } from './normalize.ts';
export { extractSalary } from './salary/salary.ts';
export { splitClauses } from './tokenizer.ts';
export type {
  BucketConfig,
  BucketName,
  Currency,
  DictionaryTerm,
  ExtractedTerm,
  ExtractionResult,
  ExtractOptions,
  JobPostInput,
  MatchEvidence,
  MatchMethod,
  MatchStrategy,
  SalaryPeriod,
  SalaryRange,
  StructuredResolution,
  StructuredResolveOptions,
  SupportedLanguage,
} from './types.ts';
export { ALL_BUCKETS } from './types.ts';
export type { BestMatch, StoredTerm } from './vector-store.ts';
export { HUBNESS_CENTERING, INDEX_SCHEMA_VERSION, VectorStore } from './vector-store.ts';
