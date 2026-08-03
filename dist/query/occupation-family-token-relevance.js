import { defaultOccupationFamilyTokenRelevanceManifestPath, loadOccupationFamilyTokenRelevanceArtifactIfAvailable } from '../runtime/occupation-family-token-relevance-artifact.js';
export function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName) {
    return defaultOccupationFamilyTokenRelevanceManifestPath(sourceName);
}
export function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName) {
    return loadOccupationFamilyTokenRelevanceArtifactIfAvailable(sourceName);
}
export function familyTokenRelevanceMultiplier(lookup, locale, familyNodeId, matchedTokens) {
    if (!lookup || familyNodeId === null || matchedTokens.length === 0) {
        return 1;
    }
    let total = 0;
    for (const token of matchedTokens) {
        const maxRelevance = lookup.maxTokenRelevance(locale, token);
        if (maxRelevance <= 0) {
            total += 1;
            continue;
        }
        total += lookup.familyTokenRelevance(locale, familyNodeId, token) / maxRelevance;
    }
    return total / matchedTokens.length;
}
