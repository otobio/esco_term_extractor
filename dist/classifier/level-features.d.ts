/**
 * Feature extraction for the logistic-regression seniority-level classifier.
 *
 * Level is a CLOSED, ordinal 8-band bucket — a classification problem, not a
 * retrieval one — so it is served by a tiny linear model over sparse text features
 * instead of a dense embedding. No model download, deterministic, CPU-instant.
 *
 * Features (all interpretable strings — an EXPLICIT vocabulary is kept at train
 * time rather than the hashing trick, so every weight maps back to a readable
 * feature; for an 8-band bucket auditability beats the hashing memory saving):
 *   - word unigrams              → the seniority head words ("senior", "sef", ...)
 *   - word bigrams               → the COMPOSITIONAL signal ("sef de", "de tura",
 *                                   "sef departament") that is the whole failure mode
 *   - char 3–5 grams (^word$)    → morphology / typos / cross-lingual robustness
 *                                   ("Sift"~"Shift", RO/HU/ET spelling variants)
 *
 * Matching runs on the shared loose normalization (fold diacritics, lowercase,
 * keep digits) so "tură" and "tura" collide, exactly like the regex layer.
 */
/**
 * The (repeatable) feature strings for a title. Shared by training and inference,
 * so the two can never drift. Repetition is intentional — the vectorizer counts.
 */
export declare function levelFeatures(title: string): string[];
/**
 * Sparse, L2-normalized feature vector keyed by vocabulary index. Unknown features
 * (absent from `vocab`) are dropped — a linear model simply has no weight for them.
 * Binary presence (not raw count) is used: for short titles a repeated char-gram
 * shouldn't dominate. L2 norm makes a long title comparable to a short one.
 */
export declare function vectorize(title: string, vocab: ReadonlyMap<string, number>): Map<number, number>;
