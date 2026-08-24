import { type SupportedQueryLocale } from '../../query/query-preparation.js';
export type FamilyScopedLeafFitTier = 'exact' | 'alias_aligned' | 'capability_aligned' | 'lexical_related' | 'weak';
export type FamilyScopedLeafFit = {
    tier: FamilyScopedLeafFitTier;
    tierRank: number;
    reasons: string[];
    matchedTerms: string[];
    missingTerms: string[];
    matchedCapabilityTerms: string[];
};
export type FamilyScopedLeafRankerInput = {
    locale: SupportedQueryLocale;
    foldedQuery: string;
    familyScopedFoldedTokens: string[];
    canonicalLabel: string;
    aliases: string[];
    capabilityLabels: string[];
};
export declare class FamilyScopedLeafRanker {
    rank(input: FamilyScopedLeafRankerInput): FamilyScopedLeafFit;
}
