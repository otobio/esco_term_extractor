/**
 * Per-locale lexicons for salary parsing. Period / tax / cue / exclude words are
 * single-language per block (never mixed in one regex). Currency identifiers and
 * amount/range syntax are language-neutral (handled in salary.ts).
 */
import type { SalaryPeriod as Period, SupportedLanguage } from '../types.js';
export type { Period };
export interface SalaryLocale {
    language: SupportedLanguage;
    period: Record<Period, string[]>;
    gross: string[];
    net: string[];
    /** words that indicate the number IS pay (used to admit amounts without a currency). */
    cue: string[];
    /** contexts that mean the money is NOT salary (turnover, benefits, counts). */
    exclude: string[];
    /** ["between","and"]-style range framings for this language. */
    rangePairs: [string, string][];
}
export declare const SALARY_LOCALES: readonly SalaryLocale[];
