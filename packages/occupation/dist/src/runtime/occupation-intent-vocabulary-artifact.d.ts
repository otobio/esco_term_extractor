import { type SupportedQueryLocale } from '../query/query-preparation.js';
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
export type OccupationIntentVocabularyBucketName = 'roleHeadTerms' | 'roleModifierTerms' | 'domainModifierTerms' | 'credentialModifierTerms' | 'ambiguousModifierTerms' | 'rolePhrases' | 'domainPhrases';
export type OccupationIntentVocabularyTermOverrides = Partial<Record<OccupationIntentVocabularyBucketName, string[]>>;
export type OccupationIntentVocabularyLocaleOverrides = {
    localeCode: string;
    add?: OccupationIntentVocabularyTermOverrides;
    remove?: OccupationIntentVocabularyTermOverrides;
};
type IntentVocabularyArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationIntentVocabularyArtifact;
};
export type TermStats = {
    totalCount: number;
    headCount: number;
    prefixCount: number;
    familyCount: number;
    capabilityCount: number;
};
type RolePhraseSource = {
    value: string;
    sourceKind: 'trusted_label' | 'supporting_alias';
};
type OccupationIntentVocabularyBuildInputs = {
    statsByLocale: Map<string, Map<string, TermStats>>;
    phraseSourcesByLocale: Map<string, Map<string, RolePhraseSource>>;
};
export declare function defaultOccupationIntentVocabularyManifestPath(sourceName: string): string;
export declare function defaultOccupationIntentVocabularyReviewJsonlPath(sourceName: string): string;
export declare function defaultOccupationIntentVocabularyOverridePath(localeCode: string): string;
export declare function loadOccupationIntentVocabularyOverridesIfPresent(overridePaths: readonly string[]): Promise<OccupationIntentVocabularyLocaleOverrides[]>;
export declare function loadOccupationIntentVocabularyArtifactIfAvailable(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry | null>;
export declare function loadOccupationIntentVocabularyArtifactRequired(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry>;
export declare function buildOccupationIntentVocabularyInputs(records: RuntimeSearchMetaRecord[]): OccupationIntentVocabularyBuildInputs;
export declare function buildOccupationIntentVocabularyRecords(records: RuntimeSearchMetaRecord[], localeOverrides?: readonly OccupationIntentVocabularyLocaleOverrides[]): OccupationIntentVocabularyLocale[];
export declare function buildOccupationIntentVocabularyBinaryFiles(records: OccupationIntentVocabularyLocale[], prefix: string): {
    manifestFiles: OccupationIntentVocabularyArtifactManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    termIdCount: number;
    phraseIdCount: number;
};
export type IntentVocabularyTermClass = 'domain_modifier' | 'role_head' | 'role_modifier' | 'ambiguous_modifier' | 'ignore';
export declare function classifyIntentVocabularyTerm(term: string, termStats: TermStats, locale: SupportedQueryLocale): IntentVocabularyTermClass;
export {};
