import { type PreparedQuery } from '../query/query-preparation.js';
import { type RuntimeSearchMetaRecord } from '../runtime/occupation-search-meta-artifact.js';
import { type BinaryAliasNgramIndex } from '../runtime/occupation-alias-ngram-binary-artifact.js';
export type RuntimeAliasNgramRecord = {
    index: number;
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    familyLabel: string | null;
    alias: string;
    normalizedAlias: string;
    aliasRole: string;
    aliasRoleScoreFactor: number;
    aliasWeight: number | null;
    foldedTokens: string[];
    usefulFoldedTokens: string[];
    weightedFeatures: Array<[string, number]>;
    norm: number;
};
export type AliasNgramIndexOptions = {
    sourceName: string;
    locale: string;
    includeFamilySupportingAliases?: boolean;
};
export type AliasNgramSourceRow = {
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    familyLabel: string | null;
    alias: string;
    normalizedAlias: string;
    aliasRole: string;
    aliasWeight: number | null;
};
export type AliasNgramHit = {
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    familyLabel: string | null;
    alias: string;
    normalizedAlias: string;
    aliasRole: string;
    aliasWeight: number | null;
    score: number;
    cosine: number;
    tokenCoverage: number;
    usefulTokenCoverage: number;
    matchedTokens: string[];
    matchedFeatures: string[];
};
type AliasNgramEntry = {
    index: number;
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    familyLabel: string | null;
    alias: string;
    normalizedAlias: string;
    aliasRole: string;
    aliasRoleScoreFactor: number;
    aliasWeight: number | null;
    foldedTokens: string[];
    usefulFoldedTokens: string[];
    featureCounts: Map<string, number>;
    weightedFeatures: Map<string, number>;
    norm: number;
};
export type AliasNgramIndex = {
    sourceName: string;
    locale: string;
    includeFamilySupportingAliases: boolean;
    aliasCount: number;
    entries: AliasNgramEntry[];
    postingsByFeature: Map<string, number[]>;
};
export declare function buildAliasNgramIndex(options: AliasNgramIndexOptions): Promise<AliasNgramIndex>;
export declare function buildOccupationAliasNgramRecords(records: RuntimeSearchMetaRecord[], options: AliasNgramIndexOptions): RuntimeAliasNgramRecord[];
export declare function buildAliasNgramIndexFromArtifactRecords(options: AliasNgramIndexOptions & {
    records: RuntimeAliasNgramRecord[];
}): AliasNgramIndex;
export declare function buildAliasNgramIndexFromRows(options: AliasNgramIndexOptions & {
    rows: AliasNgramSourceRow[];
}): AliasNgramIndex;
export declare function retrieveAliasNgramHits(index: AliasNgramIndex, preparedQuery: PreparedQuery, options: {
    limit: number;
}): AliasNgramHit[];
export declare function retrieveBinaryAliasNgramHits(index: BinaryAliasNgramIndex, preparedQuery: PreparedQuery, options: {
    limit: number;
}): AliasNgramHit[];
export {};
