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
export declare function commonRolePhraseEntries(locale: SupportedQueryLocale): CommonRolePhraseEntry[];
export declare function findCommonRolePhraseMatch(value: string, locale: SupportedQueryLocale): CommonRolePhraseMatch | null;
