import { isUsefulQueryToken, prepareQuery } from '../query/query-preparation.js';
import { foldWeakPunctuationLookupText, foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { OPENSEARCH_AUTHORITY_SCORE, OPENSEARCH_FIELD_STRENGTH, OPENSEARCH_LEXICAL_SIGNAL_POLICY, OPENSEARCH_PHRASE_WINDOW_POLICY } from '../scoring/scoring-policy.js';
import { RETRIEVAL_TEXT_FIELDS, findRange, findStringId, loadOccupationRetrievalIndexRequired, rowValue, stringAt, uint32RowValue, uint32RowsSlice } from '../runtime/occupation-retrieval-index-artifact.js';
import { maxOf, roundScore } from '../utils/operators.js';
import { buildAliasHeadTokenFallbackWindows, buildAliasPhraseWindows } from './alias-phrase-windows.js';
import { buildAuthorityQueryPreparation } from './authority-query-preparation.js';
const DEFAULT_ALIAS_SEARCH_SIZE = 1000;
const MAX_GLOBAL_TEXT_CANDIDATES = 250;
const MAX_FAMILY_TEXT_CANDIDATES = 180;
const NULL_U32 = 0xffffffff;
const TITLE_AND_ALIAS_FIELDS = [
    'canonical_label',
    'locale_primary_aliases_text',
    'locale_supporting_aliases_text',
    'reviewed_crosswalk_aliases_text',
    'aliases_text',
    'family_supporting_aliases_text',
    'english_backbone_aliases_text'
];
const BROAD_FIELDS = ['search_text', 'capability_text', 'ancestor_text'];
export function createBinaryRetrievalEngine() {
    const occupations = new BinaryOccupationRetriever();
    return {
        aliases: new BinaryAliasRetriever(),
        occupations
    };
}
export class BinaryAliasRetriever {
    async retrieve(options) {
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
export class BinaryOccupationRetriever {
    async retrieve(options) {
        const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
        return retrieveTextHits(index, options);
    }
    async retrieveCanonicalLabels(options) {
        const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
        const localeId = localeIdFor(index, options.locale);
        const rows = [];
        const queries = new Set(uniqueNonEmpty(options.foldedQueries));
        for (const query of Array.from(queries)) {
            queries.add(foldWeakPunctuationLookupText(query));
        }
        for (const query of queries) {
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
    async retrieveWithinFamily(options) {
        const index = await loadOccupationRetrievalIndexRequired(options.sourceName);
        return retrieveTextHits(index, options, options.familyNodeId);
    }
}
async function retrieveTextHits(index, options, familyNodeId) {
    const localeId = localeIdFor(index, options.locale);
    const preparedQuery = options.preparedQuery ?? (await prepareQuery(options.query, options.locale, { sourceName: options.sourceName }));
    const authorityPreparation = buildAuthorityQueryPreparation(options.query, preparedQuery);
    const queryTokens = authorityPreparation.queryTokens;
    const tokenIdCache = new Map();
    const tokenIdFor = (token) => {
        const cached = tokenIdCache.get(token);
        if (cached !== undefined) {
            return cached;
        }
        const tokenId = findStringId(index.strings, token);
        tokenIdCache.set(token, tokenId);
        return tokenId;
    };
    const queryTokenIds = queryTokens.map(tokenIdFor).filter((id) => id >= 0);
    const candidateRecordIds = candidateTextRecordIds(index, localeId, queryTokenIds, queryTokens, familyNodeId);
    const authorityMatches = buildAuthorityMatches(authorityPreparation, tokenIdFor);
    const scoredHits = candidateRecordIds
        .map((recordId) => scoreTextRecord(index, recordId, authorityMatches, queryTokens, queryTokens.map(tokenIdFor), options.locale))
        .filter((hit) => hit !== null);
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
function matchingAliasRows(index, localeId, queries, keyIndex, postings) {
    const seenRowIds = new Set();
    const rows = [];
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
function candidateAliasRowIds(index, localeId, phraseWindowTokens) {
    const selected = new Set();
    const rowIds = [];
    const tokenIds = Array.from(new Set(phraseWindowTokens
        .flat()
        .map((token) => findStringId(index.strings, token))
        .filter((id) => id >= 0)));
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
function candidateTextRecordIds(index, localeId, queryTokenIds, _queryTokens, familyNodeId) {
    const selected = new Set();
    const recordIds = [];
    const limit = familyNodeId === undefined ? MAX_GLOBAL_TEXT_CANDIDATES : MAX_FAMILY_TEXT_CANDIDATES;
    const usefulTokenIds = queryTokenIds.filter((tokenId) => isUsefulQueryToken(stringAt(index.strings, tokenId), localeFromId(index, localeId)));
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
function appendAllTermFieldCandidates(index, selected, recordIds, localeId, field, tokenIds, familyNodeId, limit) {
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
function appendUnionFieldCandidates(index, selected, recordIds, localeId, field, tokenIds, familyNodeId, limit) {
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
function appendRecordId(index, selected, recordIds, recordId, familyNodeId, limit) {
    if (recordIds.length >= limit || selected.has(recordId)) {
        return;
    }
    if (familyNodeId !== undefined && textRecordFamilyNodeId(index, recordId) !== familyNodeId) {
        return;
    }
    selected.add(recordId);
    recordIds.push(recordId);
}
function buildAuthorityMatches(authorityPreparation, tokenIdFor) {
    const { preparedQueries, preparedPhraseWindows, rawQueries } = authorityPreparation;
    const matches = [];
    preparedPhraseWindows.forEach((phraseWindow, index) => {
        const suffix = `window_len_${phraseWindow.tokenCount}_idx_${index.toString().padStart(2, '0')}`;
        matches.push(authorityMatch(`authority_010_prepared_primary_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_PRIMARY_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['locale_primary_aliases_text']), authorityMatch(`authority_020_prepared_canonical_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_CANONICAL_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['canonical_label']), authorityMatch(`authority_030_prepared_supporting_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_SUPPORTING_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['locale_supporting_aliases_text']), authorityMatch(`authority_040_prepared_reviewed_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_REVIEWED_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['reviewed_crosswalk_aliases_text']), authorityMatch(`authority_045_prepared_family_support_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_FAMILY_SUPPORT_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['family_supporting_aliases_text']), authorityMatch(`authority_050_prepared_backbone_phrase_${suffix}`, phraseWindowAuthorityScore(OPENSEARCH_AUTHORITY_SCORE.PREPARED_BACKBONE_PHRASE, phraseWindow), phraseWindow.query, tokenIdFor, 'phrase', ['english_backbone_aliases_text']));
    });
    for (const query of rawQueries) {
        matches.push(authorityMatch('authority_060_raw_primary_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_PRIMARY_OR_CANONICAL_PHRASE, query, tokenIdFor, 'phrase', [
            'locale_primary_aliases_text',
            'canonical_label'
        ]), authorityMatch('authority_070_raw_supporting_phrase', OPENSEARCH_AUTHORITY_SCORE.RAW_SUPPORTING_OR_REVIEWED_PHRASE, query, tokenIdFor, 'phrase', [
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'family_supporting_aliases_text',
            'english_backbone_aliases_text'
        ]));
    }
    for (const query of preparedQueries) {
        matches.push(authorityMatch('authority_080_prepared_all_terms', OPENSEARCH_AUTHORITY_SCORE.PREPARED_ALL_TERMS, query, tokenIdFor, 'all_terms', [
            'locale_primary_aliases_text',
            'canonical_label',
            'locale_supporting_aliases_text',
            'reviewed_crosswalk_aliases_text',
            'family_supporting_aliases_text',
            'english_backbone_aliases_text',
            'aliases_text',
            'search_text',
            'capability_text'
        ]));
    }
    for (const query of rawQueries) {
        matches.push(authorityMatch('authority_100_raw_all_terms', OPENSEARCH_AUTHORITY_SCORE.RAW_ALL_TERMS, query, tokenIdFor, 'all_terms', [
            'aliases_text',
            'search_text',
            'capability_text',
            'ancestor_text'
        ]));
    }
    return matches;
}
function scoreTextRecord(index, recordId, authorityMatches, queryTokens, queryTokenIds, locale) {
    let rawScore = 0;
    const matchedQueries = new Set();
    const matchedFields = new Set();
    for (const match of authorityMatches) {
        const fields = match.fields.filter((field) => fieldMatches(index, textRecordFieldTokenListId(index, recordId, field), match.queryTokenIds, match.type));
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
    const fieldSignals = buildFieldSignals(index, recordId, queryTokens, queryTokenIds, locale);
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
function fieldMatches(index, fieldTokenListId, queryTokenIds, type) {
    if (tokenListLength(index, fieldTokenListId) === 0 || queryTokenIds.length === 0 || queryTokenIds.some((tokenId) => tokenId < 0)) {
        return false;
    }
    if (type === 'phrase') {
        return tokenListContainsPhrase(index, fieldTokenListId, queryTokenIds);
    }
    return queryTokenIds.every((tokenId) => tokenListContainsTokenId(index, fieldTokenListId, tokenId));
}
function buildFieldSignals(index, recordId, queryTokens, queryTokenIds, locale) {
    return RETRIEVAL_TEXT_FIELDS.map((field) => buildFieldSignal(index, field, textRecordFieldTokenListId(index, recordId, field), queryTokens, queryTokenIds, locale)).filter((signal) => signal !== null);
}
function buildFieldSignal(index, field, fieldTokenListId, queryTokens, queryTokenIds, locale) {
    const matchedTokens = queryTokens.filter((_, indexOfToken) => {
        const tokenId = queryTokenIds[indexOfToken] ?? -1;
        return tokenId >= 0 && tokenListContainsTokenId(index, fieldTokenListId, tokenId);
    });
    if (matchedTokens.length === 0) {
        return null;
    }
    const usefulQueryTokens = queryTokens.filter((token) => isUsefulQueryToken(token, locale));
    const usefulMatchedTokens = matchedTokens.filter((token) => isUsefulQueryToken(token, locale));
    const fieldContainsQuery = queryTokenIds.length >= 2 && !queryTokenIds.some((tokenId) => tokenId < 0) && tokenListContainsPhrase(index, fieldTokenListId, queryTokenIds);
    const fieldTokenIds = tokenListValues(index, fieldTokenListId);
    const queryContainsField = !fieldContainsQuery && fieldTokenIds.length >= 2 && tokenIdsContainPhrase(queryTokenIds, fieldTokenIds);
    return {
        field,
        fieldClass: fieldClassForField(field),
        ...(aliasRoleForField(field) ? { aliasRole: aliasRoleForField(field) } : {}),
        // A short/single-token query is trivially "contained" in any longer field text (e.g. "jurist" inside
        // a field carrying the unrelated compound alias "jurist lingvist") -- only credit this once the query
        // has enough tokens of its own to make containment a meaningful phrase match, not a coincidental one.
        phraseMatch: fieldContainsQuery,
        // Debug-only: which direction the phrase containment fired in (field text contains the query, or vice
        // versa) -- helps distinguish "this alias fully describes the query" from "this alias is a substring of it".
        phraseMatchDirection: fieldContainsQuery ? 'field_contains_query' : queryContainsField ? 'query_contains_field' : 'none',
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
function toOccupationTextHit(hit, maxRawScore) {
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
function calculateLexicalSignalScore(hit) {
    const usefulCoverage = hit.usefulQueryTokenCount > 0 ? hit.maxUsefulTokenCoverage : maxOf(hit.fieldSignals, (signal) => signal.tokenCoverage);
    const usefulFieldStrength = maxOf(hit.fieldSignals.filter((signal) => signal.usefulMatchedTokenCount > 0 || hit.usefulQueryTokenCount === 0), (signal) => fieldStrength(signal.fieldClass));
    const phraseBoost = hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.PHRASE_MATCH_BONUS : 0;
    const shortNonPhraseCap = hit.usefulQueryTokenCount <= 2 && !hit.phraseMatch ? OPENSEARCH_LEXICAL_SIGNAL_POLICY.SHORT_NON_PHRASE_CAP : 1;
    const score = OPENSEARCH_LEXICAL_SIGNAL_POLICY.BASE_SIGNAL +
        usefulCoverage * OPENSEARCH_LEXICAL_SIGNAL_POLICY.USEFUL_COVERAGE_WEIGHT +
        usefulFieldStrength * OPENSEARCH_LEXICAL_SIGNAL_POLICY.FIELD_STRENGTH_WEIGHT +
        phraseBoost;
    return roundScore(Math.max(OPENSEARCH_LEXICAL_SIGNAL_POLICY.MIN_SIGNAL, Math.min(shortNonPhraseCap, score)));
}
function aliasEvidenceRow(index, rowId, queryBoost) {
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
function canonicalLabelHit(index, recordId) {
    return {
        graphNodeId: textRecordGraphNodeId(index, recordId),
        canonicalLabel: stringAt(index.strings, rowValue(index.textRecords, recordId, 1)),
        normalizedLabel: stringAt(index.strings, rowValue(index.textRecords, recordId, 2))
    };
}
function rangeRows(keyIndex, postings, keyColumns) {
    const range = findRange(keyIndex, keyColumns);
    if (!range || range.length === 0) {
        return [];
    }
    return uint32RowsSlice(postings, range.offset, range.length);
}
function localeIdFor(index, locale) {
    const localeIndex = index.manifest.locales.indexOf(locale);
    if (localeIndex < 0) {
        return -1;
    }
    return localeIndex + 1;
}
function localeFromId(index, localeId) {
    return index.manifest.locales[localeId - 1] ?? 'unknown';
}
function fieldIdFor(field) {
    return RETRIEVAL_TEXT_FIELDS.indexOf(field);
}
function textRecordGraphNodeId(index, recordId) {
    return rowValue(index.textRecords, recordId, 0);
}
function textRecordFamilyNodeId(index, recordId) {
    const value = rowValue(index.textRecords, recordId, 3);
    return value === NULL_U32 ? null : value;
}
function authorityMatch(name, score, query, tokenIdFor, type, fields) {
    const queryTokens = tokenizeNormalizedText(foldSearchText(query));
    return { name, score, queryTokens, queryTokenIds: queryTokens.map(tokenIdFor), type, fields };
}
function resolveAliasSubphraseRowsWithFallback(index, localeId, preparedQuery, size) {
    const primaryRows = resolveAliasSubphraseRows(index, localeId, buildAliasPhraseWindows(preparedQuery), size);
    if (primaryRows.length > 0) {
        return primaryRows;
    }
    // A multi-token query only ever searches its full-width phrase window, so it can regress to zero
    // alias evidence even when its head word alone would have matched broadly (e.g. "security personnel").
    // See buildAliasHeadTokenFallbackWindows for why this is restricted to the head token.
    return resolveAliasSubphraseRows(index, localeId, buildAliasHeadTokenFallbackWindows(preparedQuery), size);
}
function resolveAliasSubphraseRows(index, localeId, phraseWindows, size) {
    const phraseWindowTokens = phraseWindows.map((window) => tokenizeNormalizedText(foldSearchText(window)));
    if (phraseWindowTokens.length === 0) {
        return [];
    }
    return candidateAliasRowIds(index, localeId, phraseWindowTokens)
        .filter((rowId) => phraseWindowTokens.some((tokens) => {
        const tokenIds = tokens.map((token) => findStringId(index.strings, token));
        return tokenIds.length > 0 && !tokenIds.some((tokenId) => tokenId < 0) && tokenListContainsPhrase(index, rowValue(index.aliasRows, rowId, 4), tokenIds);
    }))
        .map((rowId) => aliasEvidenceRow(index, rowId, 0))
        .sort(compareAliasRows)
        .slice(0, size);
}
function phraseWindowAuthorityScore(baseScore, phraseWindow) {
    return (baseScore +
        Math.min(phraseWindow.tokenCount * OPENSEARCH_PHRASE_WINDOW_POLICY.TOKEN_AUTHORITY_INCREMENT, OPENSEARCH_PHRASE_WINDOW_POLICY.MAX_TOKEN_AUTHORITY_BONUS));
}
function textRecordFieldTokenListId(index, recordId, field) {
    return rowValue(index.textRecords, recordId, 4 + fieldIdFor(field));
}
function tokenListLength(index, tokenListId) {
    return rowValue(index.tokenListIndex, tokenListId, 1);
}
function tokenListOffset(index, tokenListId) {
    return rowValue(index.tokenListIndex, tokenListId, 0);
}
function tokenListValues(index, tokenListId) {
    const offset = tokenListOffset(index, tokenListId);
    const length = tokenListLength(index, tokenListId);
    return uint32RowsSlice(index.tokenListValues, offset, length);
}
function tokenListContainsTokenId(index, tokenListId, tokenId) {
    const offset = tokenListOffset(index, tokenListId);
    const length = tokenListLength(index, tokenListId);
    for (let cursor = 0; cursor < length; cursor += 1) {
        if (uint32RowValue(index.tokenListValues, offset + cursor) === tokenId) {
            return true;
        }
    }
    return false;
}
function tokenListContainsPhrase(index, tokenListId, queryTokenIds) {
    if (queryTokenIds.length === 0) {
        return false;
    }
    const offset = tokenListOffset(index, tokenListId);
    const length = tokenListLength(index, tokenListId);
    if (queryTokenIds.length > length) {
        return false;
    }
    for (let start = 0; start <= length - queryTokenIds.length; start += 1) {
        let matched = true;
        for (let indexOfToken = 0; indexOfToken < queryTokenIds.length; indexOfToken += 1) {
            if (uint32RowValue(index.tokenListValues, offset + start + indexOfToken) !== queryTokenIds[indexOfToken]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return true;
        }
    }
    return false;
}
function tokenIdsContainPhrase(haystack, needle) {
    if (needle.length === 0 || needle.length > haystack.length || haystack.some((tokenId) => tokenId < 0)) {
        return false;
    }
    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
        let matched = true;
        for (let indexOfToken = 0; indexOfToken < needle.length; indexOfToken += 1) {
            if (haystack[start + indexOfToken] !== needle[indexOfToken]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return true;
        }
    }
    return false;
}
function sortedIncludes(values, needle) {
    let low = 0;
    let high = values.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const value = values[mid] ?? 0;
        if (value < needle) {
            low = mid + 1;
        }
        else if (value > needle) {
            high = mid - 1;
        }
        else {
            return true;
        }
    }
    return false;
}
function compareAliasRows(left, right) {
    return ((right.alias_authority_score ?? Number.NEGATIVE_INFINITY) - (left.alias_authority_score ?? Number.NEGATIVE_INFINITY) ||
        (right.alias_role_rank ?? Number.NEGATIVE_INFINITY) - (left.alias_role_rank ?? Number.NEGATIVE_INFINITY) ||
        (right.weight ?? Number.NEGATIVE_INFINITY) - (left.weight ?? Number.NEGATIVE_INFINITY) ||
        (left.alias_token_count ?? Number.POSITIVE_INFINITY) - (right.alias_token_count ?? Number.POSITIVE_INFINITY) ||
        left.canonical_label.localeCompare(right.canonical_label) ||
        left.graph_node_id - right.graph_node_id ||
        left.alias.localeCompare(right.alias));
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
    if (field === 'locale_primary_aliases_text')
        return 'locale_primary';
    if (field === 'locale_supporting_aliases_text')
        return 'locale_supporting';
    if (field === 'reviewed_crosswalk_aliases_text')
        return 'reviewed_crosswalk';
    if (field === 'family_supporting_aliases_text')
        return 'family_supporting';
    if (field === 'english_backbone_aliases_text')
        return 'english_backbone';
    if (field === 'aliases_text')
        return 'combined';
    return undefined;
}
function fieldStrength(fieldClass) {
    if (fieldClass === 'title')
        return OPENSEARCH_FIELD_STRENGTH.TITLE;
    if (fieldClass === 'alias')
        return OPENSEARCH_FIELD_STRENGTH.ALIAS;
    if (fieldClass === 'search_text')
        return OPENSEARCH_FIELD_STRENGTH.SEARCH_TEXT;
    if (fieldClass === 'capability')
        return OPENSEARCH_FIELD_STRENGTH.CAPABILITY;
    if (fieldClass === 'family_alias')
        return OPENSEARCH_FIELD_STRENGTH.FAMILY_ALIAS;
    return OPENSEARCH_FIELD_STRENGTH.ANCESTOR;
}
function aliasRoleForId(roleId) {
    if (roleId === 1)
        return 'locale_primary';
    if (roleId === 2)
        return 'reviewed_crosswalk';
    if (roleId === 3)
        return 'locale_supporting';
    if (roleId === 4)
        return 'family_supporting';
    return 'english_backbone';
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
