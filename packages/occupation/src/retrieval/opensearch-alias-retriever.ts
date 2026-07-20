import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig, type OpenSearchConfig } from '../opensearch/config.js';
import type {
  AliasEvidenceRow,
  AliasRetrievalEngine,
  AliasRetrievalOptions,
  AliasRetrievalResult
} from './retrieval-engine.js';

export type OpenSearchAliasEvidenceRow = AliasEvidenceRow;
export type OpenSearchAliasRetrieverOptions = AliasRetrievalOptions;
export type OpenSearchAliasRetrieverResult = AliasRetrievalResult;

type AliasSearchResponse = {
  hits?: {
    hits?: AliasSearchHit[];
  };
};

type AliasMultiSearchResponse = {
  responses?: AliasSearchResponse[];
};

type AliasSearchChannel = 'exact' | 'folded' | 'subphrase';

type AliasSearchRequest = {
  channel: AliasSearchChannel;
  body: Record<string, unknown>;
};

type AliasSearchHit = {
  _source?: {
    graph_node_id?: number;
    canonical_label?: string;
    alias?: string;
    normalized_alias?: string;
    alias_role?: string;
    alias_role_rank?: number | null;
    alias_weight?: number | null;
    alias_authority_score?: number | null;
    alias_token_count?: number | null;
  };
};

const SEARCH_ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk'] as const;
const DEFAULT_ALIAS_SEARCH_SIZE = 1000;
const MAX_PHRASE_WINDOW_COUNT = 32;
const MIN_SINGLE_TOKEN_PHRASE_LENGTH = 6;

