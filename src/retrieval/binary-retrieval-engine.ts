import {
  foldSearchText,
  isUsefulQueryToken,
  prepareQuery,
  tokenizeNormalizedText,
  type PreparedQuery
} from '../query/query-preparation.js';
import {
  OPENSEARCH_AUTHORITY_SCORE,
  OPENSEARCH_FIELD_STRENGTH,
  OPENSEARCH_LEXICAL_SIGNAL_POLICY,
  OPENSEARCH_PHRASE_WINDOW_POLICY
} from '../scoring/scoring-policy.js';
import {
  RETRIEVAL_TEXT_FIELDS,
  findRange,
  findStringId,
  loadOccupationRetrievalIndexRequired,
  rowValue,
  stringAt,
  uint32RowsSlice,
  type RetrievalIndexCacheEntry,
  type RetrievalIndexTextField
} from '../runtime/occupation-retrieval-index-artifact.js';
import { maxOf, roundScore } from '../utils/operators.js';
import { buildAliasHeadTokenFallbackWindows, buildAliasPhraseWindows } from './alias-phrase-windows.js';
import type {
  AliasEvidenceRow,
  AliasRetrievalEngine,
  AliasRetrievalOptions,
  AliasRetrievalResult,
  CanonicalLabelHit,
  FamilyOccupationTextRetrievalOptions,
  OccupationRetrievalEngine,
  OccupationTextFieldSignal,
  OccupationTextHit,
  OccupationTextRetrievalEngine,
  OccupationTextRetrievalOptions
} from './retrieval-engine.js';

type BinaryAuthorityMatch = {
  name: string;
  score: number;
  queryTokens: string[];
  type: 'phrase' | 'all_terms';
  fields: RetrievalIndexTextField[];
};

type ScoredBinaryTextHit = {
  graphNodeId: number;
  canonicalLabel: string;
  rawScore: number;
  matchedQueries: string[];
  matchedFields: string[];
  fieldSignals: OccupationTextFieldSignal[];
  matchedTokens: string[];
  phraseMatch: boolean;
  maxUsefulTokenCoverage: number;
  queryTokenCount: number;
  usefulQueryTokenCount: number;
};

const DEFAULT_ALIAS_SEARCH_SIZE = 1000;
const MAX_GLOBAL_TEXT_CANDIDATES = 250;
const MAX_FAMILY_TEXT_CANDIDATES = 180;
const NULL_U32 = 0xffffffff;
const TITLE_AND_ALIAS_FIELDS: RetrievalIndexTextField[] = [
  'canonical_label',
  'locale_primary_aliases_text',
  'locale_supporting_aliases_text',
  'reviewed_crosswalk_aliases_text',
  'aliases_text',
  'family_supporting_aliases_text',
  'english_backbone_aliases_text'
];
const BROAD_FIELDS: RetrievalIndexTextField[] = ['search_text', 'capability_text', 'ancestor_text'];

export function createBinaryRetrievalEngine(): OccupationRetrievalEngine {
  const occupations = new BinaryOccupationRetriever();
  return {
    aliases: new BinaryAliasRetriever(),
    occupations
  };
}

export class BinaryAliasRetriever implements AliasRetrievalEngine {
  public async retrieve(options: AliasRetrievalOptions): Promise<AliasRetrievalResult> {
    const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
    const localeId = localeIdFor(index, options.locale);
    const size = Math.max(DEFAULT_ALIAS_SEARCH_SIZE, options.limit * 25);
    const exactRows = matchingAliasRows(index, localeId, options.exactAliasQueries, index.exactAliasIndex, index.exactAliasRows)
      .sort(compareAliasRows)
      .slice(0, size);
    const foldedRows = matchingAliasRows(index, localeId, options.foldedAliasQueries, index.foldedAliasIndex, index.foldedAliasRows)
      .sort(compareAliasRows)
      .slice(0, size);
    const subphraseRows = resolveAliasSubphraseRowsWithFallback(index, localeId, options.preparedQuery, size);

    return {
      exactRows,
      foldedRows,
      subphraseRows,
      scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
    };
  }
}

