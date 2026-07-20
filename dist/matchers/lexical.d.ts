/**
 * Baseline lexical matcher — exact / phrase / fuzzy only, no neural.
 *
 * Parity baseline to compare against additive-hybrid, and the default for any
 * bucket that should never use semantic matching. A single flat floor (no
 * asymmetry needed without a neural path).
 */
import type { TermMatchStrategy } from './types.js';
export declare const lexicalStrategy: TermMatchStrategy;
/**
 * Finite-safe lexical strategy — EXACT keyword + PHRASE only, NO edit-distance fuzzy.
 *
 * Finite buckets are discrete categories where a near-miss maps to the WRONG slug
 * (driving licence B↔C, part↔full, day↔night shift). Edit-distance fuzzy there is
 * "only ever a false positive" (see `fuzzyClauses`) and, at FUZZY_BOOST=8 > floor=5,
 * a fuzzy-only hit would still resolve. Recall for these buckets is instead carried
 * by the precise regex-inference layer (unioned in `aliasLookup`), so the OS side
 * stays strictly accurate: only true alias/phrase hits count.
 */
export declare const finiteLexicalStrategy: TermMatchStrategy;
