import type { OccupationIntentVocabularyLocale } from './query-intent.js';
export type OccupationSurfaceLocaleProfile = Pick<OccupationIntentVocabularyLocale, 'roleHeadTerms' | 'roleModifierTerms' | 'domainModifierTerms' | 'credentialModifierTerms' | 'ambiguousModifierTerms'>;
export declare function isHighConfidenceEnglishSurfaceQueryFromProfiles(foldedTokens: readonly string[], englishProfile: OccupationSurfaceLocaleProfile, activeLocaleProfile: OccupationSurfaceLocaleProfile | null, intentConfidence: number): boolean;
export declare function isLikelyEnglishSurfaceQueryFromProfiles(foldedTokens: readonly string[], englishProfile: OccupationSurfaceLocaleProfile, activeLocaleProfile: OccupationSurfaceLocaleProfile | null, intentConfidence: number): boolean;
