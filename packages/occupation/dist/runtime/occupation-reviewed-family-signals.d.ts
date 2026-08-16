import type { PreparedQuery, SupportedQueryLocale } from '../query/query-preparation.js';
export type ReviewedFamilySignalRule = {
    id: string;
    locale: SupportedQueryLocale;
    familyNodeId: number;
    familyLabel: string;
    action: 'support' | 'suppress';
    roleHeadsAny?: string[];
    queryTermsAny?: string[];
    queryTermsAll?: string[];
    score: number;
    notes?: string;
};
export type ReviewedFamilySignalArtifact = {
    description?: string;
    rules: ReviewedFamilySignalRule[];
};
export type ReviewedFamilySignalBinaryManifest = {
    schemaVersion: 1;
    generatedAt: string;
    ruleCount: number;
    stringCount: number;
    termIdCount: number;
    files: {
        strings: string;
        rows: string;
        termIds: string;
    };
};
export type ReviewedFamilySignalArtifactEntry = {
    artifactPath: string;
    artifact: ReviewedFamilySignalArtifact;
};
export type ReviewedFamilySignalMatch = {
    rule: ReviewedFamilySignalRule;
    matchedRoleHeads: string[];
    matchedQueryTerms: string[];
    missingAllTerms: string[];
};
export declare function defaultOccupationReviewedFamilySignalsArtifactPath(): string;
export declare function loadOccupationReviewedFamilySignalsArtifactRequired(): ReviewedFamilySignalArtifactEntry;
export declare function parseReviewedFamilySignalArtifact(contents: string, artifactPath: string): ReviewedFamilySignalArtifact;
export declare function buildReviewedFamilySignalBinaryFiles(artifact: ReviewedFamilySignalArtifact, prefix: string): {
    manifestFiles: ReviewedFamilySignalBinaryManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    termIdCount: number;
};
export declare function findReviewedFamilySignalMatches(preparedQuery: PreparedQuery, artifact: ReviewedFamilySignalArtifact): ReviewedFamilySignalMatch[];
