/**
 * Company-size inference → 7 headcount tiers (startup/small/mid_growing/
 * mid_stable/large/enterprise/global). Signals: employee counts ("50
 * employees", "peste 200 de angajați", "team of 20") are the primary,
 * description-driven signal; explicit stage words (startup, SME, corporation,
 * multinational, …) are a secondary, fuzzier signal mapped onto the nearest
 * tier. Counts are context-gated (an employee word required, non-employee
 * counts excluded), the way salary is. Per-locale word lists; single-language
 * regexes, pre-compiled once at module load (not per-clause) — this module
 * runs over every clause of every job description, so avoiding a `new RegExp`
 * per word per clause matters. Negation-aware.
 */
import type { Clause } from '../tokenizer.js';
import { type InferredTerm } from './shared.js';
export declare function inferCompanySize(clauses: Clause[]): InferredTerm[];
