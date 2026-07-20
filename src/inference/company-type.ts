import type { Clause } from '../tokenizer.ts';
import type { SupportedLanguage } from '../types.ts';
import { inferFacetTerms } from './facets.ts';
import type { InferredTerm } from './shared.ts';

export function inferCompanyType(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[] {
  return inferFacetTerms('company_type', clauses, languages);
}
