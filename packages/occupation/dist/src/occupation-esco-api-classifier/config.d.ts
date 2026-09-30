export declare const ESCO_API_BASE_URL = "https://ec.europa.eu/esco/api";
export declare const ESCO_API_VERSION = "v1.2.1";
export declare const ESCO_VOCABULARY_SOURCE_NAME = "esco_1_2_1";
export declare const ESCO_API_TIMEOUT_MS = 8000;
export declare const ESCO_API_RETRIES = 1;
export declare const ESCO_API_RETRY_BACKOFF_MS = 250;
export declare const ESCO_API_RESPONSE_CACHE_SIZE = 2000;
export declare const ESCO_API_FAMILY_CACHE_SIZE = 2000;
export declare const ESCO_API_PAGE_LIMIT = 50;
export declare const ESCO_API_LOCALES: readonly ["ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "is", "it", "lt", "lv", "mt", "nl", "no", "pl", "pt", "ro", "sk", "sl", "sv", "uk"];
export declare const ESCO_OCCUPATION_URI_PREFIX = "http://data.europa.eu/esco/occupation/";
export declare const ESCO_ISCO_URI_PREFIX = "http://data.europa.eu/esco/isco/C";
export declare const ESCO_FAMILY_ISCO_DIGITS = 3;
export declare const SKOS_XL_LABEL_TYPES: {
    readonly 'http://www.w3.org/2008/05/skos-xl#prefLabel': "preferred";
    readonly 'http://www.w3.org/2008/05/skos-xl#altLabel': "alternative";
    readonly 'http://www.w3.org/2008/05/skos-xl#hiddenLabel': "hidden";
};
export declare const FUNCTION_WORDS: Partial<Record<(typeof ESCO_API_LOCALES)[number], ReadonlySet<string>>>;
export declare const MAX_ALT_LEAVES = 5;
export declare const MAX_ALT_FAMILIES = 3;
export declare const CONFIDENCE: {
    readonly exactPreferredLabelLeaf: 0.95;
    readonly exactAlternativeLabelLeaf: 0.9;
    readonly exactHiddenLabelLeaf: 0.8;
    readonly exactFamilyLabel: 0.9;
    readonly familyVoteCeiling: 0.8;
};
