import type { SupportedQueryLocale } from './query-preparation.js';
export type CommonRolePhraseEntry = {
    locale: SupportedQueryLocale;
    surface: string;
    canonicalEnglish: string;
    roleKey: string;
    priority: number;
};
export type CommonRolePhraseMatch = CommonRolePhraseEntry & {
    startToken: number;
    endToken: number;
    approximate: boolean;
    surfaceTokens: string[];
    canonicalTokens: string[];
};
export type CommonRolePhraseLookupOptions = {
    disabledRoleKeys?: readonly string[];
};
export declare function commonRolePhraseEntries(locale: SupportedQueryLocale, options?: CommonRolePhraseLookupOptions): CommonRolePhraseEntry[];
export declare function disabledCommonRolePhraseSurfaces(locale: SupportedQueryLocale, disabledRoleKeys?: readonly string[]): string[];
export declare function findCommonRolePhraseMatch(value: string, locale: SupportedQueryLocale, options?: CommonRolePhraseLookupOptions): CommonRolePhraseMatch | null;
