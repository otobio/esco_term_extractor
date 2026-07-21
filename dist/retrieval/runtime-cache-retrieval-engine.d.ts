import type { AliasRetrievalEngine, AliasRetrievalOptions, AliasRetrievalResult, CanonicalLabelHit, FamilyOccupationTextRetrievalOptions, OccupationRetrievalEngine, OccupationTextHit, OccupationTextRetrievalEngine, OccupationTextRetrievalOptions } from './retrieval-engine.js';
export declare function createRuntimeCacheRetrievalEngine(): OccupationRetrievalEngine;
export declare class RuntimeCacheAliasRetriever implements AliasRetrievalEngine {
    retrieve(options: AliasRetrievalOptions): Promise<AliasRetrievalResult>;
}
export declare class RuntimeCacheOccupationRetriever implements OccupationTextRetrievalEngine {
    retrieve(options: OccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
    retrieveCanonicalLabels(options: OccupationTextRetrievalOptions & {
        foldedQueries: string[];
    }): Promise<CanonicalLabelHit[]>;
    retrieveWithinFamily(options: FamilyOccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
}
