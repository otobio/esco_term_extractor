/**
 * Self-contained term matching for the open semantic buckets, backed by the
 * `canonical_runtime_terms` OpenSearch index.
 *
 * A strategy turns one surface phrase into an OpenSearch query body and
 * classifies the response into a resolution. Strategies are pluggable so
 * matching approaches (lexical, additive-hybrid, …) can be compared per bucket.
 * The OpenSearch client is injected, so the strategies stay pure and unit-
 * testable and the library carries no hard runtime dependency.
 *
 * This module is standalone — it defines its own types and does not import from
 * any consuming service.
 */
export type SurfaceQuery = {
    bucket: string;
    surface: string;
    locale?: string;
};
export type TermResolution = {
    status: 'resolved';
    key: string;
    score: number;
} | {
    status: 'ambiguous';
    candidates: string[];
} | {
    status: 'unresolved';
};
/** Minimal OpenSearch surface the matcher needs. */
export interface OpenSearchClient {
    /** Run N query bodies in one _msearch against the canonical index; returns per-query responses in order. */
    msearch(queries: Record<string, unknown>[]): Promise<unknown[]>;
    /** Deployed neural-sparse query-tokenizer model id, or null when neural is unavailable. */
    queryModelId(): Promise<string | null>;
}
export type QueryFilters = (bucket: string, locale?: string) => Record<string, unknown>[];
export interface MatchContext {
    queryModelId: string | null;
    buildFilters: QueryFilters;
}
export interface TermMatchStrategy {
    readonly name: string;
    buildQuery(item: SurfaceQuery, ctx: MatchContext): Record<string, unknown>;
    select(response: unknown, item: SurfaceQuery): TermResolution;
}
