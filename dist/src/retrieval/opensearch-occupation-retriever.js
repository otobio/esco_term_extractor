import { OpenSearchClient } from '../opensearch/client.js';
import { getOpenSearchConfig } from '../opensearch/config.js';
import { maxOf } from '../utils/operators.js';
import { containsTokenPhrase, isUsefulQueryToken } from '../query/query-preparation.js';
import { groundedSupportingMatchedTokens, shouldSuppressContextOnlySupportingAlias } from './intent-support-grounding.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { OPENSEARCH_AUTHORITY_SCORE, OPENSEARCH_FIELD_STRENGTH, OPENSEARCH_LEXICAL_SIGNAL_POLICY, OPENSEARCH_PHRASE_WINDOW_POLICY } from '../scoring/scoring-policy.js';
import { buildAuthorityQueryPreparation } from './authority-query-preparation.js';
const GLOBAL_RETRIEVAL_SOURCE_FIELDS = [
    'graph_node_id',
    'canonical_label',
    'locale_primary_aliases_text',
    'locale_supporting_aliases_text',
    'reviewed_crosswalk_aliases_text',
    'english_backbone_aliases_text',
    'aliases_text',
    'search_text',
    'capability_text',
    'ancestor_text'
];
const FAMILY_RETRIEVAL_SOURCE_FIELDS = [...GLOBAL_RETRIEVAL_SOURCE_FIELDS, 'family_supporting_aliases_text'];
const GLOBAL_HIGHLIGHT_FIELDS = {
    canonical_label: { number_of_fragments: 0 },
    locale_primary_aliases_text: { number_of_fragments: 0 },
    locale_supporting_aliases_text: { number_of_fragments: 0 },
    reviewed_crosswalk_aliases_text: { number_of_fragments: 0 },
    english_backbone_aliases_text: { number_of_fragments: 0 },
    aliases_text: { number_of_fragments: 0 },
    search_text: { number_of_fragments: 1 },
    capability_text: { number_of_fragments: 1 },
    ancestor_text: { number_of_fragments: 1 }
};
const FAMILY_HIGHLIGHT_FIELDS = {
    ...GLOBAL_HIGHLIGHT_FIELDS,
    family_supporting_aliases_text: { number_of_fragments: 0 }
};
const GLOBAL_FIELD_SIGNALS = [
    'canonical_label',
    'locale_primary_aliases_text',
    'locale_supporting_aliases_text',
    'reviewed_crosswalk_aliases_text',
    'english_backbone_aliases_text',
    'aliases_text',
    'search_text',
    'capability_text',
    'ancestor_text'
];
const FAMILY_FIELD_SIGNALS = [...GLOBAL_FIELD_SIGNALS, 'family_supporting_aliases_text'];
export class OpenSearchOccupationRetriever {
    client;
    config;
    constructor(client = new OpenSearchClient(getOpenSearchConfig()), config = getOpenSearchConfig()) {
        this.client = client;
        this.config = config;
    }
    async retrieve(options) {
        const size = Math.max(options.limit * 4, 25);
        const preparedQuery = options.preparedQuery;
        const authorityPreparation = buildAuthorityQueryPreparation(preparedQuery);
        const queryTokens = authorityPreparation.queryTokens;
        const retrievalShape = retrievalShapeForScope(false);
        const authorityQuery = buildAuthorityDisMaxQuery(authorityPreparation, retrievalShape.includeFamilySupportingAuthority);
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationsIndex)}/_search`, {
            size,
            _source: retrievalShape.sourceFields,
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
                fields: retrievalShape.highlightFields
            }
        });
        const hits = (response.body?.hits?.hits ?? [])
            .map((hit) => toScoredSearchHit(hit, preparedQuery, queryTokens, options.locale, retrievalShape.includeFamilySupportingSignals))
            .filter((hit) => hit !== null);
        const maxRawScore = maxOf(hits, (hit) => hit.rawScore);
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
            _source: ['graph_node_id', 'canonical_label', 'normalized_label'],
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
            sort: [{ 'canonical_label.raw': { order: 'asc' } }, { graph_node_id: { order: 'asc' } }]
        });
        return (response.body?.hits?.hits ?? []).map(toCanonicalLabelHit).filter((hit) => hit !== null);
    }
    async retrieveWithinFamily(options) {
        const size = Math.max(options.limit, 25);
        const preparedQuery = options.preparedQuery;
        const authorityPreparation = buildAuthorityQueryPreparation(preparedQuery);
        const queryTokens = authorityPreparation.queryTokens;
        const retrievalShape = retrievalShapeForScope(true);
        const authorityQuery = buildAuthorityDisMaxQuery(authorityPreparation, retrievalShape.includeFamilySupportingAuthority);
        const response = await this.client.post(`/${encodeURIComponent(this.config.occupationsIndex)}/_search`, {
            size,
            _source: retrievalShape.sourceFields,
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
                fields: retrievalShape.highlightFields
            }
        });
        const hits = (response.body?.hits?.hits ?? [])
            .map((hit) => toScoredSearchHit(hit, preparedQuery, queryTokens, options.locale, retrievalShape.includeFamilySupportingSignals))
            .filter((hit) => hit !== null);
        const maxRawScore = maxOf(hits, (hit) => hit.rawScore);
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
function buildAuthorityDisMaxQuery(authorityPreparation, includeFamilySupportingAuthority) {
    const { preparedQueries, preparedPhraseWindows, primaryPreparedQueries, primaryPreparedPhraseWindows } = authorityPreparation;
    const queries = [];
    const familySupportPhraseWindows = primaryPreparedPhraseWindows.length > 0 ? primaryPreparedPhraseWindows : preparedPhraseWindows;
    const familySupportPreparedQueries = primaryPreparedQueries.length > 0 ? primaryPreparedQueries : preparedQueries;
    preparedPhraseWindows.forEach((phraseWindow, index) => {
        const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;
        queries.push(constantScoreTextQuery(`authority_010_prepared_primary_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_PRIMARY_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['locale_primary_aliases_text']), constantScoreTextQuery(`authority_020_prepared_canonical_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_CANONICAL_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['canonical_label']), constantScoreTextQuery(`authority_030_prepared_supporting_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_SUPPORTING_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['locale_supporting_aliases_text']), constantScoreTextQuery(`authority_040_prepared_reviewed_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_REVIEWED_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['reviewed_crosswalk_aliases_text']), constantScoreTextQuery(`authority_050_prepared_backbone_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_BACKBONE_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['english_backbone_aliases_text']));
    });
    if (includeFamilySupportingAuthority) {
        familySupportPhraseWindows.forEach((phraseWindow, index) => {
            const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;
            queries.push(constantScoreTextQuery(`authority_045_prepared_family_support_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_FAMILY_SUPPORT_PHRASE, phraseWindow), phraseWindow.query, 'phrase', ['family_supporting_aliases_text']));
        });
    }
    for (const query of preparedQueries) {
        queries.push(constantScoreTextQuery('authority_060_raw_primary_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_PRIMARY_OR_CANONICAL_PHRASE, query, 'phrase', ['locale_primary_aliases_text', 'canonical_label']), constantScoreTextQuery('authority_070_raw_supporting_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, 'phrase', ['locale_supporting_aliases_text', 'reviewed_crosswalk_aliases_text', 'english_backbone_aliases_text']));
    }
    if (includeFamilySupportingAuthority) {
        for (const query of familySupportPreparedQueries) {
            queries.push(constantScoreTextQuery('authority_075_raw_family_support_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, 'phrase', ['family_supporting_aliases_text']));
        }
    }
    for (const query of preparedQueries) {
        queries.push(constantScoreTextQuery('authority_080_prepared_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, 'best_fields', [
            'locale_primary_aliases_text',
            'canonical_label',
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'english_backbone_aliases_text',
            'aliases_text',
            'search_text',
            'capability_text'
        ]), constantScoreTextQuery('authority_090_strict_fuzzy', OPENSEARCH_AUTHORITY_SCORE.STRICT_FUZZY, query, 'best_fields', [
            'locale_primary_aliases_text',
            'canonical_label',
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'english_backbone_aliases_text',
            'aliases_text'
        ], true));
    }
    if (includeFamilySupportingAuthority) {
        for (const query of familySupportPreparedQueries) {
            queries.push(constantScoreTextQuery('authority_085_prepared_family_support_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, 'best_fields', ['family_supporting_aliases_text']), constantScoreTextQuery('authority_095_prepared_family_support_strict_fuzzy', OPENSEARCH_AUTHORITY_SCORE.STRICT_FUZZY, query, 'best_fields', ['family_supporting_aliases_text'], true));
        }
    }
    for (const query of preparedQueries) {
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
function retrievalShapeForScope(includeFamilySupporting) {
    return {
        sourceFields: includeFamilySupporting ? FAMILY_RETRIEVAL_SOURCE_FIELDS : GLOBAL_RETRIEVAL_SOURCE_FIELDS,
        highlightFields: includeFamilySupporting ? FAMILY_HIGHLIGHT_FIELDS : GLOBAL_HIGHLIGHT_FIELDS,
        includeFamilySupportingAuthority: includeFamilySupporting,
        includeFamilySupportingSignals: includeFamilySupporting
    };
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
function toScoredSearchHit(hit, preparedQuery, queryTokens, locale, includeFamilySupportingSignals) {
    const graphNodeId = hit._source?.graph_node_id;
    const canonicalLabel = hit._source?.canonical_label?.trim();
    const rawScore = typeof hit._score === 'number' ? hit._score : Number.NaN;
    if (!Number.isInteger(graphNodeId) || !canonicalLabel || !Number.isFinite(rawScore) || rawScore <= 0) {
        return null;
    }
    const resolvedGraphNodeId = Number(graphNodeId);
    const fieldSignals = buildFieldSignals(hit, preparedQuery, queryTokens, locale, includeFamilySupportingSignals);
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
        maxUsefulTokenCoverage: roundScore(maxOf(fieldSignals, (signal) => signal.usefulTokenCoverage)),
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
    const shortNonPhraseCap = hit.usefulQueryTokenCount <= 2 && !hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.SHORT_NON_PHRASE_CAP : 1;
    const score = OPENSEARCH_LEXICAL_SIGNAL_POLICY.BASE_SIGNAL +
        usefulCoverage * OPENSEARCH_LEXICAL_SIGNAL_POLICY.USEFUL_COVERAGE_WEIGHT +
        usefulFieldStrength * OPENSEARCH_LEXICAL_SIGNAL_POLICY.FIELD_STRENGTH_WEIGHT +
        phraseBoost;
    return roundScore(Math.max(OPENSEARCH_LEXICAL_SIGNAL_POLICY.MIN_SIGNAL, Math.min(shortNonPhraseCap, score)));
}
function buildFieldSignals(hit, preparedQuery, queryTokens, locale, includeFamilySupportingSignals) {
    const fields = includeFamilySupportingSignals ? FAMILY_FIELD_SIGNALS : GLOBAL_FIELD_SIGNALS;
    return fields
        .map((field) => buildFieldSignal(field, hit._source?.[field] ?? '', preparedQuery, queryTokens, locale))
        .filter((signal) => signal !== null);
}
function buildFieldSignal(field, value, preparedQuery, queryTokens, locale) {
    const fieldTokens = tokenizeNormalizedText(foldSearchText(value));
    const effectiveQueryTokens = usesGroundedRoleSupportQueryTokens(field)
        ? groundedSupportingMatchedTokens(preparedQuery, queryTokens)
        : queryTokens;
    const matchedTokens = effectiveQueryTokens.filter((token) => fieldTokens.includes(token));
    if (matchedTokens.length === 0) {
        return null;
    }
    if (shouldSuppressContextOnlyFamilySupportField(field, matchedTokens, preparedQuery)) {
        return null;
    }
    const usefulQueryTokens = queryTokens.filter((token) => isUsefulQueryToken(token, locale));
    const usefulMatchedTokens = matchedTokens.filter((token) => isUsefulQueryToken(token, locale));
    // A single/short useful-token query is trivially a "contiguous phrase" inside any longer field text
    // (e.g. "jurist" inside a field carrying the unrelated compound alias "jurist lingvist") -- only credit
    // the query-contains-field direction, where the query actually explains the whole matched text.
    const queryContainsField = effectiveQueryTokens.length >= 2 && containsTokenPhrase(fieldTokens, effectiveQueryTokens, locale);
    const fieldContainsQuery = containsTokenPhrase(effectiveQueryTokens, fieldTokens, locale);
    const phraseMatch = queryContainsField || fieldContainsQuery;
    return {
        field,
        fieldClass: fieldClassForField(field),
        ...(aliasRoleForField(field) ? { aliasRole: aliasRoleForField(field) } : {}),
        phraseMatch,
        // Note: `queryContainsField`/`fieldContainsQuery` above are named for the opposite of what they check
        // (containsTokenPhrase(haystack, needle) tests haystack-contains-needle) -- label by actual direction here.
        phraseMatchDirection: queryContainsField ? 'field_contains_query' : fieldContainsQuery ? 'query_contains_field' : 'none',
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
function shouldSuppressContextOnlyFamilySupportField(field, matchedTokens, preparedQuery) {
    if (matchedTokens.length === 0) {
        return false;
    }
    if (field !== 'family_supporting_aliases_text' &&
        field !== 'locale_supporting_aliases_text' &&
        field !== 'english_backbone_aliases_text') {
        return false;
    }
    return shouldSuppressContextOnlySupportingAlias(aliasRoleForField(field) ?? '', matchedTokens, preparedQuery);
}
function isSupportAliasField(field) {
    return (field === 'family_supporting_aliases_text' || field === 'locale_supporting_aliases_text' || field === 'english_backbone_aliases_text');
}
function usesGroundedRoleSupportQueryTokens(field) {
    return isSupportAliasField(field) || field === 'aliases_text';
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
    return roundScore(maxOf(fieldSignals, (signal) => signal.tokenCoverage));
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
