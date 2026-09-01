import { type PreparedQuery } from '../query/query-preparation.js';
import type { PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
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
export type AuthorityQueryPreparationOptions = {
    retrievalQuery?: PreparedOccupationRetrievalQuery;
};
export declare function buildAuthorityQueryPreparation(preparedQuery: PreparedQuery, options?: AuthorityQueryPreparationOptions): AuthorityQueryPreparation;
export declare function buildPreparedPhraseWindows(foldedRecallTokenSequences: string[][]): PreparedPhraseWindow[];
export declare function buildAliasPhraseWindows(preparedQuery: PreparedQuery, options?: AuthorityQueryPreparationOptions): string[];
export declare function buildAliasHeadTokenFallbackWindows(preparedQuery: PreparedQuery, options?: AuthorityQueryPreparationOptions): string[];
