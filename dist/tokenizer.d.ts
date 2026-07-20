/**
 * Clause tokenizer.
 *
 * Mirrors the reference esco-skill-extractor which splits text on line breaks
 * and the delimiters `. , ; and or`, then embeds each resulting clause. We extend
 * the delimiter set with the "and/or" conjunctions of the dictionary languages
 * (ro/hu/et) plus common bullet / slash separators found in job posts.
 */
export interface Clause {
    text: string;
    source: string;
}
/** Split a block of text into trimmed, non-empty clauses. */
export declare function splitClauses(text: string, source: string): Clause[];
