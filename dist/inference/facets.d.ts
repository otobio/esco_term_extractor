/**
 * Structured finite-facet aliases for source systems whose category values are
 * already deliberate bucket signals.
 *
 * Matching stays exact after deterministic variant generation: diacritic folding,
 * punctuation folding, optional count suffix stripping, and a small set of
 * approved locale synonyms. This gives recall for spelling/style variants without
 * introducing fuzzy finite-bucket guesses.
 *
 * `buildLookup`'s registration is locale-scoped: only a same-locale prior entry
 * can shadow a new one. A different locale's registration sharing the same
 * normalized variant string (e.g. an 'en' row's synonym expansion landing on the
 * same string as an unrelated 'ro' row) must not block this locale's entry from
 * being added — `localeAllowed` is what disambiguates between them at lookup
 * time. `collectFacetCollisions` scopes its dedup key by locale for the same
 * reason: a cross-locale coincidence is not a real collision.
 */
import type { Clause } from '../tokenizer.js';
import type { BucketName, SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export type FacetBucket = Extract<BucketName, 'sector' | 'job_function' | 'employment' | 'level' | 'schedule' | 'workplace'>;
export declare function inferFacetTerms(bucket: FacetBucket, clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
export declare function isFacetBucket(bucket: BucketName): bucket is FacetBucket;
export declare function facetCollisionErrors(): string[];
export declare function normalizeFacetSurface(text: string): string;
