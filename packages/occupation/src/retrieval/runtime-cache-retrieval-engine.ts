import {
  containsTokenPhrase,
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
  hydrateAllRuntimeSearchMetaRecords,
  loadOccupationSearchMetaArtifactRequired,
  type RuntimeAliasRecord,
  type RuntimeSearchMetaRecord
} from '../runtime/occupation-search-meta-artifact.js';
import { roundScore } from '../utils/operators.js';
import { normalizeSearchText } from '../utils/texts.js';
import type {
  AliasEvidenceRow,
  AliasRetrievalEngine,
  AliasRetrievalOptions,
  AliasRetrievalResult,
  CanonicalLabelHit,
  FamilyOccupationTextRetrievalOptions,
  OccupationRetrievalEngine,
  OccupationTextField,
  OccupationTextFieldSignal,
  OccupationTextHit,
  OccupationTextRetrievalEngine,
  OccupationTextRetrievalOptions
} from './retrieval-engine.js';

type AliasRole = RuntimeAliasRecord['aliasRole'];
type SearchAliasRole = 'locale_primary' | 'locale_supporting' | 'reviewed_crosswalk';

type RuntimeCacheIndex = {
  textRecords: LocalTextRecord[];
  aliasRowsByLocaleAndToken: Map<string, LocalAliasRow[]>;
  textRecordIndexesByLocaleFieldAndToken: Map<string, number[]>;
  exactAliasesByLocaleAndValue: Map<string, LocalAliasRow[]>;
  foldedAliasesByLocaleAndValue: Map<string, LocalAliasRow[]>;
  canonicalByLocaleAndFoldedLabel: Map<string, CanonicalLabelHit[]>;
};

type LocalAliasRow = AliasEvidenceRow & {
  localeCode: string;
  aliasTextTokens: string[];
  queryPriority?: number;
};

type LocalTextRecord = {
  index: number;
  graphNodeId: number;
  canonicalLabel: string;
  normalizedLabel: string;
  familyNodeId: number | null;
  localeCodes: Set<string>;
  fields: Record<OccupationTextField, string>;
  fieldTokens: Record<OccupationTextField, string[]>;
  fieldTokenText: Record<OccupationTextField, string>;
  fieldTokenSets: Record<OccupationTextField, Set<string>>;
  fieldTokensByPrefix: Record<OccupationTextField, Map<string, string[]>>;
  allTokens: string[];
};

type LocalAuthorityMatch = {
  name: string;
  score: number;
  query: string;
  queryTokens: string[];
  type: 'phrase' | 'all_terms' | 'fuzzy';
  fields: OccupationTextField[];
};

