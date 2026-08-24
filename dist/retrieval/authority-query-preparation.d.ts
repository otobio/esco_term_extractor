import { type PreparedQuery } from '../query/query-preparation.js';
export type PreparedPhraseWindow = {
    query: string;
    tokenCount: number;
};
export type AuthorityQueryPreparation = {
    queryTokens: string[];
    preparedQueries: string[];
    preparedPhraseWindows: PreparedPhraseWindow[];
    primaryQueryTokens: string[];
    primaryPreparedQueries: string[];
    primaryPreparedPhraseWindows: PreparedPhraseWindow[];
    aliasPhraseWindows: string[];
    aliasFallbackPhraseWindows: string[];
};
export declare function buildAuthorityQueryPreparation(preparedQuery: PreparedQuery): AuthorityQueryPreparation;
export declare function buildPreparedPhraseWindows(foldedRecallTokenSequences: string[][]): PreparedPhraseWindow[];
export declare function buildAliasPhraseWindows(preparedQuery: PreparedQuery): string[];
export declare function buildAliasHeadTokenFallbackWindows(preparedQuery: PreparedQuery): string[];