export class BinaryOccupationRetriever implements OccupationTextRetrievalEngine {
  public async retrieve(options: OccupationTextRetrievalOptions): Promise<OccupationTextHit[]> {
    const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
    return retrieveTextHits(index, options);
  }

  public async retrieveCanonicalLabels(
    options: OccupationTextRetrievalOptions & { foldedQueries: string[] }
  ): Promise<CanonicalLabelHit[]> {
    const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
    const localeId = localeIdFor(index, options.locale);
    const rows: CanonicalLabelHit[] = [];

    for (const query of uniqueNonEmpty(options.foldedQueries)) {
      const keyId = findStringId(index.strings, query);

      if (keyId < 0) {
        continue;
      }

      for (const recordId of rangeRows(index.canonicalIndex, index.canonicalRows, [localeId, keyId])) {
        rows.push(canonicalLabelHit(index, recordId));
      }
    }

    return rows
      .sort((left, right) => left.canonicalLabel.localeCompare(right.canonicalLabel) || left.graphNodeId - right.graphNodeId)
      .slice(0, Math.max(options.limit * 4, 25));
  }

  public async retrieveWithinFamily(options: FamilyOccupationTextRetrievalOptions): Promise<OccupationTextHit[]> {
    const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
    return retrieveTextHits(index, options, options.familyNodeId);
  }
}

async function retrieveTextHits(
  index: RetrievalIndexCacheEntry,
  options: OccupationTextRetrievalOptions,
  familyNodeId?: number
): Promise<OccupationTextHit[]> {
  const localeId = localeIdFor(index, options.locale);
  const preparedQuery = options.preparedQuery ?? (await prepareQuery(options.query, options.locale, { sourceName: options.sourceName }));
  const queryTokens = preparedQuery.foldedTokens;
  const queryTokenIds = queryTokens.map((token) => findStringId(index.strings, token)).filter((id) => id >= 0);
  const candidateRecordIds = candidateTextRecordIds(index, localeId, queryTokenIds, queryTokens, familyNodeId);
  const authorityMatches = buildAuthorityMatches(options.query, preparedQuery);
  const scoredHits = candidateRecordIds
    .map((recordId) => scoreTextRecord(index, recordId, authorityMatches, queryTokens, options.locale))
    .filter((hit): hit is ScoredBinaryTextHit => hit !== null);
  const maxRawScore = maxOf(scoredHits, (hit) => hit.rawScore);
  const size = Math.max(options.limit * (familyNodeId === undefined ? 4 : 1), 25);

  return scoredHits
    .map((hit) => toOccupationTextHit(hit, maxRawScore))
    .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
    .slice(0, size);
}

// Unions rows across every matching query variant (resolution.md #9) instead of returning as soon
// as one variant has hits, so an equally-valid alias-query variant later in the list can still
// contribute evidence rather than being silently discarded.
function matchingAliasRows(
  index: RetrievalIndexCacheEntry,
  localeId: number,
  queries: string[],
  keyIndex: RetrievalIndexCacheEntry['exactAliasIndex'],
  postings: Uint32Array
): AliasEvidenceRow[] {
  const seenRowIds = new Set<number>();
  const rows: AliasEvidenceRow[] = [];

  for (const query of uniqueNonEmpty(queries)) {
    const keyId = findStringId(index.strings, query);

    if (keyId < 0) {
      continue;
    }

    for (const rowId of rangeRows(keyIndex, postings, [localeId, keyId])) {
      if (seenRowIds.has(rowId)) {
        continue;
      }

      seenRowIds.add(rowId);
      rows.push(aliasEvidenceRow(index, rowId, 50));
    }
  }

  return rows;
}

