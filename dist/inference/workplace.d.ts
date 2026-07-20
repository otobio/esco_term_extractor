/**
 * Workplace-type inference (remote, hybrid, onsite, abroad) from explicit idioms.
 * Per-locale single-language regexes; negation-aware. Aliases folded from the shared
 * finite-facet lexicon (re-ai-search lib-enrichment) into our regex style.
 *
 * Only fires on stated signals — "onsite" is almost never written in a title/clause,
 * so absence here is not evidence of onsite; a default-onsite policy (when a listing
 * states nothing) belongs to the caller, not to this inference.
 */
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export declare function inferWorkplace(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
