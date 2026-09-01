import { type SupportedQueryLocale } from '../../query/query-preparation.js';
export type LeafClosenessQuery = {
    locale: SupportedQueryLocale;
    normalized: string;
    folded: string;
    foldedTokens: string[];
    usefulFoldedRecallTokens: string[];
    roleHeadTokens?: string[];
    altRoleHeadTokens?: string[];
    roleModifierTokens?: string[];
    altRoleModifierTokens?: string[];
};
export type LeafClosenessRankerInput = {
    query: LeafClosenessQuery;
    canonicalLabel: string;
    aliases?: string[];
};
export type LeafClosenessRank = {
    score: number;
    matchedLabel: string;
    matchedLabelSource: 'canonical' | 'alias';
    exactNormalizedLabel: boolean;
    exactFoldedLabel: boolean;
    usefulQueryCoverage: number;
    titleExtraTokenRatio: number;
    extraGenericModifierCount: number;
    matchedUsefulTokens: string[];
    missingUsefulTokens: string[];
    extraTitleTokens: string[];
    extraGenericModifiers: string[];
};
export interface LeafClosenessRanker {
    rank(input: LeafClosenessRankerInput): LeafClosenessRank;
}
export declare class TokenLeafClosenessRanker implements LeafClosenessRanker {
    private readonly cache;
    rank(input: LeafClosenessRankerInput): LeafClosenessRank;
}
