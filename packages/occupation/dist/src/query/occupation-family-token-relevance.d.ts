import { type OccupationFamilyTokenRelevanceArtifactCacheEntry } from '../runtime/occupation-family-token-relevance-artifact.js';
export type OccupationFamilyTokenRelevanceLookup = OccupationFamilyTokenRelevanceArtifactCacheEntry;
export declare function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName: string): string;
export declare function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName: string): OccupationFamilyTokenRelevanceLookup | null;
export declare function familyTokenRelevanceMultiplier(lookup: OccupationFamilyTokenRelevanceLookup | null, locale: string, familyNodeId: number | null, matchedTokens: string[]): number;
