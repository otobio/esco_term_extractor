import { type PreparedQuery } from '../../query/query-preparation.js';
export type LeafClosenessRankerInput = {
    preparedQuery: PreparedQuery;
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
    rank(input: LeafClosenessRankerInput): LeafClosenessRank;
}
