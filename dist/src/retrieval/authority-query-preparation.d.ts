import { type PreparedQuery } from '../query/query-preparation.js';
export type PreparedPhraseWindow = {
    query: string;
    tokenCount: number;
};
export type AuthorityQueryPreparation = {
    queryTokens: string[];
    preparedQueries: string[];
    preparedPhraseWindows: PreparedPhraseWindow[];
    rawQueries: string[];
};
export declare function buildAuthorityQueryPreparation(rawQuery: string, preparedQuery: PreparedQuery): AuthorityQueryPreparation;
export declare function buildPreparedPhraseWindows(foldedRecallTokenSequences: string[][]): PreparedPhraseWindow[];
