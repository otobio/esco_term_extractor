/**
 * Single entry point for the rule-based inference layer.
 *
 * Every finite bucket that has an inference implementation is registered here
 * ONCE, so all three consumers — the local extractor, the title profile
 * (`lookups.ts`), and the ingest structured path (`ingest/index.ts`) — resolve a
 * finite bucket through the SAME dispatcher instead of each holding its own map.
 *
 * `inferFiniteBucket` returns `[]` for a bucket with no registered inferer, so
 * callers can invoke it uniformly. WHICH buckets a given caller runs inference
 * for is still the caller's choice (e.g. the extractor's free-text path
 * deliberately skips workplace) — the registry only says what inference EXISTS.
 *
 * `inferLevel` is registered as a 2-arg wrapper: its own options bag (the LR
 * fold) is unrelated to `FiniteInferOptions` and is threaded by direct callers,
 * not this dispatcher, so the 3-arg registry type would otherwise mismatch it.
 *
 * `finiteInferenceLanguages` maps a text locale to the language scope used for
 * rule inference: `[locale]` when it's supported, `[]` when it's known but
 * unsupported (so no language's rules fire), `undefined` when unknown (all
 * languages allowed).
 */
import { inferCompanySize } from './company-size.js';
import { deriveBenefitVariations } from './benefits.js';
import { deriveCompensationVariations } from './compensation.js';
import { inferEmployment } from './employment.js';
import { inferJobFunction } from './job-function.js';
import { inferLevel } from './level.js';
import { inferQualifications } from './qualifications.js';
import { inferSchedule } from './schedule.js';
import { inferSector } from './sector.js';
import { inferWorkplace } from './workplace.js';
const REGISTRY = {
    level: (clauses, languages) => inferLevel(clauses, languages),
    workplace: inferWorkplace,
    schedule: inferSchedule,
    employment: inferEmployment,
    sector: inferSector,
    job_function: inferJobFunction,
    company_size: inferCompanySize,
    qualifications: inferQualifications,
    benefits: deriveBenefitVariations,
    compensation: deriveCompensationVariations,
};
export const FINITE_INFERENCE_BUCKETS = Object.keys(REGISTRY);
export function hasFiniteInferer(bucket) {
    return bucket in REGISTRY;
}
export function inferFiniteBucket(bucket, clauses, languages, opts) {
    return REGISTRY[bucket]?.(clauses, languages, opts) ?? [];
}
export function finiteInferenceLanguages(locale) {
    if (!locale)
        return undefined;
    return isSupportedLanguage(locale) ? [locale] : [];
}
export function isSupportedLanguage(locale) {
    return (locale === 'ro' || locale === 'en' || locale === 'hu' || locale === 'et' || locale === 'ng' || locale === 'global');
}
