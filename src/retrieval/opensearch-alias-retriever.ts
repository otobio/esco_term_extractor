import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig, type OpenSearchConfig } from '../opensearch/config.js';
import { DEFAULT_SEARCH_ALIAS_ROLES } from '../query/alias-role-policy.js';
import { foldWeakPunctuationLookupText } from '../utils/texts.js';
import { buildAuthorityQueryPreparation } from './authority-query-preparation.js';
import type { AliasEvidenceRow, AliasRetrievalEngine, AliasRetrievalOptions, AliasRetrievalResult } from './retrieval-engine.js';

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

const DEFAULT_ALIAS_SEARCH_SIZE = 1000;

export class OpenSearchAliasRetriever implements AliasRetrievalEngine {
  public constructor(
    private readonly client: OpenSearchClient = new OpenSearchClient(getOpenSearchConfig()),
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async retrieve(options: OpenSearchAliasRetrieverOptions): Promise<OpenSearchAliasRetrieverResult> {
    const size = Math.max(DEFAULT_ALIAS_SEARCH_SIZE, options.limit * 25);
    const authorityPreparation = buildAuthorityQueryPreparation(options.preparedQuery);
    const requests = buildAliasSearchRequests(options, size, authorityPreparation.aliasPhraseWindows);
    const rowsByChannel = await this.searchAliasRows(requests);
    const exactRows = rowsByChannel.exact ?? [];
    const foldedRows = rowsByChannel.folded ?? [];
    const subphraseRows = rowsByChannel.subphrase?.length
      ? rowsByChannel.subphrase
      : await this.searchFallbackSubphraseRows(options, size, authorityPreparation.aliasFallbackPhraseWindows);

    return {
      exactRows,
      foldedRows,
      subphraseRows,
      scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
    };
  }

  private async searchFallbackSubphraseRows(
    options: OpenSearchAliasRetrieverOptions,
    size: number,
    fallbackWindows: string[]
  ): Promise<OpenSearchAliasEvidenceRow[]> {
    // A multi-token query only ever searches its full-width phrase window, so it can regress to zero
    // alias evidence even when its head word alone would have matched broadly (e.g. "security personnel").
    if (fallbackWindows.length === 0) {
      return [];
    }

    const fallbackRows = await this.searchAliasRows(buildSubphraseSearchRequests(options, size, fallbackWindows));
    return fallbackRows.subphrase ?? [];
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

function buildAliasSearchRequests(options: OpenSearchAliasRetrieverOptions, size: number, phraseWindows: string[]): AliasSearchRequest[] {
  const requests: AliasSearchRequest[] = [];
  const exactValues = expandWeakPunctuationQueries(options.exactAliasQueries);
  const foldedValues = expandWeakPunctuationQueries(options.foldedAliasQueries);

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

  requests.push(...buildSubphraseSearchRequests(options, size, phraseWindows));

  return requests;
}

function buildSubphraseSearchRequests(
  options: OpenSearchAliasRetrieverOptions,
  size: number,
  phraseWindows: string[]
): AliasSearchRequest[] {
  if (phraseWindows.length === 0) {
    return [];
  }

  return [
    {
      channel: 'subphrase',
      body: aliasSearchBody(size, phraseAliasCandidateQuery(options, phraseWindows))
    }
  ];
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
    .flatMap((request) => [JSON.stringify({}), JSON.stringify(request.body)])
    .join('\n')
    .concat('\n');
}

function toAliasEvidenceRows(response: AliasSearchResponse | undefined): OpenSearchAliasEvidenceRow[] {
  return (response?.hits?.hits ?? []).map(toAliasEvidenceRow).filter((row): row is OpenSearchAliasEvidenceRow => row !== null);
}

function sourceFilter(sourceName: string): Record<string, unknown> {
  return { term: { source_name: sourceName } };
}

function localeFilter(locale: string): Record<string, unknown> {
  return { term: { locale_code: locale } };
}

function roleFilter(): Record<string, unknown> {
  return { terms: { alias_role: [...DEFAULT_SEARCH_ALIAS_ROLES] } };
}

function aliasScopeFilters(options: Pick<OpenSearchAliasRetrieverOptions, 'sourceName' | 'locale'>): Record<string, unknown>[] {
  return [sourceFilter(options.sourceName), localeFilter(options.locale), roleFilter()];
}

function exactAliasQuery(options: OpenSearchAliasRetrieverOptions, values: string[]): Record<string, unknown> {
  return {
    bool: {
      filter: [...aliasScopeFilters(options), { terms: { normalized_alias_exact: values } }]
    }
  };
}

function foldedAliasQuery(options: OpenSearchAliasRetrieverOptions, values: string[]): Record<string, unknown> {
  return {
    bool: {
      filter: [...aliasScopeFilters(options), { terms: { normalized_alias: values } }]
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

  if (!Number.isInteger(graphNodeId) || !canonicalLabel || !alias || !normalizedAlias || !aliasRole) {
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

function expandWeakPunctuationQueries(values: string[]): string[] {
  return uniqueNonEmpty(values.flatMap((value) => [value, foldWeakPunctuationLookupText(value)]));
}
