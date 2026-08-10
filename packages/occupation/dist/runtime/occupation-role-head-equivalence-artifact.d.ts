import { type SupportedQueryLocale } from '../query/query-preparation.js';
export type RoleHeadEquivalenceClass = {
    id: string;
    terms?: string[];
    termsByLocale: Partial<Record<SupportedQueryLocale, string[]>>;
};
export type RoleHeadEquivalenceArtifact = {
    description?: string;
    classes: RoleHeadEquivalenceClass[];
};
export type RoleHeadEquivalenceBinaryManifest = {
    schemaVersion: 1;
    generatedAt: string;
    description?: string;
    classCount: number;
    stringCount: number;
    termCount: number;
    classIdValueCount: number;
    files: {
        strings: string;
        termRows: string;
        classIds: string;
    };
};
export type RoleHeadEquivalenceLookup = {
    classIdsByLocaleAndTerm: ReadonlyMap<SupportedQueryLocale, ReadonlyMap<string, readonly string[]>>;
};
export type RoleHeadEquivalenceArtifactEntry = {
    artifactPath: string;
    manifest: RoleHeadEquivalenceBinaryManifest;
    lookup: RoleHeadEquivalenceLookup;
};
export declare function defaultOccupationRoleHeadEquivalentsArtifactPath(): string;
export declare function defaultOccupationRoleHeadEquivalentsReviewPath(): string;
export declare function loadOccupationRoleHeadEquivalenceArtifactRequired(): RoleHeadEquivalenceArtifactEntry;
export declare function buildRoleHeadEquivalenceBinaryFiles(artifact: RoleHeadEquivalenceArtifact, prefix: string): {
    manifestFiles: RoleHeadEquivalenceBinaryManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    termCount: number;
    classIdValueCount: number;
};
export declare function parseRoleHeadEquivalenceArtifact(contents: string, artifactPath: string): RoleHeadEquivalenceArtifact;
