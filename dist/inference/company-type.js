import { inferFacetTerms } from './facets.js';
export function inferCompanyType(clauses, languages) {
    return inferFacetTerms('company_type', clauses, languages);
}
