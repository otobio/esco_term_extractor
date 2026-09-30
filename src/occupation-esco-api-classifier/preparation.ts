import { foldWeakPunctuationLookupText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { ESCO_API_LOCALES, FUNCTION_WORDS } from './config.js';
import type { EscoApiLocale, PreparedSpan } from './types.js';

const SPAN_SEPARATOR = /\s*[\r\n\t;•·▪‣◦|]\s*|\s+\/\s*|\s*\/\s+/u;
const LABEL_VARIANT_SEPARATOR = /\s*\/\s*/u;
const ESCO_API_LOCALE_SET = new Set<string>(ESCO_API_LOCALES);

export function requireEscoApiLocale(locale: string): EscoApiLocale {
  const normalized = locale.trim().toLowerCase();

  if (!ESCO_API_LOCALE_SET.has(normalized)) {
    throw new Error(`Unsupported ESCO API locale "${locale}". Supported: ${ESCO_API_LOCALES.join(', ')}.`);
  }

  return normalized as EscoApiLocale;
}

export function splitTitleSpans(title: string): string[] {
  return title
    .split(SPAN_SEPARATOR)
    .map((span) => normalizeSearchSurfaceText(span))
    .filter((span) => tokenizeNormalizedText(foldWeakPunctuationLookupText(span)).length > 0);
}

export function prepareSpan(text: string, language: EscoApiLocale): PreparedSpan {
  const folded = foldWeakPunctuationLookupText(text);

  return { text, folded, tokens: comparisonTokens(folded, language) };
}

export function labelVariants(label: string): string[] {
  return label.split(LABEL_VARIANT_SEPARATOR).map((variant) => variant.trim()).filter(Boolean);
}

export function comparisonTokens(folded: string, language: EscoApiLocale): string[] {
  const functionWords = FUNCTION_WORDS[language];
  const tokens = tokenizeNormalizedText(folded).filter((token) => !functionWords?.has(token));

  return language === 'en' ? tokens.map(foldEnglishPlural) : tokens;
}

// ponytail: naive English plural strip; swap for a locale stemmer if RO/HU inflection misses show up in evaluation.
function foldEnglishPlural(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}
