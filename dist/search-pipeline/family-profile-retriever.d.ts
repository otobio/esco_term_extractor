import { type FamilyScopedPreparedQuery } from '../query/query-preparation.js';
import type { RuntimeFamilyProfileRecord, RuntimeFamilyProfileSourceKind } from '../runtime/occupation-family-profile-artifact.js';
export type FamilyProfileSourceKind = RuntimeFamilyProfileSourceKind;
export type FamilyProfileHit = {
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
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
    preparedQuery: FamilyScopedPreparedQuery;
    profiles: RuntimeFamilyProfileRecord[];
    locale: string;
    limit: number;
};
export declare class FamilyProfileRetriever {
    retrieve(options: FamilyProfileRetrieverOptions): FamilyProfileHit[];
}
