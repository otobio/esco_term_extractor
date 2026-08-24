import { type PreparedQuery } from '../query/query-preparation.js';
import type { OccupationFamilyTokenRelevanceArtifactCacheEntry } from '../runtime/occupation-family-token-relevance-artifact.js';
import { type FamilyProfileArtifactCacheEntry, type RuntimeFamilyProfileSourceKind } from '../runtime/occupation-family-profile-artifact.js';
export type FamilyTop2ClassifierQuery = {
    preparedQuery: PreparedQuery;
    rawQuery: string;
    effectiveQuery: string;
    locale: string;
    sourceName: string;
};
export type FamilyTop2ClassifierOptions = {
    familyProfileArtifact: FamilyProfileArtifactCacheEntry;
    familyTokenRelevanceArtifact: OccupationFamilyTokenRelevanceArtifactCacheEntry;
    query: FamilyTop2ClassifierQuery;
    limit: number;
};
export type FamilyTop2ClassifierResult = {
    query: FamilyTop2ClassifierQuery;
    queryTerms: QueryTerm[];
    rankedFamilies: FamilyTop2FamilyHit[];
};
export type QueryTermKind = 'support' | 'role' | 'role_head' | 'domain' | 'venue';
export type QueryTerm = {
    token: string;
    weight: number;
    kind: QueryTermKind;
};
export type FamilyTop2FamilyHit = {
    rank: number;
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
    score: number;
    exactFamilyLabelPhrase: boolean;
    usefulFamilyLabelPhrase: boolean;
    coverage: number;
    roleCoverage: number;
    domainCoverage: number;
    matchedTerms: string[];
    missingTerms: string[];
    matchedRoleTerms: string[];
    missingRoleTerms: string[];
    matchedDomainTerms: string[];
    matchedSources: RuntimeFamilyProfileSourceKind[];
    matchingLeafIds: number[];
    matchingLeafCount: number;
    profileLeafCount: number;
    scoreBreakdown: FamilyTop2ScoreBreakdown;
};
export type FamilyTop2ScoreBreakdown = {
    labelAlias: number;
    leafLabel: number;
    capability: number;
    phrase: number;
    exact: number;
    usefulExact: number;
    coverage: number;
    roleCoverage: number;
    domainCoverage: number;
    querySpecificity: number;
};
export declare function rankFamilyTop2(options: FamilyTop2ClassifierOptions): FamilyTop2ClassifierResult;
