export const ESCO_API_BASE_URL = 'https://ec.europa.eu/esco/api';
export const ESCO_API_VERSION = 'v1.2.1';
export const ESCO_VOCABULARY_SOURCE_NAME = 'esco_1_2_1';
export const ESCO_API_TIMEOUT_MS = 8_000;
export const ESCO_API_RETRIES = 1;
export const ESCO_API_RETRY_BACKOFF_MS = 250;
export const ESCO_API_RESPONSE_CACHE_SIZE = 2_000;
export const ESCO_API_FAMILY_CACHE_SIZE = 2_000;
export const ESCO_API_PAGE_LIMIT = 50;
export const ESCO_API_LOCALES = [
    'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr', 'hu', 'is',
    'it', 'lt', 'lv', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv', 'uk'
];
export const ESCO_OCCUPATION_URI_PREFIX = 'http://data.europa.eu/esco/occupation/';
export const ESCO_ISCO_URI_PREFIX = 'http://data.europa.eu/esco/isco/C';
export const ESCO_FAMILY_ISCO_DIGITS = 3;
export const SKOS_XL_LABEL_TYPES = {
    'http://www.w3.org/2008/05/skos-xl#prefLabel': 'preferred',
    'http://www.w3.org/2008/05/skos-xl#altLabel': 'alternative',
    'http://www.w3.org/2008/05/skos-xl#hiddenLabel': 'hidden'
};
export const FUNCTION_WORDS = {
    en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']),
    ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'un']),
    hu: new Set(['a', 'az', 'egy', 'es', 'hogy', 'meg', 'vagy'])
};
export const MAX_ALT_LEAVES = 5;
export const MAX_ALT_FAMILIES = 3;
export const CONFIDENCE = {
    exactPreferredLabelLeaf: 0.95,
    exactAlternativeLabelLeaf: 0.9,
    exactHiddenLabelLeaf: 0.8,
    exactFamilyLabel: 0.9,
    familyVoteCeiling: 0.8
};
