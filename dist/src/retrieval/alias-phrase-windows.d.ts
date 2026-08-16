import type { PreparedQuery } from '../query/query-preparation.js';
/**
 * Primary alias phrase windows for a query: sliding multi-word windows (full width down to 2 tokens)
 * for multi-token queries, or a single length-gated window for single-token queries.
 *
 * Shared by the binary-cache and OpenSearch alias retrievers so the two engines search the same windows.
 */
export declare function buildAliasPhraseWindows(preparedQuery: PreparedQuery): string[];
/**
 * Fallback windows for when the primary phrase-window search returns no alias hits.
 *
 * A multi-token query only ever searches its full-width phrase, so a modifier word that isn't already
 * adjacent to the head word in an existing alias (e.g. "security personnel") zeroes out alias evidence
 * entirely, even though the head word alone ("security") would have matched broadly. This falls back to
 * the query's role-head token(s) only, not every useful token: a query like "media personnel" has head
 * "media" (specific) and modifier "personnel" (a generic occupational wrapper that happens to be a
 * longer word) — falling back on every useful token let "personnel" alone pass the single-token length
 * gate and pull in unrelated HR/"personnel officer" evidence, drowning out the correct signal.
 */
export declare function buildAliasHeadTokenFallbackWindows(preparedQuery: PreparedQuery): string[];
