import type { SupportedQueryLocale } from './query-preparation.js';
export type FamilyAliasEntry = {
    locale: SupportedQueryLocale;
    surface: string;
    canonicalEnglish: string;
    roleKey: string;
    priority: number;
};
export type FamilyAliasMatch = FamilyAliasEntry & {
    startToken: number;
    endToken: number;
    approximate: boolean;
    surfaceTokens: string[];
    canonicalTokens: string[];
};
export declare function familyAliasEntries(locale: SupportedQueryLocale): FamilyAliasEntry[];
export declare function findFamilyAliasMatch(value: string, locale: SupportedQueryLocale): FamilyAliasMatch | null;
