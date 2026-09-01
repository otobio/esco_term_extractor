import type { CanonicalComparisonQuery, SupportedQueryLocale, TranslatedTitle } from './types.js';
export declare function translateTitleForClassifier(title: string, locale: SupportedQueryLocale, queryRoleHeadTokens?: readonly string[]): Promise<CanonicalComparisonQuery>;
export declare function buildCanonicalComparisonQuery(translated: TranslatedTitle): CanonicalComparisonQuery;