export class OpenSearchAliasRetriever implements AliasRetrievalEngine {
  public constructor(
    private readonly client: OpenSearchClient = new OpenSearchClient(getOpenSearchConfig()),
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async retrieve(options: OpenSearchAliasRetrieverOptions): Promise<OpenSearchAliasRetrieverResult> {
    const size = Math.max(DEFAULT_ALIAS_SEARCH_SIZE, options.limit * 25);
    const requests = buildAliasSearchRequests(options, size);
    const rowsByChannel = await this.searchAliasRows(requests);
    const exactRows = rowsByChannel.exact ?? [];
    const foldedRows = rowsByChannel.folded ?? [];
    const subphraseRows = rowsByChannel.subphrase ?? [];

    return {
      exactRows,
      foldedRows,
      subphraseRows,
      scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
    };
  }

  private async searchAliasRows(
    requests: AliasSearchRequest[]
  ): Promise<Partial<Record<AliasSearchChannel, OpenSearchAliasEvidenceRow[]>>> {
    if (requests.length === 0) {
      return {};
    }

    const response = await this.client.post<AliasMultiSearchResponse>(
      `/${encodeURIComponent(this.config.occupationAliasesIndex)}/_msearch`,
      toMultiSearchPayload(requests),
      {
        contentType: 'application/x-ndjson'
      }
    );
    const responses = response.body?.responses ?? [];
    const rowsByChannel: Partial<Record<AliasSearchChannel, OpenSearchAliasEvidenceRow[]>> = {};

    requests.forEach((request, index) => {
      rowsByChannel[request.channel] = toAliasEvidenceRows(responses[index]);
    });

    return rowsByChannel;
  }
}

function buildAliasSearchRequests(options: OpenSearchAliasRetrieverOptions, size: number): AliasSearchRequest[] {
  const requests: AliasSearchRequest[] = [];
  const exactValues = uniqueNonEmpty(options.exactAliasQueries);
  const foldedValues = uniqueNonEmpty(options.foldedAliasQueries);
  const phraseWindows = buildPreparedPhraseWindows(options.preparedQuery);

  if (exactValues.length > 0) {
    requests.push({
      channel: 'exact',
      body: aliasSearchBody(size, exactAliasQuery(options, exactValues))
    });
  }

  if (foldedValues.length > 0) {
    requests.push({
      channel: 'folded',
      body: aliasSearchBody(size, foldedAliasQuery(options, foldedValues))
    });
  }

  if (phraseWindows.length > 0) {
    requests.push({
      channel: 'subphrase',
      body: aliasSearchBody(size, phraseAliasCandidateQuery(options, phraseWindows))
    });
  }

  return requests;
}

function aliasSearchBody(size: number, query: Record<string, unknown>): Record<string, unknown> {
  return {
    size,
    sort: aliasAuthoritySort(),
    query,
    _source: [
      'graph_node_id',
      'canonical_label',
      'alias',
      'normalized_alias',
      'alias_role',
      'alias_role_rank',
      'alias_weight',
      'alias_authority_score',
      'alias_token_count'
    ]
  };
}

function toMultiSearchPayload(requests: AliasSearchRequest[]): string {
  return requests
    .flatMap((request) => [
      JSON.stringify({}),
      JSON.stringify(request.body)
    ])
    .join('\n')
    .concat('\n');
}

function toAliasEvidenceRows(response: AliasSearchResponse | undefined): OpenSearchAliasEvidenceRow[] {
  return (response?.hits?.hits ?? [])
    .map(toAliasEvidenceRow)
    .filter((row): row is OpenSearchAliasEvidenceRow => row !== null);
}

function sourceFilter(sourceName: string): Record<string, unknown> {
  return { term: { source_name: sourceName } };
}

function localeFilter(locale: string): Record<string, unknown> {
  return { term: { locale_code: locale } };
}

function roleFilter(): Record<string, unknown> {
  return { terms: { alias_role: [...SEARCH_ALIAS_ROLES] } };
}

function aliasScopeFilters(options: Pick<OpenSearchAliasRetrieverOptions, 'sourceName' | 'locale'>): Record<string, unknown>[] {
  return [
    sourceFilter(options.sourceName),
    localeFilter(options.locale),
    roleFilter()
  ];
}

function exactAliasQuery(options: OpenSearchAliasRetrieverOptions, values: string[]): Record<string, unknown> {
  return {
    bool: {
      filter: [
        ...aliasScopeFilters(options),
        { terms: { normalized_alias_exact: values } }
      ]
    }
  };
}

function foldedAliasQuery(options: OpenSearchAliasRetrieverOptions, values: string[]): Record<string, unknown> {
  return {
    bool: {
      filter: [
        ...aliasScopeFilters(options),
        { terms: { normalized_alias: values } }
      ]
    }
  };
}

function phraseAliasCandidateQuery(options: OpenSearchAliasRetrieverOptions, phraseWindows: string[]): Record<string, unknown> {
  return {
    constant_score: {
      filter: {
        bool: {
          filter: aliasScopeFilters(options),
          should: phraseWindows.map((phraseWindow, index) => ({
            match_phrase: {
              alias_text: {
                query: phraseWindow,
                _name: phraseWindowName(phraseWindow, index)
              }
            }
          })),
          minimum_should_match: 1
        }
      }
    }
  };
}

function phraseWindowName(phraseWindow: string, index: number): string {
  return `alias_phrase_window_${phraseWindow.split(/\s+/u).length}_${index}`;
}

function aliasAuthoritySort(): Array<Record<string, unknown> | string> {
  return [
    { alias_authority_score: { order: 'desc', missing: '_last' } },
    { alias_role_rank: { order: 'desc', missing: '_last' } },
    { alias_weight: { order: 'desc', missing: '_last' } },
    { alias_token_count: { order: 'asc', missing: '_last' } },
    { 'canonical_label.raw': { order: 'asc' } },
    { graph_node_id: { order: 'asc' } },
    { 'alias.raw': { order: 'asc' } }
  ];
}

function toAliasEvidenceRow(hit: AliasSearchHit): OpenSearchAliasEvidenceRow | null {
  const source = hit._source;

  if (!source) {
    return null;
  }

  const graphNodeId = source.graph_node_id;
  const canonicalLabel = source.canonical_label?.trim();
  const alias = source.alias?.trim();
  const normalizedAlias = source.normalized_alias?.trim();
  const aliasRole = source.alias_role?.trim();

  if (
    !Number.isInteger(graphNodeId) ||
    !canonicalLabel ||
    !alias ||
    !normalizedAlias ||
    !aliasRole
  ) {
    return null;
  }

  return {
    graph_node_id: Number(graphNodeId),
    canonical_label: canonicalLabel,
    alias,
    normalized_alias: normalizedAlias,
    alias_role: aliasRole,
    alias_role_rank: finiteNumberOrNull(source.alias_role_rank),
    weight: finiteNumberOrNull(source.alias_weight),
    alias_authority_score: finiteNumberOrNull(source.alias_authority_score),
    alias_token_count: finiteNumberOrNull(source.alias_token_count)
  };
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildPreparedPhraseWindows(preparedQuery: AliasRetrievalOptions['preparedQuery']): string[] {
  const windows: string[] = [];
  const seen = new Set<string>();

  appendPhraseWindows(windows, seen, preparedQuery.usefulFoldedTokens);
  appendPhraseWindows(windows, seen, preparedQuery.usefulTokens);

  return windows.slice(0, MAX_PHRASE_WINDOW_COUNT);
}

function appendPhraseWindows(windows: string[], seen: Set<string>, tokens: string[]): void {
  if (tokens.length === 1) {
    appendSingleTokenPhraseWindow(windows, seen, tokens[0]);
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

function appendSingleTokenPhraseWindow(windows: string[], seen: Set<string>, token: string | undefined): void {
  const normalized = token?.trim();

  if (!normalized || normalized.length < MIN_SINGLE_TOKEN_PHRASE_LENGTH || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  windows.push(normalized);
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
