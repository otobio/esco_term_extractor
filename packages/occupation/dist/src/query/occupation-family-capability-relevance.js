import { defaultOccupationFamilyCapabilityRelevanceManifestPath, loadOccupationFamilyCapabilityRelevanceArtifactIfAvailable } from '../runtime/occupation-family-capability-relevance-artifact.js';
export function defaultOccupationFamilyCapabilityRelevanceArtifactPath(sourceName) {
    return defaultOccupationFamilyCapabilityRelevanceManifestPath(sourceName);
}
export function tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName) {
    return loadOccupationFamilyCapabilityRelevanceArtifactIfAvailable(sourceName);
}
export function familyCapabilityRelevanceMultiplier(lookup, locale, familyNodeId, matchedTokens) {
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
        total += lookup.familyCapabilityRelevance(locale, familyNodeId, token) / maxRelevance;
    }
    return total / matchedTokens.length;
}
