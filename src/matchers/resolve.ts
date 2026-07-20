/**
 * Batched surface → canonical-key resolution.
 *
 * One `_msearch` for every surface; each bucket routes to its strategy
 * (occupation/capabilities → additive-hybrid, everything else → lexical). Locale
 * expands to [locale, en, global] (en → [en, global]) so a query can fall back
 * to English/global terms. The neural query-tokenizer model is discovered once
 * per call and shared across surfaces.
 */

import { additiveHybridStrategy } from './additive-hybrid.js';
import { finiteLexicalStrategy, lexicalStrategy } from './lexical.js';
import type { OpenSearchClient, QueryFilters, SurfaceQuery, TermMatchStrategy, TermResolution } from './types.js';

const ADDITIVE_BUCKETS = new Set(['occupation', 'capabilities']);
// Discrete/controlled buckets: exact + phrase only (no edit-distance fuzzy), since a
// near-miss maps to the wrong category. Recall is carried by the inference layer.
const FINITE_BUCKETS = new Set([
  'level',
  'employment',
  'schedule',
  'workplace',
  'collar_kind',
  'company_size',
  'benefits',
  'company_type',
  'compensation',
  'qualifications',
]);
const GLOBAL_LOCALE = 'global';

/** The strategy for a bucket. */
export function strategyForBucket(bucket: string): TermMatchStrategy {
  if (ADDITIVE_BUCKETS.has(bucket)) return additiveHybridStrategy;
  if (FINITE_BUCKETS.has(bucket)) return finiteLexicalStrategy;
  return lexicalStrategy; // occupation/capabilities handled above; location is gazetteer-owned
}

/** Bucket + locale filter clauses (locale falls back to en + global). */
export const buildFilters: QueryFilters = (bucket, locale) => {
  const filters: Record<string, unknown>[] = [{ term: { bucket } }];
  if (locale) {
    const langs = locale === 'en' ? ['en', GLOBAL_LOCALE] : [locale, 'en', GLOBAL_LOCALE];
    filters.push({ terms: { language_code: [...new Set(langs)] } });
  }
  return filters;
};

/** Resolve all surfaces in a single batched `_msearch`. */
export async function resolveSurfaces(items: SurfaceQuery[], client: OpenSearchClient): Promise<TermResolution[]> {
  if (items.length === 0) return [];
  const ctx = { queryModelId: await client.queryModelId(), buildFilters };
  const strategies = items.map((item) => strategyForBucket(item.bucket));
  const responses = await client.msearch(items.map((item, i) => strategies[i].buildQuery(item, ctx)));
  return items.map((item, i) => strategies[i].select(responses[i], item));
}
