import type { SupportedQueryLocale } from './query-preparation.js';
export declare function expandLocaleTokenVariants(token: string, locale: SupportedQueryLocale): string[];
export declare function expandLocaleTokenVariantArray(tokens: string[], locale: SupportedQueryLocale): string[];
export declare function tokenMatchesLocaleVariant(token: string, values: Set<string>, locale: SupportedQueryLocale): boolean;
