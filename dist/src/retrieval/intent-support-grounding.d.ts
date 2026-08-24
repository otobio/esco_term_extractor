import { type PreparedQuery } from '../query/query-preparation.js';
export declare function supportAliasGroundingTokens(preparedQuery: PreparedQuery): Set<string>;
export declare function groundedSupportingMatchedTokens(preparedQuery: PreparedQuery, matchedTokens: string[]): string[];
export declare function hasSupportAliasGrounding(preparedQuery: PreparedQuery, matchedTokens: string[]): boolean;
export declare function isSupportingAliasRole(aliasRole: string): boolean;
export declare function shouldSuppressContextOnlySupportingAlias(aliasRole: string, matchedTokens: string[], preparedQuery: PreparedQuery): boolean;
export declare function shouldSuppressContextOnlyLexicalMatch(preparedQuery: PreparedQuery, matchedTokens: string[]): boolean;
