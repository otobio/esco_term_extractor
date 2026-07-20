import type { DictionaryTerm } from './types.js';
export declare function serializeTerm(term: DictionaryTerm): string;
/**
 * Reject dictionary terms that would only produce garbage matches: empty /
 * single-character display names, or display names that are actually a URL or an
 * external code (e.g. a raw `http://data.europa.eu/ux2/nace2.1/...` value that
 * leaked into the display field). Applied at index-build time so both the vector
 * store and the lexical index exclude them.
 */
export declare function isUsableTerm(term: DictionaryTerm): boolean;
/** Load a JSONL dictionary snapshot into memory. */
export declare function loadDictionary(path: string): Promise<DictionaryTerm[]>;
