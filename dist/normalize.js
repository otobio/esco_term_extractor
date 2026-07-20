/**
 * Text normalization shared by the lexical index (build + query time).
 *
 * Lowercase, strip diacritics (so Romanian/Hungarian/Estonian aliases match
 * regardless of accents), replace punctuation with spaces, and collapse runs of
 * whitespace. Kept deliberately conservative so that the *same* function used at
 * build time and query time produces identical keys.
 */
export function normalizeText(input) {
    return input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // combining diacritical marks
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Split a normalized string into word tokens. */
export function words(normalized) {
    return normalized ? normalized.split(' ') : [];
}
