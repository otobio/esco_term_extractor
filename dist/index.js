/**
 * esco-term-extractor
 *
 * Shared, production term-resolution modules (buckets, inference, gazetteer,
 * matchers, profiles) grounded in the canonical_runtime_terms dictionary.
 * The embedding-model extractor (`TermExtractor`/`Embedder`) is dev-only and
 * lives in `@term-extractor/extractor-dev`. See README.md for the workflow.
 */
export { GAZETTEER_CONFIG, GAZETTEER_SCHEMA_VERSION, GazetteerIndex, GazetteerResolver, } from '@term-extractor/gazetteer';
export { getDefaultBucketConfigs, resolveBucketConfig } from './buckets.js';
export { OccupationCapabilityMap } from './derive/capability-consistency.js';
export { CollarMap } from './derive/collar.js';
export { isUsableTerm, loadDictionary, serializeTerm } from './dictionary.js';
export { inferCompanySize } from './inference/company-size.js';
export { inferEmployment } from './inference/employment.js';
export { inferLevel } from './inference/level.js';
export { inferQualifications } from './inference/qualifications.js';
export { inferSchedule } from './inference/schedule.js';
export { resolveLanguages, SUPPORTED_LANGUAGES } from './languages.js';
export { LexicalIndex } from './lexical-index.js';
export { isNegated } from './negation.js';
export { classifyClause } from './noise-guard.js';
export { normalizeText } from './normalize.js';
export { extractSalary } from './salary/salary.js';
export { splitClauses } from './tokenizer.js';
export { ALL_BUCKETS } from './types.js';
export { HUBNESS_CENTERING, INDEX_SCHEMA_VERSION, VectorStore } from './vector-store.js';
