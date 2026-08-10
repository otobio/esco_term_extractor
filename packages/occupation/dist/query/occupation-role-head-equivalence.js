import { defaultOccupationRoleHeadEquivalentsArtifactPath, loadOccupationRoleHeadEquivalenceArtifactRequired, parseRoleHeadEquivalenceArtifact } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { foldSearchText } from './query-preparation.js';
let cachedEquivalents = null;
export { defaultOccupationRoleHeadEquivalentsArtifactPath, loadOccupationRoleHeadEquivalenceArtifactRequired, parseRoleHeadEquivalenceArtifact };
export function occupationRoleHeadSharesEquivalentClass(token, locale, labelTokens) {
    const folded = foldSearchText(token);
    if (!folded) {
        return false;
    }
    const lookup = roleHeadEquivalents();
    const tokenClassIds = classIdsForTerm(lookup, locale, folded);
    if (tokenClassIds.size === 0) {
        return false;
    }
    for (const labelToken of labelTokens) {
        const labelClassIds = classIdsForTerm(lookup, locale, labelToken);
        for (const classId of tokenClassIds) {
            if (labelClassIds.has(classId)) {
                return true;
            }
        }
    }
    return false;
}
function roleHeadEquivalents() {
    if (!cachedEquivalents) {
        cachedEquivalents = loadRoleHeadEquivalents();
    }
    return cachedEquivalents;
}
function loadRoleHeadEquivalents() {
    return loadOccupationRoleHeadEquivalenceArtifactRequired().lookup;
}
function classIdsForTerm(lookup, locale, term) {
    const localeClassIds = lookup.classIdsByLocaleAndTerm.get(locale)?.get(term) ?? [];
    const globalClassIds = locale === 'unknown' ? [] : (lookup.classIdsByLocaleAndTerm.get('unknown')?.get(term) ?? []);
    if (globalClassIds.length === 0) {
        return new Set(localeClassIds);
    }
    return new Set([...localeClassIds, ...globalClassIds]);
}
