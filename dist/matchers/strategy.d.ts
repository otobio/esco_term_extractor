/**
 * Shared query primitives + response reading for the term-matching strategies.
 *
 * `foldSurface` strips diacritics so ro/hu/et surfaces (şofer, întreţinere …)
 * match the diacritic-folded aliases in the index — it mirrors the index's
 * asciifolding normalizer, and is used both to build the exact `.keyword`
 * clauses and to detect a grounded (term-anchored) hit.
 */
import type { SurfaceQuery } from './types.js';
export declare const SPARSE_FIELD = "sparse_embedding";
export declare const EXACT_BOOST = 100;
export declare const DISPLAY_NAME_BOOST = 70;
export declare const ALIAS_BOOST = 70;
export declare const PHRASE_BOOST = 18;
export declare const FUZZY_BOOST = 8;
export declare const SOURCE_FIELDS: string[];
/** Lowercase + strip diacritics (â→a, ș→s, ő→o …) to match the folded index. */
export declare function foldSurface(s: string): string;
/**
 * Exact keyword-match should-clauses — grounded, high boosts. The folded surface
 * is expanded into its number variants (plural ↔ singular) and matched with a
 * `terms` query, so a plural surface still fires the exact boost against a
 * singular alias (and vice-versa). Safe: variants that aren't aliases match
 * nothing.
 */
export declare function exactClauses(term: string, locale?: string): Record<string, unknown>[];
/**
 * Phrase + fuzzy should-clauses — softer lexical recall (analyzed fields fold at
 * search time). Phrase clauses stay cross-locale (the surface is often English,
 * which must still resolve). Edit-distance fuzzy, however, bridges look-alikes
 * ACROSS languages (ro "sef" ~ en "chef", "séf" hu) — only ever a false positive —
 * so when a `locale` is given it is gated to that locale via a NON-SCORING filter
 * (no added boost; fuzzy stays exactly as tricky as before, just same-locale).
 */
/** Phrase should-clauses — tight recall on the analyzed fields (case/diacritic
 *  folding at search time), WITHOUT edit-distance. Safe for finite categories. */
export declare function phraseClauses(term: string): Record<string, unknown>[];
export declare function fuzzyClauses(term: string, locale?: string): Record<string, unknown>[];
export interface ScoredHit {
    key: string;
    score: number;
    /** True when the folded surface exactly equals the hit's value/display_name/alias — grounded. */
    termAnchored: boolean;
    collarKind?: string;
}
/** Up to `count` distinct-canonical-key hits, ordered by score desc. */
export declare function topHits(response: unknown, item: SurfaceQuery, count: number): ScoredHit[];
