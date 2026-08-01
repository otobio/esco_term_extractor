import { readOptionalEnv } from '../config/env.js';
import { containsTokenPhrase, expandTokenVariants, foldSearchLookupText, foldSearchText, isUsefulQueryToken, longestContiguousTokenMatch, normalizeSearchText, prepareQuery, tokenizeNormalizedText } from '../query/query-preparation.js';
import { ALIAS_MATCH_POLICY, CAPABILITY_TASK_POLICY, RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT } from '../scoring/scoring-policy.js';
import { prepareOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { createRetrievalEngine } from './retrieval-engine-factory.js';
import { retrieveBinaryAliasNgramHits } from './alias-ngram-retriever.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { timed } from '../utils/timing.js';
import { requirePositiveIntegerAtMost } from '../utils/validation.js';
export const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
export const DEFAULT_RETRIEVAL_LOCALE = 'en';
export const DEFAULT_MODEL_KEY = 'none';
export const DEFAULT_CANDIDATE_LIMIT = 10;
export const DEFAULT_RETRIEVAL_PROFILE = 'occupation_hybrid_v1';
export const LEGACY_LEXICAL_BACKEND_LABEL = 'hybrid';
export function retrievalSurfaceLocales(locale) {
    const primaryLocale = normalizeLocale(locale);
    const locales = [primaryLocale];
    if (primaryLocale !== DEFAULT_RETRIEVAL_LOCALE) {
        locales.push(DEFAULT_RETRIEVAL_LOCALE);
    }
    return Array.from(new Set(locales));
}
export class OccupationCandidateRetriever {
    connection;
    occupationRetriever;
    aliasRetriever;
    constructor(connection = null, occupationRetriever = createRetrievalEngine().occupations, aliasRetriever = createRetrievalEngine().aliases) {
        this.connection = connection;
        this.occupationRetriever = occupationRetriever;
        this.aliasRetriever = aliasRetriever;
    }
    static withEngine(connection, engine) {
        return new OccupationCandidateRetriever(connection, engine.occupations, engine.aliases);
    }
    async run(options) {
        const sourceName = normalizeSourceName(options.sourceName);
        const limit = normalizeLimit(options.limit);
        const timings = {};
        const evaluationQuery = await this.resolveEvaluationQuery(options.evaluationQueryId);
        const originalQuery = normalizeRequiredQuery(evaluationQuery?.query_text ?? options.query);
        const locale = normalizeLocale(evaluationQuery?.locale_code ?? options.locale);
        const modelKey = normalizeModelKey(options.modelKey);
        const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
        const retrievalQuery = await prepareOccupationRetrievalQuery({
            sourceName,
            locale,
            originalQuery,
            timings
        });
        const preparedQuery = retrievalQuery.preparedQuery;
        const retrievalSurfaces = await prepareRetrievalSurfaces(sourceName, retrievalQuery.query, locale, preparedQuery, timings);
        const exactRows = [];
        const foldedRows = [];
        const subphraseMatches = [];
        const ngramMatches = [];
        const openSearchRows = [];
        let scannedAliasHitCount = 0;
        let hasWholeAlias = false;
        for (const surface of retrievalSurfaces) {
            const aliasRetrieval = await timed(() => this.aliasRetriever.retrieve({
                sourceName,
                locale: surface.locale,
                preparedQuery: surface.preparedQuery,
                exactAliasQueries: surface.exactAliasQueries,
                foldedAliasQueries: Array.from(surface.foldedAliasQueries),
                limit
            }), 'candidate.alias_retrieval', timings);
            const canonicalLabelRows = await timed(() => this.occupationRetriever.retrieveCanonicalLabels({
                query: retrievalQuery.query,
                locale: surface.locale,
                sourceName,
                foldedQueries: Array.from(surface.foldedAliasQueries),
                limit
            }), 'candidate.canonical_label_retrieval', timings);
            const lexicalRows = await timed(() => this.occupationRetriever.retrieve({
                query: retrievalQuery.query,
                locale: surface.locale,
                sourceName,
                limit
            }), 'candidate.lexical_retrieval', timings);
            const canonicalEvidence = partitionCanonicalLabelEvidence(canonicalLabelRows, surface.exactAliasQueries, surface.foldedAliasQueries);
            const foldedMatches = aliasRetrieval.foldedRows.filter((row) => row.normalized_alias !== retrievalQuery.normalizedQuery &&
                surface.foldedAliasQueries.has(foldSearchLookupText(row.normalized_alias)));
            exactRows.push(...canonicalEvidence.exactRows, ...aliasRetrieval.exactRows);
            foldedRows.push(...canonicalEvidence.foldedRows, ...foldedMatches);
            subphraseMatches.push(...findSubphraseAliasMatches(aliasRetrieval.subphraseRows, surface.preparedQuery));
            openSearchRows.push(...lexicalRows);
            scannedAliasHitCount += aliasRetrieval.scannedAliasHitCount + canonicalLabelRows.length;
            hasWholeAlias = hasWholeAlias || hasWholeAliasEvidence(canonicalEvidence, aliasRetrieval.exactRows, foldedMatches);
        }
        if (!hasWholeAlias) {
            for (const surface of retrievalSurfaces) {
                ngramMatches.push(...(await this.retrieveAliasNgramMatches(sourceName, surface.preparedQuery, limit, timings)));
            }
        }
        const candidates = await timed(() => this.buildCandidates(exactRows, foldedRows, subphraseMatches, ngramMatches, openSearchRows), 'candidate.build_candidates', timings);
        return {
            originalQuery: retrievalQuery.originalQuery,
            query: retrievalQuery.query,
            querySpans: retrievalQuery.querySpans,
            locale: retrievalQuery.locale,
            normalizedQuery: retrievalQuery.normalizedQuery,
            foldedQuery: retrievalQuery.foldedQuery,
            querySignals: retrievalQuery.querySignals,
            keptQuerySignals: retrievalQuery.keptQuerySignals,
            querySignalCleaningMs: retrievalQuery.querySignalCleaningMs,
            roleSpanSelection: retrievalQuery.roleSpanSelection,
            sourceName,
            retrievalProfile,
            modelKey,
            modelDimensions: null,
            limit,
            evaluationQueryId: evaluationQuery?.id ?? null,
            scannedAliasHitCount,
            scannedOpenSearchHitCount: openSearchRows.length,
            timings,
            candidates
        };
    }
    async resolveEvaluationQuery(evaluationQueryId) {
        if (evaluationQueryId === undefined) {
            return null;
        }
        if (!this.connection) {
            throw new Error('--evaluation-query-id requires a MySQL connection. Runtime query mode should pass --query instead.');
        }
        const [rows] = await this.connection.query(`
        SELECT
          id,
          locale_code,
          query_text
        FROM ose_evaluation_queries
        WHERE id = ?
        LIMIT 1
      `, [evaluationQueryId]);
        const row = rows[0] ?? null;
        if (!row) {
            throw new Error(`No evaluation query found for --evaluation-query-id=${evaluationQueryId}.`);
        }
        return row;
    }
    async retrieveAliasNgramMatches(sourceName, preparedQuery, limit, timings) {
        if (!isAliasNgramRetrievalEnabled()) {
            return [];
        }
        const scoringQuery = preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedTokens.join(' ').trim() || preparedQuery.normalized;
        const scoringPreparedQuery = scoringQuery === preparedQuery.raw
            ? preparedQuery
            : await timed(() => prepareQuery(scoringQuery, preparedQuery.locale, { sourceName }), 'candidate.alias_ngram_prepare', timings);
        const index = await timed(() => loadAliasNgramIndex(sourceName, preparedQuery.locale), 'candidate.alias_ngram_index_load', timings);
        return timed(() => retrieveAliasNgramRuntimeHits(index, scoringPreparedQuery, { limit: Math.max(limit * 3, 25) }), 'candidate.alias_ngram_retrieval', timings);
    }
    buildCandidates(exactRows, foldedRows, subphraseRows, ngramRows, openSearchRows) {
        const candidatesByNodeId = new Map();
        for (const row of exactRows) {
            addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
                channel: 'exact_alias',
                ...aliasEvidenceDetails(row),
                score: roundScore(toNullableNumber(row.weight) ?? 1)
            });
        }
        for (const row of foldedRows) {
            const aliasWeight = toNullableNumber(row.weight);
            addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
                channel: 'folded_alias',
                ...aliasEvidenceDetails(row),
                score: roundScore((aliasWeight ?? 1) * ALIAS_MATCH_POLICY.FOLDED_EXACT_DISCOUNT),
                foldedAlias: foldSearchText(row.normalized_alias)
            });
        }
        for (const row of subphraseRows) {
            const aliasWeight = toNullableNumber(row.weight);
            const channel = row.matchType === 'query_in_alias' ? 'opensearch_lexical' : 'folded_alias';
            addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
                channel,
                ...aliasEvidenceDetails(row),
                score: roundScore((aliasWeight ?? 1) * row.subphraseScore),
                foldedAlias: row.foldedAlias,
                details: {
                    ...aliasAuthorityDetails(row),
                    match_type: row.matchType,
                    matched_tokens: row.matchedTokens,
                    alias_token_count: row.aliasTokenCount,
                    query_token_count: row.queryTokenCount
                }
            });
        }
        for (const row of ngramRows) {
            addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, {
                channel: 'ngram_alias',
                score: row.score,
                alias: row.alias,
                normalizedAlias: row.normalizedAlias,
                aliasRole: row.aliasRole,
                aliasWeight: row.aliasWeight,
                cosine: row.cosine,
                details: {
                    family_node_id: row.familyNodeId,
                    family_label: row.familyLabel,
                    token_coverage: row.tokenCoverage,
                    useful_token_coverage: row.usefulTokenCoverage,
                    matched_tokens: row.matchedTokens,
                    matched_features: row.matchedFeatures
                }
            });
        }
        for (const row of openSearchRows) {
            addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, {
                channel: 'opensearch_lexical',
                score: row.score,
                details: {
                    raw_score: row.rawScore,
                    normalized_raw_score: row.normalizedRawScore,
                    lexical_signal_score: row.lexicalSignalScore,
                    matched_queries: row.matchedQueries,
                    matched_fields: row.matchedFields,
                    matched_tokens: row.matchedTokens,
                    phrase_match: row.phraseMatch,
                    field_signals: row.fieldSignals,
                    max_useful_token_coverage: row.maxUsefulTokenCoverage,
                    query_token_count: row.queryTokenCount,
                    useful_query_token_count: row.usefulQueryTokenCount
                }
            });
            const capabilityEvidence = buildCapabilityTaskEvidence(row);
            if (capabilityEvidence) {
                addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, capabilityEvidence);
            }
        }
        // Each channel above already bounded its own retrieval to the caller's `limit` (or `limit * 3`
        // for ngram_alias) at the source, so this merged/deduped set is a per-channel top-K union, not
        // an unbounded scan. Re-slicing it here by blended totalScore would throw away exactly the
        // channel-diverse candidates that union was built to preserve, so the full merged set is returned.
        return Array.from(candidatesByNodeId.values())
            .map((candidate) => finalizeCandidate(candidate))
            .sort((left, right) => right.totalScore - left.totalScore ||
            (right.channelScores.exact_alias ?? 0) - (left.channelScores.exact_alias ?? 0) ||
            (right.channelScores.folded_alias ?? 0) - (left.channelScores.folded_alias ?? 0) ||
            (right.channelScores.ngram_alias ?? 0) - (left.channelScores.ngram_alias ?? 0) ||
            (right.channelScores.opensearch_lexical ?? 0) - (left.channelScores.opensearch_lexical ?? 0) ||
            (right.channelScores.capability_task ?? 0) - (left.channelScores.capability_task ?? 0) ||
            left.canonicalLabel.localeCompare(right.canonicalLabel));
    }
}
async function prepareRetrievalSurfaces(sourceName, query, locale, preparedQuery, timings) {
    const surfaces = [];
    for (const surfaceLocale of retrievalSurfaceLocales(locale)) {
        const surfacePreparedQuery = surfaceLocale === preparedQuery.locale
            ? preparedQuery
            : await timed(() => prepareQuery(query, surfaceLocale, { sourceName }), 'candidate.secondary_surface_prepare', timings);
        surfaces.push({
            locale: surfaceLocale,
            preparedQuery: surfacePreparedQuery,
            exactAliasQueries: exactAliasQueriesForPreparedQuery(surfacePreparedQuery),
            foldedAliasQueries: foldedAliasQueriesForPreparedQuery(surfacePreparedQuery)
        });
    }
    return surfaces;
}
export function isAliasNgramRetrievalEnabled() {
    const disableValue = readOptionalEnv('OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL')?.toLowerCase();
    if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
        return false;
    }
    const enableValue = readOptionalEnv('OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL')?.toLowerCase();
    return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}
