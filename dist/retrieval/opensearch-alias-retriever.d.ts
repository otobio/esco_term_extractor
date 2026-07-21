import { OpenSearchClient } from '../opensearch/client.js';
import { type OpenSearchConfig } from '../opensearch/config.js';
import type { AliasEvidenceRow, AliasRetrievalEngine, AliasRetrievalOptions, AliasRetrievalResult } from './retrieval-engine.js';
export type OpenSearchAliasEvidenceRow = AliasEvidenceRow;
export type OpenSearchAliasRetrieverOptions = AliasRetrievalOptions;
export type OpenSearchAliasRetrieverResult = AliasRetrievalResult;
export declare class OpenSearchAliasRetriever implements AliasRetrievalEngine {
    private readonly client;
    private readonly config;
    constructor(client?: OpenSearchClient, config?: OpenSearchConfig);
    retrieve(options: OpenSearchAliasRetrieverOptions): Promise<OpenSearchAliasRetrieverResult>;
    private searchAliasRows;
}
