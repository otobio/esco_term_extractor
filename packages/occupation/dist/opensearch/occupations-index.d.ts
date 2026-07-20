import type { Connection } from 'mysql2/promise';
import { OpenSearchClient } from './client.js';
import { type OpenSearchConfig } from './config.js';
export type CreateOccupationIndexOptions = {
    indexName?: string;
    templateName?: string;
    recreate?: boolean;
    includeVectorField?: boolean;
};
export type CreateOccupationIndexResult = {
    indexName: string;
    templateName: string;
    recreated: boolean;
    created: boolean;
    vectorField: string | null;
};
export type PopulateOccupationIndexOptions = {
    sourceName?: string;
    indexName?: string;
    templateName?: string;
    chunkSize?: number;
    limit?: number;
    modelKey?: string;
    ensureIndex?: boolean;
    recreateIndex?: boolean;
    includeVectorField?: boolean;
    refresh?: boolean;
    onProgress?: (progress: PopulateOccupationIndexProgress) => void;
};
export type PopulateOccupationIndexProgress = {
    indexName: string;
    sourceName: string;
    lastGraphNodeId: number;
    chunkDocumentCount: number;
    indexedDocumentCount: number;
    failedDocumentCount: number;
    vectorDocumentCount: number;
    remaining?: number;
};
export type PopulateOccupationIndexResult = {
    indexName: string;
    sourceName: string;
    chunkSize: number;
    totalCandidateCount: number;
    attemptedDocumentCount: number;
    indexedDocumentCount: number;
    failedDocumentCount: number;
    vectorDocumentCount: number;
    usedEmbeddingModelKey: string | null;
    embeddingDimensions: number | null;
};
export declare class OccupationOpenSearchIndexManager {
    private readonly client;
    private readonly config;
    constructor(client: OpenSearchClient, config?: OpenSearchConfig);
    createOrUpdate(options?: CreateOccupationIndexOptions): Promise<CreateOccupationIndexResult>;
}
export declare class OccupationOpenSearchBulkIndexer {
    private readonly connection;
    private readonly client;
    private readonly config;
    constructor(connection: Connection, client: OpenSearchClient, config?: OpenSearchConfig);
    run(options?: PopulateOccupationIndexOptions): Promise<PopulateOccupationIndexResult>;
    private countIndexableOccupations;
    private loadBaseOccupationRows;
    private loadAliasRows;
    private loadCapabilityRows;
    private loadAncestorRows;
    private loadEmbeddingModel;
    private loadEmbeddingRows;
    private bulkIndexDocuments;
}
