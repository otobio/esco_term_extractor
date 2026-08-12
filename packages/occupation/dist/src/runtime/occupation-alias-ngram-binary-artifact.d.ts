import { type BinaryStringTable, type FileBackedUint32Rows, type FixedTable } from '../utils/binary-table.js';
import type { RuntimeAliasNgramRecord } from '../retrieval/alias-ngram-retriever.js';
export declare const ALIAS_NGRAM_BINARY_SCHEMA_VERSION = 1;
export declare const ALIAS_NGRAM_NULL_U32 = 4294967295;
export declare const ALIAS_NGRAM_WEIGHT_SCALE = 1000000;
export type OccupationAliasNgramBinaryManifest = {
    schemaVersion: 1;
    sourceName: string;
    locale: string;
    includeFamilySupportingAliases: boolean;
    generatedAt: string;
    count: number;
    stringCount: number;
    featurePostingKeyCount: number;
    featureValueCount: number;
    files: {
        strings: string;
        rows: string;
        featureValues: string;
        featurePostings: string;
        featurePostingRows: string;
    };
};
export type BinaryAliasNgramIndex = {
    manifestPath: string;
    manifest: OccupationAliasNgramBinaryManifest;
    strings: BinaryStringTable;
    rows: FixedTable;
    featureValues: FixedTable;
    featurePostings: FixedTable;
    featurePostingRows: Uint32Array | FileBackedUint32Rows;
};
export declare function defaultOccupationAliasNgramBinaryManifestPath(sourceName: string, locale: string, includeFamilySupportingAliases: boolean): string;
export declare function loadOccupationAliasNgramBinaryIfAvailable(sourceName: string, locale: string, includeFamilySupportingAliases: boolean): Promise<BinaryAliasNgramIndex | null>;
export declare function buildAliasNgramBinaryFiles(records: RuntimeAliasNgramRecord[], prefix: string): {
    manifestFiles: OccupationAliasNgramBinaryManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    featurePostingKeyCount: number;
    featureValueCount: number;
};
export declare function binaryRowFeatureWeight(index: BinaryAliasNgramIndex, rowId: number, featureId: number): number;
export declare function binaryFeaturePostings(index: BinaryAliasNgramIndex, featureId: number): number[];
export declare function binaryStringId(index: BinaryAliasNgramIndex, value: string): number;
export declare function binaryStringAt(index: BinaryAliasNgramIndex, stringId: number): string;
