import type { SupportedQueryLocale } from '../query/query-preparation.js';
import type { FamilyStructureDimension } from './occupation-family-structure-rules.js';
export type FamilyStructureVocabularyDimension = FamilyStructureDimension | 'occupation_level';
export type FamilyStructureVocabularyEntry = {
    dimension: FamilyStructureVocabularyDimension;
    value: string;
    aliases: readonly string[];
    locales?: readonly SupportedQueryLocale[];
};
export type FamilyStructureVocabularyMatch = {
    dimension: FamilyStructureVocabularyDimension;
    value: string;
    matchedAlias: string;
};
export type FamilyStructureVocabularyLookupOptions = {
    readonly expandLocaleVariants?: boolean;
};
export declare const FAMILY_STRUCTURE_QUERY_VOCABULARY: readonly FamilyStructureVocabularyEntry[];
export declare function familyStructureVocabularyMatchesForToken(token: string, locale?: SupportedQueryLocale, options?: FamilyStructureVocabularyLookupOptions): readonly FamilyStructureVocabularyMatch[];
export declare function familyStructureVocabularyMatchesForTokens(tokens: readonly string[], locale?: SupportedQueryLocale, options?: FamilyStructureVocabularyLookupOptions): readonly FamilyStructureVocabularyMatch[];
export declare function familyStructureVocabularyValuesByDimension(tokens: readonly string[], locale?: SupportedQueryLocale, options?: FamilyStructureVocabularyLookupOptions): ReadonlyMap<FamilyStructureVocabularyDimension, readonly string[]>;
