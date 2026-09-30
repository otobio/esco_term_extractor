import { foldWeakPunctuationLookupText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { ESCO_API_LOCALES, FUNCTION_WORDS } from './config.js';
const SPAN_SEPARATOR = /\s*[\r\n\t;•·▪‣◦|]\s*|\s+\/\s*|\s*\/\s+/u;
const LABEL_VARIANT_SEPARATOR = /\s*\/\s*/u;
const ESCO_API_LOCALE_SET = new Set(ESCO_API_LOCALES);
export function requireEscoApiLocale(locale) {
    const normalized = locale.trim().toLowerCase();
    if (!ESCO_API_LOCALE_SET.has(normalized)) {
        throw new Error(`Unsupported ESCO API locale "${locale}". Supported: ${ESCO_API_LOCALES.join(', ')}.`);
    }
    return normalized;
}
export function splitTitleSpans(title) {
    return title
        .split(SPAN_SEPARATOR)
        .map((span) => normalizeSearchSurfaceText(span))
        .filter((span) => tokenizeNormalizedText(foldWeakPunctuationLookupText(span)).length > 0);
}
export function prepareSpan(text, language) {
    const folded = foldWeakPunctuationLookupText(text);
    return { text, folded, tokens: comparisonTokens(folded, language) };
}
export function labelVariants(label) {
    return label.split(LABEL_VARIANT_SEPARATOR).map((variant) => variant.trim()).filter(Boolean);
}
export function comparisonTokens(folded, language) {
    const functionWords = FUNCTION_WORDS[language];
    const tokens = tokenizeNormalizedText(folded).filter((token) => !functionWords?.has(token));
    return language === 'en' ? tokens.map(foldEnglishPlural) : tokens;
}
// ponytail: naive English plural strip; swap for a locale stemmer if RO/HU inflection misses show up in evaluation.
function foldEnglishPlural(token) {
    return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}
