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

import type { Clause } from '../tokenizer.js';
import type { BucketName, SupportedLanguage } from '../types.js';
import { inferCompanySize } from './company-size.js';
import { inferEmployment } from './employment.js';
import { inferJobFunction } from './job-function.js';
import { inferLevel } from './level.js';
import { inferQualifications } from './qualifications.js';
import { inferSchedule } from './schedule.js';
import { inferSector } from './sector.js';
import type { FiniteInferOptions, InferredTerm } from './shared.js';
import { deriveBenefitVariations, deriveCompensationVariations } from './variation.js';
import { inferWorkplace } from './workplace.js';

export type { FiniteInferOptions } from './shared.js';

type InferFn = (clauses: Clause[], languages?: SupportedLanguage[], opts?: FiniteInferOptions) => InferredTerm[];

const REGISTRY: Partial<Record<BucketName, InferFn>> = {
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

export const FINITE_INFERENCE_BUCKETS: readonly BucketName[] = Object.keys(REGISTRY) as BucketName[];

export function hasFiniteInferer(bucket: BucketName): boolean {
  return bucket in REGISTRY;
}

export function inferFiniteBucket(
  bucket: BucketName,
  clauses: Clause[],
  languages?: SupportedLanguage[],
  opts?: FiniteInferOptions,
): InferredTerm[] {
  return REGISTRY[bucket]?.(clauses, languages, opts) ?? [];
}

export function finiteInferenceLanguages(locale: string | undefined): SupportedLanguage[] | undefined {
  if (!locale) return undefined;
  return isSupportedLanguage(locale) ? [locale] : [];
}

export function isSupportedLanguage(locale: string): locale is SupportedLanguage {
  return (
    locale === 'ro' || locale === 'en' || locale === 'hu' || locale === 'et' || locale === 'ng' || locale === 'global'
  );
}