type ScoredLocalTextHit = {
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

const SEARCH_ALIAS_ROLES = new Set<SearchAliasRole>(['locale_primary', 'locale_supporting', 'reviewed_crosswalk']);
const ALIAS_AUTHORITY_WEIGHT_SCALE = 100;
const ALIAS_ROLE_RANK: Record<AliasRole, number> = {
  locale_primary: 5,
  reviewed_crosswalk: 4,
  locale_supporting: 3,
  family_supporting: 2,
  english_backbone: 1
};
const DEFAULT_ALIAS_SEARCH_SIZE = 1000;
const MAX_PHRASE_WINDOW_COUNT = 32;
const MIN_SINGLE_TOKEN_PHRASE_LENGTH = 6;
const MAX_GLOBAL_TEXT_CANDIDATES = 250;
const MAX_FAMILY_TEXT_CANDIDATES = 180;
const INDEX_CACHE = new Map<string, Promise<RuntimeCacheIndex>>();
const TEXT_FIELDS: OccupationTextField[] = [
  'canonical_label',
  'locale_primary_aliases_text',
  'locale_supporting_aliases_text',
  'reviewed_crosswalk_aliases_text',
  'family_supporting_aliases_text',
  'english_backbone_aliases_text',
  'aliases_text',
  'search_text',
  'capability_text',
  'ancestor_text'
];

export function createRuntimeCacheRetrievalEngine(): OccupationRetrievalEngine {
  const occupations = new RuntimeCacheOccupationRetriever();
  return {
    aliases: new RuntimeCacheAliasRetriever(),
    occupations
  };
}

export class RuntimeCacheAliasRetriever implements AliasRetrievalEngine {
  public async retrieve(options: AliasRetrievalOptions): Promise<AliasRetrievalResult> {
    const index = await loadRuntimeCacheIndex(options.sourceName);
    const size = Math.max(DEFAULT_ALIAS_SEARCH_SIZE, options.limit * 25);
    const exactRows = firstMatchingAliasRows(
      uniqueNonEmpty(options.exactAliasQueries),
      (value) => index.exactAliasesByLocaleAndValue.get(localeValueKey(options.locale, value)) ?? []
    )
      .sort(compareAliasRowsWithQueryPriority)
      .slice(0, size);
    const foldedRows = firstMatchingAliasRows(
      uniqueNonEmpty(options.foldedAliasQueries),
      (value) => index.foldedAliasesByLocaleAndValue.get(localeValueKey(options.locale, value)) ?? []
    )
      .sort(compareAliasRowsWithQueryPriority)
      .slice(0, size);
    const phraseWindows = buildAliasPhraseWindows(options.preparedQuery);
    const phraseWindowTokens = phraseWindows.map((window) => tokenizeNormalizedText(foldSearchText(window)));
    const subphraseCandidateRows = candidateAliasRows(index, options.locale, phraseWindowTokens);
    const subphraseRows = phraseWindows.length === 0
      ? []
      : subphraseCandidateRows
        .filter((row) =>
          SEARCH_ALIAS_ROLES.has(row.alias_role as SearchAliasRole) &&
          phraseWindowTokens.some((windowTokens) => containsTokenPhrase(row.aliasTextTokens, windowTokens, options.locale))
        )
        .sort(compareAliasRows)
        .slice(0, size);

    return {
      exactRows,
      foldedRows,
      subphraseRows,
      scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
    };
  }
}

function firstMatchingAliasRows(
  queries: string[],
  rowsForQuery: (query: string) => LocalAliasRow[]
): LocalAliasRow[] {
  const rowsByKey = new Map<string, LocalAliasRow>();

  for (let queryPriority = 0; queryPriority < queries.length; queryPriority += 1) {
    const query = queries[queryPriority] ?? '';
    const queryRows = rowsForQuery(query);

    if (queryRows.length === 0) {
      continue;
    }

    for (const row of queryRows) {
      const key = `${row.graph_node_id}\0${row.localeCode}\0${row.alias_role}\0${row.normalized_alias}\0${row.alias}`;
      const existing = rowsByKey.get(key);

      if (!existing || queryPriority < (existing.queryPriority ?? Number.POSITIVE_INFINITY)) {
        rowsByKey.set(key, {
          ...row,
          alias_authority_score: (row.alias_authority_score ?? 0) + 50,
          weight: Math.min((row.weight ?? 1) + 0.2, 1),
          queryPriority
        });
      }
    }

    break;
  }

  return Array.from(rowsByKey.values());
}

export class RuntimeCacheOccupationRetriever implements OccupationTextRetrievalEngine {
  public async retrieve(options: OccupationTextRetrievalOptions): Promise<OccupationTextHit[]> {
    const index = await loadRuntimeCacheIndex(options.sourceName);
    return retrieveTextHits(index, options);
  }

  public async retrieveCanonicalLabels(
    options: OccupationTextRetrievalOptions & { foldedQueries: string[] }
  ): Promise<CanonicalLabelHit[]> {
    const index = await loadRuntimeCacheIndex(options.sourceName);
    const values = uniqueNonEmpty(options.foldedQueries);

    if (values.length === 0) {
      return [];
    }

    return values
      .flatMap((value) => index.canonicalByLocaleAndFoldedLabel.get(localeValueKey(options.locale, value)) ?? [])
      .sort((left, right) => left.canonicalLabel.localeCompare(right.canonicalLabel) || left.graphNodeId - right.graphNodeId)
      .slice(0, Math.max(options.limit * 4, 25));
  }

  public async retrieveWithinFamily(options: FamilyOccupationTextRetrievalOptions): Promise<OccupationTextHit[]> {
    const index = await loadRuntimeCacheIndex(options.sourceName);
    return retrieveTextHits(index, options, options.familyNodeId);
  }
}

async function loadRuntimeCacheIndex(sourceName: string): Promise<RuntimeCacheIndex> {
  const cached = INDEX_CACHE.get(sourceName);

  if (cached) {
    return cached;
  }

  const loading = buildRuntimeCacheIndex(sourceName);
  INDEX_CACHE.set(sourceName, loading);
  return loading;
}

async function buildRuntimeCacheIndex(sourceName: string): Promise<RuntimeCacheIndex> {
  const artifactEntry = await loadOccupationSearchMetaArtifactRequired(sourceName);
  const records = await hydrateAllRuntimeSearchMetaRecords(artifactEntry, artifactEntry.artifact.records);
  const aliasRows = buildAliasRows(records);
  const textRecords = records.map(buildTextRecord);
  const aliasRowsByLocaleAndToken = buildAliasTokenPostings(aliasRows);
  const textRecordIndexesByLocaleFieldAndToken = buildTextFieldTokenPostings(textRecords);
  const exactAliasesByLocaleAndValue = new Map<string, LocalAliasRow[]>();
  const foldedAliasesByLocaleAndValue = new Map<string, LocalAliasRow[]>();
  const canonicalByLocaleAndFoldedLabel = new Map<string, CanonicalLabelHit[]>();

  for (const row of aliasRows) {
    if (SEARCH_ALIAS_ROLES.has(row.alias_role as SearchAliasRole)) {
      pushMap(exactAliasesByLocaleAndValue, localeValueKey(row.localeCode, row.normalized_alias), row);
      pushMap(foldedAliasesByLocaleAndValue, localeValueKey(row.localeCode, foldSearchText(row.normalized_alias)), row);
    }
  }

  for (const record of textRecords) {
    const hit = {
      graphNodeId: record.graphNodeId,
      canonicalLabel: record.canonicalLabel,
      normalizedLabel: record.normalizedLabel
    };

    for (const locale of record.localeCodes) {
      pushMap(canonicalByLocaleAndFoldedLabel, localeValueKey(locale, foldSearchText(record.normalizedLabel)), hit);
    }
  }

  sortMapValues(exactAliasesByLocaleAndValue, compareAliasRows);
  sortMapValues(foldedAliasesByLocaleAndValue, compareAliasRows);

  return {
    textRecords,
    aliasRowsByLocaleAndToken,
    textRecordIndexesByLocaleFieldAndToken,
    exactAliasesByLocaleAndValue,
    foldedAliasesByLocaleAndValue,
    canonicalByLocaleAndFoldedLabel
  };
}

async function retrieveTextHits(
  index: RuntimeCacheIndex,
  options: OccupationTextRetrievalOptions,
  familyNodeId?: number
): Promise<OccupationTextHit[]> {
  const size = Math.max(options.limit * (familyNodeId === undefined ? 4 : 1), 25);
  const preparedQuery = await prepareQuery(options.query, options.locale, { sourceName: options.sourceName });
  const queryTokens = preparedQuery.foldedTokens;
  const authorityMatches = buildAuthorityMatches(options.query, preparedQuery);
  const candidateRecords = candidateTextRecords(index, options.locale, preparedQuery.foldedTokens, familyNodeId).filter((record) =>
    record.localeCodes.has(options.locale) &&
    (familyNodeId === undefined || record.familyNodeId === familyNodeId)
  );
  const scoredHits = candidateRecords
    .map((record) => scoreTextRecord(record, authorityMatches, queryTokens, options.locale))
    .filter((hit): hit is ScoredLocalTextHit => hit !== null);
  const maxRawScore = Math.max(...scoredHits.map((hit) => hit.rawScore), 0);

  return scoredHits
    .map((hit) => toOccupationTextHit(hit, maxRawScore))
    .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
    .slice(0, size);
}

function buildAliasRows(records: RuntimeSearchMetaRecord[]): LocalAliasRow[] {
  const rows: LocalAliasRow[] = [];

  for (const record of records) {
    for (const alias of record.aliases) {
      if (!SEARCH_ALIAS_ROLES.has(alias.aliasRole as SearchAliasRole)) {
        continue;
      }

      const normalizedAlias = alias.normalizedAlias || normalizeSearchText(alias.alias);
      const aliasRoleRank = ALIAS_ROLE_RANK[alias.aliasRole];
      const aliasWeight = alias.weight;

      rows.push({
        graph_node_id: record.graphNodeId,
        canonical_label: record.canonicalLabel,
        alias: alias.alias,
        normalized_alias: normalizedAlias,
        alias_role: alias.aliasRole,
        alias_role_rank: aliasRoleRank,
        weight: aliasWeight,
        alias_authority_score: aliasRoleRank * ALIAS_AUTHORITY_WEIGHT_SCALE + (aliasWeight ?? 0),
        alias_token_count: tokenizeNormalizedText(normalizedAlias || alias.alias).length,
        localeCode: alias.localeCode,
        aliasTextTokens: tokenizeNormalizedText(foldSearchText(normalizedAlias || alias.alias))
      });
    }
  }

  return rows;
}

function buildTextRecord(record: RuntimeSearchMetaRecord, index = 0): LocalTextRecord {
  const aliasBundle = buildAliasBundle(record.aliases);
  const ancestors = record.ancestors.map((ancestor) => ancestor.canonicalLabel);
  const capabilityLabels = record.capabilityLabels.map((capability) => capability.label);
  const searchText = uniqueValues([
    record.canonicalLabel,
    ...aliasBundle.aliases,
    record.familyLabel ?? '',
    record.groupLabel ?? '',
    record.parentLabel ?? '',
    ...ancestors
  ]).join('\n');

  const fieldData = textFields({
    canonical_label: record.canonicalLabel,
    locale_primary_aliases_text: aliasBundle.roleAliases.locale_primary.join('\n'),
    locale_supporting_aliases_text: aliasBundle.roleAliases.locale_supporting.join('\n'),
    reviewed_crosswalk_aliases_text: aliasBundle.roleAliases.reviewed_crosswalk.join('\n'),
    family_supporting_aliases_text: aliasBundle.roleAliases.family_supporting.join('\n'),
    english_backbone_aliases_text: aliasBundle.roleAliases.english_backbone.join('\n'),
    aliases_text: aliasBundle.aliases.join('\n'),
    search_text: searchText,
    capability_text: uniqueValues(capabilityLabels).join('\n'),
    ancestor_text: uniqueValues(ancestors).join('\n')
  });

  return {
    index,
    graphNodeId: record.graphNodeId,
    canonicalLabel: record.canonicalLabel,
    normalizedLabel: normalizeSearchText(record.canonicalLabel),
    familyNodeId: record.familyNodeId,
    localeCodes: aliasBundle.localeCodes,
    ...fieldData,
    allTokens: Array.from(new Set(Object.values(fieldData.fieldTokens).flat())).sort()
  };
}

function textFields(
  fields: Record<OccupationTextField, string>
): Pick<LocalTextRecord, 'fields' | 'fieldTokens' | 'fieldTokenText' | 'fieldTokenSets' | 'fieldTokensByPrefix'> {
  const fieldTokens = mapTextFields((field) => tokenizeField(fields[field]));

  return {
    fields,
    fieldTokens,
    fieldTokenText: mapTextFields((field) => tokenPhraseText(fieldTokens[field])),
    fieldTokenSets: mapTextFields((field) => new Set(fieldTokens[field])),
    fieldTokensByPrefix: mapTextFields((field) => buildTokenPrefixMap(fieldTokens[field]))
  };
}

function mapTextFields<Value>(callback: (field: OccupationTextField) => Value): Record<OccupationTextField, Value> {
  return Object.fromEntries(TEXT_FIELDS.map((field) => [field, callback(field)])) as Record<OccupationTextField, Value>;
}

function tokenizeField(value: string): string[] {
  return tokenizeNormalizedText(foldSearchText(value));
}

function tokenPhraseText(tokens: string[]): string {
  return ` ${tokens.join(' ')} `;
}

function buildTokenPrefixMap(tokens: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const token of new Set(tokens)) {
    pushMap(map, token.slice(0, 3), token);
  }

  return map;
}

