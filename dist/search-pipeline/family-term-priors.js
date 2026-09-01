function primary(familyNodeId, familyLabel) {
    return { familyNodeId, familyLabel, strength: 'primary' };
}
function supporting(familyNodeId, familyLabel) {
    return { familyNodeId, familyLabel, strength: 'supporting' };
}
// Keyed by a single folded query term (industry, venue, or occupation-context word) that reliably
// points at one family, independent of any generic-head role word (see generic-head-family-priors.ts,
// which requires one). This fires on the term alone, so it also covers venue/industry-only queries
// that carry no recognizable head word. Keep entries narrow and unambiguous -- this is a curated
// override, not a lexical-coverage signal, so a wrong entry here is a direct family-selection bug.
const FAMILY_TERM_PRIORS = {
    servicii: [primary(14965, 'Client information workers')],
    clienti: [primary(14965, 'Client information workers')],
    tura: [supporting(14856, 'Process control technicians')]
};
export function getFamilyTermPriors(foldedTokens) {
    const byFamily = new Map();
    for (const token of foldedTokens) {
        const entries = FAMILY_TERM_PRIORS[token];
        if (!entries) {
            continue;
        }
        for (const entry of entries) {
            const existing = byFamily.get(entry.familyNodeId);
            if (!existing || (existing.strength === 'supporting' && entry.strength === 'primary')) {
                byFamily.set(entry.familyNodeId, entry);
            }
        }
    }
    return Array.from(byFamily.values());
}
