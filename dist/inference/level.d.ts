/**
 * Seniority-level inference (entry_level, junior, mid_level, senior, lead, manager,
 * director, executive) from title tokens, years of experience, and team-management
 * idioms. Idiom rules per locale (single-language regexes); years loop over LOCALES.
 *
 * A years→level guess is only added when NO explicit seniority band (entry/junior/
 * mid/senior) was found in the text — the stated band wins over the heuristic.
 *
 * Optionally folds in the logistic-regression classifier (see {@link InferLevelOptions}
 * `enableLr`, OFF by default): it runs alongside the regex and a confident band
 * overrides a disagreeing regex band on the same clause. Default path stays pure regex.
 */
import { type LoadedLevelLr } from '../classifier/level-lr.js';
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
/**
 * Options for the level classifier fold. `enableLr` is OFF by default, so the default
 * path is pure regex (today's behavior, no model/data-file dependency). Turning it on
 * runs the logistic-regression classifier ({@link inferLevelLr}) and reconciles it with
 * the regex via {@link reconcileLevel} — a confident LR band overrides a disagreeing
 * regex band on the same clause, rather than blindly unioning.
 *
 * (Kept synchronous on purpose — the LR core is pure CPU. When `infer<Bucket>` is later
 * unified to async, this signature moves with it; nothing here needs a Promise today.)
 */
export interface InferLevelOptions {
    /** Fold the LR classifier into the result. Default false → regex-only. */
    enableLr?: boolean;
    /** Injected model (tests / callers holding one). Falls back to the lazily-loaded
     *  `data/level-lr.json`; if that's absent too, LR is skipped (regex-only). */
    lrModel?: LoadedLevelLr;
    /** Probability floor for an LR band (default {@link DEFAULT_LR_THRESHOLD}). */
    lrThreshold?: number;
}
export declare function inferLevel(clauses: Clause[], languages?: SupportedLanguage[], options?: InferLevelOptions): InferredTerm[];
