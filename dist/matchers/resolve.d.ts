/**
 * Batched surface → canonical-key resolution.
 *
 * One `_msearch` for every surface; each bucket routes to its strategy
 * (occupation/capabilities → additive-hybrid, everything else → lexical). Locale
 * expands to [locale, en, global] (en → [en, global]) so a query can fall back
 * to English/global terms. The neural query-tokenizer model is discovered once
 * per call and shared across surfaces.
 */
import type { OpenSearchClient, QueryFilters, SurfaceQuery, TermMatchStrategy, TermResolution } from './types.js';
/** The strategy for a bucket. */
export declare function strategyForBucket(bucket: string): TermMatchStrategy;
/** Bucket + locale filter clauses (locale falls back to en + global). */
export declare const buildFilters: QueryFilters;
/** Resolve all surfaces in a single batched `_msearch`. */
export declare function resolveSurfaces(items: SurfaceQuery[], client: OpenSearchClient): Promise<TermResolution[]>;
