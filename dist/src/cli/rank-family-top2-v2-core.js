import { isGenericQueryToken, isStopQueryToken, isUsefulQueryToken } from '../query/query-preparation.js';
import { roundScore, uniqueSortedStrings } from '../utils/operators.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
const QUERY_KIND_WEIGHT = {
    support: 0.35,
    role: 1.8,
    role_head: 2.9,
    domain: 0.85,
    venue: 0.7
};
const SOURCE_KIND_WEIGHT = {
    family_label: 1.55,
    alias: 1.15,
    leaf_label: 0.8,
    capability: 0.45
};
export function rankFamilyTop2V2(options) {
    const familyVectors = buildFamilyVectors(options.familyProfileArtifact, options.query.locale, options.query.effectiveQuery);
    const queryVector = buildQueryVector(options.query.preparedQuery, options.familyTokenRelevanceArtifact, options.query.locale);
    const hits = [];
    for (const family of familyVectors) {
        const hit = scoreFamilyVector(family, queryVector, options.familyProfileArtifact);
        if (hit.score > 0) {
            hits.push(hit);
        }
    }
    const rankedFamilies = hits
        .sort(compareFamilyHits)
        .slice(0, options.limit)
        .map((family, index) => ({
        ...family,
        rank: index + 1
    }));
    return {
        query: options.query,
        queryVector,
        rankedFamilies
    };
}
function buildFamilyVectors(artifact, locale, effectiveQuery) {
    const vectors = [];
    for (let rowId = 0; rowId < artifact.profileRows.count; rowId += 1) {
        const profile = artifact.getProfileCore(rowId);
        if (!profile) {
            continue;
        }
        const localeProfile = artifact.getLocaleProfile(profile, locale);
        if (!localeProfile) {
            continue;
        }
        const sourceVectors = {
            family_label: artifact.getSource(localeProfile, 'family_label'),
            alias: artifact.getSource(localeProfile, 'alias'),
            leaf_label: artifact.getSource(localeProfile, 'leaf_label'),
            capability: artifact.getSource(localeProfile, 'capability')
        };
        const vector = emptyWeightedVector();
        for (const sourceKind of Object.keys(sourceVectors)) {
            buildVectorFromSource(vector, sourceVectors[sourceKind], artifact, locale, sourceKind);
        }
        vector.norm = vectorNorm(vector.weights);
        vectors.push({
            familyNodeId: profile.familyNodeId,
            familyLabel: profile.familyLabel,
            groupNodeId: profile.groupNodeId,
            groupLabel: profile.groupLabel,
            profileLeafCount: profile.profileLeafCount,
            vector,
            localeProfile,
            exactFamilyLabelPhrase: exactFamilyLabelPhrase(profile.familyLabel, effectiveQuery),
            usefulFamilyLabelPhrase: usefulFamilyLabelPhrase(profile.familyLabel, effectiveQuery, locale)
        });
    }
    return vectors;
}
function buildQueryVector(preparedQuery, familyTokenRelevanceArtifact, locale) {
    const terms = new Map();
    addQueryTerms(terms, uniqueTokenSequence(preparedQuery.intent.authoritativeRoleHeadTokens), 'role_head', QUERY_KIND_WEIGHT.role_head, familyTokenRelevanceArtifact, locale);
    addQueryTerms(terms, uniqueTokenSequence(preparedQuery.intent.roleTokens), 'role', QUERY_KIND_WEIGHT.role, familyTokenRelevanceArtifact, locale);
    addQueryTerms(terms, uniqueTokenSequence(preparedQuery.intent.domainTokens), 'domain', QUERY_KIND_WEIGHT.domain, familyTokenRelevanceArtifact, locale);
    addQueryTerms(terms, uniqueTokenSequence(preparedQuery.intent.venueTokens), 'venue', QUERY_KIND_WEIGHT.venue, familyTokenRelevanceArtifact, locale);
    addQueryTerms(terms, uniqueTokenSequence(preparedQuery.usefulFoldedVariantTokens.filter((token) => !isGenericQueryToken(token, preparedQuery.locale) &&
        !isStopQueryToken(token, preparedQuery.locale) &&
        isUsefulQueryToken(token, preparedQuery.locale))), 'support', QUERY_KIND_WEIGHT.support, familyTokenRelevanceArtifact, locale);
    return Array.from(terms.values()).sort((left, right) => {
        const kindDiff = queryKindPriority(right.kind) - queryKindPriority(left.kind);
        return kindDiff !== 0 ? kindDiff : left.token.localeCompare(right.token);
    });
}
function addQueryTerms(terms, tokens, kind, kindWeight, familyTokenRelevanceArtifact, locale) {
    for (const rawToken of tokens) {
        const token = foldSearchText(rawToken).trim();
        if (!token || token.length < 2) {
            continue;
        }
        const specificity = 0.5 + familyTokenRelevanceArtifact.maxTokenRelevance(locale, token);
        const weight = kindWeight * specificity;
        const existing = terms.get(token);
        if (!existing || weight > existing.weight) {
            terms.set(token, { token, kind, weight, specificity });
        }
    }
}
function scoreFamilyVector(family, queryVector, familyProfileArtifact) {
    const matchedTerms = new Set();
    const matchedRoleTerms = new Set();
    const matchedDomainTerms = new Set();
    const matchedSources = new Set();
    const matchingLeafIds = new Set();
    let dotProduct = 0;
    let roleTotal = 0;
    let roleMatched = 0;
    let domainTotal = 0;
    let domainMatched = 0;
    for (const term of queryVector) {
        const familyWeight = family.vector.weights.get(term.token) ?? 0;
        if (familyWeight <= 0) {
            if (term.kind === 'role' || term.kind === 'role_head') {
                roleTotal += 1;
            }
            if (term.kind === 'domain' || term.kind === 'venue') {
                domainTotal += 1;
            }
            continue;
        }
        const tokenId = familyProfileArtifact.stringId(term.token);
        if (tokenId >= 0) {
            for (const leafId of familyProfileArtifact.leafIdsForToken(family.localeProfile.rowId, tokenId)) {
                matchingLeafIds.add(leafId);
            }
        }
        dotProduct += term.weight * familyWeight;
        matchedTerms.add(term.token);
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'family_label', term.token)) {
            matchedSources.add('family_label');
        }
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'alias', term.token)) {
            matchedSources.add('alias');
        }
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'leaf_label', term.token)) {
            matchedSources.add('leaf_label');
        }
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'capability', term.token)) {
            matchedSources.add('capability');
        }
        if (term.kind === 'role' || term.kind === 'role_head') {
            matchedRoleTerms.add(term.token);
            roleMatched += 1;
        }
        if (term.kind === 'domain' || term.kind === 'venue') {
            matchedDomainTerms.add(term.token);
            domainMatched += 1;
        }
        if (term.kind === 'role' || term.kind === 'role_head') {
            roleTotal += 1;
        }
        if (term.kind === 'domain' || term.kind === 'venue') {
            domainTotal += 1;
        }
    }
    const queryNorm = vectorNormFromQuery(queryVector);
    const cosine = queryNorm > 0 && family.vector.norm > 0 ? dotProduct / (queryNorm * family.vector.norm) : 0;
    const exactBoost = family.exactFamilyLabelPhrase ? 0.18 : 0;
    const usefulBoost = !family.exactFamilyLabelPhrase && family.usefulFamilyLabelPhrase ? 0.1 : 0;
    const coverage = queryVector.length > 0 ? matchedTerms.size / queryVector.length : 0;
    const roleCoverage = roleTotal > 0 ? roleMatched / roleTotal : 0;
    const domainCoverage = domainTotal > 0 ? domainMatched / domainTotal : 0;
    const scoreBreakdown = {
        vector: roundScore(cosine),
        phrase: roundScore(exactBoost + usefulBoost),
        coverage: roundScore(coverage * 0.05),
        roleCoverage: roundScore(roleCoverage * 0.06),
        domainCoverage: roundScore(domainCoverage * 0.03),
        familyLabelExact: roundScore(exactBoost),
        familyLabelUseful: roundScore(usefulBoost),
        queryVectorNorm: roundScore(queryNorm),
        familyVectorNorm: roundScore(family.vector.norm)
    };
    const score = roundScore(scoreBreakdown.vector + scoreBreakdown.phrase + scoreBreakdown.coverage + scoreBreakdown.roleCoverage + scoreBreakdown.domainCoverage);
    return {
        rank: 0,
        familyNodeId: family.familyNodeId,
        familyLabel: family.familyLabel,
        groupNodeId: family.groupNodeId,
        groupLabel: family.groupLabel,
        score,
        cosine: scoreBreakdown.vector,
        exactFamilyLabelPhrase: family.exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase: family.usefulFamilyLabelPhrase,
        matchedTerms: uniqueSortedStrings(matchedTerms),
        missingTerms: queryVector.filter((term) => !matchedTerms.has(term.token)).map((term) => term.token),
        matchedRoleTerms: uniqueSortedStrings(matchedRoleTerms),
        missingRoleTerms: queryVector
            .filter((term) => (term.kind === 'role' || term.kind === 'role_head') && !matchedRoleTerms.has(term.token))
            .map((term) => term.token),
        matchedDomainTerms: uniqueSortedStrings(matchedDomainTerms),
        matchedSources: Array.from(matchedSources).sort(),
        matchingLeafIds: Array.from(matchingLeafIds).sort((left, right) => left - right),
        matchingLeafCount: matchingLeafIds.size,
        profileLeafCount: family.profileLeafCount,
        vectorNorm: roundScore(family.vector.norm),
        queryNorm: roundScore(queryNorm),
        scoreBreakdown
    };
}
function familyContainsToken(artifact, localeProfile, sourceKind, token) {
    const source = artifact.getSource(localeProfile, sourceKind);
    const tokenId = artifact.stringId(token);
    return tokenId >= 0 && artifact.sourceHasToken(source, tokenId);
}
function buildVectorFromSource(vector, source, artifact, locale, sourceKind) {
    const sourceWeight = SOURCE_KIND_WEIGHT[sourceKind] / sourceNormalization(source);
    for (const token of artifact.sourceTokens(source)) {
        const folded = foldSearchText(token).trim();
        if (!isFamilyVectorToken(folded, locale)) {
            continue;
        }
        addVectorWeight(vector.weights, folded, sourceWeight);
    }
}
function emptyWeightedVector() {
    return {
        weights: new Map(),
        norm: 0
    };
}
function addVectorWeight(weights, token, value) {
    weights.set(token, (weights.get(token) ?? 0) + value);
}
function vectorNorm(weights) {
    let sum = 0;
    for (const value of weights.values()) {
        sum += value * value;
    }
    return Math.sqrt(sum);
}
function vectorNormFromQuery(queryVector) {
    let sum = 0;
    for (const term of queryVector) {
        sum += term.weight * term.weight;
    }
    return Math.sqrt(sum);
}
function sourceNormalization(source) {
    return 1 + Math.log2(2 + source.tokenCount + source.phraseCount);
}
function exactFamilyLabelPhrase(familyLabel, query) {
    return (foldSearchText(familyLabel) === foldSearchText(query) ||
        foldWeakPunctuationLookupText(familyLabel) === foldWeakPunctuationLookupText(query));
}
function usefulFamilyLabelPhrase(familyLabel, query, locale) {
    const familyTokens = familyUsefulTokens(familyLabel, locale);
    const queryTokens = familyUsefulTokens(query, locale);
    return (familyTokens.length > 0 &&
        familyTokens.length === queryTokens.length &&
        familyTokens.every((token, index) => token === queryTokens[index]));
}
function familyUsefulTokens(value, locale) {
    return tokenizeNormalizedText(foldSearchText(value)).filter((token) => isUsefulQueryToken(token, locale) && !isStopQueryToken(token, locale) && !isGenericQueryToken(token, locale));
}
function isFamilyVectorToken(token, locale) {
    return token.length >= 2 && !isStopQueryToken(token, locale) && !isGenericQueryToken(token, locale);
}
function uniqueTokenSequence(tokens) {
    const seen = new Set();
    const unique = [];
    for (const token of tokens) {
        const folded = foldSearchText(token).trim();
        if (!folded || seen.has(folded)) {
            continue;
        }
        seen.add(folded);
        unique.push(folded);
    }
    return unique;
}
function compareFamilyHits(left, right) {
    return (right.score - left.score ||
        right.cosine - left.cosine ||
        Number(right.exactFamilyLabelPhrase) - Number(left.exactFamilyLabelPhrase) ||
        Number(right.usefulFamilyLabelPhrase) - Number(left.usefulFamilyLabelPhrase) ||
        right.vectorNorm - left.vectorNorm ||
        right.matchingLeafCount - left.matchingLeafCount ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function queryKindPriority(kind) {
    switch (kind) {
        case 'role_head':
            return 5;
        case 'role':
            return 4;
        case 'domain':
            return 3;
        case 'venue':
            return 2;
        case 'support':
            return 1;
    }
}