function buildAliasBundle(aliases: RuntimeAliasRecord[]): {
  localeCodes: Set<string>;
  aliases: string[];
  roleAliases: Record<AliasRole, string[]>;
} {
  const localeCodes = new Set<string>();
  const aliasesText: string[] = [];
  const aliasSeen = new Set<string>();
  const roleAliases: Record<AliasRole, string[]> = {
    locale_primary: [],
    locale_supporting: [],
    reviewed_crosswalk: [],
    family_supporting: [],
    english_backbone: []
  };
  const roleSeen = new Set<string>();

  for (const row of aliases) {
    const alias = row.alias.trim();

    if (!alias) {
      continue;
    }

    if (row.aliasRole !== 'family_supporting') {
      localeCodes.add(row.localeCode);

      if (!aliasSeen.has(alias)) {
        aliasSeen.add(alias);
        aliasesText.push(alias);
      }
    }

    const roleKey = `${row.aliasRole}\0${alias}`;

    if (!roleSeen.has(roleKey)) {
      roleSeen.add(roleKey);
      roleAliases[row.aliasRole].push(alias);
    }
  }

  return {
    localeCodes,
    aliases: aliasesText,
    roleAliases
  };
}

function buildAliasTokenPostings(aliasRows: LocalAliasRow[]): Map<string, LocalAliasRow[]> {
  const postings = new Map<string, LocalAliasRow[]>();

  for (const row of aliasRows) {
    if (!SEARCH_ALIAS_ROLES.has(row.alias_role as SearchAliasRole)) {
      continue;
    }

    for (const token of new Set(row.aliasTextTokens)) {
      pushMap(postings, localeValueKey(row.localeCode, token), row);
    }
  }

  return postings;
}

