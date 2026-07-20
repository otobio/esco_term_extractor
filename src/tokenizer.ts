/**
 * Clause tokenizer.
 *
 * Mirrors the reference esco-skill-extractor which splits text on line breaks
 * and the delimiters `. , ; and or`, then embeds each resulting clause. We extend
 * the delimiter set with the "and/or" conjunctions of the dictionary languages
 * (ro/hu/et) plus common bullet / slash separators found in job posts.
 */

// Delimiters: newlines, tabs, common punctuation, bullets/slashes/pipes, and the
// "and"/"or" conjunctions across en/ro/hu/et. Conjunctions are matched only as
// whole words (surrounded by whitespace) to avoid slicing inside words.
const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦•|/]+|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;

export interface Clause {
  text: string;
  source: string;
}

/** Split a block of text into trimmed, non-empty clauses. */
export function splitClauses(text: string, source: string): Clause[] {
  if (!text) return [];
  const out: Clause[] = [];
  for (const raw of text.split(CLAUSE_SPLIT)) {
    const clause = raw.trim();
    // Drop empties and single-character fragments; cap length so a runaway
    // paragraph without delimiters does not dominate an embedding batch.
    if (clause.length < 2) continue;
    out.push({ text: clause.length > 160 ? clause.slice(0, 160) : clause, source });
  }
  return out;
}
