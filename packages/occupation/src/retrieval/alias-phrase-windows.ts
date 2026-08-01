import { foldSearchText, type PreparedQuery } from '../query/query-preparation.js';

const MAX_PHRASE_WINDOW_COUNT = 32;
const MIN_SINGLE_TOKEN_PHRASE_LENGTH = 6;

/**
 * Primary alias phrase windows for a query: sliding multi-word windows (full width down to 2 tokens)
 * for multi-token queries, or a single length-gated window for single-token queries.
 *
 * Shared by the binary-cache and OpenSearch alias retrievers so the two engines search the same windows.
 */
export function buildAliasPhraseWindows(preparedQuery: PreparedQuery): string[] {
  const windows: string[] = [];
  const seen = new Set<string>();

  for (const tokens of [preparedQuery.usefulFoldedTokens, preparedQuery.usefulTokens]) {
    appendPhraseWindowsForTokens(windows, seen, tokens);
  }

  return windows.slice(0, MAX_PHRASE_WINDOW_COUNT);
}

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
export function buildAliasHeadTokenFallbackWindows(preparedQuery: PreparedQuery): string[] {
  const headTokens = new Set(preparedQuery.intent.roleHeadTokens.map((token) => token.toLowerCase()));

  if (headTokens.size === 0) {
    return [];
  }

  const foldedHeadTokens = new Set(preparedQuery.intent.roleHeadTokens.map((token) => foldSearchText(token)));
  const windows: string[] = [];
  const seen = new Set<string>();

  appendSingleTokenWindows(
    windows,
    seen,
    preparedQuery.usefulFoldedTokens.filter((token) => foldedHeadTokens.has(token))
  );
  appendSingleTokenWindows(
    windows,
    seen,
    preparedQuery.usefulTokens.filter((token) => headTokens.has(token.toLowerCase()))
  );

  return windows.slice(0, MAX_PHRASE_WINDOW_COUNT);
}

function appendPhraseWindowsForTokens(windows: string[], seen: Set<string>, tokens: string[]): void {
  if (tokens.length === 1) {
    appendSingleTokenWindows(windows, seen, tokens);
    return;
  }

  for (let windowSize = tokens.length; windowSize >= 2; windowSize -= 1) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      const window = tokens.slice(start, start + windowSize).join(' ').trim();

      if (window && !seen.has(window)) {
        seen.add(window);
        windows.push(window);
      }
    }
  }
}

function appendSingleTokenWindows(windows: string[], seen: Set<string>, tokens: string[]): void {
  for (const rawToken of tokens) {
    const token = rawToken?.trim();

    if (token && token.length >= MIN_SINGLE_TOKEN_PHRASE_LENGTH && !seen.has(token)) {
      seen.add(token);
      windows.push(token);
    }
  }
}
