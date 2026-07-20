/**
 * Per-locale numeric lexicons for the inference layer. Each locale owns its own
 * unit / cue words so the numeric parsers build ONE single-language regex per
 * locale (never a mixed-language alternation). Adding a locale is one block.
 */
import type { SupportedLanguage } from '../types.js';
export interface Locale {
    language: SupportedLanguage;
    /** hour unit words (h, ore, óra→ora, tundi). */
    hour: string[];
    /** "week" words. */
    week: string[];
    /** "day" words. */
    day: string[];
    /** connective glue between number and period ("per", "pe", "/"). */
    connect: string[];
    /** "year(s)" words. */
    years: string[];
    /** "experience" words. */
    experience: string[];
    /** minimum qualifiers ("minim", "at least", "peste"). */
    minimum: string[];
    /** words that signal a clock time-range is a work schedule. */
    scheduleCue: string[];
}
export declare const LOCALES: readonly Locale[];
/** A non-capturing alternation of literal words. */
export declare function alt(words: string[]): string;
