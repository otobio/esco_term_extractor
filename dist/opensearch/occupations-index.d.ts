import type { Connection } from 'mysql2/promise';
import type { OpenSearchClient } from './client.js';
import { type OpenSearchConfig } from './config.js';
export type CreateOccupationIndexOptions = {
    indexName?: string;
    templateName?: string;
    recreate?: boolean;
};
export type CreateOccupationIndexResult = {
    indexName: string;
    templateName: string;
    recreated: boolean;
    created: boolean;
};
export type PopulateOccupationIndexOptions = {
    sourceName?: string;
    indexName?: string;
    templateName?: string;
    chunkSize?: number;
    limit?: number;
    ensureIndex?: boolean;
    recreateIndex?: boolean;
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
    private bulkIndexDocuments;
}
