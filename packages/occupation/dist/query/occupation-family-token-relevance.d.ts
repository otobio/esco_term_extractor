export type OccupationFamilyTokenStats = {
    occurrences: number;
    tfRatio: number;
    documentFrequency: number;
    relevance: number;
};
export type OccupationFamilyTokenRelevanceFamily = {
    familyNodeId: number;
    familyLabel: string;
    leafCount: number;
    totalTokenOccurrences: number;
    tokens: Record<string, OccupationFamilyTokenStats>;
};
export type OccupationFamilyTokenGenericity = {
    documentFrequency: number;
    maxRelevance: number;
    maxRelevanceFamilyNodeId: number;
};
export type OccupationFamilyTokenRelevanceArtifact = {
    schemaVersion: 1;
    sourceName: string;
    generatedAt: string;
    totalFamilies: number;
    locales: string[];
    lowConfidenceLocales: string[];
    familiesByLocale: Record<string, OccupationFamilyTokenRelevanceFamily[]>;
    genericityByLocale: Record<string, Record<string, OccupationFamilyTokenGenericity>>;
};
export type OccupationFamilyTokenRelevanceArtifactEntry = {
    artifactPath: string;
    artifact: OccupationFamilyTokenRelevanceArtifact;
};
export declare function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName: string): string;
export declare function loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName: string): OccupationFamilyTokenRelevanceArtifactEntry;
export declare function parseOccupationFamilyTokenRelevanceArtifact(contents: string, artifactPath: string): OccupationFamilyTokenRelevanceArtifact;
export type OccupationFamilyTokenRelevanceLookup = {
    familyTokensByLocale: Map<string, Map<number, Map<string, number>>>;
    genericityByLocale: Map<string, Map<string, number>>;
};
export declare function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName: string): OccupationFamilyTokenRelevanceLookup | null;
export declare function familyTokenRelevanceMultiplier(lookup: OccupationFamilyTokenRelevanceLookup | null, locale: string, familyNodeId: number | null, matchedTokens: string[]): number;