function buildTextFieldTokenPostings(records: LocalTextRecord[]): Map<string, number[]> {
  const postings = new Map<string, number[]>();

  for (const record of records) {
    for (const locale of record.localeCodes) {
      for (const field of TEXT_FIELDS) {
        for (const token of record.fieldTokenSets[field]) {
          pushMap(postings, localeFieldValueKey(locale, field, token), record.index);
        }
      }
    }
  }

  return postings;
}

function candidateAliasRows(index: RuntimeCacheIndex, locale: string, phraseWindowTokens: string[][]): LocalAliasRow[] {
  const rows = new Map<string, LocalAliasRow>();
  const tokens = Array.from(new Set(phraseWindowTokens.flat()));

  for (const token of tokens) {
    for (const row of index.aliasRowsByLocaleAndToken.get(localeValueKey(locale, token)) ?? []) {
      rows.set(`${row.graph_node_id}\0${row.localeCode}\0${row.alias_role}\0${row.normalized_alias}\0${row.alias}`, row);
    }
  }

  return Array.from(rows.values());
}

function candidateTextRecords(
  index: RuntimeCacheIndex,
  locale: string,
  queryTokens: string[],
  familyNodeId: number | undefined
): LocalTextRecord[] {
  return tieredCandidateTextRecords(index, locale, queryTokens, familyNodeId);
}

