/**
 * opensearchFetch — a drop-in `fetch` for OpenSearch (HTTP REST) that adds cluster
 * authentication. Generic and self-contained: it knows nothing about any consuming
 * app. Call sites use it exactly like `fetch`; auth strategies grow here without
 * touching them.
 *
 * Strategy is chosen from an explicit config (`configureOpenSearchAuth`) or, by
 * default, from the environment:
 *   - none  : transparent passthrough (local / unsecured cluster).
 *   - basic : HTTP Basic — OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD.
 */
export type OpenSearchAuth = {
    kind: 'none';
} | {
    kind: 'basic';
    username: string;
    password: string;
};
/** Explicitly set the auth strategy (overrides env auto-detection). `undefined`
 *  restores environment-based detection. */
export declare function configureOpenSearchAuth(auth: OpenSearchAuth | undefined): void;
/** Same signature and behavior as `fetch`, plus cluster authentication. */
export declare function opensearchFetch(input: string | URL, init?: RequestInit): Promise<Response>;
