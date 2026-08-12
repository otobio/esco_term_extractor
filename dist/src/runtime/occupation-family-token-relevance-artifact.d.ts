import { type BinaryStringTable, type FixedTable } from '../utils/binary-table.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
export declare const FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION = 1;
export declare const FAMILY_TOKEN_RELEVANCE_SCORE_SCALE = 1000000;
export declare const FAMILY_TOKEN_RELEVANCE_FAMILY_ROW_WIDTH = 4;
export declare const FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH = 2;
export declare const FAMILY_TOKEN_RELEVANCE_GENERICITY_LOCALE_ROW_WIDTH = 3;
type BuiltLocaleFamily = {
    familyNodeId: number;
    tokens: Array<[string, number]>;
};
export type OccupationFamilyTokenRelevanceReviewData = {
    totalFamilies: number;
    locales: string[];
    lowConfidenceLocales: string[];
    familiesByLocale: Record<string, BuiltLocaleFamily[]>;
    genericityByLocale: Record<string, Array<[string, number]>>;
};
export type OccupationFamilyTokenRelevanceArtifactManifest = {
    schemaVersion: 1;
    sourceName: string;
    generatedAt: string;
    totalFamilies: number;
    locales: string[];
    lowConfidenceLocales: string[];
    stringCount: number;
    familyKeyCount: number;
    familyTokenValueCount: number;
    genericityLocaleCount: number;
    genericityTokenValueCount: number;
    files: {
        strings: string;
        familyRows: string;
        familyTokenRows: string;
        genericityLocaleRows: string;
        genericityTokenRows: string;
    };
};
export type OccupationFamilyTokenRelevanceArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationFamilyTokenRelevanceArtifactManifest;
    strings: BinaryStringTable;
    familyRows: FixedTable;
    familyTokenRows: FixedTable;
    genericityLocaleRows: FixedTable;
    genericityTokenRows: FixedTable;
    familyTokenRelevance(locale: string, familyNodeId: number, token: string): number;
    maxTokenRelevance(locale: string, token: string): number;
};
export declare function defaultOccupationFamilyTokenRelevanceManifestPath(sourceName: string): string;
export declare function loadOccupationFamilyTokenRelevanceArtifactIfAvailable(sourceName: string): OccupationFamilyTokenRelevanceArtifactCacheEntry | null;
export declare function loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName: string): OccupationFamilyTokenRelevanceArtifactCacheEntry;
export declare function buildOccupationFamilyTokenRelevanceBinaryFiles(records: RuntimeSearchMetaRecord[], prefix: string): {
    manifestFiles: OccupationFamilyTokenRelevanceArtifactManifest['files'];
    buffers: Map<string, Buffer>;
    totalFamilies: number;
    locales: string[];
    lowConfidenceLocales: string[];
    stringCount: number;
    familyKeyCount: number;
    familyTokenValueCount: number;
    genericityLocaleCount: number;
    genericityTokenValueCount: number;
};
export declare function buildOccupationFamilyTokenRelevanceReviewData(records: RuntimeSearchMetaRecord[]): OccupationFamilyTokenRelevanceReviewData;
export {};
