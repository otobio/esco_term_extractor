/**
 * Clause tokenizer owned by the package (mirrors the host app's) so the package can
 * go raw text → clauses → locations standalone (used by the resolve-location CLI).
 * The resolver itself takes pre-split clauses; the host tokenizes in production.
 *
 * Splits on line breaks, common punctuation/bullets/slashes, and the "and"/"or"
 * conjunctions across en/ro/hu/et (whole words only).
 */
import type { Clause } from './types.js';
/** Split a block of text into trimmed, non-empty clauses. */
export declare function splitClauses(text: string, source: string): Clause[];
