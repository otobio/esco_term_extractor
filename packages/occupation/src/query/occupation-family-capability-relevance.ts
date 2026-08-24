import {
  defaultOccupationFamilyCapabilityRelevanceManifestPath,
  loadOccupationFamilyCapabilityRelevanceArtifactIfAvailable,
  type OccupationFamilyCapabilityRelevanceArtifactCacheEntry
} from '../runtime/occupation-family-capability-relevance-artifact.js';

export type OccupationFamilyCapabilityRelevanceLookup = OccupationFamilyCapabilityRelevanceArtifactCacheEntry;

export function defaultOccupationFamilyCapabilityRelevanceArtifactPath(sourceName: string): string {
  return defaultOccupationFamilyCapabilityRelevanceManifestPath(sourceName);
}

export function tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName: string): OccupationFamilyCapabilityRelevanceLookup | null {
  return loadOccupationFamilyCapabilityRelevanceArtifactIfAvailable(sourceName);
}

export function familyCapabilityRelevanceMultiplier(
  lookup: OccupationFamilyCapabilityRelevanceLookup | null,
  locale: string,
  familyNodeId: number | null,
  matchedTokens: string[]
): number {
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
