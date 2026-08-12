/**
 * Heuristic check for whether a single word could plausibly be an English verb.
 * There is no dictionary/POS dependency in this repo, so this rejects obvious
 * non-verbs (stopwords, noun/adjective suffixes, non-alphabetic tokens) rather
 * than validating against a full lexicon.
 */
export declare function isLikelyEnglishVerb(word: string): boolean;
/**
 * Reduces an inflected English verb form to its root/base form
 * (analysing -> analyse, applies -> apply, stopped -> stop). Heuristic only —
 * there's no dictionary/lemmatizer in this repo — so ambiguous cases
 * (e.g. words that keep a final consonant without a silent e) may not
 * round-trip perfectly.
 */
export declare function toEnglishVerbRootForm(word: string): string;
export declare function americanToBritishOrthography(text: string): string;
