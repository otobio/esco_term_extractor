import { ATOMIC_SPECIALIZATION_SYNONYMS } from '../runtime/occupation-leaf-structure-rules.js';
import { foldSearchText } from '../utils/texts.js';
function primary(familyNodeId, familyLabel) {
    return { familyNodeId, familyLabel, strength: 'primary' };
}
// Keyed by the same (kind, tag) pairs as ATOMIC_SPECIALIZATION_SYNONYMS -- each tag already bundles
// every locale's synonyms (e.g. population.client covers "clienti"/"customer"/"ugyfelek"/"kliendid"),
// so one entry here covers every wording of that concept instead of one hardcoded word at a time.
// Add a (kind, tag) here only once ATOMIC_SPECIALIZATION_SYNONYMS actually has that tag -- a concept
// with no tag yet (e.g. "shift work") belongs there first, not as a mismatched entry here.
const FAMILY_SPECIALIZATION_PRIORS = {
    population: {
        client: [primary(14965, 'Client information workers')]
    }
};
const FOLDED_TAG_TOKENS = Object.entries(FAMILY_SPECIALIZATION_PRIORS).flatMap(([kind, tagPriors]) => Object.keys(tagPriors ?? {}).map((tag) => ({
    kind: kind,
    tag,
    tokens: new Set((ATOMIC_SPECIALIZATION_SYNONYMS[kind]?.[tag] ?? []).map((word) => foldSearchText(word)))
})));
export function getFamilySpecializationPriors(foldedTokens) {
    const tokenSet = new Set(foldedTokens);
    const byFamily = new Map();
    for (const { kind, tag, tokens } of FOLDED_TAG_TOKENS) {
        const matches = Array.from(tokens).some((token) => tokenSet.has(token));
        if (!matches) {
            continue;
        }
        for (const entry of FAMILY_SPECIALIZATION_PRIORS[kind]?.[tag] ?? []) {
            const existing = byFamily.get(entry.familyNodeId);
            if (!existing || (existing.strength === 'supporting' && entry.strength === 'primary')) {
                byFamily.set(entry.familyNodeId, entry);
            }
        }
    }
    return Array.from(byFamily.values());
}
