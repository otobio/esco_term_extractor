import type { SupportedQueryLocale } from './query-preparation.js';
import type { OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';
/**
 * Vocabulary-driven (HU) or curated-list (ET) compound-word splitting, shared by every consumer that
 * needs to decompose a compound token into its constituent parts — query intent classification, phrase-atlas
 * rewrite, and retrieval evidence (alias-ngram / family-profile) alike.
 */
export declare function perTokenVocabularyCompoundSplits(tokens: string[], locale: SupportedQueryLocale, sourceName: string): Promise<string[][] | null>;
export declare function reconstructCompoundExpandedSurface(tokens: string[], perTokenSplits: string[][] | null): string | null;
export declare function splitCompoundTokens(tokens: string[], locale: SupportedQueryLocale, sourceName: string): Promise<string[]>;
export declare function splitCompoundTokensWithArtifact(tokens: string[], locale: SupportedQueryLocale, artifact: OccupationSignalVocabularyArtifact): string[];
export declare function expandLocaleTokenVariants(token: string, locale: SupportedQueryLocale): string[];
export declare function expandLocaleTokenVariantArray(tokens: string[], locale: SupportedQueryLocale): string[];
export declare function tokenMatchesLocaleVariant(token: string, values: ReadonlySet<string>, locale: SupportedQueryLocale): boolean;
