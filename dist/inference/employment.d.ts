/**
 * Employment-type inference (full_time, part_time, contract, temporary, seasonal,
 * internship, per_diem) from explicit idioms + numeric hours.
 *
 * Idiom rules are grouped per locale — each regex is single-language. Numeric
 * signals loop over LOCALES. Layered on top of alias/structured; negation-aware.
 */
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export declare function inferEmployment(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
