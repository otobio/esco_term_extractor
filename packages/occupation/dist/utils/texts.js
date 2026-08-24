// Every fold below is a pure string -> string function, and the pipeline re-folds the same
// candidate labels, aliases and tokens millions of times per query. Memoize by input text and
// clear on overflow so a long-lived process cannot grow the caches without bound.
const FOLD_CACHE_LIMIT = 100_000;
const SURFACE_TEXT_CACHE = new Map();
const NORMALIZED_TEXT_CACHE = new Map();
const FOLDED_TEXT_CACHE = new Map();
const FOLDED_LOOKUP_TEXT_CACHE = new Map();
const FOLDED_WEAK_PUNCTUATION_CACHE = new Map();
const ACRONYM_TOKEN_CACHE = new Map();
function rememberFold(cache, value, folded) {
    if (cache.size >= FOLD_CACHE_LIMIT) {
        cache.clear();
    }
    cache.set(value, folded);
    return folded;
}
export function normalizeSearchSurfaceText(value) {
    const cached = SURFACE_TEXT_CACHE.get(value);
    if (cached !== undefined) {
        return cached;
    }
    return rememberFold(SURFACE_TEXT_CACHE, value, value.normalize('NFKC').trim().replace(/\s+/gu, ' '));
}
export function normalizeSearchText(value) {
    const cached = NORMALIZED_TEXT_CACHE.get(value);
    if (cached !== undefined) {
        return cached;
    }
    const normalized = normalizeSearchSurfaceText(value).replace(/[\p{L}\p{N}]+/gu, (token) => shouldPreserveAcronymToken(token) ? token : token.toLowerCase());
    return rememberFold(NORMALIZED_TEXT_CACHE, value, normalized);
}
export function foldSearchText(value) {
    const cached = FOLDED_TEXT_CACHE.get(value);
    if (cached !== undefined) {
        return cached;
    }
    return rememberFold(FOLDED_TEXT_CACHE, value, normalizeSearchText(value).normalize('NFKD').replace(/\p{M}/gu, ''));
}
export function foldSearchLookupText(value) {
    const cached = FOLDED_LOOKUP_TEXT_CACHE.get(value);
    if (cached !== undefined) {
        return cached;
    }
    const folded = normalizeSearchSurfaceText(value).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
    return rememberFold(FOLDED_LOOKUP_TEXT_CACHE, value, folded);
}
const WEAK_LOOKUP_PUNCTUATION = /[.,;:()[\]{}]+/gu;
export function foldWeakPunctuationLookupText(value) {
    const cached = FOLDED_WEAK_PUNCTUATION_CACHE.get(value);
    if (cached !== undefined) {
        return cached;
    }
    const folded = foldSearchLookupText(value).replace(WEAK_LOOKUP_PUNCTUATION, ' ').replace(/\s+/gu, ' ').trim();
    return rememberFold(FOLDED_WEAK_PUNCTUATION_CACHE, value, folded);
}
export function tokenizeNormalizedText(value) {
    return value
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}
export function tokenizeSurfaceText(value) {
    return tokenizeNormalizedText(value);
}
export function isAcronymToken(token) {
    const cached = ACRONYM_TOKEN_CACHE.get(token);
    if (cached !== undefined) {
        return cached;
    }
    const normalized = token.normalize('NFKC');
    const isAcronym = /^(?=.*\p{Lu})[\p{Lu}\p{N}]{2,5}$/u.test(normalized) && !COMMON_UPPERCASE_WORDS.has(normalized);
    if (ACRONYM_TOKEN_CACHE.size >= FOLD_CACHE_LIMIT) {
        ACRONYM_TOKEN_CACHE.clear();
    }
    ACRONYM_TOKEN_CACHE.set(token, isAcronym);
    return isAcronym;
}
const COMMON_UPPERCASE_WORDS = new Set(['FAST', 'FOOD']);
function shouldPreserveAcronymToken(token) {
    return isAcronymToken(token);
}
