import type { CanonicalComparisonQuery, SupportedQueryLocale, TranslatedTitle, TranslationConceptDimension } from './types.js';
export declare function translateTitleForClassifier(title: string, locale: SupportedQueryLocale, queryRoleHeadTokens?: readonly string[]): Promise<CanonicalComparisonQuery>;
export declare function buildCanonicalComparisonQuery(translated: TranslatedTitle): CanonicalComparisonQuery;
export declare function modifierTokenUnitsForComparisonQuery(comparisonQuery: CanonicalComparisonQuery): readonly (readonly string[])[];
export declare function conceptUnitCoverageForComparisonQuery(comparisonQuery: CanonicalComparisonQuery, conceptsByDimension: ReadonlyMap<TranslationConceptDimension, readonly string[]>): number | null;
