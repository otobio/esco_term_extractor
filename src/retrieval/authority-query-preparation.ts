import { isGenericQueryToken, preparedQueryIntentRetrievalSequences, type PreparedQuery } from '../query/query-preparation.js';
import type { PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { foldSearchText } from '../utils/texts.js';
import { isBroadToken } from '../utils/lang.js';

export type PreparedPhraseWindow = {
  query: string;
  tokenCount: number;
};

export type AuthorityQueryPreparation = {
  queryTokens: string[];
  preparedQueries: string[];
  preparedPhraseWindows: PreparedPhraseWindow[];
  primaryQueryTokens: string[];
  primaryPreparedQueries: string[];
  primaryPreparedPhraseWindows: PreparedPhraseWindow[];
  aliasPhraseWindows: string[];
  aliasFallbackPhraseWindows: string[];
};

export type AuthorityQueryPreparationOptions = {
  retrievalQuery?: PreparedOccupationRetrievalQuery;
};

const MAX_ALIAS_PHRASE_WINDOW_COUNT = 32;
const MIN_ALIAS_SINGLE_TOKEN_PHRASE_LENGTH = 6;
const MIN_GENERIC_HEAD_SPECIFIC_FALLBACK_LENGTH = 4;
const RETRIEVAL_GENERIC_HEAD_WRAPPERS = new Set(['personnel', 'personal']);

export function buildAuthorityQueryPreparation(
  preparedQuery: PreparedQuery,
  options: AuthorityQueryPreparationOptions = {}
): AuthorityQueryPreparation {
  const retrievalSequences = preparedQueryIntentRetrievalSequences(preparedQuery);
  const primaryFoldedTokenSequences = retrievalSequences.primaryFoldedTokenSequences;
  const contextualFoldedTokenSequences = retrievalSequences.contextualFoldedTokenSequences;
  const authoritySequences = primaryFoldedTokenSequences.length > 0 ? primaryFoldedTokenSequences : contextualFoldedTokenSequences;
  const supportSequences = contextualFoldedTokenSequences.length > 0 ? contextualFoldedTokenSequences : [];
  const retrievalSequencesForQueries = [...authoritySequences, ...supportSequences];

  return {
    queryTokens: uniqueTokens(retrievalSequencesForQueries),
    preparedQueries: uniqueJoinedQueries(retrievalSequencesForQueries),
    preparedPhraseWindows: buildPreparedPhraseWindows(retrievalSequencesForQueries),
    primaryQueryTokens: uniqueTokens(authoritySequences),
    primaryPreparedQueries: uniqueJoinedQueries(authoritySequences),
    primaryPreparedPhraseWindows: buildPreparedPhraseWindows(authoritySequences),
    aliasPhraseWindows: buildAliasPhraseWindowsFromSequences(retrievalSequencesForQueries),
    aliasFallbackPhraseWindows: buildAliasFallbackPhraseWindows(preparedQuery, authoritySequences, options)
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

export function buildAliasPhraseWindows(preparedQuery: PreparedQuery, options: AuthorityQueryPreparationOptions = {}): string[] {
  return buildAuthorityQueryPreparation(preparedQuery, options).aliasPhraseWindows;
}

export function buildAliasHeadTokenFallbackWindows(preparedQuery: PreparedQuery, options: AuthorityQueryPreparationOptions = {}): string[] {
  return buildAuthorityQueryPreparation(preparedQuery, options).aliasFallbackPhraseWindows;
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

function buildAliasPhraseWindowsFromSequences(foldedTokenSequences: string[][]): string[] {
  const windows: string[] = [];
  const seen = new Set<string>();

  for (const tokens of foldedTokenSequences) {
    appendAliasPhraseWindows(windows, seen, tokens);
  }

  return windows.slice(0, MAX_ALIAS_PHRASE_WINDOW_COUNT);
}

function buildAliasFallbackPhraseWindows(
  preparedQuery: PreparedQuery,
  primaryFoldedTokenSequences: string[][],
  options: AuthorityQueryPreparationOptions
): string[] {
  const adjacentSpecificTokens = broadHeadAdjacentSpecificFallbackTokens(preparedQuery, tokenAnchorCounts(options.retrievalQuery));

  if (adjacentSpecificTokens.length > 0) {
    return limitAliasWindows(adjacentSpecificTokens);
  }

  const authorityTokens = authorityBearingFallbackTokens(preparedQuery);

  if (authorityTokens.length > 0) {
    return limitAliasWindows(authorityTokens);
  }

  return limitAliasWindows(genericHeadSensitiveSpecificFallbackTokens(preparedQuery, primaryFoldedTokenSequences));
}

function broadHeadAdjacentSpecificFallbackTokens(preparedQuery: PreparedQuery, anchorCountsByToken: ReadonlyMap<string, number>): string[] {
  const foldedTokens = preparedQuery.foldedTokens;
  const usefulFoldedRecallTokens = new Set(preparedQuery.usefulFoldedRecallTokens);
  const roleModifierDiagnostics = new Set(
    preparedQuery.intent.diagnostics.filter((decision) => decision.kind === 'role_modifier').map((decision) => decision.normalizedToken)
  );
  const windows: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < foldedTokens.length; index += 1) {
    const token = foldedTokens[index] ?? '';
    const anchorCount = anchorCountsByToken.get(token) ?? 0;

    if (!isBroadToken({ token, locale: preparedQuery.locale, anchorCount }) && !isRetrievalGenericHeadToken(token, preparedQuery)) {
      continue;
    }

    for (const adjacentIndex of [index - 1, index + 1]) {
      const adjacent = foldedTokens[adjacentIndex] ?? '';

      if (
        adjacent.length < MIN_GENERIC_HEAD_SPECIFIC_FALLBACK_LENGTH ||
        seen.has(adjacent) ||
        !usefulFoldedRecallTokens.has(adjacent) ||
        !roleModifierDiagnostics.has(adjacent) ||
        isRetrievalGenericHeadToken(adjacent, preparedQuery)
      ) {
        continue;
      }

      seen.add(adjacent);
      windows.push(adjacent);
    }
  }

  return filterSpecificFallbackTokens(windows);
}

function tokenAnchorCounts(retrievalQuery: PreparedOccupationRetrievalQuery | undefined): ReadonlyMap<string, number> {
  if (!retrievalQuery) {
    return new Map();
  }

  const counts = new Map<string, number>();

  for (const candidate of retrievalQuery.roleSpanSelection.candidates) {
    if (candidate.tokenCount !== 1) {
      continue;
    }

    const token = candidate.foldedText.trim();

    if (token.length > 0) {
      counts.set(token, Math.max(counts.get(token) ?? 0, candidate.maxAnchorCount));
    }
  }

  return counts;
}

function authorityBearingFallbackTokens(preparedQuery: PreparedQuery): string[] {
  if (preparedQuery.intent.roleHeadTokens.length === 0) {
    return [];
  }

  const usefulFoldedRecallTokens = new Set(preparedQuery.usefulFoldedRecallTokens);
  const authoritativeHeads =
    preparedQuery.intent.authoritativeRoleHeadTokens.length > 0
      ? preparedQuery.intent.authoritativeRoleHeadTokens
      : preparedQuery.intent.roleHeadTokens;
  const usefulHeadTokens = authoritativeHeads.map((token) => foldSearchText(token)).filter((token) => usefulFoldedRecallTokens.has(token));

  if (usefulHeadTokens.length > 0) {
    return uniqueFoldedTokens(usefulHeadTokens);
  }

  const roleModifierDiagnostics = new Set(
    preparedQuery.intent.diagnostics.filter((decision) => decision.kind === 'role_modifier').map((decision) => decision.normalizedToken)
  );
  const authorityTokens: string[] = [];
  const seen = new Set<string>();

  for (const token of preparedQuery.intent.roleTokens) {
    const folded = foldSearchText(token);

    if (!usefulFoldedRecallTokens.has(folded) || !roleModifierDiagnostics.has(folded) || seen.has(folded)) {
      continue;
    }

    seen.add(folded);
    authorityTokens.push(folded);
  }

  return authorityTokens;
}

function genericHeadSensitiveSpecificFallbackTokens(preparedQuery: PreparedQuery, primaryFoldedTokenSequences: string[][]): string[] {
  const queryFoldedTokens = uniqueFoldedTokens(preparedQuery.foldedTokens);

  if (queryFoldedTokens.length !== 2) {
    return [];
  }

  const genericHeadTokenSet = new Set(preparedQuery.intent.genericRoleHeadTokens.map((token) => foldSearchText(token)));
  const genericTokens = queryFoldedTokens.filter(
    (token) => genericHeadTokenSet.has(token) || isRetrievalGenericHeadToken(token, preparedQuery)
  );

  if (genericTokens.length !== 1) {
    return [];
  }

  const specificUsefulTokens = uniqueFoldedTokens(preparedQuery.usefulFoldedRecallTokens).filter((token) => token !== genericTokens[0]);

  if (specificUsefulTokens.length > 0) {
    return filterSpecificFallbackTokens(specificUsefulTokens);
  }

  const primarySequence = primaryFoldedTokenSequences.find((sequence) => sequence.length > 0) ?? [];
  const specificPrimaryTokens = uniqueFoldedTokens(primarySequence).filter((token) => token !== genericTokens[0]);

  if (specificPrimaryTokens.length > 0) {
    return filterSpecificFallbackTokens(specificPrimaryTokens);
  }

  return filterSpecificFallbackTokens(queryFoldedTokens.filter((token) => token !== genericTokens[0]));
}

function appendAliasPhraseWindows(windows: string[], seen: Set<string>, tokens: string[]): void {
  if (tokens.length === 1) {
    for (const rawToken of tokens) {
      const token = rawToken?.trim();

      if (token && token.length >= MIN_ALIAS_SINGLE_TOKEN_PHRASE_LENGTH && !seen.has(token)) {
        seen.add(token);
        windows.push(token);
      }
    }
    return;
  }

  for (let windowSize = tokens.length; windowSize >= 2; windowSize -= 1) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      const window = tokens
        .slice(start, start + windowSize)
        .join(' ')
        .trim();

      if (!window || seen.has(window)) {
        continue;
      }

      seen.add(window);
      windows.push(window);
    }
  }
}

function uniqueTokens(tokenSequences: string[][]): string[] {
  return Array.from(new Set(tokenSequences.flat()));
}

function uniqueJoinedQueries(tokenSequences: string[][]): string[] {
  return Array.from(new Set(tokenSequences.map((tokens) => tokens.join(' ').trim()).filter(Boolean)));
}

function uniqueFoldedTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
}

function filterSpecificFallbackTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= MIN_GENERIC_HEAD_SPECIFIC_FALLBACK_LENGTH);
}

function limitAliasWindows(tokens: string[]): string[] {
  return tokens.slice(0, MAX_ALIAS_PHRASE_WINDOW_COUNT);
}

function isRetrievalGenericHeadToken(token: string, preparedQuery: PreparedQuery): boolean {
  return isGenericQueryToken(token, preparedQuery.locale) || RETRIEVAL_GENERIC_HEAD_WRAPPERS.has(token);
}
