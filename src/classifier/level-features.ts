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

import { normalizeLoose } from '../inference/shared.js';

/** Char n-gram sizes over `^word$`-padded tokens. 3–5 balances morphology signal
 *  against vocabulary blow-up. */
const CHAR_MIN = 3;
const CHAR_MAX = 5;

/** Boundary-anchored char n-grams (CHAR_MIN..CHAR_MAX) of one token: `sef` → `^se`,
 *  `sef`, `ef$`, `^sef`, … The `^`/`$` markers let a prefix/suffix be a distinct signal. */
function charGrams(token: string): string[] {
  const padded = `^${token}$`;
  const grams: string[] = [];
  for (let n = CHAR_MIN; n <= CHAR_MAX; n++) {
    for (let s = 0; s + n <= padded.length; s++) grams.push(`c:${padded.slice(s, s + n)}`);
  }
  return grams;
}

/**
 * The (repeatable) feature strings for a title. Shared by training and inference,
 * so the two can never drift. Repetition is intentional — the vectorizer counts.
 */
export function levelFeatures(title: string): string[] {
  const toks = normalizeLoose(title).split(' ').filter(Boolean);
  const feats: string[] = [];
  toks.forEach((t, i) => {
    feats.push(`w:${t}`); // unigram
    if (i > 0) feats.push(`w2:${toks[i - 1]}_${t}`); // bigram — carries head×scope
    feats.push(...charGrams(t));
  });
  return feats;
}

/**
 * Sparse, L2-normalized feature vector keyed by vocabulary index. Unknown features
 * (absent from `vocab`) are dropped — a linear model simply has no weight for them.
 * Binary presence (not raw count) is used: for short titles a repeated char-gram
 * shouldn't dominate. L2 norm makes a long title comparable to a short one.
 */
export function vectorize(title: string, vocab: ReadonlyMap<string, number>): Map<number, number> {
  const present = new Set<number>();
  for (const f of levelFeatures(title)) {
    const idx = vocab.get(f);
    if (idx !== undefined) present.add(idx);
  }
  const inv = present.size ? 1 / Math.sqrt(present.size) : 0;
  const vec = new Map<number, number>();
  for (const idx of present) vec.set(idx, inv);
  return vec;
}
