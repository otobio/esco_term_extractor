import { foldSearchText, isGenericQueryToken, isSafeJobLevelModifierToken, isStopQueryToken, tokenizeNormalizedText } from '../query/query-preparation.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { ALIAS_NGRAM_NULL_U32, ALIAS_NGRAM_WEIGHT_SCALE, binaryFeaturePostings, binaryStringAt, binaryStringId } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { rowValue } from '../runtime/occupation-retrieval-index-artifact.js';
import { clampScore, roundScore } from '../utils/operators.js';
const CANONICAL_ALIAS_ROLE = 'canonical_label';
const DEFAULT_SEARCH_ALIAS_ROLES = new Set(['locale_primary', 'locale_supporting', 'reviewed_crosswalk']);
const FAMILY_SUPPORTING_ALIAS_ROLE = 'family_supporting';
const MAX_FEATURE_POSTING_SCAN = 2500;
export async function buildAliasNgramIndex(options) {
    const artifactEntry = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const records = artifactEntry.getAllRecordsWithDetails();
    const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
    const rawEntries = buildRawEntries(records, options.locale, includeFamilySupportingAliases);
    return buildAliasNgramIndexFromRawEntries({
        sourceName: options.sourceName,
        locale: options.locale,
        includeFamilySupportingAliases,
        rawEntries
    });
}
export function buildOccupationAliasNgramRecords(records, options) {
    const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
    const rawEntries = buildRawEntries(records, options.locale, includeFamilySupportingAliases);
    const documentFrequency = countDocumentFrequency(rawEntries.map((entry) => entry.featureCounts));
    return rawEntries.map((entry, index) => {
        const weightedFeatures = weightFeatures(entry.featureCounts, documentFrequency, rawEntries.length);
        return {
            index,
            graphNodeId: entry.graphNodeId,
            canonicalLabel: entry.canonicalLabel,
            familyNodeId: entry.familyNodeId,
            familyLabel: entry.familyLabel,
            alias: entry.alias,
            normalizedAlias: entry.normalizedAlias,
            aliasRole: entry.aliasRole,
            aliasRoleScoreFactor: entry.aliasRoleScoreFactor,
            aliasWeight: entry.aliasWeight,
            foldedTokens: entry.foldedTokens,
            usefulFoldedTokens: entry.usefulFoldedTokens,
            weightedFeatures: Array.from(weightedFeatures.entries()).sort(([left], [right]) => left.localeCompare(right)),
            norm: vectorNorm(weightedFeatures)
        };
    });
}
export function buildAliasNgramIndexFromArtifactRecords(options) {
    const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
    const entries = options.records.map((record, fallbackIndex) => ({
        index: record.index ?? fallbackIndex,
        graphNodeId: record.graphNodeId,
        canonicalLabel: record.canonicalLabel,
        familyNodeId: record.familyNodeId,
        familyLabel: record.familyLabel,
        alias: record.alias,
        normalizedAlias: record.normalizedAlias,
        aliasRole: record.aliasRole,
        aliasRoleScoreFactor: record.aliasRoleScoreFactor,
        aliasWeight: record.aliasWeight,
        foldedTokens: record.foldedTokens,
        usefulFoldedTokens: record.usefulFoldedTokens,
        featureCounts: new Map(),
        weightedFeatures: new Map(record.weightedFeatures),
        norm: record.norm
    }));
    return {
        sourceName: options.sourceName,
        locale: options.locale,
        includeFamilySupportingAliases,
        aliasCount: entries.length,
        entries,
        postingsByFeature: buildPostings(entries)
    };
}
export function buildAliasNgramIndexFromRows(options) {
    const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
    const rawEntries = buildRawEntriesFromRows(options.rows, options.locale, includeFamilySupportingAliases);
    return buildAliasNgramIndexFromRawEntries({
        sourceName: options.sourceName,
        locale: options.locale,
        includeFamilySupportingAliases,
        rawEntries
    });
}
function buildAliasNgramIndexFromRawEntries(options) {
    const rawEntries = options.rawEntries;
    const documentFrequency = countDocumentFrequency(rawEntries.map((entry) => entry.featureCounts));
    const entries = rawEntries.map((entry, index) => {
        const weightedFeatures = weightFeatures(entry.featureCounts, documentFrequency, rawEntries.length);
        return {
            ...entry,
            index,
            weightedFeatures,
            norm: vectorNorm(weightedFeatures)
        };
    });
    const postingsByFeature = buildPostings(entries);
    return {
        sourceName: options.sourceName,
        locale: options.locale,
        includeFamilySupportingAliases: options.includeFamilySupportingAliases,
        aliasCount: entries.length,
        entries,
        postingsByFeature
    };
}
export function retrieveAliasNgramHits(index, preparedQuery, options) {
    const queryFeatures = buildFeatureCounts(preparedQuery.folded, index.locale);
    const weightedQueryFeatures = weightFeatures(queryFeatures, countQueryDocumentFrequency(index, queryFeatures), index.aliasCount);
    const queryNorm = vectorNorm(weightedQueryFeatures);
    if (queryNorm === 0) {
        return [];
    }
    const candidateIds = candidateEntryIds(index, weightedQueryFeatures);
    const queryTokenSet = new Set(preparedQuery.foldedTokens);
    const usefulQueryTokenSet = new Set(preparedQuery.usefulFoldedTokens);
    const hits = [];
    for (const entryId of candidateIds) {
        const entry = index.entries[entryId];
        if (!entry || entry.norm === 0) {
            continue;
        }
        const cosine = dotProduct(weightedQueryFeatures, entry.weightedFeatures) / (queryNorm * entry.norm);
        if (cosine <= 0) {
            continue;
        }
        const matchedTokens = entry.foldedTokens.filter((token) => queryTokenSet.has(token));
        const matchedUsefulTokens = entry.usefulFoldedTokens.filter((token) => usefulQueryTokenSet.has(token));
        const tokenCoverage = queryTokenSet.size > 0 ? matchedTokens.length / queryTokenSet.size : 0;
        const usefulTokenCoverage = usefulQueryTokenSet.size > 0 ? matchedUsefulTokens.length / usefulQueryTokenSet.size : tokenCoverage;
        const phraseBonus = entry.normalizedAlias === preparedQuery.normalized || foldSearchText(entry.normalizedAlias) === preparedQuery.folded
            ? 0.12
            : entry.foldedTokens.join(' ').includes(preparedQuery.folded) || preparedQuery.folded.includes(entry.foldedTokens.join(' '))
                ? 0.05
                : 0;
        const authorityBoost = entry.aliasRole === CANONICAL_ALIAS_ROLE ? 0.04 : Math.min(0.04, Math.max(0, entry.aliasWeight ?? 0) * 0.04);
        const score = clampScore(((cosine * 0.72) + (usefulTokenCoverage * 0.18) + phraseBonus + authorityBoost) * entry.aliasRoleScoreFactor);
        hits.push({
            graphNodeId: entry.graphNodeId,
            canonicalLabel: entry.canonicalLabel,
            familyNodeId: entry.familyNodeId,
            familyLabel: entry.familyLabel,
            alias: entry.alias,
            normalizedAlias: entry.normalizedAlias,
            aliasRole: entry.aliasRole,
            aliasWeight: entry.aliasWeight,
            score,
            cosine: roundScore(cosine),
            tokenCoverage: roundScore(tokenCoverage),
            usefulTokenCoverage: roundScore(usefulTokenCoverage),
            matchedTokens: Array.from(new Set(matchedTokens)).sort(),
            matchedFeatures: topMatchedFeatures(weightedQueryFeatures, entry.weightedFeatures, 8)
        });
    }
    return hits
        .sort((left, right) => right.score - left.score ||
        right.usefulTokenCoverage - left.usefulTokenCoverage ||
        right.cosine - left.cosine ||
        left.canonicalLabel.localeCompare(right.canonicalLabel) ||
        left.alias.localeCompare(right.alias))
        .slice(0, options.limit);
}
export function retrieveBinaryAliasNgramHits(index, preparedQuery, options) {
    const queryFeatures = buildFeatureCounts(preparedQuery.folded, index.manifest.locale);
    const weightedQueryFeatures = weightFeatures(queryFeatures, countBinaryQueryDocumentFrequency(index, queryFeatures), index.manifest.count);
    const queryNorm = vectorNorm(weightedQueryFeatures);
    if (queryNorm === 0) {
        return [];
    }
    const candidateIds = binaryCandidateEntryIds(index, weightedQueryFeatures);
    const binaryQueryFeatures = binaryQueryFeatureMap(index, weightedQueryFeatures);
    const queryTokenSet = new Set(preparedQuery.foldedTokens);
    const usefulQueryTokenSet = new Set(preparedQuery.usefulFoldedTokens);
    const preselectedHits = [];
    for (const entryId of candidateIds) {
        const norm = rowValue(index.rows, entryId, 11) / ALIAS_NGRAM_WEIGHT_SCALE;
        if (norm === 0) {
            continue;
        }
        const cosine = binaryDotProduct(index, entryId, binaryQueryFeatures.weightsByFeatureId) / (queryNorm * norm);
        if (cosine <= 0) {
            continue;
        }
        preselectedHits.push({ entryId, cosine });
    }
    const shortlist = preselectedHits
        .sort((left, right) => right.cosine - left.cosine || left.entryId - right.entryId)
        .slice(0, Math.max(options.limit * 8, 120));
    const hits = [];
    for (const { entryId, cosine } of shortlist) {
        const foldedTokens = tokenTextToTokens(binaryStringAt(index, rowValue(index.rows, entryId, 9)));
        const usefulFoldedTokens = tokenTextToTokens(binaryStringAt(index, rowValue(index.rows, entryId, 10)));
        const normalizedAlias = binaryStringAt(index, rowValue(index.rows, entryId, 5));
        const aliasRole = binaryStringAt(index, rowValue(index.rows, entryId, 6));
        const aliasWeight = nullableScaled(rowValue(index.rows, entryId, 7));
        const matchedTokens = foldedTokens.filter((token) => queryTokenSet.has(token));
        const matchedUsefulTokens = usefulFoldedTokens.filter((token) => usefulQueryTokenSet.has(token));
        const tokenCoverage = queryTokenSet.size > 0 ? matchedTokens.length / queryTokenSet.size : 0;
        const usefulTokenCoverage = usefulQueryTokenSet.size > 0 ? matchedUsefulTokens.length / usefulQueryTokenSet.size : tokenCoverage;
        const phraseBonus = normalizedAlias === preparedQuery.normalized || foldSearchText(normalizedAlias) === preparedQuery.folded
            ? 0.12
            : foldedTokens.join(' ').includes(preparedQuery.folded) || preparedQuery.folded.includes(foldedTokens.join(' '))
                ? 0.05
                : 0;
        const authorityBoost = aliasRole === CANONICAL_ALIAS_ROLE ? 0.04 : Math.min(0.04, Math.max(0, aliasWeight ?? 0) * 0.04);
        const aliasRoleScoreFactor = rowValue(index.rows, entryId, 8) / ALIAS_NGRAM_WEIGHT_SCALE;
        const score = clampScore(((cosine * 0.72) + (usefulTokenCoverage * 0.18) + phraseBonus + authorityBoost) * aliasRoleScoreFactor);
        hits.push({
            entryId,
            graphNodeId: rowValue(index.rows, entryId, 0),
            canonicalLabel: binaryStringAt(index, rowValue(index.rows, entryId, 1)),
            familyNodeId: nullableU32(rowValue(index.rows, entryId, 2)),
            familyLabel: nullableString(index, rowValue(index.rows, entryId, 3)),
            alias: binaryStringAt(index, rowValue(index.rows, entryId, 4)),
            normalizedAlias,
            aliasRole,
            aliasWeight,
            score,
            cosine: roundScore(cosine),
            tokenCoverage: roundScore(tokenCoverage),
            usefulTokenCoverage: roundScore(usefulTokenCoverage),
            matchedTokens: Array.from(new Set(matchedTokens)).sort()
        });
    }
    return hits
        .sort((left, right) => right.score - left.score ||
        right.usefulTokenCoverage - left.usefulTokenCoverage ||
        right.cosine - left.cosine ||
        left.canonicalLabel.localeCompare(right.canonicalLabel) ||
        left.alias.localeCompare(right.alias))
        .slice(0, options.limit)
        .map(({ entryId, ...hit }) => ({
        ...hit,
        matchedFeatures: binaryTopMatchedFeatures(index, entryId, binaryQueryFeatures, 8)
    }));
}
function buildRawEntries(records, locale, includeFamilySupportingAliases) {
    const entries = [];
    const seen = new Set();
    const familySupportingRowsByKey = new Map();
    for (const record of records) {
        if (locale === 'en') {
            addEntry(record, {
                alias: record.canonicalLabel,
                normalizedAlias: record.canonicalLabel,
                aliasRole: CANONICAL_ALIAS_ROLE,
                weight: 1
            });
        }
        for (const alias of record.aliases) {
            if (alias.localeCode !== locale || !isSearchAliasRole(alias.aliasRole, includeFamilySupportingAliases)) {
                continue;
            }
            if (alias.aliasRole === FAMILY_SUPPORTING_ALIAS_ROLE) {
                if (record.familyNodeId === null || !record.familyLabel) {
                    continue;
                }
                const normalizedAlias = alias.normalizedAlias.trim() || alias.alias.trim();
                const foldedAlias = foldSearchText(normalizedAlias);
                const key = `${record.familyNodeId}\0${foldedAlias}`;
                const existing = familySupportingRowsByKey.get(key);
                if (!existing || (alias.weight ?? 0) > (existing.aliasWeight ?? 0)) {
                    familySupportingRowsByKey.set(key, {
                        graphNodeId: record.familyNodeId,
                        canonicalLabel: record.familyLabel,
                        familyNodeId: record.familyNodeId,
                        familyLabel: record.familyLabel,
                        alias: alias.alias,
                        normalizedAlias,
                        aliasRole: alias.aliasRole,
                        aliasWeight: alias.weight
                    });
                }
                continue;
            }
            addEntry(record, alias);
        }
    }
    entries.push(...buildRawEntriesFromRows(Array.from(familySupportingRowsByKey.values()), locale, includeFamilySupportingAliases));
    return entries;
    function addEntry(record, alias) {
        const normalizedAlias = alias.normalizedAlias.trim() || alias.alias.trim();
        const foldedAlias = foldSearchText(normalizedAlias);
        const foldedTokens = tokenizeNormalizedText(foldedAlias);
        if (foldedTokens.length === 0) {
            return;
        }
        const key = `${record.graphNodeId}\0${alias.aliasRole}\0${foldedAlias}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push({
            graphNodeId: record.graphNodeId,
            canonicalLabel: record.canonicalLabel,
            familyNodeId: record.familyNodeId,
            familyLabel: record.familyLabel,
            alias: alias.alias,
            normalizedAlias,
            aliasRole: alias.aliasRole,
            aliasRoleScoreFactor: aliasRoleScoreFactor(alias.aliasRole),
            aliasWeight: alias.weight,
            foldedTokens,
            usefulFoldedTokens: usefulAliasTokens(foldedTokens, locale),
            featureCounts: buildFeatureCounts(foldedAlias, locale)
        });
    }
}
function buildRawEntriesFromRows(rows, locale, includeFamilySupportingAliases) {
    const entries = [];
    const seen = new Set();
    for (const row of rows) {
        if (!isSearchAliasRole(row.aliasRole, includeFamilySupportingAliases)) {
            continue;
        }
        const normalizedAlias = row.normalizedAlias.trim() || row.alias.trim();
        const foldedAlias = foldSearchText(normalizedAlias);
        const foldedTokens = tokenizeNormalizedText(foldedAlias);
        if (foldedTokens.length === 0) {
            continue;
        }
        const key = `${row.graphNodeId}\0${row.aliasRole}\0${foldedAlias}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        entries.push({
            graphNodeId: row.graphNodeId,
            canonicalLabel: row.canonicalLabel,
            familyNodeId: row.familyNodeId,
            familyLabel: row.familyLabel,
            alias: row.alias,
            normalizedAlias,
            aliasRole: row.aliasRole,
            aliasRoleScoreFactor: aliasRoleScoreFactor(row.aliasRole),
            aliasWeight: row.aliasWeight,
            foldedTokens,
            usefulFoldedTokens: usefulAliasTokens(foldedTokens, locale),
            featureCounts: buildFeatureCounts(foldedAlias, locale)
        });
    }
    return entries;
}
function isSearchAliasRole(aliasRole, includeFamilySupportingAliases) {
    return DEFAULT_SEARCH_ALIAS_ROLES.has(aliasRole) || (includeFamilySupportingAliases && aliasRole === FAMILY_SUPPORTING_ALIAS_ROLE);
}
function aliasRoleScoreFactor(aliasRole) {
    if (aliasRole === CANONICAL_ALIAS_ROLE || aliasRole === 'locale_primary') {
        return 1;
    }
    if (aliasRole === 'reviewed_crosswalk') {
        return 0.96;
    }
    if (aliasRole === 'locale_supporting') {
        return 0.92;
    }
    if (aliasRole === 'family_supporting') {
        return 0.78;
    }
    return 0.7;
}
function buildFeatureCounts(text, locale) {
    const tokens = tokenizeNormalizedText(foldSearchText(text));
    const counts = new Map();
    tokens.forEach((token, index) => {
        for (const variant of tokenVariants(token)) {
            addFeature(counts, `tok:${variant}`, tokenWeight(token, locale) * (variant === token ? 1 : 0.82));
        }
        addFeature(counts, `pre:${token.slice(0, Math.min(4, token.length))}`, 0.35);
        if (index + 1 < tokens.length) {
            addFeature(counts, `bi:${token}_${tokens[index + 1]}`, 1.55);
            for (const compound of compoundTokenVariants(token, tokens[index + 1] ?? '')) {
                addFeature(counts, `tok:${compound}`, 1.25);
            }
        }
        for (const ngram of characterNgrams(token, 3)) {
            addFeature(counts, `c3:${ngram}`, 0.25);
        }
        for (const ngram of characterNgrams(token, 4)) {
            addFeature(counts, `c4:${ngram}`, 0.35);
        }
    });
    return counts;
}
function tokenVariants(token) {
    const variants = new Set([token]);
    if (token.endsWith('ies') && token.length > 5) {
        variants.add(`${token.slice(0, -3)}y`);
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    if (token === 'backend') {
        variants.add('back_end');
    }
    if (token === 'frontend') {
        variants.add('front_end');
    }
    if (token === 'fullstack') {
        variants.add('full_stack');
    }
    return Array.from(variants);
}
function compoundTokenVariants(left, right) {
    const compound = `${left}_${right}`;
    const variants = new Set([compound]);
    if (compound === 'back_end') {
        variants.add('backend');
    }
    if (compound === 'front_end') {
        variants.add('frontend');
    }
    if (compound === 'full_stack') {
        variants.add('fullstack');
    }
    return Array.from(variants);
}
function tokenWeight(token, locale) {
    if (isStopQueryToken(token, locale) || isSafeJobLevelModifierToken(token, locale)) {
        return 0.15;
    }
    if (isGenericQueryToken(token, locale)) {
        return 0.65;
    }
    return 1.4;
}
function usefulAliasTokens(tokens, locale) {
    return tokens.filter((token) => !isStopQueryToken(token, locale) && !isSafeJobLevelModifierToken(token, locale));
}
function characterNgrams(token, size) {
    if (token.length < size) {
        return [];
    }
    const grams = [];
    for (let index = 0; index <= token.length - size; index += 1) {
        grams.push(token.slice(index, index + size));
    }
    return grams;
}
function addFeature(counts, feature, weight) {
    counts.set(feature, (counts.get(feature) ?? 0) + weight);
}
function countDocumentFrequency(featureCounts) {
    const df = new Map();
    for (const counts of featureCounts) {
        for (const feature of counts.keys()) {
            df.set(feature, (df.get(feature) ?? 0) + 1);
        }
    }
    return df;
}
function countQueryDocumentFrequency(index, queryFeatures) {
    const df = new Map();
    for (const feature of queryFeatures.keys()) {
        df.set(feature, index.postingsByFeature.get(feature)?.length ?? 0);
    }
    return df;
}
function weightFeatures(counts, documentFrequency, documentCount) {
    const weighted = new Map();
    for (const [feature, count] of counts) {
        const df = documentFrequency.get(feature) ?? 0;
        const idf = Math.log(1 + ((documentCount + 1) / (df + 1)));
        weighted.set(feature, count * idf);
    }
    return weighted;
}
function buildPostings(entries) {
    const postings = new Map();
    for (const entry of entries) {
        for (const feature of entry.weightedFeatures.keys()) {
            const ids = postings.get(feature) ?? [];
            ids.push(entry.index);
            postings.set(feature, ids);
        }
    }
    return postings;
}
function candidateEntryIds(index, queryFeatures) {
    const ids = new Set();
    const orderedFeatures = Array.from(queryFeatures.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([feature]) => feature);
    for (const feature of orderedFeatures) {
        const postings = index.postingsByFeature.get(feature) ?? [];
        if (postings.length > MAX_FEATURE_POSTING_SCAN) {
            continue;
        }
        for (const id of postings) {
            ids.add(id);
        }
    }
    return ids;
}
function vectorNorm(features) {
    let sum = 0;
    for (const value of features.values()) {
        sum += value * value;
    }
    return Math.sqrt(sum);
}
function dotProduct(left, right) {
    let sum = 0;
    const [smaller, larger] = left.size < right.size ? [left, right] : [right, left];
    for (const [feature, value] of smaller) {
        sum += value * (larger.get(feature) ?? 0);
    }
    return sum;
}
function topMatchedFeatures(left, right, limit) {
    const matches = [];
    for (const [feature, leftWeight] of left) {
        const rightWeight = right.get(feature);
        if (rightWeight === undefined) {
            continue;
        }
        matches.push({ feature, score: leftWeight * rightWeight });
    }
    return matches
        .sort((leftMatch, rightMatch) => rightMatch.score - leftMatch.score || leftMatch.feature.localeCompare(rightMatch.feature))
        .slice(0, limit)
        .map((match) => match.feature);
}
function countBinaryQueryDocumentFrequency(index, queryFeatures) {
    const df = new Map();
    for (const feature of queryFeatures.keys()) {
        const featureId = binaryStringId(index, feature);
        df.set(feature, featureId >= 0 ? binaryFeaturePostings(index, featureId).length : 0);
    }
    return df;
}
function binaryCandidateEntryIds(index, queryFeatures) {
    const ids = new Set();
    const orderedFeatures = Array.from(queryFeatures.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([feature]) => feature);
    for (const feature of orderedFeatures) {
        const featureId = binaryStringId(index, feature);
        const postings = featureId >= 0 ? binaryFeaturePostings(index, featureId) : [];
        if (postings.length > MAX_FEATURE_POSTING_SCAN) {
            continue;
        }
        for (const id of postings) {
            ids.add(id);
        }
    }
    return ids;
}
function binaryDotProduct(index, entryId, queryFeatures) {
    let sum = 0;
    const offset = rowValue(index.rows, entryId, 12);
    const length = rowValue(index.rows, entryId, 13);
    for (let cursor = offset; cursor < offset + length; cursor += 1) {
        const featureId = rowValue(index.featureValues, cursor, 0);
        const queryWeight = queryFeatures.get(featureId);
        if (queryWeight === undefined) {
            continue;
        }
        sum += queryWeight * (rowValue(index.featureValues, cursor, 1) / ALIAS_NGRAM_WEIGHT_SCALE);
    }
    return sum;
}
function binaryQueryFeatureMap(index, queryFeatures) {
    const featureById = new Map();
    const weightsByFeatureId = new Map();
    for (const [feature, weight] of queryFeatures) {
        const featureId = binaryStringId(index, feature);
        if (featureId < 0) {
            continue;
        }
        featureById.set(featureId, feature);
        weightsByFeatureId.set(featureId, weight);
    }
    return { featureById, weightsByFeatureId };
}
function binaryTopMatchedFeatures(index, entryId, queryFeatures, limit) {
    const matches = [];
    const offset = rowValue(index.rows, entryId, 12);
    const length = rowValue(index.rows, entryId, 13);
    for (let cursor = offset; cursor < offset + length; cursor += 1) {
        const featureId = rowValue(index.featureValues, cursor, 0);
        const queryWeight = queryFeatures.weightsByFeatureId.get(featureId);
        if (queryWeight === undefined) {
            continue;
        }
        matches.push({
            feature: queryFeatures.featureById.get(featureId) ?? '',
            score: queryWeight * (rowValue(index.featureValues, cursor, 1) / ALIAS_NGRAM_WEIGHT_SCALE)
        });
    }
    return matches
        .sort((left, right) => right.score - left.score || left.feature.localeCompare(right.feature))
        .slice(0, limit)
        .map((match) => match.feature);
}
function tokenTextToTokens(value) {
    return value ? value.split('\n').filter(Boolean) : [];
}
function nullableU32(value) {
    return value === ALIAS_NGRAM_NULL_U32 ? null : value;
}
function nullableScaled(value) {
    return value === ALIAS_NGRAM_NULL_U32 ? null : value / ALIAS_NGRAM_WEIGHT_SCALE;
}
function nullableString(index, value) {
    return value === ALIAS_NGRAM_NULL_U32 ? null : binaryStringAt(index, value);
}
