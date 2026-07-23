import { inferFacetTerms } from './facets.js';
export function inferSector(clauses, languages) {
    return inferFacetTerms('sector', clauses, languages);
}
