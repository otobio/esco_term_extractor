import { type FamilyScopedPreparedQuery } from '../../query/query-preparation.js';
export type CapabilityFitTier = 'strong' | 'partial' | 'none';
export type CapabilityFit = {
    tier: CapabilityFitTier;
    tierRank: number;
    coverage: number;
    matchedCapabilityTerms: string[];
    missingCapabilityTerms: string[];
};
export type CapabilityFitRankerInput = {
    preparedQuery: FamilyScopedPreparedQuery;
    capabilityLabels: string[];
};
export declare class CapabilityFitRanker {
    rank(input: CapabilityFitRankerInput): CapabilityFit;
}
