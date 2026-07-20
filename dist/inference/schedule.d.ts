/**
 * Schedule inference (shifts, business hours, weekend, flexible, on-call, ...).
 * Idiom rules per locale (single-language regexes); shift-count and clock
 * time-range parsing loop over LOCALES. Negation-aware.
 */
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export declare function inferSchedule(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
