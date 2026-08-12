import type { Connection } from 'mysql2/promise';
import type { OpenSearchClient } from './client.js';
import { type OpenSearchConfig } from './config.js';
export type CreateOccupationAliasIndexOptions = {
    indexName?: string;
    templateName?: string;
    recreate?: boolean;
};
export type CreateOccupationAliasIndexResult = {
    indexName: string;
    templateName: string;
    recreated: boolean;
    created: boolean;
};
export type PopulateOccupationAliasIndexOptions = {
    sourceName?: string;
    indexName?: string;
    templateName?: string;
    chunkSize?: number;
    limit?: number;
    ensureIndex?: boolean;
    recreateIndex?: boolean;
    refresh?: boolean;
    onProgress?: (progress: PopulateOccupationAliasIndexProgress) => void;
};
export type PopulateOccupationAliasIndexProgress = {
    indexName: string;
    sourceName: string;
    lastGraphNodeId: number;
    lastAliasSortKey: string;
    chunkDocumentCount: number;
    indexedDocumentCount: number;
    failedDocumentCount: number;
    remaining?: number;
};
export type PopulateOccupationAliasIndexResult = {
    indexName: string;
    sourceName: string;
    chunkSize: number;
    totalCandidateCount: number;
    attemptedDocumentCount: number;
    indexedDocumentCount: number;
    failedDocumentCount: number;
};
export declare class OccupationAliasOpenSearchIndexManager {
    private readonly client;
    private readonly config;
    constructor(client: OpenSearchClient, config?: OpenSearchConfig);
    createOrUpdate(options?: CreateOccupationAliasIndexOptions): Promise<CreateOccupationAliasIndexResult>;
}
export declare class OccupationAliasOpenSearchBulkIndexer {
    private readonly connection;
    private readonly client;
    private readonly config;
    constructor(connection: Connection, client: OpenSearchClient, config?: OpenSearchConfig);
    run(options?: PopulateOccupationAliasIndexOptions): Promise<PopulateOccupationAliasIndexResult>;
    private countIndexableAliases;
    private loadAliasRows;
    private bulkIndexDocuments;
}