function candidateAliasRowIds(index: RetrievalIndexCacheEntry, localeId: number, phraseWindowTokens: string[][]): number[] {
  const selected = new Set<number>();
  const rowIds: number[] = [];
  const tokenIds = Array.from(
    new Set(
      phraseWindowTokens
        .flat()
        .map((token) => findStringId(index.strings, token))
        .filter((id) => id >= 0)
    )
  );

  for (const tokenId of tokenIds) {
    for (const rowId of rangeRows(index.aliasTokenIndex, index.aliasTokenRows, [localeId, tokenId])) {
      if (selected.has(rowId)) {
        continue;
      }

      selected.add(rowId);
      rowIds.push(rowId);
    }
  }

  return rowIds;
}

function candidateTextRecordIds(
  index: RetrievalIndexCacheEntry,
  localeId: number,
  queryTokenIds: number[],
  _queryTokens: string[],
  familyNodeId: number | undefined
): number[] {
  const selected = new Set<number>();
  const recordIds: number[] = [];
  const limit = familyNodeId === undefined ? MAX_GLOBAL_TEXT_CANDIDATES : MAX_FAMILY_TEXT_CANDIDATES;
  const usefulTokenIds = queryTokenIds.filter((tokenId) =>
    isUsefulQueryToken(stringAt(index.strings, tokenId), localeFromId(index, localeId))
  );
  const authorityTokenIds = usefulTokenIds.length > 0 ? usefulTokenIds : queryTokenIds;

  for (const field of TITLE_AND_ALIAS_FIELDS) {
    appendAllTermFieldCandidates(index, selected, recordIds, localeId, field, authorityTokenIds, familyNodeId, limit);
  }

  for (const field of TITLE_AND_ALIAS_FIELDS) {
    appendUnionFieldCandidates(index, selected, recordIds, localeId, field, authorityTokenIds, familyNodeId, limit);
  }

  for (const field of BROAD_FIELDS) {
    appendUnionFieldCandidates(index, selected, recordIds, localeId, field, authorityTokenIds, familyNodeId, limit);
  }

  return recordIds;
}

function appendAllTermFieldCandidates(
  index: RetrievalIndexCacheEntry,
  selected: Set<number>,
  recordIds: number[],
  localeId: number,
  field: RetrievalIndexTextField,
  tokenIds: number[],
  familyNodeId: number | undefined,
  limit: number
): void {
  if (tokenIds.length === 0) {
    return;
  }

  const fieldId = fieldIdFor(field);
  const postings = tokenIds
    .map((tokenId) => rangeRows(index.textFieldPostingIndex, index.textPostingRows, [localeId, fieldId, tokenId]))
    .filter((rows) => rows.length > 0)
    .sort((left, right) => left.length - right.length);

  if (postings.length !== tokenIds.length) {
    return;
  }

  const [smallest = [], ...rest] = postings;

  for (const recordId of smallest) {
    if (!rest.every((rows) => sortedIncludes(rows, recordId))) {
      continue;
    }

    appendRecordId(index, selected, recordIds, recordId, familyNodeId, limit);

    if (recordIds.length >= limit) {
      return;
    }
  }
}

function appendUnionFieldCandidates(
  index: RetrievalIndexCacheEntry,
  selected: Set<number>,
  recordIds: number[],
  localeId: number,
  field: RetrievalIndexTextField,
  tokenIds: number[],
  familyNodeId: number | undefined,
  limit: number
): void {
  const fieldId = fieldIdFor(field);

  for (const tokenId of tokenIds) {
    for (const recordId of rangeRows(index.textFieldPostingIndex, index.textPostingRows, [localeId, fieldId, tokenId])) {
      appendRecordId(index, selected, recordIds, recordId, familyNodeId, limit);

      if (recordIds.length >= limit) {
        return;
      }
    }
  }
}

function appendRecordId(
  index: RetrievalIndexCacheEntry,
  selected: Set<number>,
  recordIds: number[],
  recordId: number,
  familyNodeId: number | undefined,
  limit: number
): void {
  if (recordIds.length >= limit || selected.has(recordId)) {
    return;
  }

  if (familyNodeId !== undefined && textRecordFamilyNodeId(index, recordId) !== familyNodeId) {
    return;
  }

  selected.add(recordId);
  recordIds.push(recordId);
}

