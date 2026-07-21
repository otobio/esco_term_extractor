import { type FamilyScopedPreparedQuery } from '../../query/query-preparation.js';
export type FamilyScopedLeafFitTier = 'exact' | 'alias_aligned' | 'capability_aligned' | 'semantic_aligned' | 'lexical_related' | 'weak';
export type FamilyScopedLeafFit = {
    tier: FamilyScopedLeafFitTier;
    tierRank: number;
    reasons: string[];
    matchedTerms: string[];
    missingTerms: string[];
    matchedCapabilityTerms: string[];
};
export type FamilyScopedLeafRankerInput = {
    preparedQuery: FamilyScopedPreparedQuery;
    canonicalLabel: string;
    aliases: string[];
    capabilityLabels: string[];
    hasSemanticEvidence: boolean;
};
export declare class FamilyScopedLeafRanker {
    rank(input: FamilyScopedLeafRankerInput): FamilyScopedLeafFit;
}
