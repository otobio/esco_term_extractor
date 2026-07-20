/**
 * Structured finite-facet aliases for source systems whose category values are
 * already deliberate bucket signals.
 *
 * Matching stays exact after deterministic variant generation: diacritic folding,
 * punctuation folding, optional count suffix stripping, and a small set of
 * approved locale synonyms. This gives recall for spelling/style variants without
 * introducing fuzzy finite-bucket guesses.
 */
import type { Clause } from '../tokenizer.js';
import type { BucketName, SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export type FacetBucket = Extract<BucketName, 'company_type' | 'employment' | 'level' | 'schedule' | 'workplace'>;
export declare function inferFacetTerms(bucket: FacetBucket, clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
export declare function isFacetBucket(bucket: BucketName): bucket is FacetBucket;
export declare function facetCollisionErrors(): string[];
export declare function normalizeFacetSurface(text: string): string;
