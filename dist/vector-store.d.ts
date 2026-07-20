import type { BucketName, DictionaryTerm, SupportedLanguage } from './types.js';
export interface StoredTerm {
    canonicalKey: string;
    bucket: BucketName;
    displayName: string;
    termType: string;
    languageCode: SupportedLanguage;
}
/** Bump when the on-disk layout changes in a backward-incompatible way. */
export declare const INDEX_SCHEMA_VERSION = 2;
/**
 * Hubness centering coefficient applied at query time. Some embedding vectors
 * (short/brand-like display names, on multilingual models especially) sit near
 * the global centroid and score high against *everything* ("hubs"). We subtract
 * `HUBNESS_CENTERING × bias[i]` — where bias[i] is a term's similarity to the
 * centroid — so hubs are demoted while specific terms are untouched. 0 disables.
 */
export declare const HUBNESS_CENTERING = 0.7;
export interface BestMatch {
    index: number;
    score: number;
}
export declare class VectorStore {
    readonly model: string;
    readonly dim: number;
    private readonly terms;
    private readonly vectors;
    private readonly ranges;
    private readonly centering;
    /** canonicalKey -> vector indices (one per indexed language / alias vector). */
    private readonly byKey;
    private readonly bias;
    private constructor();
    static load(dir: string): Promise<VectorStore>;
    get size(): number;
    buckets(): BucketName[];
    term(index: number): StoredTerm;
    /** First stored term for a canonical key (for enriching inferred/structured hits). */
    termByKey(canonicalKey: string): StoredTerm | undefined;
    /**
     * Find the single best-matching term for `query` within `bucket`, restricted to
     * `languages` (all languages of the bucket when omitted). Returns null if the
     * bucket/languages have no vectors.
     */
    searchBest(query: Float32Array, bucket: BucketName, languages?: SupportedLanguage[]): BestMatch | null;
    /**
     * Top-`k` matching terms for `query` within `bucket`, de-duplicated by canonical
     * key (a term indexed in several languages contributes once, at its best score),
     * sorted by descending score. Used by structured single-bucket resolution.
     */
    searchTopK(query: Float32Array, bucket: BucketName, k: number, languages?: SupportedLanguage[]): BestMatch[];
    private dot;
    /**
     * Cosine similarity between `query` and a specific canonical term's own
     * embedding (best over its language/alias vectors, optionally preferring
     * `language`). Returns null when the term has no vector in the index.
     */
    similarityTo(query: Float32Array, canonicalKey: string, language?: SupportedLanguage): number | null;
    /** Per-term similarity to the L2-normalized global centroid (the hubness bias). */
    static computeBias(dim: number, vectors: Float32Array, count: number): Float32Array;
    /** Build the contiguous, (bucket,language)-grouped arrays from raw entries. */
    private static buildArrays;
    /**
     * Build an in-memory store (no disk I/O) — used by tests and embedded callers.
     * Centering defaults to 0 here so in-memory/test scores are raw dot products;
     * pass a coefficient to enable hubness centering.
     */
    static fromEntries(model: string, dim: number, entries: {
        term: DictionaryTerm;
        vector: Float32Array;
    }[], centering?: number): VectorStore;
    /** Persist a freshly built index to `dir`. */
    static save(dir: string, model: string, dim: number, entries: {
        term: DictionaryTerm;
        vector: Float32Array;
    }[]): Promise<void>;
}
