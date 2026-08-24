import { type BinaryStringTable, type FixedTable } from '../utils/binary-table.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
export declare const FAMILY_CAPABILITY_RELEVANCE_BINARY_SCHEMA_VERSION = 1;
export declare const FAMILY_CAPABILITY_RELEVANCE_SCORE_SCALE = 1000000;
export declare const FAMILY_CAPABILITY_RELEVANCE_FAMILY_ROW_WIDTH = 4;
export declare const FAMILY_CAPABILITY_RELEVANCE_TOKEN_ROW_WIDTH = 2;
export declare const FAMILY_CAPABILITY_RELEVANCE_GENERICITY_LOCALE_ROW_WIDTH = 3;
type BuiltLocaleFamily = {
    familyNodeId: number;
    tokens: Array<[string, number]>;
};
export type OccupationFamilyCapabilityRelevanceReviewData = {
    totalFamilies: number;
    locales: string[];
    lowConfidenceLocales: string[];
    familiesByLocale: Record<string, BuiltLocaleFamily[]>;
    genericityByLocale: Record<string, Array<[string, number]>>;
};
export type OccupationFamilyCapabilityRelevanceArtifactManifest = {
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
export type OccupationFamilyCapabilityRelevanceArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationFamilyCapabilityRelevanceArtifactManifest;
    strings: BinaryStringTable;
    familyRows: FixedTable;
    familyTokenRows: FixedTable;
    genericityLocaleRows: FixedTable;
    genericityTokenRows: FixedTable;
    familyCapabilityRelevance(locale: string, familyNodeId: number, token: string): number;
    maxTokenRelevance(locale: string, token: string): number;
};
export declare function defaultOccupationFamilyCapabilityRelevanceManifestPath(sourceName: string): string;
export declare function loadOccupationFamilyCapabilityRelevanceArtifactIfAvailable(sourceName: string): OccupationFamilyCapabilityRelevanceArtifactCacheEntry | null;
export declare function loadOccupationFamilyCapabilityRelevanceArtifactRequired(sourceName: string): OccupationFamilyCapabilityRelevanceArtifactCacheEntry;
export declare function buildOccupationFamilyCapabilityRelevanceBinaryFiles(records: RuntimeSearchMetaRecord[], prefix: string): {
    manifestFiles: OccupationFamilyCapabilityRelevanceArtifactManifest['files'];
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
export declare function buildOccupationFamilyCapabilityRelevanceReviewData(records: RuntimeSearchMetaRecord[]): OccupationFamilyCapabilityRelevanceReviewData;
export {};
