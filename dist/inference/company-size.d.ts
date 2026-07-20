/**
 * Company-size inference → the company_stage canonical terms (startup/scaleup/
 * enterprise). Signals: explicit stage words (startup, multinational, SME, …) and
 * employee counts ("50 employees", "peste 200 de angajați", "team of 20"). Counts
 * are context-gated (an employee word required, non-employee counts excluded), the
 * way salary is. Per-locale word lists; single-language regexes. Negation-aware.
 */
import type { Clause } from '../tokenizer.js';
import { type InferredTerm } from './shared.js';
export declare function inferCompanySize(clauses: Clause[]): InferredTerm[];
