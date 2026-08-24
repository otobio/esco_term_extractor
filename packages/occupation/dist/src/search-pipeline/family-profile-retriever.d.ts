import { type PreparedQuery } from '../query/query-preparation.js';
import type { FamilyProfileArtifactCacheEntry, RuntimeFamilyProfileSourceKind } from '../runtime/occupation-family-profile-artifact.js';
export type FamilyProfileSourceKind = RuntimeFamilyProfileSourceKind;
export type FamilyProfileHit = {
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
    exactFamilyLabelPhrase: boolean;
    usefulFamilyLabelPhrase: boolean;
    score: number;
    coverage: number;
    roleCoverage: number;
    domainCoverage: number;
    matchedTerms: string[];
    missingTerms: string[];
    matchedRoleTerms: string[];
    missingRoleTerms: string[];
    matchedDomainTerms: string[];
    matchedSources: FamilyProfileSourceKind[];
    matchingLeafIds: number[];
    matchingLeafCount: number;
    profileLeafCount: number;
};
export type FamilyProfileRetrieverOptions = {
    preparedQuery: PreparedQuery;
    artifact: FamilyProfileArtifactCacheEntry;
    locale: string;
    limit: number;
    rawQuery?: string;
};
export declare class FamilyProfileRetriever {
    retrieveExactCanonicalFamilies(options: FamilyProfileRetrieverOptions): FamilyProfileHit[];
    retrieve(options: FamilyProfileRetrieverOptions): FamilyProfileHit[];
}
