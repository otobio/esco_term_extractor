import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
export declare const FAMILY_PROFILE_SOURCE_KINDS: readonly ["family_label", "alias", "leaf_label", "capability"];
export type RuntimeFamilyProfileSourceKind = typeof FAMILY_PROFILE_SOURCE_KINDS[number];
export type RuntimeFamilyProfileSource = {
    tokens: string[];
    phrases: string[];
};
export type RuntimeFamilyProfileLocaleRecord = {
    localeCode: string;
    sources: Record<RuntimeFamilyProfileSourceKind, RuntimeFamilyProfileSource>;
    leafIdsByToken: Array<[string, number[]]>;
};
export type RuntimeFamilyProfileRecord = {
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
    profileLeafCount: number;
    localeProfiles: RuntimeFamilyProfileLocaleRecord[];
};
export type OccupationFamilyProfileArtifactManifest = {
    schemaVersion: 1;
    sourceName: string;
    generatedAt: string;
    count: number;
    recordsPath: string;
};
export type OccupationFamilyProfileArtifact = OccupationFamilyProfileArtifactManifest & {
    records: RuntimeFamilyProfileRecord[];
};
type FamilyProfileArtifactCacheEntry = {
    manifestPath: string;
    recordsPath: string;
    artifact: OccupationFamilyProfileArtifact;
    recordsByFamilyNodeId: Map<number, RuntimeFamilyProfileRecord>;
};
export declare function defaultOccupationFamilyProfileManifestPath(sourceName: string): string;
export declare function defaultOccupationFamilyProfileRecordsPath(sourceName: string): string;
export declare function loadOccupationFamilyProfileArtifactIfAvailable(sourceName: string): Promise<FamilyProfileArtifactCacheEntry | null>;
export declare function loadOccupationFamilyProfileArtifactRequired(sourceName: string): Promise<FamilyProfileArtifactCacheEntry>;
export declare function buildOccupationFamilyProfileRecords(records: RuntimeSearchMetaRecord[]): RuntimeFamilyProfileRecord[];
export {};