function tieredCandidateTextRecords(
  index: RuntimeCacheIndex,
  locale: string,
  queryTokens: string[],
  familyNodeId: number | undefined
): LocalTextRecord[] {
  const selectedIndexes = new Set<number>();
  const limit = familyNodeId === undefined ? MAX_GLOBAL_TEXT_CANDIDATES : MAX_FAMILY_TEXT_CANDIDATES;
  const uniqueTokens = Array.from(new Set(queryTokens.filter(Boolean)));
  const usefulTokens = uniqueTokens.filter((token) => isUsefulQueryToken(token, locale));
  const authorityTokens = usefulTokens.length > 0 ? usefulTokens : uniqueTokens;
  const titleAndAliasFields: OccupationTextField[] = [
    'canonical_label',
    'locale_primary_aliases_text',
    'locale_supporting_aliases_text',
    'reviewed_crosswalk_aliases_text',
    'aliases_text',
    'family_supporting_aliases_text',
    'english_backbone_aliases_text'
  ];

  for (const field of titleAndAliasFields) {
    appendAllTermFieldCandidates(index, selectedIndexes, locale, field, authorityTokens, familyNodeId, limit);
  }

  for (const field of titleAndAliasFields) {
    appendUnionFieldCandidates(index, selectedIndexes, locale, field, authorityTokens, familyNodeId, limit);
  }

  const broadFields: OccupationTextField[] = ['search_text', 'capability_text', 'ancestor_text'];

  for (const field of broadFields) {
    appendUnionFieldCandidates(index, selectedIndexes, locale, field, authorityTokens, familyNodeId, limit);
  }

  return Array.from(selectedIndexes)
    .map((recordIndex) => index.textRecords[recordIndex])
    .filter((record): record is LocalTextRecord => Boolean(record));
}

function appendAllTermFieldCandidates(
  index: RuntimeCacheIndex,
  selectedIndexes: Set<number>,
  locale: string,
  field: OccupationTextField,
  queryTokens: string[],
  familyNodeId: number | undefined,
  limit: number
): void {
  const postings = queryTokens
    .map((token) => index.textRecordIndexesByLocaleFieldAndToken.get(localeFieldValueKey(locale, field, token)) ?? [])
    .filter((values) => values.length > 0)
    .sort((left, right) => left.length - right.length);

  if (postings.length !== queryTokens.length) {
    return;
  }

  const [smallest = [], ...rest] = postings;
  const restSets = rest.map((values) => new Set(values));

  for (const recordIndex of smallest) {
    if (!restSets.every((values) => values.has(recordIndex))) {
      continue;
    }

    appendCandidateIndex(index, selectedIndexes, recordIndex, familyNodeId, limit);

    if (selectedIndexes.size >= limit) {
      return;
    }
  }
}

function appendUnionFieldCandidates(
  index: RuntimeCacheIndex,
  selectedIndexes: Set<number>,
  locale: string,
  field: OccupationTextField,
  queryTokens: string[],
  familyNodeId: number | undefined,
  limit: number
): void {
  for (const token of queryTokens) {
    const postings = index.textRecordIndexesByLocaleFieldAndToken.get(localeFieldValueKey(locale, field, token)) ?? [];

    for (const recordIndex of postings) {
      appendCandidateIndex(index, selectedIndexes, recordIndex, familyNodeId, limit);

      if (selectedIndexes.size >= limit) {
        return;
      }
    }
  }
}

function appendCandidateIndex(
  index: RuntimeCacheIndex,
  selectedIndexes: Set<number>,
  recordIndex: number,
  familyNodeId: number | undefined,
  limit: number
): void {
  if (selectedIndexes.size >= limit || selectedIndexes.has(recordIndex)) {
    return;
  }

  const record = index.textRecords[recordIndex];

  if (!record || (familyNodeId !== undefined && record.familyNodeId !== familyNodeId)) {
    return;
  }

  selectedIndexes.add(recordIndex);
}

