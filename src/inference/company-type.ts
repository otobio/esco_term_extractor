import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { inferFacetTerms } from './facets.js';
import type { InferredTerm } from './shared.js';

export function inferCompanyType(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[] {
  return inferFacetTerms('company_type', clauses, languages);
}
