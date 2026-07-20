import type { OccupationIntentVocabulary, OccupationIntentVocabularyLocale } from '../query/query-intent.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
export type OccupationIntentVocabularyArtifactManifest = {
    schemaVersion: 2;
    sourceName: string;
    generatedAt: string;
    localeCount: number;
    recordsPath: string;
};
export type OccupationIntentVocabularyArtifact = OccupationIntentVocabularyArtifactManifest & OccupationIntentVocabulary;
type IntentVocabularyArtifactCacheEntry = {
    manifestPath: string;
    recordsPath: string;
    artifact: OccupationIntentVocabularyArtifact;
};
export declare function defaultOccupationIntentVocabularyManifestPath(sourceName: string): string;
export declare function defaultOccupationIntentVocabularyRecordsPath(sourceName: string): string;
export declare function loadOccupationIntentVocabularyArtifactIfAvailable(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry | null>;
export declare function loadOccupationIntentVocabularyArtifactRequired(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry>;
export declare function buildOccupationIntentVocabularyRecords(records: RuntimeSearchMetaRecord[]): OccupationIntentVocabularyLocale[];
export {};
