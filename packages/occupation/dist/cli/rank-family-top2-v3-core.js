import { isGenericQueryToken, isStopQueryToken, isUsefulQueryToken } from '../query/query-preparation.js';
import { roundScore, uniqueSortedStrings } from '../utils/operators.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
const QUERY_KIND_WEIGHT = {
    support: 0.3,
    role: 1.8,
    role_head: 3.0,
    domain: 0.9,
    venue: 0.75
};
const BASE_SOURCE_WEIGHT = {
    family_label: 0,
    alias: 1.3,
    leaf_label: 0.8,
    capability: 0.5
};
const HIERARCHY_LABEL_WEIGHT = {
    family_label: 1.55,
    group_label: 1.1,
    parent_label: 0.95,
    ancestor: 0.78,
    sibling: 0.28
};
export function rankFamilyTop2V3(options) {
    const familyVectors = buildFamilyVectors(options.familyProfileArtifact, options.searchMetaArtifact, options.query.locale, options.query.effectiveQuery);
    const queryVector = buildQueryVector(options.query.preparedQuery, options.familyTokenRelevanceArtifact, options.query.locale);
    const hits = [];
    for (const family of familyVectors) {
        const hit = scoreFamilyVector(family, queryVector, options.familyProfileArtifact, options.searchMetaArtifact);
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
export function buildFamilyVectors(familyProfileArtifact, searchMetaArtifact, locale, effectiveQuery) {
    const vectors = [];
    for (let rowId = 0; rowId < familyProfileArtifact.profileRows.count; rowId += 1) {
        const profile = familyProfileArtifact.getProfileCore(rowId);
        if (!profile) {
            continue;
        }
        const localeProfile = familyProfileArtifact.getLocaleProfile(profile, locale);
        if (!localeProfile) {
            continue;
        }
        const coreRecord = searchMetaArtifact.getCoreRecord(profile.familyNodeId);
        const baseVector = emptyWeightedVector();
        const hierarchyVector = emptyWeightedVector();
        const siblingVector = emptyWeightedVector();
        buildVectorFromSource(baseVector, familyProfileArtifact.getSource(localeProfile, 'alias'), familyProfileArtifact, locale, 'alias');
        buildVectorFromSource(baseVector, familyProfileArtifact.getSource(localeProfile, 'leaf_label'), familyProfileArtifact, locale, 'leaf_label');
        buildVectorFromSource(baseVector, familyProfileArtifact.getSource(localeProfile, 'capability'), familyProfileArtifact, locale, 'capability');
        const hierarchyProfile = buildHierarchyProfile(profile.familyLabel, coreRecord, locale, effectiveQuery);
        for (const source of hierarchyProfile.sources) {
            buildVectorFromLabel(hierarchyVector, source.label, source.weight, locale, source.kind, source.distanceFromLeaf);
        }
        for (const sibling of hierarchyProfile.siblingSources) {
            buildVectorFromLabel(siblingVector, sibling.label, sibling.weight, locale, 'sibling', sibling.distanceFromLeaf);
        }
        baseVector.norm = vectorNorm(baseVector.weights);
        hierarchyVector.norm = vectorNorm(hierarchyVector.weights);
        siblingVector.norm = vectorNorm(siblingVector.weights);
        vectors.push({
            familyNodeId: profile.familyNodeId,
            familyLabel: profile.familyLabel,
            groupNodeId: profile.groupNodeId,
            groupLabel: profile.groupLabel,
            profileLeafCount: profile.profileLeafCount,
            locale,
            baseVector,
            hierarchyVector,
            siblingVector,
            localeProfile,
            exactFamilyLabelPhrase: hierarchyProfile.exactFamilyLabelPhrase,
            usefulFamilyLabelPhrase: hierarchyProfile.usefulFamilyLabelPhrase,
            hierarchyExactPhrase: hierarchyProfile.hierarchyExactPhrase,
            hierarchyUsefulPhrase: hierarchyProfile.hierarchyUsefulPhrase,
            matchedHierarchyLabels: hierarchyProfile.matchedHierarchyLabels,
            matchedSiblingLabels: hierarchyProfile.matchedSiblingLabels,
            genericRisk: coreRecord?.genericRisk ?? 'medium',
            hasHierarchy: coreRecord?.hasHierarchy ?? false,
            hasCapabilitySupport: coreRecord?.hasCapabilitySupport ?? false
        });
    }
    return vectors;
}
function buildHierarchyProfile(familyLabel, coreRecord, locale, effectiveQuery) {
    const sources = [];
    const siblingSources = [];
    const matchedHierarchyLabels = new Set();
    const matchedSiblingLabels = new Set();
    const queryUsefulTokens = familyUsefulTokens(effectiveQuery, locale);
    const familyExact = labelMatchesQueryExactly(familyLabel, effectiveQuery, locale);
    const familyUseful = !familyExact && labelMatchesQueryUsefully(familyLabel, effectiveQuery, locale);
    let hierarchyExactPhrase = familyExact;
    let hierarchyUsefulPhrase = familyUseful;
    if (familyLabel.trim()) {
        sources.push({
            label: familyLabel,
            weight: HIERARCHY_LABEL_WEIGHT.family_label,
            kind: 'family_label',
            distanceFromLeaf: 0
        });
    }
    if (!coreRecord) {
        return {
            sources,
            siblingSources,
            exactFamilyLabelPhrase: familyExact,
            usefulFamilyLabelPhrase: familyUseful,
            hierarchyExactPhrase,
            hierarchyUsefulPhrase,
            matchedHierarchyLabels: [],
            matchedSiblingLabels: []
        };
    }
    if (coreRecord.groupLabel?.trim()) {
        sources.push({
            label: coreRecord.groupLabel,
            weight: HIERARCHY_LABEL_WEIGHT.group_label,
            kind: 'group_label',
            distanceFromLeaf: 0
        });
        hierarchyExactPhrase = hierarchyExactPhrase || labelMatchesQueryExactly(coreRecord.groupLabel, effectiveQuery, locale);
        hierarchyUsefulPhrase = hierarchyUsefulPhrase || labelMatchesQueryUsefully(coreRecord.groupLabel, effectiveQuery, locale);
    }
    if (coreRecord.parentLabel?.trim()) {
        sources.push({
            label: coreRecord.parentLabel,
            weight: HIERARCHY_LABEL_WEIGHT.parent_label,
            kind: 'parent_label',
            distanceFromLeaf: 0
        });
        hierarchyExactPhrase = hierarchyExactPhrase || labelMatchesQueryExactly(coreRecord.parentLabel, effectiveQuery, locale);
        hierarchyUsefulPhrase = hierarchyUsefulPhrase || labelMatchesQueryUsefully(coreRecord.parentLabel, effectiveQuery, locale);
    }
    for (const ancestor of coreRecord.ancestors) {
        const label = ancestor.canonicalLabel.trim();
        if (!label) {
            continue;
        }
        const weight = hierarchyAncestorWeight(ancestor);
        sources.push({
            label,
            weight,
            kind: 'ancestor',
            distanceFromLeaf: ancestor.distanceFromLeaf
        });
        hierarchyExactPhrase = hierarchyExactPhrase || labelMatchesQueryExactly(label, effectiveQuery, locale);
        hierarchyUsefulPhrase = hierarchyUsefulPhrase || labelMatchesQueryUsefully(label, effectiveQuery, locale);
    }
    for (const sibling of coreRecord.siblings.slice(0, 8)) {
        const label = sibling.canonicalLabel.trim();
        if (!label) {
            continue;
        }
        siblingSources.push({
            label,
            weight: HIERARCHY_LABEL_WEIGHT.sibling,
            distanceFromLeaf: 0
        });
    }
    collectMatchedLabelEvidence(sources, queryUsefulTokens, matchedHierarchyLabels, locale);
    collectMatchedLabelEvidence(siblingSources, queryUsefulTokens, matchedSiblingLabels, locale);
    return {
        sources,
        siblingSources,
        exactFamilyLabelPhrase: familyExact,
        usefulFamilyLabelPhrase: familyUseful,
        hierarchyExactPhrase,
        hierarchyUsefulPhrase,
        matchedHierarchyLabels: uniqueSortedStrings(matchedHierarchyLabels),
        matchedSiblingLabels: uniqueSortedStrings(matchedSiblingLabels)
    };
}
function collectMatchedLabelEvidence(sources, queryTokens, matchedLabels, locale) {
    for (const source of sources) {
        const sourceTokens = tokenSetForText(source.label, locale);
        if (queryTokens.some((token) => tokenSetHasEquivalent(sourceTokens, token))) {
            matchedLabels.add(source.label);
        }
    }
}
export function buildQueryVector(preparedQuery, familyTokenRelevanceArtifact, locale) {
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
function scoreFamilyVector(family, queryVector, familyProfileArtifact, searchMetaArtifact) {
    const matchedTerms = new Set();
    const matchedRoleTerms = new Set();
    const matchedDomainTerms = new Set();
    const matchedSources = new Set();
    const matchingLeafIds = new Set();
    let baseDotProduct = 0;
    let hierarchyDotProduct = 0;
    let siblingDotProduct = 0;
    let roleTotal = 0;
    let roleMatched = 0;
    let domainTotal = 0;
    let domainMatched = 0;
    for (const term of queryVector) {
        const baseWeight = family.baseVector.weights.get(term.token) ?? 0;
        const hierarchyWeight = family.hierarchyVector.weights.get(term.token) ?? 0;
        const siblingWeight = family.siblingVector.weights.get(term.token) ?? 0;
        if (baseWeight <= 0 && hierarchyWeight <= 0 && siblingWeight <= 0) {
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
        baseDotProduct += term.weight * baseWeight;
        hierarchyDotProduct += term.weight * hierarchyWeight;
        siblingDotProduct += term.weight * siblingWeight;
        matchedTerms.add(term.token);
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'alias', term.token)) {
            matchedSources.add('alias');
        }
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'leaf_label', term.token)) {
            matchedSources.add('leaf_label');
        }
        if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'capability', term.token)) {
            matchedSources.add('capability');
        }
        if (matchesHierarchyToken(family.matchedHierarchyLabels, term.token, family.locale)) {
            matchedTerms.add(term.token);
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
    const baseCosine = queryNorm > 0 && family.baseVector.norm > 0 ? baseDotProduct / (queryNorm * family.baseVector.norm) : 0;
    const hierarchyCosine = queryNorm > 0 && family.hierarchyVector.norm > 0 ? hierarchyDotProduct / (queryNorm * family.hierarchyVector.norm) : 0;
    const siblingCosine = queryNorm > 0 && family.siblingVector.norm > 0 ? siblingDotProduct / (queryNorm * family.siblingVector.norm) : 0;
    const coverage = queryVector.length > 0 ? matchedTerms.size / queryVector.length : 0;
    const roleCoverage = roleTotal > 0 ? roleMatched / roleTotal : 0;
    const domainCoverage = domainTotal > 0 ? domainMatched / domainTotal : 0;
    const exactBoost = family.exactFamilyLabelPhrase ? 0.25 : 0;
    const usefulBoost = !family.exactFamilyLabelPhrase && family.usefulFamilyLabelPhrase ? 0.12 : 0;
    const hierarchyExactBoost = !family.exactFamilyLabelPhrase && family.hierarchyExactPhrase ? 0.12 : 0;
    const hierarchyUsefulBoost = !family.usefulFamilyLabelPhrase && family.hierarchyUsefulPhrase ? 0.06 : 0;
    const hierarchyReliability = family.hasHierarchy ? 0.02 : 0;
    const genericRiskPenalty = genericRiskPenaltyFor(family.genericRisk, coverage, roleCoverage, domainCoverage);
    const siblingPenalty = siblingPenaltyFor(siblingCosine, hierarchyCosine, coverage);
    const scoreBreakdown = {
        baseVector: roundScore(baseCosine * 0.45),
        hierarchyVector: roundScore(hierarchyCosine * 0.32),
        siblingPenalty: roundScore(siblingPenalty),
        phrase: roundScore(exactBoost + usefulBoost + hierarchyExactBoost + hierarchyUsefulBoost),
        coverage: roundScore(coverage * 0.05),
        roleCoverage: roundScore(roleCoverage * 0.06),
        domainCoverage: roundScore(domainCoverage * 0.03),
        hierarchyReliability: roundScore(hierarchyReliability),
        genericRiskPenalty: roundScore(genericRiskPenalty),
        familyLabelExact: roundScore(exactBoost),
        familyLabelUseful: roundScore(usefulBoost),
        hierarchyLabelExact: roundScore(hierarchyExactBoost),
        hierarchyLabelUseful: roundScore(hierarchyUsefulBoost),
        queryVectorNorm: roundScore(queryNorm),
        baseVectorNorm: roundScore(family.baseVector.norm),
        hierarchyVectorNorm: roundScore(family.hierarchyVector.norm),
        siblingVectorNorm: roundScore(family.siblingVector.norm)
    };
    const score = roundScore(scoreBreakdown.baseVector +
        scoreBreakdown.hierarchyVector +
        scoreBreakdown.phrase +
        scoreBreakdown.coverage +
        scoreBreakdown.roleCoverage +
        scoreBreakdown.domainCoverage +
        scoreBreakdown.hierarchyReliability -
        scoreBreakdown.genericRiskPenalty -
        scoreBreakdown.siblingPenalty);
    const matchedHierarchyTerms = queryVector
        .filter((term) => matchesHierarchyToken(family.matchedHierarchyLabels, term.token, family.locale))
        .map((term) => term.token);
    const matchedSiblingTerms = queryVector
        .filter((term) => matchesHierarchyToken(family.matchedSiblingLabels, term.token, family.locale))
        .map((term) => term.token);
    return {
        rank: 0,
        familyNodeId: family.familyNodeId,
        familyLabel: family.familyLabel,
        groupNodeId: family.groupNodeId,
        groupLabel: family.groupLabel,
        score,
        baseCosine: roundScore(baseCosine),
        hierarchyCosine: roundScore(hierarchyCosine),
        siblingCosine: roundScore(siblingCosine),
        exactFamilyLabelPhrase: family.exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase: family.usefulFamilyLabelPhrase,
        hierarchyExactPhrase: family.hierarchyExactPhrase,
        hierarchyUsefulPhrase: family.hierarchyUsefulPhrase,
        matchedTerms: uniqueSortedStrings(matchedTerms),
        missingTerms: queryVector.filter((term) => !matchedTerms.has(term.token)).map((term) => term.token),
        matchedRoleTerms: uniqueSortedStrings(matchedRoleTerms),
        missingRoleTerms: queryVector
            .filter((term) => (term.kind === 'role' || term.kind === 'role_head') && !matchedRoleTerms.has(term.token))
            .map((term) => term.token),
        matchedDomainTerms: uniqueSortedStrings(matchedDomainTerms),
        matchedSources: Array.from(matchedSources).sort(),
        matchedHierarchyLabels: family.matchedHierarchyLabels,
        matchedSiblingLabels: family.matchedSiblingLabels,
        matchingLeafIds: Array.from(matchingLeafIds).sort((left, right) => left - right),
        matchingLeafCount: matchingLeafIds.size,
        profileLeafCount: family.profileLeafCount,
        genericRisk: family.genericRisk,
        hasHierarchy: family.hasHierarchy,
        hasCapabilitySupport: family.hasCapabilitySupport,
        scoreBreakdown
    };
}
function familyContainsToken(artifact, localeProfile, sourceKind, token) {
    const source = artifact.getSource(localeProfile, sourceKind);
    const tokenId = artifact.stringId(token);
    return tokenId >= 0 && artifact.sourceHasToken(source, tokenId);
}
function buildVectorFromSource(vector, source, artifact, locale, sourceKind) {
    const sourceWeight = BASE_SOURCE_WEIGHT[sourceKind] / sourceNormalization(source);
    for (const token of artifact.sourceTokens(source)) {
        const folded = foldSearchText(token).trim();
        const tokenWeightFactor = familyVectorTokenFactor(folded, locale);
        if (tokenWeightFactor <= 0) {
            continue;
        }
        addVectorWeight(vector.weights, folded, sourceWeight * tokenWeightFactor);
    }
}
function buildVectorFromLabel(vector, label, weight, locale, kind, distanceFromLeaf) {
    const tokens = tokenizeNormalizedText(foldSearchText(label)).filter((token) => familyVectorTokenFactor(token, locale) > 0);
    const normalization = 1 + Math.log2(2 + tokens.length);
    const labelWeight = (weight / normalization) * hierarchyDistanceFactor(distanceFromLeaf, kind);
    for (const token of tokens) {
        addVectorWeight(vector.weights, token, labelWeight * familyVectorTokenFactor(token, locale));
    }
}
function hierarchyDistanceFactor(distanceFromLeaf, kind) {
    if (kind === 'sibling') {
        return 1;
    }
    if (distanceFromLeaf <= 0) {
        return 1;
    }
    return 1 / (1 + Math.max(distanceFromLeaf - 1, 0) * 0.35);
}
function hierarchyAncestorWeight(ancestor) {
    const roleWeight = ancestorRoleWeight(ancestor.ancestorRole);
    const distanceWeight = 1 / (1 + Math.max(ancestor.distanceFromLeaf - 1, 0) * 0.4);
    return HIERARCHY_LABEL_WEIGHT.ancestor * roleWeight * distanceWeight;
}
function ancestorRoleWeight(role) {
    switch (role) {
        case 'parent':
            return 1;
        case 'family':
            return 0.92;
        case 'group':
            return 0.8;
        case 'broader':
            return 0.62;
        default:
            return 0.7;
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
function labelMatchesQueryExactly(label, query, _locale) {
    return exactFamilyLabelPhrase(label, query);
}
function labelMatchesQueryUsefully(label, query, locale) {
    return usefulFamilyLabelPhrase(label, query, locale);
}
function tokenSetForText(value, locale, includeGeneric = false) {
    return new Set(tokenizeNormalizedText(foldSearchText(value)).filter((token) => token.length >= 2 && !isStopQueryToken(token, locale) && (includeGeneric || !isGenericQueryToken(token, locale))));
}
function tokenSetHasEquivalent(values, token) {
    if (values.has(token)) {
        return true;
    }
    const queryVariants = simpleTokenVariants(token);
    if (queryVariants.some((variant) => values.has(variant))) {
        return true;
    }
    for (const value of values) {
        if (simpleTokenVariants(value).includes(token)) {
            return true;
        }
        if (queryVariants.some((variant) => simpleTokenVariants(value).includes(variant))) {
            return true;
        }
    }
    return false;
}
function simpleTokenVariants(token) {
    if (token.endsWith('ies') && token.length > 4) {
        return [`${token.slice(0, -3)}y`];
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return [token.slice(0, -1)];
    }
    return [];
}
function matchesHierarchyToken(labels, token, locale) {
    const queryTokens = new Set(simpleTokenVariants(token).concat(token));
    return labels.some((label) => {
        const labelTokens = tokenSetForText(label, locale, true);
        return Array.from(queryTokens).some((variant) => tokenSetHasEquivalent(labelTokens, variant));
    });
}
function familyVectorTokenFactor(token, locale) {
    if (token.length < 2 || isStopQueryToken(token, locale)) {
        return 0;
    }
    return isGenericQueryToken(token, locale) ? 0.35 : 1;
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
function genericRiskPenaltyFor(risk, coverage, roleCoverage, domainCoverage) {
    const base = risk === 'high' ? 0.04 : risk === 'medium' ? 0.02 : 0;
    const broadness = coverage < 0.5 && roleCoverage < 0.5 ? 0.01 : 0;
    const domainSupport = domainCoverage > 0.5 ? -0.005 : 0;
    return Math.max(0, base + broadness + domainSupport);
}
function siblingPenaltyFor(siblingCosine, hierarchyCosine, coverage) {
    if (siblingCosine <= hierarchyCosine) {
        return 0;
    }
    const confusion = siblingCosine - hierarchyCosine;
    const coverageFactor = coverage < 0.5 ? 1.15 : 0.85;
    return confusion * 0.1 * coverageFactor;
}
function compareFamilyHits(left, right) {
    return (right.score - left.score ||
        right.baseCosine - left.baseCosine ||
        right.hierarchyCosine - left.hierarchyCosine ||
        Number(right.exactFamilyLabelPhrase) - Number(left.exactFamilyLabelPhrase) ||
        Number(right.usefulFamilyLabelPhrase) - Number(left.usefulFamilyLabelPhrase) ||
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
        default:
            return 0;
    }
}
