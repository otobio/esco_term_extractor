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
 * Structured-only clauses (caller-known field values) fall back to the English
 * rules when the locale's own rules find nothing; prose and mixed clause sets
 * never do, so English idioms cannot fire on local-language body text.
 *
 * `finiteInferenceLanguages` maps a text locale to the language scope used for
 * rule inference: `[locale]` when it's supported, `[]` when it's known but
 * unsupported (so no language's rules fire), `undefined` when unknown (all
 * languages allowed).
 */
import { SUPPORTED_LANGUAGES } from '../languages.js';
import { deriveBenefitVariations } from './benefits.js';
import { inferCompanySize } from './company-size.js';
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
    const infer = REGISTRY[bucket];
    if (!infer)
        return [];
    const terms = infer(clauses, languages, opts);
    if (terms.length || !allowsEnglishFallback(clauses, languages))
        return terms;
    return infer(clauses, ['en'], opts);
}
function allowsEnglishFallback(clauses, languages) {
    if (!languages || languages.includes('en'))
        return false;
    return clauses.length > 0 && clauses.every((c) => c.source === 'structured');
}
export function finiteInferenceLanguages(locale) {
    if (!locale)
        return undefined;
    const language = locale.split(/[-_]/)[0].toLowerCase();
    return isSupportedLanguage(language) ? [language] : [];
}
export function isSupportedLanguage(locale) {
    return SUPPORTED_LANGUAGES.includes(locale) || locale === 'ng';
}
