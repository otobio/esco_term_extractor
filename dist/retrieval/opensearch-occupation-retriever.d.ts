import { OpenSearchClient } from '../opensearch/client.js';
import { type OpenSearchConfig } from '../opensearch/config.js';
import type { CanonicalLabelHit, FamilyOccupationTextRetrievalOptions, OccupationTextFieldSignal, OccupationTextRetrievalEngine, OccupationTextHit, OccupationTextRetrievalOptions } from './retrieval-engine.js';
export type OpenSearchOccupationRetrieverOptions = OccupationTextRetrievalOptions;
export type OpenSearchFamilyOccupationRetrieverOptions = FamilyOccupationTextRetrievalOptions;
export type OpenSearchOccupationHit = OccupationTextHit;
export type OpenSearchCanonicalLabelHit = CanonicalLabelHit;
export type OpenSearchFieldSignal = OccupationTextFieldSignal;
export declare class OpenSearchOccupationRetriever implements OccupationTextRetrievalEngine {
    private readonly client;
    private readonly config;
    constructor(client?: OpenSearchClient, config?: OpenSearchConfig);
    retrieve(options: OpenSearchOccupationRetrieverOptions): Promise<OpenSearchOccupationHit[]>;
    retrieveCanonicalLabels(options: OpenSearchOccupationRetrieverOptions & {
        foldedQueries: string[];
    }): Promise<OpenSearchCanonicalLabelHit[]>;
    retrieveWithinFamily(options: OpenSearchFamilyOccupationRetrieverOptions): Promise<OpenSearchOccupationHit[]>;
}
