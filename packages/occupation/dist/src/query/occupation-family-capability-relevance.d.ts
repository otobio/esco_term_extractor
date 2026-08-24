import { type OccupationFamilyCapabilityRelevanceArtifactCacheEntry } from '../runtime/occupation-family-capability-relevance-artifact.js';
export type OccupationFamilyCapabilityRelevanceLookup = OccupationFamilyCapabilityRelevanceArtifactCacheEntry;
export declare function defaultOccupationFamilyCapabilityRelevanceArtifactPath(sourceName: string): string;
export declare function tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName: string): OccupationFamilyCapabilityRelevanceLookup | null;
export declare function familyCapabilityRelevanceMultiplier(lookup: OccupationFamilyCapabilityRelevanceLookup | null, locale: string, familyNodeId: number | null, matchedTokens: string[]): number;
