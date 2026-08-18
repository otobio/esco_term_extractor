import { type OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';
export declare const FUNCTION_WORDS_BY_LOCALE: Record<'en' | 'ro' | 'hu' | 'et' | 'unknown', Set<string>>;
export declare function isEnglishWord(value: string, sourceName: string): Promise<boolean>;
export declare function isEnglishQuery(value: string, sourceName: string): Promise<boolean>;
export type CompoundSplitLocale = 'en' | 'ro' | 'hu' | 'et' | 'unknown';
export declare function usesVocabularyCompoundSplit(locale: CompoundSplitLocale): boolean;
export declare function splitVocabularyCompoundToken(token: string, locale: CompoundSplitLocale, sourceName: string): Promise<string[]>;
export declare function preloadVocabularyCompoundSplitArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact>;
export declare function splitVocabularyCompoundTokenWithArtifact(token: string, locale: CompoundSplitLocale, artifact: OccupationSignalVocabularyArtifact, options?: {
    bypassWholeWordShortCircuit?: boolean;
}): string[];
