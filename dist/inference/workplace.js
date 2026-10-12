/**
 * Workplace-type inference (remote, hybrid, onsite, abroad) from explicit idioms.
 * Per-locale single-language regexes; negation-aware. Aliases folded from the shared
 * finite-facet lexicon (re-ai-search lib-enrichment) into our regex style.
 *
 * Only fires on stated signals — "onsite" is almost never written in a title/clause,
 * so absence here is not evidence of onsite; a default-onsite policy (when a listing
 * states nothing) belongs to the caller, not to this inference.
 */
import { inferFacetTerms } from './facets.js';
import { applyIdioms, collector, normalizeLoose } from './shared.js';
const EN = [
    {
        key: 'workplace:remote',
        score: 0.9,
        re: /\b(remote|remote work|work from home|wfh|home[ -]?based|fully remote)\b/,
    },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hybrid( remote)?|part(ial)?ly remote)\b/ },
    { key: 'workplace:onsite', score: 0.85, re: /\b(on[ -]?site|onsite|in office|office[ -]?based)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(abroad|overseas|rest of the world)\b/ },
];
const RO = [
    { key: 'workplace:remote', score: 0.9, re: /\b(remote|la distanta|munca de acasa|telemunca)\b/ },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hibrid|program hibrid)\b/ },
    { key: 'workplace:onsite', score: 0.85, re: /\b(la sediu|la birou|on site|onsite)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(strainatate|in strainatate)\b/ },
];
const HU = [
    { key: 'workplace:remote', score: 0.9, re: /\b(tavmunka|otthonrol|home office)\b/ },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hibrid)\b/ },
    { key: 'workplace:onsite', score: 0.85, re: /\b(helyhez kotott|terulet|regio)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(kulfold|kulfoldon)\b/ },
];
const ET = [
    { key: 'workplace:remote', score: 0.9, re: /\b(kaugtoo|kodukontor)\b/ },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hubriid)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(valismaal)\b/ },
];
const LV = [
    { key: 'workplace:remote', score: 0.9, re: /\b(attalinat[a-z]*|darbs no majam)\b/ },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hibrid[a-z]*)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(arzemes)\b/ },
];
const LT = [
    { key: 'workplace:remote', score: 0.9, re: /\b(nuotolin[a-z]*|darbas is namu)\b/ },
    { key: 'workplace:hybrid', score: 0.9, re: /\b(hibridin[a-z]*)\b/ },
    { key: 'workplace:abroad', score: 0.9, re: /\b(uzsienyje)\b/ },
];
const RULES = [...EN, ...RO, ...HU, ...ET, ...LV, ...LT];
export function inferWorkplace(clauses, languages) {
    const { add, terms } = collector();
    for (const facet of inferFacetTerms('workplace', clauses, languages))
        add(facet.canonicalKey, facet.score, facet.evidence);
    for (const c of clauses) {
        applyIdioms(normalizeLoose(c.text), c.text, RULES, add);
    }
    return terms();
}
