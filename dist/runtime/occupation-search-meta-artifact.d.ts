export type RuntimeGenericRisk = 'low' | 'medium' | 'high';
export type RuntimeAncestorRecord = {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
    distanceFromLeaf: number;
    ancestorRole: string;
};
export type RuntimeSiblingRecord = {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
    siblingKind: string;
    weight: number | null;
};
export type RuntimeAliasRecord = {
    localeCode: string;
    alias: string;
    normalizedAlias: string;
    aliasRole: 'locale_primary' | 'locale_supporting' | 'reviewed_crosswalk' | 'family_supporting' | 'english_backbone';
    isPrimary: boolean;
    confidence: number | null;
    weight: number | null;
};
export type RuntimeCapabilityRecord = {
    capabilityId: number;
    capabilityType: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
    label: string;
    normalizedLabel: string;
    hintKind: string;
    weight: number | null;
};
export type RuntimeSearchMetaRecord = {
    searchMetaId: number;
    graphNodeId: number;
    canonicalLabel: string;
    genericRisk: RuntimeGenericRisk;
    hasHierarchy: boolean;
    hasCapabilitySupport: boolean;
    familyNodeId: number | null;
    familyLabel: string | null;
    groupNodeId: number | null;
    groupLabel: string | null;
    parentNodeId: number | null;
    parentLabel: string | null;
    ancestors: RuntimeAncestorRecord[];
    siblings: RuntimeSiblingRecord[];
    aliases: RuntimeAliasRecord[];
    capabilityLabels: RuntimeCapabilityRecord[];
};
export type OccupationSearchMetaArtifactManifest = {
    schemaVersion: 1;
    sourceName: string;
    generatedAt: string;
    count: number;
    recordsPath: string;
    detailsPath?: string;
    detailsPaths: string[];
};
export type OccupationSearchMetaArtifact = OccupationSearchMetaArtifactManifest & {
    records: RuntimeSearchMetaRecord[];
};
type SearchMetaArtifactCacheEntry = {
    manifestPath: string;
    recordsPath: string;
    detailsPaths: string[];
    artifact: OccupationSearchMetaArtifact;
    recordsByNodeId: Map<number, RuntimeSearchMetaRecord>;
    leafRecordsByFamilyNodeId: Map<number, RuntimeSearchMetaRecord[]>;
    detailsByNodeId: Map<number, SearchMetaDetailsPointer>;
    detailsCacheByNodeId: Map<number, RuntimeSearchMetaDetails>;
};
type RuntimeSearchMetaDetails = {
    graphNodeId: number;
    aliases: RuntimeAliasRecord[];
    capabilityLabels: RuntimeCapabilityRecord[];
};
type SearchMetaDetailsPointer = {
    fileIndex: number;
    offset: number;
    byteLength: number;
};
export declare function defaultOccupationSearchMetaManifestPath(sourceName: string): string;
export declare function defaultOccupationSearchMetaRecordsPath(sourceName: string): string;
export declare function defaultOccupationSearchMetaDetailsPath(sourceName: string): string;
export declare function loadOccupationSearchMetaArtifactIfAvailable(sourceName: string): Promise<SearchMetaArtifactCacheEntry | null>;
export declare function loadOccupationSearchMetaArtifactRequired(sourceName: string): Promise<SearchMetaArtifactCacheEntry>;
export declare function loadOccupationSearchMetaArtifactWithDetailsRequired(sourceName: string): Promise<SearchMetaArtifactCacheEntry>;
export declare function hydrateRuntimeSearchMetaRecords(artifactEntry: SearchMetaArtifactCacheEntry, records: RuntimeSearchMetaRecord[]): Promise<RuntimeSearchMetaRecord[]>;
export declare function hydrateAllRuntimeSearchMetaRecords(artifactEntry: SearchMetaArtifactCacheEntry, records: RuntimeSearchMetaRecord[]): Promise<RuntimeSearchMetaRecord[]>;
export declare function hydrateRuntimeSearchMetaRecord(artifactEntry: SearchMetaArtifactCacheEntry, record: RuntimeSearchMetaRecord): Promise<RuntimeSearchMetaRecord>;
export {};
