import {
  preparedQueryFoldedRecallSurfaces,
  preparedQueryFoldedRecallTokenSequences,
  preparedQueryUsefulFoldedRecallTokenSequences,
  type PreparedQuery
} from '../query/query-preparation.js';

export type PreparedPhraseWindow = {
  query: string;
  tokenCount: number;
};

export type AuthorityQueryPreparation = {
  queryTokens: string[];
  preparedQueries: string[];
  preparedPhraseWindows: PreparedPhraseWindow[];
  rawQueries: string[];
};

export function buildAuthorityQueryPreparation(rawQuery: string, preparedQuery: PreparedQuery): AuthorityQueryPreparation {
  const foldedRecallTokenSequences = preparedQueryFoldedRecallTokenSequences(preparedQuery);
  const usefulFoldedRecallTokenSequences = preparedQueryUsefulFoldedRecallTokenSequences(preparedQuery);

  return {
    queryTokens: uniqueTokens(foldedRecallTokenSequences),
    preparedQueries: uniqueJoinedQueries(usefulFoldedRecallTokenSequences),
    preparedPhraseWindows: buildPreparedPhraseWindows(usefulFoldedRecallTokenSequences),
    rawQueries: Array.from(
      new Set([rawQuery.trim(), preparedQuery.normalized, ...preparedQueryFoldedRecallSurfaces(preparedQuery)].filter(Boolean))
    )
  };
}

export function buildPreparedPhraseWindows(foldedRecallTokenSequences: string[][]): PreparedPhraseWindow[] {
  const windows: PreparedPhraseWindow[] = [];
  const seen = new Set<string>();

  for (const tokens of foldedRecallTokenSequences) {
    appendPreparedPhraseWindows(windows, seen, tokens);
  }

  return windows;
}

function appendPreparedPhraseWindows(windows: PreparedPhraseWindow[], seen: Set<string>, tokens: string[]): void {
  const minimumWindowSize = tokens.length > 1 ? 2 : 1;

  for (let windowSize = tokens.length; windowSize >= minimumWindowSize; windowSize -= 1) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      const query = tokens
        .slice(start, start + windowSize)
        .join(' ')
        .trim();

      if (!query || seen.has(query)) {
        continue;
      }

      seen.add(query);
      windows.push({ query, tokenCount: windowSize });
    }
  }
}

function uniqueTokens(tokenSequences: string[][]): string[] {
  return Array.from(new Set(tokenSequences.flat()));
}

function uniqueJoinedQueries(tokenSequences: string[][]): string[] {
  return Array.from(new Set(tokenSequences.map((tokens) => tokens.join(' ').trim()).filter(Boolean)));
}
