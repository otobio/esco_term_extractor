/**
 * Shared helpers for the rule-based inference layer (employment / schedule / level).
 *
 * These buckets are usually *implied* by numeric and idiomatic signals rather than
 * stated as clean aliases, so we parse them deterministically. All matching runs
 * on a "loose" normalization that folds diacritics + lowercases but KEEPS the
 * digits, ':', '/' and '-' that hours and time-ranges depend on.
 *
 * Numeric parsers take ONE {@link Locale} and build a single-language regex — the
 * caller loops over {@link LOCALES}. Idiom rules likewise live in per-locale blocks
 * inside each bucket module. No regex ever mixes languages.
 *
 * `FiniteInferOptions.titleMode` is a cross-cutting flag a caller threads into rule
 * inference via the `inferFiniteBucket` dispatcher (see inference/index.ts) — true
 * for the title profile (short, terse text), where it loosens gates that are
 * otherwise strict for noisier body/description text. Most inferers ignore it;
 * currently only `inferQualifications` reads it. It lives here rather than in
 * index.ts so bucket modules can import it without a circular dependency on the
 * dispatcher that imports them.
 *
 * `parseExperienceYears` requires the number+years token to sit directly next to
 * an experience word (either order) — this is what separates "5+ years
 * experience" from age ("peste 35 ani"), contract length ("contract pe 2 ani") or
 * company age ("firmă cu 15 ani pe piață").
 *
 * `parseTimeRanges` only accepts a bare (colon-less) range like "22-06" when one
 * of `L.scheduleCue` is also present, so "1-3 years" isn't mistaken for a
 * schedule; colon ranges ("09:00-17:00") need no such cue.
 */
import { type Locale } from './locales.js';
export interface InferredTerm {
    canonicalKey: string;
    score: number;
    evidence: string;
}
export interface FiniteInferOptions {
    titleMode?: boolean;
}
export interface IdiomRule {
    key: string;
    score: number;
    re: RegExp;
}
export type Add = (key: string, score: number, evidence: string) => void;
export declare function applyIdioms(loose: string, rawClause: string, rules: readonly IdiomRule[], add: Add): void;
export declare function collector(): {
    add: Add;
    terms: () => InferredTerm[];
};
export declare function normalizeLoose(text: string): string;
export declare function parseWeeklyHours(loose: string, L: Locale): number | null;
export declare function parseDailyHours(loose: string, L: Locale): number | null;
export declare function parseExperienceYears(loose: string, L: Locale): number | null;
export interface TimeRange {
    start: number;
    end: number;
}
export declare function parseTimeRanges(loose: string, L: Locale): TimeRange[];
