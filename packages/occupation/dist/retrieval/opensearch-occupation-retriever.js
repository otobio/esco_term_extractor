import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig } from '../opensearch/config.js';
import { containsTokenPhrase, foldSearchText, isUsefulQueryToken, prepareQuery, tokenizeNormalizedText } from '../query/query-preparation.js';
import { OPENSEARCH_AUTHORITY_SCORE, OPENSEARCH_FIELD_STRENGTH, OPENSEARCH_LEXICAL_SIGNAL_POLICY, OPENSEARCH_PHRASE_WINDOW_POLICY } from '../scoring/scoring-policy.js';
export class OpenSearchOccupationRetriever {
    client;
    config;
    constructor(client = new OpenSearchClient(getOpenSearchConfig()), config = getOpenSearchConfig()) {
        this.client = client;
        this.config = config;
    }
    async retrieve(options) {
        const size = Math.max(options.limit * 4, 25);
        const preparedQuery = await prepareQuery(options.query, options.locale, { sourceName: options.sourceName });
        const queryTokens = preparedQuery.foldedTokens;
        const authorityQuery = buildAuthorityDisMaxQuery(options.query, preparedQuery);
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationsIndex)}/_search`, {
            size,
            _source: [
                'graph_node_id',
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
            ],
            query: {
                bool: {
                    filter: [
                        { term: { source_name: options.sourceName } },
                        { term: { node_level: 'occupation' } },
                        { term: { locale_codes: options.locale } }
                    ],
                    must: [authorityQuery]
                }
            },
            highlight: {
                pre_tags: [''],
                post_tags: [''],
                fields: {
                    canonical_label: { number_of_fragments: 0 },
                    locale_primary_aliases_text: { number_of_fragments: 0 },
                    locale_supporting_aliases_text: { number_of_fragments: 0 },
                    reviewed_crosswalk_aliases_text: { number_of_fragments: 0 },
                    family_supporting_aliases_text: { number_of_fragments: 0 },
                    english_backbone_aliases_text: { number_of_fragments: 0 },
                    aliases_text: { number_of_fragments: 0 },
                    search_text: { number_of_fragments: 1 },
                    capability_text: { number_of_fragments: 1 },
                    ancestor_text: { number_of_fragments: 1 }
                }
            }
        });
        const hits = (response.body?.hits?.hits ?? [])
            .map((hit) => toScoredSearchHit(hit, queryTokens, options.locale))
            .filter((hit) => hit !== null);
        const maxRawScore = Math.max(...hits.map((hit) => hit.rawScore), 0);
        return hits
            .map((hit) => toOccupationHit(hit, maxRawScore))
            .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
            .slice(0, size);
    }
    async retrieveCanonicalLabels(options) {
        const values = uniqueNonEmpty(options.foldedQueries);
        if (values.length === 0) {
            return [];
        }
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationsIndex)}/_search`, {
            size: Math.max(options.limit * 4, 25),
            _source: [
                'graph_node_id',
                'canonical_label',
                'normalized_label'
            ],
            query: {
                bool: {
                    filter: [
                        { term: { source_name: options.sourceName } },
                        { term: { node_level: 'occupation' } },
                        { term: { locale_codes: options.locale } },
                        { terms: { normalized_label: values } }
                    ]
                }
            },
            sort: [
                { 'canonical_label.raw': { order: 'asc' } },
                { graph_node_id: { order: 'asc' } }
            ]
        });
        return (response.body?.hits?.hits ?? [])
            .map(toCanonicalLabelHit)
            .filter((hit) => hit !== null);
    }
    async retrieveWithinFamily(options) {
        const size = Math.max(options.limit, 25);
        const preparedQuery = await prepareQuery(options.query, options.locale, { sourceName: options.sourceName });
        const queryTokens = preparedQuery.foldedTokens;
        const authorityQuery = buildAuthorityDisMaxQuery(options.query, preparedQuery);
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationsIndex)}/_search`, {
            size,
            _source: [
                'graph_node_id',
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
            ],
            query: {
                bool: {
                    filter: [
                        { term: { source_name: options.sourceName } },
                        { term: { node_level: 'occupation' } },
                        { term: { locale_codes: options.locale } },
                        { term: { family_node_id: options.familyNodeId } }
                    ],
                    must: [authorityQuery]
                }
            },
            highlight: {
                pre_tags: [''],
                post_tags: [''],
                fields: {
                    canonical_label: { number_of_fragments: 0 },
                    locale_primary_aliases_text: { number_of_fragments: 0 },
                    locale_supporting_aliases_text: { number_of_fragments: 0 },
                    reviewed_crosswalk_aliases_text: { number_of_fragments: 0 },
                    family_supporting_aliases_text: { number_of_fragments: 0 },
                    english_backbone_aliases_text: { number_of_fragments: 0 },
                    aliases_text: { number_of_fragments: 0 },
                    search_text: { number_of_fragments: 1 },
                    capability_text: { number_of_fragments: 1 },
                    ancestor_text: { number_of_fragments: 1 }
                }
            }
        });
        const hits = (response.body?.hits?.hits ?? [])
            .map((hit) => toScoredSearchHit(hit, queryTokens, options.locale))
            .filter((hit) => hit !== null);
        const maxRawScore = Math.max(...hits.map((hit) => hit.rawScore), 0);
        return hits
            .map((hit) => toOccupationHit(hit, maxRawScore))
            .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
            .slice(0, size);
    }
}
function toCanonicalLabelHit(hit) {
    const graphNodeId = hit._source?.graph_node_id;
    const canonicalLabel = hit._source?.canonical_label?.trim();
    const normalizedLabel = hit._source?.normalized_label?.trim();
    if (!Number.isInteger(graphNodeId) || !canonicalLabel || !normalizedLabel) {
        return null;
    }
    return {
        graphNodeId: Number(graphNodeId),
        canonicalLabel,
        normalizedLabel
    };
}
function buildAuthorityDisMaxQuery(rawQuery, preparedQuery) {
    const preparedUsefulQuery = preparedQuery.usefulTokens.join(' ').trim();
    const preparedFoldedUsefulQuery = preparedQuery.usefulFoldedTokens.join(' ').trim();
    const preparedPhraseWindows = buildPreparedPhraseWindows(preparedQuery);
    const preparedQueries = Array.from(new Set([preparedUsefulQuery, preparedFoldedUsefulQuery].filter(Boolean)));
    const rawQueries = Array.from(new Set([rawQuery.trim(), preparedQuery.normalized, preparedQuery.folded].filter(Boolean)));
    const queries = [];
    preparedPhraseWindows.forEach((phraseWindow, index) => {
        const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;
        queries.push(constantScoreTextQuery(`authority_010_prepared_primary_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_PRIMARY_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'locale_primary_aliases_text'
        ]), constantScoreTextQuery(`authority_020_prepared_canonical_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_CANONICAL_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'canonical_label'
        ]), constantScoreTextQuery(`authority_030_prepared_supporting_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_SUPPORTING_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'locale_supporting_aliases_text'
        ]), constantScoreTextQuery(`authority_040_prepared_reviewed_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_REVIEWED_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'reviewed_crosswalk_aliases_text'
        ]), constantScoreTextQuery(`authority_045_prepared_family_support_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_FAMILY_SUPPORT_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'family_supporting_aliases_text'
        ]), constantScoreTextQuery(`authority_050_prepared_backbone_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_BACKBONE_PHRASE, phraseWindow), phraseWindow.query, 'phrase', [
            'english_backbone_aliases_text'
        ]));
    });
    for (const query of rawQueries) {
        queries.push(constantScoreTextQuery('authority_060_raw_primary_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_PRIMARY_OR_CANONICAL_PHRASE, query, 'phrase', [
            'locale_primary_aliases_text',
            'canonical_label'
        ]), constantScoreTextQuery('authority_070_raw_supporting_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, 'phrase', [
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'family_supporting_aliases_text',
            'english_backbone_aliases_text'
        ]));
    }
    for (const query of preparedQueries) {
        queries.push(constantScoreTextQuery('authority_080_prepared_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, 'best_fields', [
            'locale_primary_aliases_text',
            'canonical_label',
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'family_supporting_aliases_text',
            'english_backbone_aliases_text',
            'aliases_text',
            'search_text',
            'capability_text'
        ]), constantScoreTextQuery('authority_090_strict_fuzzy', OPENSEARCH_AUTHORITY_SCORE.STRICT_FUZZY, query, 'best_fields', [
            'locale_primary_aliases_text',
            'canonical_label',
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'family_supporting_aliases_text',
            'english_backbone_aliases_text',
            'aliases_text'
        ], true));
    }
    for (const query of rawQueries) {
        queries.push(constantScoreTextQuery('authority_100_raw_all_terms', OPENSEARCH_AUTHORITY_SCORE.RAW_ALL_TERMS, query, 'best_fields', [
            'aliases_text',
            'search_text',
            'capability_text',
            'ancestor_text'
        ]));
    }
    return {
        dis_max: {
            tie_breaker: 0,
            queries
        }
    };
}
function buildPreparedPhraseWindows(preparedQuery) {
    const windows = [];
    const seen = new Set();
    appendPhraseWindows(windows, seen, preparedQuery.usefulTokens);
    appendPhraseWindows(windows, seen, preparedQuery.usefulFoldedTokens);
    return windows;
}
function appendPhraseWindows(windows, seen, tokens) {
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
function phraseWindowAuthorityScore(baseScore, phraseWindow) {
    const tokenBonus = Math.min(phraseWindow.tokenCount * OPENSEARCH_PHRASE_WINDOW_POLICY.TOKEN_AUTHORITY_INCREMENT, OPENSEARCH_PHRASE_WINDOW_POLICY.MAX_TOKEN_AUTHORITY_BONUS);
    return baseScore + tokenBonus;
}
function constantScoreTextQuery(name, boost, query, type, fields, fuzzy = false) {
    return {
        constant_score: {
            boost,
            filter: {
                multi_match: {
                    _name: name,
                    query,
                    type,
                    ...(type === 'best_fields' ? { operator: 'and' } : {}),
                    ...(fuzzy ? { fuzziness: 1, prefix_length: 3, max_expansions: 8 } : {}),
                    fields
                }
            }
        }
    };
}
function toScoredSearchHit(hit, queryTokens, locale) {
    const graphNodeId = hit._source?.graph_node_id;
    const canonicalLabel = hit._source?.canonical_label?.trim();
    const rawScore = typeof hit._score === 'number' ? hit._score : Number.NaN;
    if (!Number.isInteger(graphNodeId) || !canonicalLabel || !Number.isFinite(rawScore) || rawScore <= 0) {
        return null;
    }
    const resolvedGraphNodeId = Number(graphNodeId);
    const fieldSignals = buildFieldSignals(hit, queryTokens, locale);
    const matchedTokens = Array.from(new Set(fieldSignals.flatMap((signal) => signal.matchedTokens))).sort();
    const usefulQueryTokenCount = countUsefulTokens(queryTokens, locale);
    return {
        graphNodeId: resolvedGraphNodeId,
        canonicalLabel,
        rawScore: roundScore(rawScore),
        matchedQueries: [...(hit.matched_queries ?? [])].sort(),
        matchedFields: Object.keys(hit.highlight ?? {}).sort(),
        fieldSignals,
        matchedTokens,
        phraseMatch: fieldSignals.some((signal) => signal.phraseMatch),
        maxUsefulTokenCoverage: roundScore(Math.max(...fieldSignals.map((signal) => signal.usefulTokenCoverage), 0)),
        queryTokenCount: queryTokens.length,
        usefulQueryTokenCount
    };
}
function toOccupationHit(hit, maxRawScore) {
    const normalizedRawScore = roundScore(normalizeScore(hit.rawScore, maxRawScore));
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
function calculateLexicalSignalScore(hit) {
    const usefulCoverage = hit.usefulQueryTokenCount > 0 ? hit.maxUsefulTokenCoverage : maxTokenCoverage(hit.fieldSignals);
    const usefulFieldStrength = Math.max(...hit.fieldSignals
        .filter((signal) => signal.usefulMatchedTokenCount > 0 || hit.usefulQueryTokenCount === 0)
        .map((signal) => fieldStrength(signal.fieldClass)), 0);
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
function buildFieldSignals(hit, queryTokens, locale) {
    const fields = [
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
    return fields
        .map((field) => buildFieldSignal(field, hit._source?.[field] ?? '', queryTokens, locale))
        .filter((signal) => signal !== null);
}
function buildFieldSignal(field, value, queryTokens, locale) {
    const fieldTokens = tokenizeNormalizedText(foldSearchText(value));
    const matchedTokens = queryTokens.filter((token) => fieldTokens.includes(token));
    if (matchedTokens.length === 0) {
        return null;
    }
    const usefulQueryTokens = queryTokens.filter((token) => isUsefulQueryToken(token, locale));
    const usefulMatchedTokens = matchedTokens.filter((token) => isUsefulQueryToken(token, locale));
    const phraseMatch = containsTokenPhrase(fieldTokens, queryTokens, locale) || containsTokenPhrase(queryTokens, fieldTokens, locale);
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
function fieldClassForField(field) {
    if (field === 'canonical_label') {
        return 'title';
    }
    if (field === 'aliases_text' ||
        field === 'locale_primary_aliases_text' ||
        field === 'locale_supporting_aliases_text' ||
        field === 'reviewed_crosswalk_aliases_text' ||
        field === 'english_backbone_aliases_text') {
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
function aliasRoleForField(field) {
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
function fieldStrength(fieldClass) {
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
function maxTokenCoverage(fieldSignals) {
    return roundScore(Math.max(...fieldSignals.map((signal) => signal.tokenCoverage), 0));
}
function countUsefulTokens(tokens, locale) {
    return tokens.filter((token) => isUsefulQueryToken(token, locale)).length;
}
function normalizeScore(rawScore, maxRawScore) {
    if (maxRawScore <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(1, rawScore / maxRawScore));
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
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
