import type { EscoApiLocale, PreparedSpan } from './types.js';
export declare function requireEscoApiLocale(locale: string): EscoApiLocale;
export declare function splitTitleSpans(title: string): string[];
export declare function prepareSpan(text: string, language: EscoApiLocale): PreparedSpan;
export declare function labelVariants(label: string): string[];
export declare function comparisonTokens(folded: string, language: EscoApiLocale): string[];
