import type { Connection } from 'mysql2/promise';
import { type EmbeddingProviderKind } from '../providers/index.js';
export type BuildOccupationEmbeddingsOptions = {
    sourceName?: string;
    provider?: EmbeddingProviderKind;
    modelKey?: string;
    modelName?: string;
    cacheDir?: string;
    dimensions?: number;
    skipExisting?: boolean;
    limit?: number;
    processChunkSize?: number;
    onProgress?: (progress: BuildOccupationEmbeddingsProgress) => void;
};
export type BuildOccupationEmbeddingsResult = {
    sourceName: string;
    modelId: number;
    modelKey: string;
    provider: string;
    dimensions: number;
    processedNodeCount: number;
    insertedEmbeddingCount: number;
    skippedEmptyTextCount: number;
};
export type BuildOccupationEmbeddingsProgress = {
    sourceName: string;
    modelKey: string;
    provider: string;
    lastGraphNodeId: number;
    processedNodeCount: number;
    insertedEmbeddingCount: number;
    chunkRowCount: number;
    remaining?: number;
};
export declare class OccupationEmbeddingBuilder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: BuildOccupationEmbeddingsOptions): Promise<BuildOccupationEmbeddingsResult>;
    private upsertEmbeddingModel;
    private loadEmbeddingModel;
    private loadDenseTextRows;
    private countEmptyDenseTextRows;
    private replaceNodeEmbeddings;
    private deleteExistingNodeEmbeddings;
    private insertNodeEmbeddings;
}
export declare function defaultOccupationEmbeddingModelKey(): string;
export declare function defaultOccupationEmbeddingDimensions(): number;
