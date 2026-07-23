import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { inferFacetTerms } from './facets.js';
import type { InferredTerm } from './shared.js';

export function inferJobFunction(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[] {
  return inferFacetTerms('job_function', clauses, languages);
}
