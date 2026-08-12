import type { OccupationIntentVocabulary, OccupationIntentVocabularyLocale } from '../query/query-intent.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
export declare const INTENT_VOCABULARY_BINARY_SCHEMA_VERSION = 3;
export type OccupationIntentVocabularyArtifactManifest = {
    schemaVersion: typeof INTENT_VOCABULARY_BINARY_SCHEMA_VERSION;
    sourceName: string;
    generatedAt: string;
    localeCount: number;
    stringCount: number;
    termIdCount: number;
    phraseIdCount: number;
    files: {
        strings: string;
        localeRows: string;
        termIds: string;
        phraseIds: string;
    };
};
export type OccupationIntentVocabularyArtifact = OccupationIntentVocabularyArtifactManifest & OccupationIntentVocabulary;
type IntentVocabularyArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationIntentVocabularyArtifact;
};
export declare function defaultOccupationIntentVocabularyManifestPath(sourceName: string): string;
export declare function defaultOccupationIntentVocabularyReviewJsonlPath(sourceName: string): string;
export declare function loadOccupationIntentVocabularyArtifactIfAvailable(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry | null>;
export declare function loadOccupationIntentVocabularyArtifactRequired(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry>;
export declare function buildOccupationIntentVocabularyRecords(records: RuntimeSearchMetaRecord[]): OccupationIntentVocabularyLocale[];
export declare function buildOccupationIntentVocabularyBinaryFiles(records: OccupationIntentVocabularyLocale[], prefix: string): {
    manifestFiles: OccupationIntentVocabularyArtifactManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    termIdCount: number;
    phraseIdCount: number;
};
export {};
