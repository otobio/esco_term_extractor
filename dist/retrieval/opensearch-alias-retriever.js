import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig } from '../opensearch/config.js';
import { buildAliasHeadTokenFallbackWindows, buildAliasPhraseWindows } from './alias-phrase-windows.js';
const SEARCH_ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk'];
const DEFAULT_ALIAS_SEARCH_SIZE = 1000;
export class OpenSearchAliasRetriever {
    client;
    config;
    constructor(client = new OpenSearchClient(getOpenSearchConfig()), config = getOpenSearchConfig()) {
        this.client = client;
        this.config = config;
    }
    async retrieve(options) {
        const size = Math.max(DEFAULT_ALIAS_SEARCH_SIZE, options.limit * 25);
        const requests = buildAliasSearchRequests(options, size, buildAliasPhraseWindows(options.preparedQuery));
        const rowsByChannel = await this.searchAliasRows(requests);
        const exactRows = rowsByChannel.exact ?? [];
        const foldedRows = rowsByChannel.folded ?? [];
        const subphraseRows = rowsByChannel.subphrase?.length
            ? rowsByChannel.subphrase
            : await this.searchFallbackSubphraseRows(options, size);
        return {
            exactRows,
            foldedRows,
            subphraseRows,
            scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
        };
    }
    async searchFallbackSubphraseRows(options, size) {
        // A multi-token query only ever searches its full-width phrase window, so it can regress to zero
        // alias evidence even when its head word alone would have matched broadly (e.g. "security personnel").
        // See buildAliasHeadTokenFallbackWindows for why this is restricted to the head token.
        const fallbackWindows = buildAliasHeadTokenFallbackWindows(options.preparedQuery);
        if (fallbackWindows.length === 0) {
            return [];
        }
        const fallbackRows = await this.searchAliasRows(buildSubphraseSearchRequests(options, size, fallbackWindows));
        return fallbackRows.subphrase ?? [];
    }
    async searchAliasRows(requests) {
        if (requests.length === 0) {
            return {};
        }
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationAliasesIndex)}/_msearch`, toMultiSearchPayload(requests), {
            contentType: 'application/x-ndjson'
        });
        const responses = response.body?.responses ?? [];
        const rowsByChannel = {};
        requests.forEach((request, index) => {
            rowsByChannel[request.channel] = toAliasEvidenceRows(responses[index]);
        });
        return rowsByChannel;
    }
}
function buildAliasSearchRequests(options, size, phraseWindows) {
    const requests = [];
    const exactValues = uniqueNonEmpty(options.exactAliasQueries);
    const foldedValues = uniqueNonEmpty(options.foldedAliasQueries);
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
function buildSubphraseSearchRequests(options, size, phraseWindows) {
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
function aliasSearchBody(size, query) {
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
function toMultiSearchPayload(requests) {
    return requests
        .flatMap((request) => [JSON.stringify({}), JSON.stringify(request.body)])
        .join('\n')
        .concat('\n');
}
function toAliasEvidenceRows(response) {
    return (response?.hits?.hits ?? []).map(toAliasEvidenceRow).filter((row) => row !== null);
}
function sourceFilter(sourceName) {
    return { term: { source_name: sourceName } };
}
function localeFilter(locale) {
    return { term: { locale_code: locale } };
}
function roleFilter() {
    return { terms: { alias_role: [...SEARCH_ALIAS_ROLES] } };
}
function aliasScopeFilters(options) {
    return [sourceFilter(options.sourceName), localeFilter(options.locale), roleFilter()];
}
function exactAliasQuery(options, values) {
    return {
        bool: {
            filter: [...aliasScopeFilters(options), { terms: { normalized_alias_exact: values } }]
        }
    };
}
function foldedAliasQuery(options, values) {
    return {
        bool: {
            filter: [...aliasScopeFilters(options), { terms: { normalized_alias: values } }]
        }
    };
}
function phraseAliasCandidateQuery(options, phraseWindows) {
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
function phraseWindowName(phraseWindow, index) {
    return `alias_phrase_window_${phraseWindow.split(/\s+/u).length}_${index}`;
}
function aliasAuthoritySort() {
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
function toAliasEvidenceRow(hit) {
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
function finiteNumberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function uniqueNonEmpty(values) {
    const unique = new Set();
    for (const value of values) {
        const normalized = value.trim();
        if (normalized) {
            unique.add(normalized);
        }
    }
    return Array.from(unique);
}
