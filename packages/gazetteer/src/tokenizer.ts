/**
 * Clause tokenizer owned by the package (mirrors the host app's) so the package can
 * go raw text → clauses → locations standalone (used by the resolve-location CLI).
 * The resolver itself takes pre-split clauses; the host tokenizes in production.
 *
 * Splits on line breaks, common punctuation/bullets/slashes, and the "and"/"or"
 * conjunctions across en/ro/hu/et (whole words only).
 */
import type { Clause } from './types.ts';

const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦•|/]+|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;

/** Split a block of text into trimmed, non-empty clauses. */
export function splitClauses(text: string, source: string): Clause[] {
  if (!text) return [];
  const out: Clause[] = [];
  for (const raw of text.split(CLAUSE_SPLIT)) {
    const clause = raw.trim();
    if (clause.length < 2) continue;
    out.push({ text: clause.length > 160 ? clause.slice(0, 160) : clause, source });
  }
  return out;
}
