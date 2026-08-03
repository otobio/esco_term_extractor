import {
  defaultOccupationFamilyTokenRelevanceManifestPath,
  loadOccupationFamilyTokenRelevanceArtifactIfAvailable,
  type OccupationFamilyTokenRelevanceArtifactCacheEntry
} from '../runtime/occupation-family-token-relevance-artifact.js';

export type OccupationFamilyTokenRelevanceLookup = OccupationFamilyTokenRelevanceArtifactCacheEntry;

export function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName: string): string {
  return defaultOccupationFamilyTokenRelevanceManifestPath(sourceName);
}

export function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName: string): OccupationFamilyTokenRelevanceLookup | null {
  return loadOccupationFamilyTokenRelevanceArtifactIfAvailable(sourceName);
}

export function familyTokenRelevanceMultiplier(
  lookup: OccupationFamilyTokenRelevanceLookup | null,
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

    total += lookup.familyTokenRelevance(locale, familyNodeId, token) / maxRelevance;
  }

  return total / matchedTokens.length;
}