function buildAuthorityMatches(rawQuery: string, preparedQuery: PreparedQuery): BinaryAuthorityMatch[] {
  const preparedUsefulQuery = preparedQuery.usefulTokens.join(' ').trim();
  const preparedFoldedUsefulQuery = preparedQuery.usefulFoldedTokens.join(' ').trim();
  const preparedPhraseWindows = buildPreparedPhraseWindows(preparedQuery);
  const preparedQueries = Array.from(new Set([preparedUsefulQuery, preparedFoldedUsefulQuery].filter(Boolean)));
  const rawQueries = Array.from(new Set([rawQuery.trim(), preparedQuery.normalized, preparedQuery.folded].filter(Boolean)));
  const matches: BinaryAuthorityMatch[] = [];

  preparedPhraseWindows.forEach((phraseWindow, index) => {
    const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;

    matches.push(
      authorityMatch(
        `authority_010_prepared_primary_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_PRIMARY_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['locale_primary_aliases_text']
      ),
      authorityMatch(
        `authority_020_prepared_canonical_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_CANONICAL_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['canonical_label']
      ),
      authorityMatch(
        `authority_030_prepared_supporting_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_SUPPORTING_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['locale_supporting_aliases_text']
      ),
      authorityMatch(
        `authority_040_prepared_reviewed_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_REVIEWED_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['reviewed_crosswalk_aliases_text']
      ),
      authorityMatch(
        `authority_045_prepared_family_support_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_FAMILY_SUPPORT_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['family_supporting_aliases_text']
      ),
      authorityMatch(
        `authority_050_prepared_backbone_phrase_${suffix}`,
        phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_BACKBONE_PHRASE, phraseWindow),
        phraseWindow.query,
        'phrase',
        ['english_backbone_aliases_text']
      )
    );
  });

  for (const query of rawQueries) {
    matches.push(
      authorityMatch('authority_060_raw_primary_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_PRIMARY_OR_CANONICAL_PHRASE, query, 'phrase', [
        'locale_primary_aliases_text',
        'canonical_label'
      ]),
      authorityMatch('authority_070_raw_supporting_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, 'phrase', [
        'locale_supporting_aliases_text',
        'reviewed_crosswalk_aliases_text',
        'family_supporting_aliases_text',
        'english_backbone_aliases_text'
      ])
    );
  }

  for (const query of preparedQueries) {
    matches.push(
      authorityMatch('authority_080_prepared_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, 'all_terms', [
        'locale_primary_aliases_text',
        'canonical_label',
        'locale_supporting_aliases_text',
        'reviewed_crosswalk_aliases_text',
        'family_supporting_aliases_text',
        'english_backbone_aliases_text',
        'aliases_text',
        'search_text',
        'capability_text'
      ])
    );
  }

  for (const query of rawQueries) {
    matches.push(
      authorityMatch('authority_100_raw_all_terms', OPENSEARCH_AUTHORITY_SCORE.RAW_ALL_TERMS, query, 'all_terms', [
        'aliases_text',
        'search_text',
        'capability_text',
        'ancestor_text'
      ])
    );
  }

  return matches;
}

function scoreTextRecord(
  index: RetrievalIndexCacheEntry,
  recordId: number,
  authorityMatches: BinaryAuthorityMatch[],
  queryTokens: string[],
  locale: string
): ScoredBinaryTextHit | null {
  let rawScore = 0;
  const matchedQueries = new Set<string>();
  const matchedFields = new Set<string>();

  for (const match of authorityMatches) {
    const fields = match.fields.filter((field) =>
      fieldMatches(textRecordFieldTokenText(index, recordId, field), match.queryTokens, match.type)
    );

    if (fields.length === 0) {
      continue;
    }

    rawScore = Math.max(rawScore, match.score);
    matchedQueries.add(match.name);
    for (const field of fields) {
      matchedFields.add(field);
    }
  }

  if (rawScore <= 0) {
    return null;
  }

  const fieldSignals = buildFieldSignals(index, recordId, queryTokens, locale);
  const matchedTokens = Array.from(new Set(fieldSignals.flatMap((signal) => signal.matchedTokens))).sort();
  const usefulQueryTokenCount = queryTokens.filter((token) => isUsefulQueryToken(token, locale)).length;

  return {
    graphNodeId: textRecordGraphNodeId(index, recordId),
    canonicalLabel: stringAt(index.strings, rowValue(index.textRecords, recordId, 1)),
    rawScore: roundScore(rawScore),
    matchedQueries: Array.from(matchedQueries).sort(),
    matchedFields: Array.from(matchedFields).sort(),
    fieldSignals,
    matchedTokens,
    phraseMatch: fieldSignals.some((signal) => signal.phraseMatch),
    maxUsefulTokenCoverage: roundScore(maxOf(fieldSignals, (signal) => signal.usefulTokenCoverage)),
    queryTokenCount: queryTokens.length,
    usefulQueryTokenCount
  };
}

function fieldMatches(fieldTokenText: string, queryTokens: string[], type: BinaryAuthorityMatch['type']): boolean {
  if (!fieldTokenText.trim() || queryTokens.length === 0) {
    return false;
  }

  if (type === 'phrase') {
    return tokenTextContainsPhrase(fieldTokenText, queryTokens);
  }

  return queryTokens.every((token) => fieldTokenText.includes(tokenPhraseText([token])));
}

function buildFieldSignals(
  index: RetrievalIndexCacheEntry,
  recordId: number,
  queryTokens: string[],
  locale: string
): OccupationTextFieldSignal[] {
  return RETRIEVAL_TEXT_FIELDS.map((field) =>
    buildFieldSignal(field, textRecordFieldTokenText(index, recordId, field), queryTokens, locale)
  ).filter((signal): signal is OccupationTextFieldSignal => signal !== null);
}

function buildFieldSignal(
  field: RetrievalIndexTextField,
  fieldTokenText: string,
  queryTokens: string[],
  locale: string
): OccupationTextFieldSignal | null {
  const matchedTokens = queryTokens.filter((token) => fieldTokenText.includes(tokenPhraseText([token])));

  if (matchedTokens.length === 0) {
    return null;
  }

  const usefulQueryTokens = queryTokens.filter((token) => isUsefulQueryToken(token, locale));
  const usefulMatchedTokens = matchedTokens.filter((token) => isUsefulQueryToken(token, locale));

  return {
    field,
    fieldClass: fieldClassForField(field),
    ...(aliasRoleForField(field) ? { aliasRole: aliasRoleForField(field) } : {}),
    phraseMatch: tokenTextContainsPhrase(fieldTokenText, queryTokens),
    matchedTokens: Array.from(new Set(matchedTokens)).sort(),
    usefulMatchedTokens: Array.from(new Set(usefulMatchedTokens)).sort(),
    matchedTokenCount: matchedTokens.length,
    usefulMatchedTokenCount: usefulMatchedTokens.length,
    queryTokenCount: queryTokens.length,
    usefulQueryTokenCount: usefulQueryTokens.length,
    tokenCoverage: roundScore(matchedTokens.length / Math.max(queryTokens.length, 1)),
    usefulTokenCoverage: roundScore(usefulMatchedTokens.length / Math.max(usefulQueryTokens.length, 1))
  };
}

function toOccupationTextHit(hit: ScoredBinaryTextHit, maxRawScore: number): OccupationTextHit {
  const normalizedRawScore = roundScore(maxRawScore > 0 ? hit.rawScore / maxRawScore : 0);
  const lexicalSignalScore = calculateLexicalSignalScore(hit);

  return {
    graphNodeId: hit.graphNodeId,
    canonicalLabel: hit.canonicalLabel,
    score: roundScore(normalizedRawScore * lexicalSignalScore),
    rawScore: hit.rawScore,
    normalizedRawScore,
    lexicalSignalScore,
    matchedQueries: hit.matchedQueries,
    matchedFields: hit.matchedFields,
    fieldSignals: hit.fieldSignals,
    matchedTokens: hit.matchedTokens,
    phraseMatch: hit.phraseMatch,
    maxUsefulTokenCoverage: hit.maxUsefulTokenCoverage,
    queryTokenCount: hit.queryTokenCount,
    usefulQueryTokenCount: hit.usefulQueryTokenCount
  };
}

function calculateLexicalSignalScore(hit: ScoredBinaryTextHit): number {
  const usefulCoverage =
    hit.usefulQueryTokenCount > 0 ? hit.maxUsefulTokenCoverage : maxOf(hit.fieldSignals, (signal) => signal.tokenCoverage);
  const usefulFieldStrength = maxOf(
    hit.fieldSignals.filter((signal) => signal.usefulMatchedTokenCount > 0 || hit.usefulQueryTokenCount === 0),
    (signal) => fieldStrength(signal.fieldClass)
  );
  const phraseBoost = hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.PHRASE_MATCH_BONUS : 0;
  const shortNonPhraseCap = hit.usefulQueryTokenCount <= 2 && !hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.SHORT_NON_PHRASE_CAP : 1;
  const score =
    OPENSEARCH_LEXICAL_SIGNAL_POLICY.BASE_SIGNAL +
    usefulCoverage * OPENSEARCH_LEXICAL_SIGNAL_POLICY.USEFUL_COVERAGE_WEIGHT +
    usefulFieldStrength * OPENSEARCH_LEXICAL_SIGNAL_POLICY.FIELD_STRENGTH_WEIGHT +
    phraseBoost;

  return roundScore(Math.max(OPENSEARCH_LEXICAL_SIGNAL_POLICY.MIN_SIGNAL, Math.min(shortNonPhraseCap, score)));
}

function aliasEvidenceRow(index: RetrievalIndexCacheEntry, rowId: number, queryBoost: number): AliasEvidenceRow {
  const roleId = rowValue(index.aliasRows, rowId, 5);
  const weight = Math.min(rowValue(index.aliasRows, rowId, 7) / 1000 + (queryBoost > 0 ? 0.2 : 0), 1);

  return {
    graph_node_id: rowValue(index.aliasRows, rowId, 0),
    canonical_label: stringAt(index.strings, rowValue(index.aliasRows, rowId, 1)),
    alias: stringAt(index.strings, rowValue(index.aliasRows, rowId, 2)),
    normalized_alias: stringAt(index.strings, rowValue(index.aliasRows, rowId, 3)),
    alias_role: aliasRoleForId(roleId),
    alias_role_rank: rowValue(index.aliasRows, rowId, 6),
    weight,
    alias_authority_score: rowValue(index.aliasRows, rowId, 8) / 1000 + queryBoost,
    alias_token_count: rowValue(index.aliasRows, rowId, 9)
  };
}

function canonicalLabelHit(index: RetrievalIndexCacheEntry, recordId: number): CanonicalLabelHit {
  return {
    graphNodeId: textRecordGraphNodeId(index, recordId),
    canonicalLabel: stringAt(index.strings, rowValue(index.textRecords, recordId, 1)),
    normalizedLabel: stringAt(index.strings, rowValue(index.textRecords, recordId, 2))
  };
}

function rangeRows(
  keyIndex: RetrievalIndexCacheEntry['exactAliasIndex'],
  postings: RetrievalIndexCacheEntry['exactAliasRows'] | RetrievalIndexCacheEntry['textPostingRows'],
  keyColumns: number[]
): number[] {
  const range = findRange(keyIndex, keyColumns);

  if (!range || range.length === 0) {
    return [];
  }

  return uint32RowsSlice(postings, range.offset, range.length);
}

function localeIdFor(index: RetrievalIndexCacheEntry, locale: string): number {
  const localeIndex = index.manifest.locales.indexOf(locale);

  if (localeIndex < 0) {
    return -1;
  }

  return localeIndex + 1;
}

function localeFromId(index: RetrievalIndexCacheEntry, localeId: number): string {
  return index.manifest.locales[localeId - 1] ?? 'unknown';
}

function fieldIdFor(field: RetrievalIndexTextField): number {
  return RETRIEVAL_TEXT_FIELDS.indexOf(field);
}

function textRecordGraphNodeId(index: RetrievalIndexCacheEntry, recordId: number): number {
  return rowValue(index.textRecords, recordId, 0);
}

function textRecordFamilyNodeId(index: RetrievalIndexCacheEntry, recordId: number): number | null {
  const value = rowValue(index.textRecords, recordId, 3);
  return value === NULL_U32 ? null : value;
}

function textRecordFieldTokenText(index: RetrievalIndexCacheEntry, recordId: number, field: RetrievalIndexTextField): string {
  return stringAt(index.strings, rowValue(index.textRecords, recordId, 4 + fieldIdFor(field)));
}

function authorityMatch(
  name: string,
  score: number,
  query: string,
  type: BinaryAuthorityMatch['type'],
  fields: RetrievalIndexTextField[]
): BinaryAuthorityMatch {
  return { name, score, queryTokens: tokenizeNormalizedText(foldSearchText(query)), type, fields };
}

type PreparedPhraseWindow = {
  query: string;
  tokenCount: number;
};

function buildPreparedPhraseWindows(preparedQuery: PreparedQuery): PreparedPhraseWindow[] {
  const windows: PreparedPhraseWindow[] = [];
  const seen = new Set<string>();

  appendOccupationPhraseWindows(windows, seen, preparedQuery.usefulTokens);
  appendOccupationPhraseWindows(windows, seen, preparedQuery.usefulFoldedTokens);

  return windows;
}

function appendOccupationPhraseWindows(windows: PreparedPhraseWindow[], seen: Set<string>, tokens: string[]): void {
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

function resolveAliasSubphraseRowsWithFallback(
  index: RetrievalIndexCacheEntry,
  localeId: number,
  preparedQuery: PreparedQuery,
  size: number
): AliasEvidenceRow[] {
  const primaryRows = resolveAliasSubphraseRows(index, localeId, buildAliasPhraseWindows(preparedQuery), size);

  if (primaryRows.length > 0) {
    return primaryRows;
  }

  // A multi-token query only ever searches its full-width phrase window, so it can regress to zero
  // alias evidence even when its head word alone would have matched broadly (e.g. "security personnel").
  // See buildAliasHeadTokenFallbackWindows for why this is restricted to the head token.
  return resolveAliasSubphraseRows(index, localeId, buildAliasHeadTokenFallbackWindows(preparedQuery), size);
}

function resolveAliasSubphraseRows(
  index: RetrievalIndexCacheEntry,
  localeId: number,
  phraseWindows: string[],
  size: number
): AliasEvidenceRow[] {
  const phraseWindowTokens = phraseWindows.map((window) => tokenizeNormalizedText(foldSearchText(window)));

  if (phraseWindowTokens.length === 0) {
    return [];
  }

  return candidateAliasRowIds(index, localeId, phraseWindowTokens)
    .filter((rowId) =>
      phraseWindowTokens.some((tokens) => tokenTextContainsPhrase(stringAt(index.strings, rowValue(index.aliasRows, rowId, 4)), tokens))
    )
    .map((rowId) => aliasEvidenceRow(index, rowId, 0))
    .sort(compareAliasRows)
    .slice(0, size);
}

function phraseWindowAuthorityScore(baseScore: number, phraseWindow: PreparedPhraseWindow): number {
  return (
    baseScore +
    Math.min(
      phraseWindow.tokenCount * OPENSEARCH_PHRASE_WINDOW_POLICY.TOKEN_AUTHORITY_INCREMENT,
      OPENSEARCH_PHRASE_WINDOW_POLICY.MAX_TOKEN_AUTHORITY_BONUS
    )
  );
}

function tokenTextContainsPhrase(fieldTokenText: string, queryTokens: string[]): boolean {
  return queryTokens.length > 0 && fieldTokenText.includes(tokenPhraseText(queryTokens));
}

function tokenPhraseText(tokens: string[]): string {
  return ` ${tokens.join(' ')} `;
}

function sortedIncludes(values: number[], needle: number): boolean {
  let low = 0;
  let high = values.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = values[mid] ?? 0;

    if (value < needle) {
      low = mid + 1;
    } else if (value > needle) {
      high = mid - 1;
    } else {
      return true;
    }
  }

  return false;
}

function compareAliasRows(left: AliasEvidenceRow, right: AliasEvidenceRow): number {
  return (
    (right.alias_authority_score ?? Number.NEGATIVE_INFINITY) - (left.alias_authority_score ?? Number.NEGATIVE_INFINITY) ||
    (right.alias_role_rank ?? Number.NEGATIVE_INFINITY) - (left.alias_role_rank ?? Number.NEGATIVE_INFINITY) ||
    (right.weight ?? Number.NEGATIVE_INFINITY) - (left.weight ?? Number.NEGATIVE_INFINITY) ||
    (left.alias_token_count ?? Number.POSITIVE_INFINITY) - (right.alias_token_count ?? Number.POSITIVE_INFINITY) ||
    left.canonical_label.localeCompare(right.canonical_label) ||
    left.graph_node_id - right.graph_node_id ||
    left.alias.localeCompare(right.alias)
  );
}

function fieldClassForField(field: RetrievalIndexTextField): OccupationTextFieldSignal['fieldClass'] {
  if (field === 'canonical_label') {
    return 'title';
  }

  if (
    field === 'aliases_text' ||
    field === 'locale_primary_aliases_text' ||
    field === 'locale_supporting_aliases_text' ||
    field === 'reviewed_crosswalk_aliases_text' ||
    field === 'english_backbone_aliases_text'
  ) {
    return 'alias';
  }

  if (field === 'family_supporting_aliases_text') {
    return 'family_alias';
  }

  if (field === 'capability_text') {
    return 'capability';
  }

  if (field === 'ancestor_text') {
    return 'ancestor';
  }

  return 'search_text';
}

function aliasRoleForField(field: RetrievalIndexTextField): OccupationTextFieldSignal['aliasRole'] | undefined {
  if (field === 'locale_primary_aliases_text') return 'locale_primary';
  if (field === 'locale_supporting_aliases_text') return 'locale_supporting';
  if (field === 'reviewed_crosswalk_aliases_text') return 'reviewed_crosswalk';
  if (field === 'family_supporting_aliases_text') return 'family_supporting';
  if (field === 'english_backbone_aliases_text') return 'english_backbone';
  if (field === 'aliases_text') return 'combined';
  return undefined;
}

function fieldStrength(fieldClass: OccupationTextFieldSignal['fieldClass']): number {
  if (fieldClass === 'title') return OPENSEARCH_FIELD_STRENGTH.TITLE;
  if (fieldClass === 'alias') return OPENSEARCH_FIELD_STRENGTH.ALIAS;
  if (fieldClass === 'search_text') return OPENSEARCH_FIELD_STRENGTH.SEARCH_TEXT;
  if (fieldClass === 'capability') return OPENSEARCH_FIELD_STRENGTH.CAPABILITY;
  if (fieldClass === 'family_alias') return OPENSEARCH_FIELD_STRENGTH.FAMILY_ALIAS;
  return OPENSEARCH_FIELD_STRENGTH.ANCESTOR;
}

function aliasRoleForId(roleId: number): string {
  if (roleId === 1) return 'locale_primary';
  if (roleId === 2) return 'reviewed_crosswalk';
  if (roleId === 3) return 'locale_supporting';
  if (roleId === 4) return 'family_supporting';
  return 'english_backbone';
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}
