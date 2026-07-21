import type { AliasRetrievalEngine, AliasRetrievalOptions, AliasRetrievalResult, CanonicalLabelHit, FamilyOccupationTextRetrievalOptions, OccupationRetrievalEngine, OccupationTextHit, OccupationTextRetrievalEngine, OccupationTextRetrievalOptions } from './retrieval-engine.js';
export declare function createBinaryRetrievalEngine(): OccupationRetrievalEngine;
export declare class BinaryAliasRetriever implements AliasRetrievalEngine {
    retrieve(options: AliasRetrievalOptions): Promise<AliasRetrievalResult>;
}
export declare class BinaryOccupationRetriever implements OccupationTextRetrievalEngine {
    retrieve(options: OccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
    retrieveCanonicalLabels(options: OccupationTextRetrievalOptions & {
        foldedQueries: string[];
    }): Promise<CanonicalLabelHit[]>;
    retrieveWithinFamily(options: FamilyOccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
}
