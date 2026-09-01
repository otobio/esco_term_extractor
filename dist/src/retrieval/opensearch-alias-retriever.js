import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig } from '../opensearch/config.js';
import { DEFAULT_SEARCH_ALIAS_ROLES } from '../query/alias-role-policy.js';
import { containsTokenPhrase } from '../query/query-preparation.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { buildAuthorityQueryPreparation } from './authority-query-preparation.js';
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
        const authorityPreparation = buildAuthorityQueryPreparation(options.preparedQuery, { retrievalQuery: options.retrievalQuery });
        const requests = buildAliasSearchRequests(options, size, authorityPreparation.aliasPhraseWindows);
        const rowsByChannel = await this.searchAliasRows(requests);
        const exactRows = rowsByChannel.exact ?? [];
        const foldedRows = rowsByChannel.folded ?? [];
        const subphraseRows = mergeOpenSearchAliasRows(rowsByChannel.subphrase ?? [], await this.searchFallbackSubphraseRows(options, size, authorityPreparation.aliasFallbackPhraseWindows)).slice(0, size);
        return {
            exactRows,
            foldedRows,
            subphraseRows,
            scannedAliasHitCount: exactRows.length + foldedRows.length + subphraseRows.length
        };
    }
    async searchFallbackSubphraseRows(options, size, fallbackWindows) {
        // A multi-token query only ever searches its full-width phrase window, so it can regress to zero
        // alias evidence even when its head word alone would have matched broadly (e.g. "security personnel").
        if (fallbackWindows.length === 0) {
            return [];
        }
        const fallbackRows = await this.searchAliasRows(buildSubphraseSearchRequests(options, size, fallbackWindows));
        return annotateMatchedSubphraseWindows(fallbackRows.subphrase ?? [], fallbackWindows);
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
function annotateMatchedSubphraseWindows(rows, phraseWindows) {
    const tokenizedWindows = phraseWindows
        .map((window) => tokenizeNormalizedText(foldSearchText(window)))
        .filter((tokens) => tokens.length > 0);
    if (tokenizedWindows.length === 0) {
        return [...rows];
    }
    return rows.map((row) => {
        const aliasTokens = tokenizeNormalizedText(foldSearchText(row.normalized_alias));
        const matchedWindowTokens = tokenizedWindows.find((tokens) => containsTokenPhrase(aliasTokens, tokens, 'en'));
        if (!matchedWindowTokens) {
            return row;
        }
        return {
            ...row,
            matched_query: matchedWindowTokens.join(' '),
            matched_query_tokens: matchedWindowTokens
        };
    });
}
function mergeOpenSearchAliasRows(...rowSets) {
    const rowsByKey = new Map();
    for (const row of rowSets.flat()) {
        const key = `${row.graph_node_id}\t${row.normalized_alias}\t${row.alias_role}`;
        const existing = rowsByKey.get(key);
        if (!existing || compareOpenSearchAliasRows(row, existing) < 0) {
            rowsByKey.set(key, row);
        }
    }
    return Array.from(rowsByKey.values()).sort(compareOpenSearchAliasRows);
}
function compareOpenSearchAliasRows(left, right) {
    return ((right.alias_authority_score ?? Number.NEGATIVE_INFINITY) - (left.alias_authority_score ?? Number.NEGATIVE_INFINITY) ||
        (right.alias_role_rank ?? Number.NEGATIVE_INFINITY) - (left.alias_role_rank ?? Number.NEGATIVE_INFINITY) ||
        (right.weight ?? Number.NEGATIVE_INFINITY) - (left.weight ?? Number.NEGATIVE_INFINITY) ||
        (left.alias_token_count ?? Number.POSITIVE_INFINITY) - (right.alias_token_count ?? Number.POSITIVE_INFINITY) ||
        left.canonical_label.localeCompare(right.canonical_label) ||
        left.graph_node_id - right.graph_node_id ||
        left.alias.localeCompare(right.alias));
}
function sourceFilter(sourceName) {
    return { term: { source_name: sourceName } };
}
function localeFilter(locale) {
    return { term: { locale_code: locale } };
}
function roleFilter() {
    return { terms: { alias_role: [...DEFAULT_SEARCH_ALIAS_ROLES] } };
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
function expandWeakPunctuationQueries(values) {
    return uniqueNonEmpty(values.flatMap((value) => [value, foldWeakPunctuationLookupText(value)]));
}
