/**
 * Text normalization for the gazetteer (build + query time). Owned by the package so
 * the match contract is self-contained. Mirrors the host app's normalize so surfaces
 * built here match text tokenized there.
 *
 * Lowercase, strip diacritics (so Romanian/Hungarian/Estonian names match regardless
 * of accents), replace punctuation with spaces, collapse whitespace. Deliberately
 * conservative: the *same* function at build and query time produces identical keys.
 */
export declare function normalizeText(input: string): string;
/** Split a normalized string into word tokens. */
export declare function words(normalized: string): string[];