function buildAuthorityMatches(rawQuery: string, preparedQuery: PreparedQuery): LocalAuthorityMatch[] {
  const preparedUsefulQuery = preparedQuery.usefulTokens.join(' ').trim();
  const preparedFoldedUsefulQuery = preparedQuery.usefulFoldedTokens.join(' ').trim();
  const preparedPhraseWindows = buildPreparedPhraseWindows(preparedQuery);
  const preparedQueries = Array.from(new Set([preparedUsefulQuery, preparedFoldedUsefulQuery].filter(Boolean)));
  const rawQueries = Array.from(new Set([rawQuery.trim(), preparedQuery.normalized, preparedQuery.folded].filter(Boolean)));
  const matches: LocalAuthorityMatch[] = [];

  preparedPhraseWindows.forEach((phraseWindow, index) => {
    const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;

    matches.push(
      authorityMatch(`authority_010_prepared_primary_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_PRIMARY_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['locale_primary_aliases_text']),
      authorityMatch(`authority_020_prepared_canonical_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_CANONICAL_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['canonical_label']),
      authorityMatch(`authority_030_prepared_supporting_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_SUPPORTING_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['locale_supporting_aliases_text']),
      authorityMatch(`authority_040_prepared_reviewed_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_REVIEWED_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['reviewed_crosswalk_aliases_text']),
      authorityMatch(`authority_045_prepared_family_support_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_FAMILY_SUPPORT_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['family_supporting_aliases_text']),
      authorityMatch(`authority_050_prepared_backbone_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_BACKBONE_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['english_backbone_aliases_text'])
    );
  });

  for (const query of rawQueries) {
    matches.push(
      authorityMatch('authority_060_raw_primary_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_PRIMARY_OR_CANONICAL_PHRASE, query, 'phrase', ['locale_primary_aliases_text', 'canonical_label']),
      authorityMatch('authority_070_raw_supporting_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, 'phrase', ['locale_supporting_aliases_text', 'reviewed_crosswalk_aliases_text', 'family_supporting_aliases_text', 'english_backbone_aliases_text'])
    );
  }

  for (const query of preparedQueries) {
    matches.push(
      authorityMatch('authority_080_prepared_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, 'all_terms', ['locale_primary_aliases_text', 'canonical_label', 'locale_supporting_aliases_text', 'reviewed_crosswalk_aliases_text', 'family_supporting_aliases_text', 'english_backbone_aliases_text', 'aliases_text', 'search_text', 'capability_text']),
      authorityMatch('authority_090_strict_fuzzy', OPENSEARCH_AUTHORITY_SCORE.STRICT_FUZZY, query, 'fuzzy', ['locale_primary_aliases_text', 'canonical_label', 'locale_supporting_aliases_text', 'reviewed_crosswalk_aliases_text', 'family_supporting_aliases_text', 'english_backbone_aliases_text', 'aliases_text'])
    );
  }

  for (const query of rawQueries) {
    matches.push(
      authorityMatch('authority_100_raw_all_terms', OPENSEARCH_AUTHORITY_SCORE.RAW_ALL_TERMS, query, 'all_terms', ['aliases_text', 'search_text', 'capability_text', 'ancestor_text'])
    );
  }

  return matches;
}

function authorityMatch(
  name: string,
  score: number,
  query: string,
  type: LocalAuthorityMatch['type'],
  fields: OccupationTextField[]
): LocalAuthorityMatch {
  return { name, score, query, queryTokens: tokenizeNormalizedText(foldSearchText(query)), type, fields };
}

function scoreTextRecord(
  record: LocalTextRecord,
  authorityMatches: LocalAuthorityMatch[],
  queryTokens: string[],
  locale: string
): ScoredLocalTextHit | null {
  let rawScore = 0;
  const matchedQueries = new Set<string>();
  const matchedFields = new Set<string>();

  for (const match of authorityMatches) {
    if (match.type === 'fuzzy' && rawScore >= OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS) {
      continue;
    }

    const matchedMatchFields = match.fields.filter((field) =>
      fieldMatches(
        record.fieldTokens[field],
        record.fieldTokenText[field],
        record.fieldTokenSets[field],
        record.fieldTokensByPrefix[field],
        match.queryTokens,
        match.type,
        locale
      )
    );

    if (matchedMatchFields.length === 0) {
      continue;
    }

    rawScore = Math.max(rawScore, match.score);
    matchedQueries.add(match.name);

    for (const field of matchedMatchFields) {
      matchedFields.add(field);
    }
  }

  if (rawScore <= 0) {
    return null;
  }

  const fieldSignals = buildFieldSignals(record, queryTokens, locale);
  const matchedTokens = Array.from(new Set(fieldSignals.flatMap((signal) => signal.matchedTokens))).sort();
  const usefulQueryTokenCount = countUsefulTokens(queryTokens, locale);

  return {
    graphNodeId: record.graphNodeId,
    canonicalLabel: record.canonicalLabel,
    rawScore: roundScore(rawScore),
    matchedQueries: Array.from(matchedQueries).sort(),
    matchedFields: Array.from(matchedFields).sort(),
    fieldSignals,
    matchedTokens,
    phraseMatch: fieldSignals.some((signal) => signal.phraseMatch),
    maxUsefulTokenCoverage: roundScore(Math.max(...fieldSignals.map((signal) => signal.usefulTokenCoverage), 0)),
    queryTokenCount: queryTokens.length,
    usefulQueryTokenCount
  };
}

function fieldMatches(
  fieldTokens: string[],
  fieldTokenText: string,
  fieldTokenSet: Set<string>,
  fieldTokensByPrefix: Map<string, string[]>,
  queryTokens: string[],
  type: LocalAuthorityMatch['type'],
  locale: string
): boolean {
  if (fieldTokens.length === 0 || queryTokens.length === 0) {
    return false;
  }

  if (type === 'phrase') {
    return tokenTextContainsPhrase(fieldTokenText, queryTokens);
  }

  if (type === 'all_terms') {
    return queryTokens.every((token) => fieldTokenSet.has(token));
  }

  return queryTokens.every((queryToken) =>
    (fieldTokensByPrefix.get(queryToken.slice(0, 3)) ?? []).some((fieldToken) => editDistanceAtMostOne(fieldToken, queryToken))
  );
}

function buildFieldSignals(record: LocalTextRecord, queryTokens: string[], locale: string): OccupationTextFieldSignal[] {
  return TEXT_FIELDS
    .map((field) =>
      buildFieldSignal(field, record.fieldTokens[field], record.fieldTokenText[field], record.fieldTokenSets[field], queryTokens, locale)
    )
    .filter((signal): signal is OccupationTextFieldSignal => signal !== null);
}

function buildFieldSignal(
  field: OccupationTextField,
  fieldTokens: string[],
  fieldTokenText: string,
  fieldTokenSet: Set<string>,
  queryTokens: string[],
  locale: string
): OccupationTextFieldSignal | null {
  const matchedTokens = queryTokens.filter((token) => fieldTokenSet.has(token));

  if (matchedTokens.length === 0) {
    return null;
  }

  const usefulQueryTokens = queryTokens.filter((token) => isUsefulQueryToken(token, locale));
  const usefulMatchedTokens = matchedTokens.filter((token) => isUsefulQueryToken(token, locale));
  const phraseMatch = tokenTextContainsPhrase(fieldTokenText, queryTokens) ||
    (fieldTokens.length <= queryTokens.length && containsTokenPhrase(queryTokens, fieldTokens, locale));

  return {
    field,
    fieldClass: fieldClassForField(field),
    ...(aliasRoleForField(field) ? { aliasRole: aliasRoleForField(field) } : {}),
    phraseMatch,
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

function tokenTextContainsPhrase(fieldTokenText: string, queryTokens: string[]): boolean {
  return queryTokens.length > 0 && fieldTokenText.includes(tokenPhraseText(queryTokens));
}

function toOccupationTextHit(hit: ScoredLocalTextHit, maxRawScore: number): OccupationTextHit {
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

function calculateLexicalSignalScore(hit: ScoredLocalTextHit): number {
  const usefulCoverage = hit.usefulQueryTokenCount > 0 ? hit.maxUsefulTokenCoverage : maxTokenCoverage(hit.fieldSignals);
  const usefulFieldStrength = Math.max(
    ...hit.fieldSignals
      .filter((signal) => signal.usefulMatchedTokenCount > 0 || hit.usefulQueryTokenCount === 0)
      .map((signal) => fieldStrength(signal.fieldClass)),
    0
  );
  const phraseBoost = hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.PHRASE_MATCH_BONUS : 0;
  const shortNonPhraseCap = hit.usefulQueryTokenCount <= 2 && !hit.phraseMatch
    ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.SHORT_NON_PHRASE_CAP
    : 1;
  const score = OPENSEARCH_LEXICAL_SIGNAL_POLICY.BASE_SIGNAL +
    usefulCoverage * OPENSEARCH_LEXICAL_SIGNAL_POLICY.USEFUL_COVERAGE_WEIGHT +
    usefulFieldStrength * OPENSEARCH_LEXICAL_SIGNAL_POLICY.FIELD_STRENGTH_WEIGHT +
    phraseBoost;

  return roundScore(Math.max(OPENSEARCH_LEXICAL_SIGNAL_POLICY.MIN_SIGNAL, Math.min(shortNonPhraseCap, score)));
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
      const query = tokens.slice(start, start + windowSize).join(' ').trim();

      if (!query || seen.has(query)) {
        continue;
      }

      seen.add(query);
      windows.push({ query, tokenCount: windowSize });
    }
  }
}

function buildAliasPhraseWindows(preparedQuery: PreparedQuery): string[] {
  const windows: string[] = [];
  const seen = new Set<string>();

  appendAliasPhraseWindows(windows, seen, preparedQuery.usefulFoldedTokens);
  appendAliasPhraseWindows(windows, seen, preparedQuery.usefulTokens);

  return windows.slice(0, MAX_PHRASE_WINDOW_COUNT);
}

function appendAliasPhraseWindows(windows: string[], seen: Set<string>, tokens: string[]): void {
  if (tokens.length === 1) {
    const token = tokens[0]?.trim();

    if (token && token.length >= MIN_SINGLE_TOKEN_PHRASE_LENGTH && !seen.has(token)) {
      seen.add(token);
      windows.push(token);
    }

    return;
  }

  if (tokens.length < 2) {
    return;
  }

  for (let windowSize = tokens.length; windowSize >= 2; windowSize -= 1) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      const window = tokens.slice(start, start + windowSize).join(' ').trim();

      if (!window || seen.has(window)) {
        continue;
      }

      seen.add(window);
      windows.push(window);
    }
  }
}

function phraseWindowAuthorityScore(baseScore: number, phraseWindow: PreparedPhraseWindow): number {
  const tokenBonus = Math.min(
    phraseWindow.tokenCount * OPENSEARCH_PHRASE_WINDOW_POLICY.TOKEN_AUTHORITY_INCREMENT,
    OPENSEARCH_PHRASE_WINDOW_POLICY.MAX_TOKEN_AUTHORITY_BONUS
  );

  return baseScore + tokenBonus;
}

function fieldClassForField(field: OccupationTextField): OccupationTextFieldSignal['fieldClass'] {
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

function aliasRoleForField(field: OccupationTextField): OccupationTextFieldSignal['aliasRole'] | undefined {
  if (field === 'locale_primary_aliases_text') {
    return 'locale_primary';
  }

  if (field === 'locale_supporting_aliases_text') {
    return 'locale_supporting';
  }

  if (field === 'reviewed_crosswalk_aliases_text') {
    return 'reviewed_crosswalk';
  }

  if (field === 'family_supporting_aliases_text') {
    return 'family_supporting';
  }

  if (field === 'english_backbone_aliases_text') {
    return 'english_backbone';
  }

  if (field === 'aliases_text') {
    return 'combined';
  }

  return undefined;
}

function fieldStrength(fieldClass: OccupationTextFieldSignal['fieldClass']): number {
  if (fieldClass === 'title') {
    return OPENSEARCH_FIELD_STRENGTH.TITLE;
  }

  if (fieldClass === 'alias') {
    return OPENSEARCH_FIELD_STRENGTH.ALIAS;
  }

  if (fieldClass === 'search_text') {
    return OPENSEARCH_FIELD_STRENGTH.SEARCH_TEXT;
  }

  if (fieldClass === 'capability') {
    return OPENSEARCH_FIELD_STRENGTH.CAPABILITY;
  }

  if (fieldClass === 'family_alias') {
    return OPENSEARCH_FIELD_STRENGTH.FAMILY_ALIAS;
  }

  return OPENSEARCH_FIELD_STRENGTH.ANCESTOR;
}

function maxTokenCoverage(signals: OccupationTextFieldSignal[]): number {
  return Math.max(...signals.map((signal) => signal.tokenCoverage), 0);
}

function countUsefulTokens(tokens: string[], locale: string): number {
  return tokens.filter((token) => isUsefulQueryToken(token, locale)).length;
}

function compareAliasRows(left: LocalAliasRow, right: LocalAliasRow): number {
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

function compareAliasRowsWithQueryPriority(left: LocalAliasRow, right: LocalAliasRow): number {
  return (
    (left.queryPriority ?? Number.POSITIVE_INFINITY) - (right.queryPriority ?? Number.POSITIVE_INFINITY) ||
    compareAliasRows(left, right)
  );
}

function localeValueKey(locale: string, value: string): string {
  return `${locale}\0${value}`;
}

function localeFieldValueKey(locale: string, field: OccupationTextField, value: string): string {
  return `${locale}\0${field}\0${value}`;
}

function pushMap<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues<Value>(map: Map<string, Value[]>, compare: (left: Value, right: Value) => number): void {
  for (const values of map.values()) {
    values.sort(compare);
  }
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
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

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }

  let edits = 0;
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;

    if (edits > 1) {
      return false;
    }

    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return true;
}
