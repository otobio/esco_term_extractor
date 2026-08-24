import { readOptionalEnv } from '../config/env.js';
import { containsTokenPhrase, expandTokenVariants, isUsefulQueryToken, longestContiguousTokenMatch, preparedQueryCompoundExpandedFoldedTokens, preparedQueryFoldedRecallSurfaces, preparedQueryIntentRetrievalSequences, preparedQueryNormalizedRecallSurfaces, prepareQuery } from '../query/query-preparation.js';
import { foldWeakPunctuationLookupText, foldSearchLookupText, foldSearchText, normalizeSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { ALIAS_MATCH_POLICY, CAPABILITY_TASK_POLICY, RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT } from '../scoring/scoring-policy.js';
import { createRetrievalEngine } from './retrieval-engine-factory.js';
import { retrieveBinaryAliasNgramHits } from './alias-ngram-retriever.js';
import { shouldSuppressContextOnlySupportingAlias } from './intent-support-grounding.js';
import { shouldSuppressContextOnlyLexicalMatch } from './intent-support-grounding.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { timed } from '../utils/timing.js';
import { requirePositiveIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';
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
        if (!options.retrievalQuery) {
            throw new Error('Missing required query input. Provide --retrieval-query');
        }
        const sourceName = normalizeSourceName(options.sourceName);
        const limit = normalizeLimit(options.limit);
        const timings = {};
        const locale = normalizeLocale(options.locale);
        const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
        const retrievalQuery = options.retrievalQuery;
        const preparedQuery = retrievalQuery.preparedQuery;
        const debugCollector = options.debugCollector ?? null;
        const retrievalSurfaces = await prepareRetrievalSurfaces(sourceName, retrievalQuery.query, locale, preparedQuery, timings);
        const retrievalLocales = retrievalSurfaces.map((surface) => surface.locale);
        const exactRows = [];
        const foldedRows = [];
        const subphraseMatches = [];
        const ngramMatches = [];
        const openSearchRows = [];
        let scannedAliasHitCount = 0;
        let hasWholeAlias = false;
        for (const surface of retrievalSurfaces) {
            const rawSurfacePreparedQuery = retrievalQuery.originalQuery === retrievalQuery.query
                ? surface.preparedQuery
                : await timed(() => prepareQuery(retrievalQuery.originalQuery, surface.locale, { sourceName }), 'candidate.raw_canonical_prepare', timings);
            const foldedAliasQueries = Array.from(surface.foldedAliasQueries);
            const aliasRetrieval = await timed(() => this.aliasRetriever.retrieve({
                sourceName,
                locale: surface.locale,
                preparedQuery: surface.preparedQuery,
                exactAliasQueries: surface.exactAliasQueries,
                foldedAliasQueries: foldedAliasQueries,
                limit
            }), 'candidate.alias_retrieval', timings);
            const canonicalLabelRows = await timed(() => this.occupationRetriever.retrieveCanonicalLabels({
                locale: surface.locale,
                sourceName,
                preparedQuery: surface.preparedQuery,
                foldedQueries: foldedAliasQueries,
                limit
            }), 'candidate.canonical_label_retrieval', timings);
            const rawCanonicalLabelRows = retrievalQuery.query !== retrievalQuery.originalQuery
                ? await timed(() => this.occupationRetriever.retrieveCanonicalLabels({
                    locale: surface.locale,
                    sourceName,
                    preparedQuery: rawSurfacePreparedQuery,
                    foldedQueries: [foldSearchLookupText(rawSurfacePreparedQuery.normalized)],
                    limit: Math.min(limit, 5)
                }), 'candidate.raw_canonical_label_retrieval', timings)
                : [];
            const lexicalRows = await timed(() => this.occupationRetriever.retrieve({
                locale: surface.locale,
                sourceName,
                preparedQuery: surface.preparedQuery,
                limit
            }), 'candidate.lexical_retrieval', timings);
            const canonicalEvidence = partitionCanonicalLabelEvidence(canonicalLabelRows, surface.exactAliasQueries, surface.foldedAliasQueries);
            const rawCanonicalEvidence = partitionCanonicalLabelEvidence(rawCanonicalLabelRows, preparedQueryNormalizedRecallSurfaces(rawSurfacePreparedQuery), new Set(preparedQueryFoldedRecallSurfaces(rawSurfacePreparedQuery).map((query) => foldSearchLookupText(query))));
            const foldedMatches = aliasRetrieval.foldedRows.filter((row) => row.normalized_alias !== preparedQuery.normalized && surface.foldedAliasQueries.has(foldSearchLookupText(row.normalized_alias)));
            exactRows.push(...canonicalEvidence.exactRows, ...rawCanonicalEvidence.exactRows, ...aliasRetrieval.exactRows);
            foldedRows.push(...canonicalEvidence.foldedRows, ...rawCanonicalEvidence.foldedRows, ...foldedMatches);
            subphraseMatches.push(...findSubphraseAliasMatches(aliasRetrieval.subphraseRows, surface.preparedQuery));
            openSearchRows.push(...lexicalRows);
            scannedAliasHitCount += aliasRetrieval.scannedAliasHitCount + canonicalLabelRows.length + rawCanonicalLabelRows.length;
            hasWholeAlias =
                hasWholeAlias ||
                    hasWholeAliasEvidence(canonicalEvidence, aliasRetrieval.exactRows, foldedMatches) ||
                    hasWholeAliasEvidence(rawCanonicalEvidence, [], []);
        }
        if (!hasWholeAlias) {
            for (const surface of retrievalSurfaces) {
                ngramMatches.push(...(await this.retrieveAliasNgramMatches(sourceName, surface.preparedQuery, limit, timings, debugCollector)));
            }
        }
        const candidates = await timed(() => this.buildCandidates(preparedQuery, exactRows, foldedRows, subphraseMatches, ngramMatches, openSearchRows, debugCollector), 'candidate.build_candidates', timings);
        return {
            retrievalLocales,
            retrievalProfile,
            scannedAliasHitCount,
            scannedOpenSearchHitCount: openSearchRows.length,
            timings,
            candidates
        };
    }
    async retrieveAliasNgramMatches(sourceName, preparedQuery, limit, timings, debugCollector) {
        if (!isAliasNgramRetrievalEnabled()) {
            return [];
        }
        const index = await timed(() => loadAliasNgramIndex(sourceName, preparedQuery.locale), 'candidate.alias_ngram_index_load', timings);
        return timed(() => retrieveBinaryAliasNgramHits(index, preparedQuery, { limit: Math.max(limit * 3, 25), debugCollector }), 'candidate.alias_ngram_retrieval', timings);
    }
    buildCandidates(preparedQuery, exactRows, foldedRows, subphraseRows, ngramRows, openSearchRows, debugCollector) {
        const candidatesByNodeId = new Map();
        for (const row of exactRows) {
            const channel = row.alias_role === 'canonical_label' ? 'exact_canonical' : 'exact_alias';
            addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
                channel,
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
            if (shouldSuppressContextOnlySupportingAlias(row.alias_role, row.matchedTokens, preparedQuery)) {
                continue;
            }
            const aliasWeight = toNullableNumber(row.weight);
            const downgradeWeakAliasInQuery = shouldDowngradeWeakAliasInQuery(row);
            const channel = row.matchType === 'query_in_alias' || downgradeWeakAliasInQuery ? 'lexical' : 'folded_alias';
            addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
                channel,
                ...aliasEvidenceDetails(row),
                score: roundScore((aliasWeight ?? 1) * row.subphraseScore),
                foldedAlias: row.foldedAlias,
                details: {
                    ...aliasAuthorityDetails(row),
                    match_type: row.matchType,
                    downgraded_weak_alias_in_query: downgradeWeakAliasInQuery,
                    matched_tokens: row.matchedTokens,
                    alias_token_count: row.aliasTokenCount,
                    query_token_count: row.queryTokenCount
                }
            });
        }
        for (const row of ngramRows) {
            if (row.aliasRole === 'family_supporting') {
                continue;
            }
            if (shouldSuppressContextOnlySupportingAlias(row.aliasRole, row.matchedTokens, preparedQuery)) {
                continue;
            }
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
                    query_useful_token_coverage: row.queryUsefulTokenCoverage,
                    alias_useful_token_coverage: row.aliasUsefulTokenCoverage,
                    phrase_direction: row.phraseDirection,
                    matched_tokens: row.matchedTokens,
                    matched_features: row.matchedFeatures
                }
            });
        }
        for (const row of openSearchRows) {
            if (shouldSuppressContextOnlyLexicalMatch(preparedQuery, row.matchedTokens)) {
                continue;
            }
            debugCollector?.collectLexicalAdmission(preparedQuery, row);
            addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, {
                channel: 'lexical',
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
            (right.channelScores.exact_canonical ?? 0) - (left.channelScores.exact_canonical ?? 0) ||
            (right.channelScores.exact_alias ?? 0) - (left.channelScores.exact_alias ?? 0) ||
            (right.channelScores.folded_alias ?? 0) - (left.channelScores.folded_alias ?? 0) ||
            (right.channelScores.ngram_alias ?? 0) - (left.channelScores.ngram_alias ?? 0) ||
            (right.channelScores.lexical ?? 0) - (left.channelScores.lexical ?? 0) ||
            (right.channelScores.capability_task ?? 0) - (left.channelScores.capability_task ?? 0) ||
            left.canonicalLabel.localeCompare(right.canonicalLabel));
    }
}
async function prepareRetrievalSurfaces(sourceName, query, locale, preparedQuery, timings) {
    const surfaceLocales = retrievalSurfaceLocales(locale);
    const surfaces = [];
    for (const surfaceLocale of surfaceLocales) {
        const surfacePreparedQuery = surfaceLocale === preparedQuery.locale
            ? preparedQuery
            : await timed(() => prepareQuery(query, surfaceLocale, { sourceName }), 'candidate.secondary_surface_prepare', timings);
        const expansionBundle = preparedQueryExpansionBundle(surfacePreparedQuery);
        surfaces.push({
            locale: surfaceLocale,
            preparedQuery: surfacePreparedQuery,
            exactAliasQueries: expansionBundle.normalizedExpandedQueries,
            foldedAliasQueries: new Set(expansionBundle.foldedExpandedQueries.map((expandedQuery) => foldSearchLookupText(expandedQuery)))
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
/**
 * The binary artifact module already caches and version-checks the loaded
 * index by manifest path and disposes it (closing its file descriptors) on
 * eviction. A second cache here previously wrapped the same resource with
 * its own, uncoordinated eviction policy; once the lower cache disposed an
 * entry this one kept handing out the now-closed object, causing EBADF /
 * stale-fd reads under concurrent multi-locale traffic. Delegate straight
 * through so there is a single owner of the resource's lifetime.
 */
function loadAliasNgramIndex(sourceName, locale) {
    return loadAliasNgramRuntimeIndex(sourceName, locale, isAliasNgramFamilySupportEnabled());
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
    const exactWeakPunctuationQuerySet = new Set(exactQueries.map((query) => foldWeakPunctuationLookupText(query)));
    const foldedQueryVariants = new Set(foldedQueries);
    for (const foldedQuery of foldedQueries) {
        foldedQueryVariants.add(foldWeakPunctuationLookupText(foldedQuery));
    }
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
        if (exactQuerySet.has(row.normalizedLabel) || exactWeakPunctuationQuerySet.has(foldWeakPunctuationLookupText(row.normalizedLabel))) {
            exactRows.push(evidenceRow);
            continue;
        }
        if (foldedQueryVariants.has(foldSearchLookupText(row.normalizedLabel)) ||
            foldedQueryVariants.has(foldWeakPunctuationLookupText(row.normalizedLabel))) {
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
    const usefulQueryTokens = preparedQuery.usefulFoldedRecallTokens;
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
    const usefulQueryTokens = preparedQuery.usefulFoldedRecallTokens;
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
function preparedQueryExpansionBundle(preparedQuery) {
    return {
        normalizedExpandedQueries: Array.from(new Set(expandedPreparedQueryTokenSequences(preparedQuery))),
        foldedExpandedQueries: Array.from(new Set(expandedPreparedQueryFoldedTokenSequences(preparedQuery)))
    };
}
function expandedPreparedQueryTokenSequences(preparedQuery) {
    const retrievalSequences = preparedQueryIntentRetrievalSequences(preparedQuery);
    return [
        ...preparedQueryNormalizedRecallSurfaces(preparedQuery),
        ...compoundExpandedExactAliasProbeQueries(preparedQuery, 'normalized'),
        ...fullUsefulVariantExactAliasProbeQueries(preparedQuery, 'normalized'),
        ...retrievalSequences.primaryNormalizedTokenSequences.flatMap((tokens) => expandQueryTokenSequence(tokens, preparedQuery.locale)),
        ...retrievalSequences.contextualNormalizedTokenSequences.flatMap((tokens) => expandQueryTokenSequence(tokens, preparedQuery.locale))
    ].filter(Boolean);
}
function expandedPreparedQueryFoldedTokenSequences(preparedQuery) {
    const retrievalSequences = preparedQueryIntentRetrievalSequences(preparedQuery);
    return [
        ...preparedQueryFoldedRecallSurfaces(preparedQuery),
        ...compoundExpandedExactAliasProbeQueries(preparedQuery, 'folded'),
        ...fullUsefulVariantExactAliasProbeQueries(preparedQuery, 'folded'),
        ...retrievalSequences.primaryFoldedTokenSequences.flatMap((tokens) => expandQueryTokenSequence(tokens, preparedQuery.locale)),
        ...retrievalSequences.contextualFoldedTokenSequences.flatMap((tokens) => expandQueryTokenSequence(tokens, preparedQuery.locale)),
        ...expandQueryTokenSequence(preparedQueryCompoundExpandedFoldedTokens(preparedQuery), preparedQuery.locale)
    ].filter(Boolean);
}
function compoundExpandedExactAliasProbeQueries(preparedQuery, surface) {
    const compoundTokens = surface === 'normalized' ? preparedQuery.compoundExpandedTokens : preparedQueryCompoundExpandedFoldedTokens(preparedQuery);
    const baseTokens = surface === 'normalized' ? preparedQuery.tokens : preparedQuery.foldedTokens;
    if (compoundTokens.length === 0 || compoundTokens.join(' ') === baseTokens.join(' ')) {
        return [];
    }
    const usefulCompoundTokens = surface === 'normalized'
        ? preparedQuery.compoundExpandedTokens.filter((token) => isUsefulQueryToken(token, preparedQuery.locale))
        : preparedQueryCompoundExpandedFoldedTokens(preparedQuery).filter((token) => isUsefulQueryToken(token, preparedQuery.locale));
    return [
        ...expandQueryTokenSequence(compoundTokens, preparedQuery.locale),
        ...expandQueryTokenSequence(usefulCompoundTokens, preparedQuery.locale)
    ].filter(Boolean);
}
function fullUsefulVariantExactAliasProbeQueries(preparedQuery, surface) {
    const usefulTokens = surface === 'normalized' ? preparedQuery.usefulRecallTokens : preparedQuery.usefulFoldedRecallTokens;
    const baseQuery = surface === 'normalized' ? preparedQuery.normalized : preparedQuery.folded;
    if (usefulTokens.length < 2) {
        return [];
    }
    return expandQueryTokenSequence(usefulTokens, preparedQuery.locale).filter((query) => query && query !== baseQuery);
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
function shouldDowngradeWeakAliasInQuery(row) {
    return row.matchType === 'alias_in_query' && row.queryTokenCount >= 3 && row.matchedTokens.length < 2;
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
    const maxUsefulTokenCoverage = roundScore(maxOf(capabilitySignals, (signal) => signal.usefulTokenCoverage));
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
            source_channel: 'lexical',
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
    // derives it from the same lexical row (score = row.score * min(1, 0.35 + coverage
    // * 0.65)), so it can never exceed that row's own lexical score. Summing both with
    // separate weights below would double-count one opensearch hit as if it were two corroborating
    // signals, inflating loosely-matched candidates relative to ones whose only evidence is a
    // genuinely independent channel (e.g. ngram_alias). Only the max of the two is counted.
    const totalScore = roundScore((channelScores.exact_canonical ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.EXACT_CANONICAL +
        (channelScores.exact_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.EXACT_ALIAS +
        (channelScores.folded_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.FOLDED_ALIAS +
        (channelScores.ngram_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.NGRAM_ALIAS +
        Math.max(channelScores.lexical ?? 0, channelScores.capability_task ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.OPENSEARCH_LEXICAL);
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        totalScore,
        channelScores,
        evidence: candidate.evidence.sort((left, right) => channelOrder(left.channel) - channelOrder(right.channel) || right.score - left.score)
    };
}
function channelOrder(channel) {
    if (channel === 'exact_canonical') {
        return 0;
    }
    if (channel === 'exact_alias') {
        return 1;
    }
    if (channel === 'folded_alias') {
        return 2;
    }
    if (channel === 'ngram_alias') {
        return 3;
    }
    if (channel === 'lexical') {
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
