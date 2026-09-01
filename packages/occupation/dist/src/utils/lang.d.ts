import { type OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';
export declare const FUNCTION_WORDS_BY_LOCALE: Record<'en' | 'ro' | 'hu' | 'et' | 'unknown', Set<string>>;
export declare const DEFAULT_BROAD_TOKEN_ANCHOR_COUNT_THRESHOLD = 1000;
export declare function isBroadToken(options: {
    token: string;
    locale: 'en' | 'ro' | 'hu' | 'et' | 'unknown' | string | undefined;
    anchorCount?: number | null;
    threshold?: number;
}): boolean;
export declare function isEnglishWord(value: string, sourceName: string): Promise<boolean>;
export declare function isEnglishQuery(value: string, sourceName: string): Promise<boolean>;
export type CompoundSplitLocale = 'en' | 'ro' | 'hu' | 'et' | 'unknown';
export declare function usesVocabularyCompoundSplit(locale: CompoundSplitLocale): boolean;
export declare function splitVocabularyCompoundToken(token: string, locale: CompoundSplitLocale, sourceName: string): Promise<string[]>;
export declare function preloadVocabularyCompoundSplitArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact>;
export declare function splitVocabularyCompoundTokenWithArtifact(token: string, locale: CompoundSplitLocale, artifact: OccupationSignalVocabularyArtifact, options?: {
    bypassWholeWordShortCircuit?: boolean;
}): string[];
