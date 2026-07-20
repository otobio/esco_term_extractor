/**
 * Shared query primitives + response reading for the term-matching strategies.
 *
 * `foldSurface` strips diacritics so ro/hu/et surfaces (şofer, întreţinere …)
 * match the diacritic-folded aliases in the index — it mirrors the index's
 * asciifolding normalizer, and is used both to build the exact `.keyword`
 * clauses and to detect a grounded (term-anchored) hit.
 */

import { numberVariants } from './morphology.js';
import type { SurfaceQuery } from './types.js';

export const SPARSE_FIELD = 'sparse_embedding';
export const EXACT_BOOST = 100; // value.keyword
export const DISPLAY_NAME_BOOST = 70;
export const ALIAS_BOOST = 70;
export const PHRASE_BOOST = 18;
export const FUZZY_BOOST = 8;

export const SOURCE_FIELDS = ['canonical_key', 'searchable', 'value', 'display_name', 'aliases'];

/** Lowercase + strip diacritics (â→a, ș→s, ő→o …) to match the folded index. */
export function foldSurface(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Exact keyword-match should-clauses — grounded, high boosts. The folded surface
 * is expanded into its number variants (plural ↔ singular) and matched with a
 * `terms` query, so a plural surface still fires the exact boost against a
 * singular alias (and vice-versa). Safe: variants that aren't aliases match
 * nothing.
 */
export function exactClauses(term: string, locale?: string): Record<string, unknown>[] {
  const variants = numberVariants(foldSurface(term), locale);
  return [
    { constant_score: { filter: { terms: { 'value.keyword': variants } }, boost: EXACT_BOOST } },
    { constant_score: { filter: { terms: { 'display_name.keyword': variants } }, boost: DISPLAY_NAME_BOOST } },
    { constant_score: { filter: { terms: { 'aliases.keyword': variants } }, boost: ALIAS_BOOST } },
  ];
}

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
export function phraseClauses(term: string): Record<string, unknown>[] {
  return [
    { match_phrase: { value: { query: term, boost: PHRASE_BOOST } } },
    { match_phrase: { display_name: { query: term, boost: PHRASE_BOOST } } },
    { match_phrase: { aliases: { query: term, boost: PHRASE_BOOST } } },
  ];
}

export function fuzzyClauses(term: string, locale?: string): Record<string, unknown>[] {
  const phrase = phraseClauses(term);
  const fuzzy = [
    {
      match: {
        value: { query: term, operator: 'or', minimum_should_match: '2<70%', fuzziness: 'AUTO', boost: FUZZY_BOOST },
      },
    },
    {
      match: {
        aliases: { query: term, operator: 'or', minimum_should_match: '2<70%', fuzziness: 'AUTO', boost: FUZZY_BOOST },
      },
    },
  ];
  const scopedFuzzy = locale
    ? fuzzy.map((f) => ({ bool: { must: [f], filter: [{ term: { language_code: locale } }] } }))
    : fuzzy;
  return [...phrase, ...scopedFuzzy];
}

export interface ScoredHit {
  key: string;
  score: number;
  /** True when the folded surface exactly equals the hit's value/display_name/alias — grounded. */
  termAnchored: boolean;
  collarKind?: string;
}

/** Up to `count` distinct-canonical-key hits, ordered by score desc. */
export function topHits(response: unknown, item: SurfaceQuery, count: number): ScoredHit[] {
  const surface = foldSurface(item.surface);
  const hits =
    (
      response as {
        hits?: {
          hits?: {
            _score: number;
            _source?: {
              canonical_key?: string;
              value?: string;
              display_name?: string;
              aliases?: string[];
              searchable?: { collar_kind?: string };
            };
          }[];
        };
      }
    )?.hits?.hits ?? [];
  const seen = new Set<string>();
  const out: ScoredHit[] = [];
  for (const hit of hits) {
    const src = hit._source ?? {};
    const key = src.canonical_key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const surfaces = [src.value, src.display_name, ...(src.aliases ?? [])]
      .filter((s): s is string => typeof s === 'string')
      .map(foldSurface);
    out.push({
      key,
      score: hit._score,
      termAnchored: surfaces.includes(surface),
      collarKind: src.searchable?.collar_kind,
    });
    if (out.length >= count) break;
  }
  return out;
}
