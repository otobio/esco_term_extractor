/**
 * Text normalization shared by the lexical index (build + query time).
 *
 * Lowercase, strip diacritics (so Romanian/Hungarian/Estonian aliases match
 * regardless of accents), replace punctuation with spaces, and collapse runs of
 * whitespace. Kept deliberately conservative so that the *same* function used at
 * build time and query time produces identical keys.
 */
export declare function normalizeText(input: string): string;
/** Split a normalized string into word tokens. */
export declare function words(normalized: string): string[];
