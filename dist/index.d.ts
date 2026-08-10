/**
 * esco-term-extractor
 *
 * Shared, production term-resolution modules (buckets, inference, gazetteer,
 * matchers, profiles) grounded in the canonical_runtime_terms dictionary.
 * The embedding/vector extractor lives in `@term-extractor/extractor-dev`.
 */
export type { GazetteerConfig, GazetteerPlace, LocationEdge } from '@term-extractor/gazetteer';
export { GAZETTEER_CONFIG, GAZETTEER_SCHEMA_VERSION, GazetteerIndex, GazetteerResolver, } from '@term-extractor/gazetteer';
export { getDefaultBucketConfigs, resolveBucketConfig } from './buckets.js';
export { OccupationCapabilityMap } from './derive/capabilities.js';
export { CollarMap } from './derive/collar.js';
export { isUsableTerm, loadDictionary, serializeTerm } from './dictionary.js';
export type { FiniteBucket, FiniteValues } from './finite-values.js';
export { FINITE_VALUES } from './finite-values.js';
export { inferCompanySize } from './inference/company-size.js';
export { inferEmployment } from './inference/employment.js';
export { inferLevel } from './inference/level.js';
export { inferQualifications } from './inference/qualifications.js';
export { inferSchedule } from './inference/schedule.js';
export type { InferredTerm } from './inference/shared.js';
export { getDisplayTitles } from './ingest/index.js';
export { resolveLanguages, SUPPORTED_LANGUAGES } from './languages.js';
export type { LexicalEntry, LexicalHit } from './lexical-index.js';
export { LexicalIndex } from './lexical-index.js';
export { isNegated } from './negation.js';
export { classifyClause } from './noise-guard.js';
export { normalizeText } from './normalize.js';
export { extractSalary } from './salary/salary.js';
export { splitClauses } from './tokenizer.js';
export type { BucketConfig, BucketName, Currency, DictionaryTerm, ExtractedTerm, ExtractionResult, ExtractOptions, JobPostInput, MatchEvidence, MatchMethod, MatchStrategy, SalaryPeriod, SalaryRange, StructuredResolution, StructuredResolveOptions, SupportedLanguage, } from './types.js';
export { ALL_BUCKETS } from './types.js';
