import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { inferFacetTerms } from './facets.js';
import type { InferredTerm } from './shared.js';

export function inferSector(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[] {
  return inferFacetTerms('sector', clauses, languages);
}