const ALIAS_NGRAM_INDEX_CACHE = new Map();
const DEFAULT_ALIAS_NGRAM_INDEX_CACHE_SIZE = 1;
function loadAliasNgramIndex(sourceName, locale) {
    const includeFamilySupportingAliases = isAliasNgramFamilySupportEnabled();
    const cacheKey = `${sourceName}\0${locale}\0${includeFamilySupportingAliases ? 'family' : 'leaf'}`;
    let cached = ALIAS_NGRAM_INDEX_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadAliasNgramRuntimeIndex(sourceName, locale, includeFamilySupportingAliases);
        ALIAS_NGRAM_INDEX_CACHE.set(cacheKey, cached);
        trimAliasNgramIndexCache();
    }
    else {
        ALIAS_NGRAM_INDEX_CACHE.delete(cacheKey);
        ALIAS_NGRAM_INDEX_CACHE.set(cacheKey, cached);
    }
    return cached;
}
function trimAliasNgramIndexCache() {
    const maxSize = configuredAliasNgramIndexCacheSize();
    while (ALIAS_NGRAM_INDEX_CACHE.size > maxSize) {
        const oldestKey = ALIAS_NGRAM_INDEX_CACHE.keys().next().value;
        if (!oldestKey) {
            return;
        }
        ALIAS_NGRAM_INDEX_CACHE.delete(oldestKey);
    }
}
function configuredAliasNgramIndexCacheSize() {
    const rawValue = readOptionalEnv('OSE_ALIAS_NGRAM_CACHE_SIZE');
    if (!rawValue) {
        return DEFAULT_ALIAS_NGRAM_INDEX_CACHE_SIZE;
    }
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(value) || value < 1) {
        return DEFAULT_ALIAS_NGRAM_INDEX_CACHE_SIZE;
    }
    return value;
}
async function loadAliasNgramRuntimeIndex(sourceName, locale, includeFamilySupportingAliases) {
    const binaryIndex = await loadOccupationAliasNgramBinaryIfAvailable(sourceName, locale, includeFamilySupportingAliases);
    if (binaryIndex) {
        return binaryIndex;
    }
    throw new Error([
        `Missing required binary alias-ngram artifact for source="${sourceName}" locale="${locale}".`,
        `family_support=${includeFamilySupportingAliases ? 'yes' : 'no'}`,
        'Run `npm run runtime:artifacts-build` before runtime resolution.'
    ].join(' '));
}
function retrieveAliasNgramRuntimeHits(runtimeIndex, preparedQuery, options) {
    return retrieveBinaryAliasNgramHits(runtimeIndex, preparedQuery, options);
}
export function isAliasNgramFamilySupportEnabled() {
    const disableValue = readOptionalEnv('OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT')?.toLowerCase();
    if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
        return false;
    }
    const enableValue = readOptionalEnv('OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT')?.toLowerCase();
    return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}
