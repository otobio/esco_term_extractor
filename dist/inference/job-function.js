import { inferFacetTerms } from './facets.js';
export function inferJobFunction(clauses, languages) {
    return inferFacetTerms('job_function', clauses, languages);
}
