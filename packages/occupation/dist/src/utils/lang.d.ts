export declare const FUNCTION_WORDS_BY_LOCALE: Record<'en' | 'ro' | 'hu' | 'et' | 'unknown', Set<string>>;
export declare function isEnglishWord(value: string, sourceName: string): Promise<boolean>;
export declare function isEnglishQuery(value: string, sourceName: string): Promise<boolean>;