function partitionCanonicalLabelEvidence(rows, exactQueries, foldedQueries) {
    const exactQuerySet = new Set(exactQueries);
    const exactRows = [];
    const foldedRows = [];
    for (const row of rows) {
        const evidenceRow = {
            graph_node_id: row.graphNodeId,
            canonical_label: row.canonicalLabel,
            alias: row.canonicalLabel,
            normalized_alias: row.normalizedLabel,
            alias_role: 'canonical_label',
            alias_role_rank: null,
            weight: 1,
            alias_authority_score: null,
            alias_token_count: null
        };
        if (exactQuerySet.has(row.normalizedLabel)) {
            exactRows.push(evidenceRow);
            continue;
        }
        if (foldedQueries.has(foldSearchLookupText(row.normalizedLabel))) {
            foldedRows.push(evidenceRow);
        }
    }
    return { exactRows, foldedRows };
}
function hasWholeAliasEvidence(canonicalEvidence, exactAliasRows, foldedAliasRows) {
    return (canonicalEvidence.exactRows.length > 0 ||
        exactAliasRows.length > 0 ||
        canonicalEvidence.foldedRows.length > 0 ||
        foldedAliasRows.length > 0);
}
function aliasAuthorityDetails(row) {
    return {
        alias_role_rank: row.alias_role_rank,
        alias_authority_score: row.alias_authority_score,
        indexed_alias_token_count: row.alias_token_count
    };
}
function aliasEvidenceDetails(row) {
    return {
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
        aliasRole: row.alias_role,
        aliasWeight: toNullableNumber(row.weight),
        details: aliasAuthorityDetails(row)
    };
}
function findSubphraseAliasMatches(rows, preparedQuery) {
    const queryTokens = preparedQuery.foldedTokens;
    const usefulQueryTokens = preparedQuery.usefulFoldedTokens;
    const queryTokenCount = queryTokens.length;
    const matches = findExactAliasAlternativeMatches(rows, preparedQuery);
    const seen = new Set();
    if (queryTokenCount < 2 || usefulQueryTokens.length === 0) {
        return matches;
    }
    for (const row of rows) {
        if (row.normalized_alias === preparedQuery.normalized) {
            continue;
        }
        const foldedAlias = foldSearchText(row.normalized_alias);
        if (foldedAlias === preparedQuery.folded) {
            continue;
        }
        const aliasTokens = tokenizeNormalizedText(foldedAlias);
        const usefulAliasTokens = aliasTokens.filter((token) => isUsefulQueryToken(token, preparedQuery.locale));
        if (!isSafeSubphraseAlias(usefulAliasTokens)) {
            continue;
        }
        const aliasInQuery = containsTokenPhrase(usefulQueryTokens, usefulAliasTokens, preparedQuery.locale);
        const queryInAlias = containsTokenPhrase(usefulAliasTokens, usefulQueryTokens, preparedQuery.locale);
        const longestMatch = longestContiguousTokenMatch(usefulQueryTokens, usefulAliasTokens, preparedQuery.locale);
        if (!aliasInQuery && !queryInAlias) {
            continue;
        }
        const key = `${row.graph_node_id}|${foldedAlias}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        matches.push({
            ...row,
            foldedAlias,
            matchType: aliasInQuery ? 'alias_in_query' : 'query_in_alias',
            matchedTokens: longestMatch,
            aliasTokenCount: usefulAliasTokens.length,
            queryTokenCount: usefulQueryTokens.length,
            subphraseScore: scoreSubphraseAlias(usefulAliasTokens.length, usefulQueryTokens.length, aliasInQuery, longestMatch.length)
        });
    }
    return matches.sort((left, right) => right.subphraseScore - left.subphraseScore ||
        (toNullableNumber(right.weight) ?? 0) - (toNullableNumber(left.weight) ?? 0) ||
        left.canonical_label.localeCompare(right.canonical_label));
}
function findExactAliasAlternativeMatches(rows, preparedQuery) {
    const usefulQueryTokens = preparedQuery.usefulFoldedTokens;
    const matches = [];
    const seen = new Set();
    if (usefulQueryTokens.length === 0) {
        return matches;
    }
    for (const row of rows) {
        for (const aliasAlternative of foldedAliasAlternatives(row.normalized_alias)) {
            const alternativeTokens = tokenizeNormalizedText(aliasAlternative).filter((token) => isUsefulQueryToken(token, preparedQuery.locale));
            if (alternativeTokens.length === 0 || !sameTokenPhrase(alternativeTokens, usefulQueryTokens, preparedQuery.locale)) {
                continue;
            }
            const key = `${row.graph_node_id}|${aliasAlternative}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            matches.push({
                ...row,
                foldedAlias: aliasAlternative,
                matchType: 'alias_alternative_exact',
                matchedTokens: alternativeTokens,
                aliasTokenCount: alternativeTokens.length,
                queryTokenCount: usefulQueryTokens.length,
                subphraseScore: ALIAS_MATCH_POLICY.ALTERNATIVE_EXACT_SUBPHRASE_SCORE
            });
        }
    }
    return matches;
}
function foldedAliasAlternatives(normalizedAlias) {
    if (!/[\u002f,;|]/u.test(normalizedAlias)) {
        return [];
    }
    return Array.from(new Set(normalizedAlias
        .split(/[\u002f,;|]/u)
        .map((part) => foldSearchText(normalizeSearchText(part)))
        .filter(Boolean)));
}
function sameTokenPhrase(leftTokens, rightTokens, locale) {
    return leftTokens.length === rightTokens.length && containsTokenPhrase(leftTokens, rightTokens, locale);
}
function exactAliasQueriesForPreparedQuery(preparedQuery) {
    return Array.from(new Set([
        ...expandQueryTokenSequence(preparedQuery.tokens, preparedQuery.locale),
        ...expandQueryTokenSequence(preparedQuery.usefulTokens, preparedQuery.locale)
    ]));
}
function foldedAliasQueriesForPreparedQuery(preparedQuery) {
    return new Set([
        ...expandQueryTokenSequence(preparedQuery.foldedTokens, preparedQuery.locale),
        ...expandQueryTokenSequence(preparedQuery.usefulFoldedTokens, preparedQuery.locale)
    ].map((query) => foldSearchLookupText(query)));
}
function expandQueryTokenSequence(tokens, locale) {
    const maxVariantQueries = 24;
    if (tokens.length === 0 || tokens.length > 5) {
        return [tokens.join(' ')].filter(Boolean);
    }
    let phrases = [''];
    for (const token of tokens) {
        const tokenVariants = expandTokenVariants([token], locale);
        const nextPhrases = [];
        for (const phrase of phrases) {
            for (const variant of tokenVariants) {
                nextPhrases.push(`${phrase} ${variant}`.trim());
            }
        }
        phrases = Array.from(new Set(nextPhrases)).slice(0, maxVariantQueries);
        if (phrases.length >= maxVariantQueries) {
            break;
        }
    }
    return Array.from(new Set(phrases));
}
function isSafeSubphraseAlias(aliasTokens) {
    if (aliasTokens.length >= 2) {
        return aliasTokens.some((token) => token.length >= 4);
    }
    const token = aliasTokens[0] ?? '';
    return token.length >= 6;
}
function scoreSubphraseAlias(aliasTokenCount, queryTokenCount, aliasInQuery, longestMatchTokenCount) {
    const coverage = aliasInQuery ? aliasTokenCount / Math.max(queryTokenCount, 1) : queryTokenCount / Math.max(aliasTokenCount, 1);
    const longestMatchBoost = Math.min(longestMatchTokenCount, ALIAS_MATCH_POLICY.MAX_LONGEST_MATCH_TOKENS) * ALIAS_MATCH_POLICY.LONGEST_MATCH_TOKEN_BONUS;
    const phraseStrength = aliasTokenCount >= 2 && queryTokenCount >= 2 ? ALIAS_MATCH_POLICY.MULTI_TOKEN_PHRASE_BASE : ALIAS_MATCH_POLICY.SINGLE_TOKEN_PHRASE_BASE;
    return roundScore(Math.min(ALIAS_MATCH_POLICY.MAX_SUBPHRASE_SCORE, phraseStrength + Math.min(coverage, 1) * ALIAS_MATCH_POLICY.COVERAGE_CONTRIBUTION + longestMatchBoost));
}
function getOrCreateCandidate(candidatesByNodeId, graphNodeId, canonicalLabel) {
    const existing = candidatesByNodeId.get(graphNodeId);
    if (existing) {
        return existing;
    }
    const candidate = {
        graphNodeId,
        canonicalLabel,
        evidence: []
    };
    candidatesByNodeId.set(graphNodeId, candidate);
    return candidate;
}
function addEvidence(candidatesByNodeId, graphNodeId, canonicalLabel, evidence) {
    getOrCreateCandidate(candidatesByNodeId, graphNodeId, canonicalLabel).evidence.push(evidence);
}
function buildCapabilityTaskEvidence(row) {
    if (row.usefulQueryTokenCount < 2) {
        return null;
    }
    const capabilitySignals = row.fieldSignals.filter((signal) => signal.fieldClass === 'capability' && signal.usefulMatchedTokenCount > 0);
    if (capabilitySignals.length === 0) {
        return null;
    }
    const maxUsefulTokenCoverage = roundScore(Math.max(...capabilitySignals.map((signal) => signal.usefulTokenCoverage), 0));
    if (maxUsefulTokenCoverage <= 0) {
        return null;
    }
    const usefulMatchedTokens = Array.from(new Set(capabilitySignals.flatMap((signal) => signal.usefulMatchedTokens))).sort();
    const capabilityAlignment = CAPABILITY_TASK_POLICY.BASE_ALIGNMENT + maxUsefulTokenCoverage * CAPABILITY_TASK_POLICY.COVERAGE_ALIGNMENT_WEIGHT;
    const score = roundScore(row.score * Math.min(1, capabilityAlignment));
    if (score <= 0) {
        return null;
    }
    return {
        channel: 'capability_task',
        score,
        details: {
            source_channel: 'opensearch_lexical',
            opensearch_score: row.score,
            lexical_signal_score: row.lexicalSignalScore,
            matched_tokens: usefulMatchedTokens,
            field_signals: capabilitySignals,
            max_useful_token_coverage: maxUsefulTokenCoverage,
            useful_query_token_count: row.usefulQueryTokenCount
        }
    };
}
function finalizeCandidate(candidate) {
    const channelScores = {};
    for (const evidence of candidate.evidence) {
        channelScores[evidence.channel] = Math.max(channelScores[evidence.channel] ?? 0, evidence.score);
    }
    // `capability_task` is not an independent retrieval channel: buildCapabilityTaskEvidence()
    // derives it from the same opensearch_lexical row (score = row.score * min(1, 0.35 + coverage
    // * 0.65)), so it can never exceed that row's own opensearch_lexical score. Summing both with
    // separate weights below would double-count one opensearch hit as if it were two corroborating
    // signals, inflating loosely-matched candidates relative to ones whose only evidence is a
    // genuinely independent channel (e.g. ngram_alias). Only the max of the two is counted.
    const totalScore = roundScore((channelScores.exact_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.EXACT_ALIAS +
        (channelScores.folded_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.FOLDED_ALIAS +
        (channelScores.ngram_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.NGRAM_ALIAS +
        Math.max(channelScores.opensearch_lexical ?? 0, channelScores.capability_task ?? 0) *
            RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.OPENSEARCH_LEXICAL);
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        totalScore,
        channelScores,
        evidence: candidate.evidence.sort((left, right) => channelOrder(left.channel) - channelOrder(right.channel) || right.score - left.score)
    };
}
function channelOrder(channel) {
    if (channel === 'exact_alias') {
        return 1;
    }
    if (channel === 'folded_alias') {
        return 2;
    }
    if (channel === 'ngram_alias') {
        return 3;
    }
    if (channel === 'opensearch_lexical') {
        return 4;
    }
    if (channel === 'capability_task') {
        return 5;
    }
    return 6;
}
function normalizeRequiredQuery(query) {
    const normalized = query?.trim();
    if (!normalized) {
        throw new Error('Provide --query="..." or --evaluation-query-id=N.');
    }
    return normalized;
}
function normalizeLocale(locale) {
    const normalized = locale?.trim().toLowerCase();
    return normalized || DEFAULT_RETRIEVAL_LOCALE;
}
function normalizeSourceName(sourceName) {
    const normalized = sourceName?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeModelKey(modelKey) {
    const normalized = modelKey?.trim();
    return normalized || DEFAULT_MODEL_KEY;
}
function normalizeLimit(limit) {
    return requirePositiveIntegerAtMost(limit ?? DEFAULT_CANDIDATE_LIMIT, 1000, 'Candidate limit');
}
function toNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
