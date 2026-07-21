export type OccupationVectorRecord = {
    index: number;
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number;
    familyLabel: string;
    vectorNorm: number | null;
};
export type OccupationVectorArtifactManifest = {
    schemaVersion: 1;
    sourceName: string;
    modelKey: string;
    provider: string;
    dimensions: number;
    textRole: 'dense_text';
    localeCode: null;
    generatedAt: string;
    count: number;
    metadataPath: string;
    vectorsPath: string;
    vectorDataType: 'float32_le';
};
export type OccupationVectorArtifact = OccupationVectorArtifactManifest & {
    vectors: OccupationVectorRecord[];
    vectorValues: Float32Array;
};
export type OccupationVectorScore = {
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number;
    familyLabel: string;
    score: number;
    dot: number;
};
type ArtifactCacheEntry = {
    manifestPath: string;
    metadataPath: string;
    vectorsPath: string;
    artifact: OccupationVectorArtifact;
    vectorsByFamilyNodeId: Map<number, OccupationVectorRecord[]>;
};
export declare function defaultOccupationVectorManifestPath(sourceName: string, modelKey: string): string;
export declare function defaultOccupationVectorMetadataPath(sourceName: string, modelKey: string): string;
export declare function defaultOccupationVectorValuesPath(sourceName: string, modelKey: string): string;
export declare function loadOccupationVectorArtifactIfAvailable(sourceName: string, modelKey: string): Promise<ArtifactCacheEntry | null>;
export declare function loadOccupationVectorArtifactRequired(sourceName: string, modelKey: string): Promise<ArtifactCacheEntry>;
export declare function scoreOccupationVectorArtifact(artifact: OccupationVectorArtifact, queryVector: number[], queryVectorNorm: number, options: {
    limit: number;
    familyNodeIds?: number[];
}): OccupationVectorScore[];
export declare function scoreOccupationVectorRecords(records: OccupationVectorRecord[], vectorValues: Float32Array, dimensions: number, queryVector: number[], queryVectorNorm: number, options: {
    limit: number;
}): OccupationVectorScore[];
export {};
