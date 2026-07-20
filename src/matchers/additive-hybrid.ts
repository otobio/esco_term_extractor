/**
 * Additive-hybrid term matcher for occupation + capabilities.
 *
 * Neither signal gates the other: the neural-sparse clause and the lexical
 * clauses (exact / phrase / fuzzy) all sit in `should`, so a strong lexical or
 * alias hit resolves on its own — even when neural is silent (e.g. Romanian,
 * whose docs carry no sparse vector) — while neural still surfaces English
 * paraphrase the lexicon can't. `minimum_should_match: 1` stops it returning the
 * whole bucket. Unlike a `must: neural_sparse`, the neural clause can never veto.
 *
 * Selection is ASYMMETRIC by confidence: an EXACT (term-anchored) hit is
 * grounded and accepted at a low floor; a hit that matched only via
 * phrase/fuzzy/neural is riskier and must clear a higher, per-bucket floor.
 */

import { exactClauses, fuzzyClauses, type ScoredHit, SOURCE_FIELDS, SPARSE_FIELD, topHits } from './strategy.js';
import type { MatchContext, SurfaceQuery, TermMatchStrategy, TermResolution } from './types.js';

interface BucketFloors {
  /** Sanity floor for grounded exact hits (they always score high). */
  term: number;
  /** Noise floor a phrase/fuzzy/neural-only hit must clear to count. */
  neural: number;
}

const FLOORS: Record<string, BucketFloors> = {
  occupation: { term: 1, neural: 5.5 },
  capabilities: { term: 1, neural: 4.8 },
};
const DEFAULT_FLOORS: BucketFloors = { term: 1, neural: 5.5 };

/**
 * TEMPORARY (2026-07): restrict neural-sparse to English (or unset) queries only.
 *
 * Sparse vectors are English-centric (the query encoder is English), so on a
 * ro/hu/et query neural mostly bridges cross-lingually to English docs. Re-enabled
 * on every query (`false`): it helps English-primary locales (e.g. `ng` — English
 * titles under a country-code locale) and never vetoes (it sits in `should`). Flip
 * to `true` to restrict neural to English/unset queries again.
 */
const NEURAL_ENGLISH_ONLY = false;

/** A second candidate this close to the top (relative) is too near to call. */
const AMBIGUITY_MARGIN_RATIO = 0.15;

const floorFor = (bucket: string): BucketFloors => FLOORS[bucket] ?? DEFAULT_FLOORS;
const accepts = (hit: ScoredHit, floors: BucketFloors): boolean =>
  hit.score >= (hit.termAnchored ? floors.term : floors.neural);

export const additiveHybridStrategy: TermMatchStrategy = {
  name: 'additive-hybrid',

  buildQuery(item: SurfaceQuery, ctx: MatchContext): Record<string, unknown> {
    const should: Record<string, unknown>[] = [
      ...exactClauses(item.surface, item.locale),
      ...fuzzyClauses(item.surface, item.locale),
    ];
    // See NEURAL_ENGLISH_ONLY — neural is skipped for non-English queries while the
    // temporary gate is on (their docs have no sparse vector anyway).
    const englishQuery = !item.locale || item.locale === 'en';
    if (ctx.queryModelId && (!NEURAL_ENGLISH_ONLY || englishQuery)) {
      should.push({ neural_sparse: { [SPARSE_FIELD]: { query_text: item.surface, model_id: ctx.queryModelId } } });
    }
    return {
      query: { bool: { filter: ctx.buildFilters(item.bucket, item.locale), should, minimum_should_match: 1 } },
      size: 2,
      _source: SOURCE_FIELDS,
    };
  },

  select(response: unknown, item: SurfaceQuery): TermResolution {
    const floors = floorFor(item.bucket);
    const [first, second] = topHits(response, item, 2);
    if (!first || !accepts(first, floors)) return { status: 'unresolved' };
    if (second && accepts(second, floors)) {
      const closeInScore = (first.score - second.score) / first.score <= AMBIGUITY_MARGIN_RATIO;
      const collarConflict = !!first.collarKind && !!second.collarKind && first.collarKind !== second.collarKind;
      if (closeInScore || collarConflict) {
        return { status: 'ambiguous', candidates: [first.key, second.key] };
      }
    }
    return { status: 'resolved', key: first.key, score: first.score };
  },
};
