import { type PreparedQuery } from '../query/query-preparation.js';
import type { OccupationFamilyTokenRelevanceArtifactCacheEntry } from '../runtime/occupation-family-token-relevance-artifact.js';
import { type FamilyProfileArtifactCacheEntry, type RuntimeFamilyProfileSourceKind } from '../runtime/occupation-family-profile-artifact.js';
export type FamilyTop2V2ClassifierQuery = {
    preparedQuery: PreparedQuery;
    rawQuery: string;
    effectiveQuery: string;
    locale: string;
    sourceName: string;
};
export type FamilyTop2V2ClassifierOptions = {
    familyProfileArtifact: FamilyProfileArtifactCacheEntry;
    familyTokenRelevanceArtifact: OccupationFamilyTokenRelevanceArtifactCacheEntry;
    query: FamilyTop2V2ClassifierQuery;
    limit: number;
};
export type FamilyTop2V2Result = {
    query: FamilyTop2V2ClassifierQuery;
    queryVector: QueryVectorTerm[];
    rankedFamilies: FamilyTop2V2FamilyHit[];
};
export type QueryVectorKind = 'support' | 'role' | 'role_head' | 'domain' | 'venue';
export type QueryVectorTerm = {
    token: string;
    kind: QueryVectorKind;
    weight: number;
    specificity: number;
};
export type FamilyTop2V2FamilyHit = {
    rank: number;
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
    score: number;
    cosine: number;
    exactFamilyLabelPhrase: boolean;
    usefulFamilyLabelPhrase: boolean;
    matchedTerms: string[];
    missingTerms: string[];
    matchedRoleTerms: string[];
    missingRoleTerms: string[];
    matchedDomainTerms: string[];
    matchedSources: RuntimeFamilyProfileSourceKind[];
    matchingLeafIds: number[];
    matchingLeafCount: number;
    profileLeafCount: number;
    vectorNorm: number;
    queryNorm: number;
    scoreBreakdown: FamilyTop2V2ScoreBreakdown;
};
export type FamilyTop2V2ScoreBreakdown = {
    vector: number;
    phrase: number;
    coverage: number;
    roleCoverage: number;
    domainCoverage: number;
    familyLabelExact: number;
    familyLabelUseful: number;
    queryVectorNorm: number;
    familyVectorNorm: number;
};
export declare function rankFamilyTop2V2(options: FamilyTop2V2ClassifierOptions): FamilyTop2V2Result;
