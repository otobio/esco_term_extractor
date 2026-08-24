import { isGenericQueryToken, isStopQueryToken, isUsefulQueryToken, preparedQueryFamilyScopedFoldedTokens } from '../query/query-preparation.js';
import { clampScore, roundScore, uniqueSortedStrings } from '../utils/operators.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
const QUERY_KIND_WEIGHT = {
    support: 1,
    role: 1.75,
    role_head: 2.75,
    domain: 0.8,
    venue: 0.7
};
const SOURCE_KIND_WEIGHT = {
    family_label: 1.35,
    alias: 1.15,
    leaf_label: 0.7,
    capability: 0.45
};
export function rankFamilyTop2(options) {
    const queryTerms = buildQueryTerms(options.query.preparedQuery);
    const hits = [];
    for (let rowId = 0; rowId < options.familyProfileArtifact.profileRows.count; rowId += 1) {
        const profile = options.familyProfileArtifact.getProfileCore(rowId);
        if (!profile) {
            continue;
        }
        const localeProfile = options.familyProfileArtifact.getLocaleProfile(profile, options.query.locale);
        if (!localeProfile) {
            continue;
        }
        const hit = scoreFamily(options.familyProfileArtifact, options.familyTokenRelevanceArtifact, profile, localeProfile, queryTerms, options.query.preparedQuery, options.query.effectiveQuery, options.query.locale);
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
        queryTerms,
        rankedFamilies
    };
}
function buildQueryTerms(preparedQuery) {
    const terms = new Map();
    const roleTokens = uniqueTokenSequence(preparedQuery.intent.roleTokens.length > 0
        ? preparedQuery.intent.roleTokens.map((token) => foldSearchText(token))
        : preparedQueryFamilyScopedFoldedTokens(preparedQuery));
    addTokens(terms, preparedQuery.usefulFoldedVariantTokens, 'support', 1);
    addTokens(terms, roleTokens, 'role', 1.75);
    addTokens(terms, uniqueTokenSequence(preparedQuery.intent.authoritativeRoleHeadTokens.map((token) => foldSearchText(token))), 'role_head', 2.75);
    addTokens(terms, preparedQuery.intent.domainTokens.map((token) => foldSearchText(token)), 'domain', 0.8);
    addTokens(terms, preparedQuery.intent.venueTokens.map((token) => foldSearchText(token)), 'venue', 0.7);
    return Array.from(terms.values()).sort((left, right) => {
        const kindDiff = queryKindPriority(right.kind) - queryKindPriority(left.kind);
        return kindDiff !== 0 ? kindDiff : left.token.localeCompare(right.token);
    });
}
function addTokens(terms, tokens, kind, baseWeight) {
    for (const rawToken of tokens) {
        const token = foldSearchText(rawToken).trim();
        if (!token || token.length < 2) {
            continue;
        }
        const weight = baseWeight * QUERY_KIND_WEIGHT[kind];
        const existing = terms.get(token);
        if (!existing ||
            weight > existing.weight ||
            (weight === existing.weight && queryKindPriority(kind) > queryKindPriority(existing.kind))) {
            terms.set(token, { token, weight, kind });
        }
    }
}
function scoreFamily(familyProfileArtifact, familyTokenRelevanceArtifact, profile, localeProfile, queryTerms, preparedQuery, effectiveQuery, locale) {
    const familyLabelSource = familyProfileArtifact.getSource(localeProfile, 'family_label');
    const aliasSource = familyProfileArtifact.getSource(localeProfile, 'alias');
    const leafSource = familyProfileArtifact.getSource(localeProfile, 'leaf_label');
    const capabilitySource = familyProfileArtifact.getSource(localeProfile, 'capability');
    const familyLabelNormalization = sourceNormalization(familyLabelSource);
    const aliasNormalization = sourceNormalization(aliasSource);
    const leafNormalization = sourceNormalization(leafSource);
    const capabilityNormalization = sourceNormalization(capabilitySource);
    const familyLabelFolded = foldSearchText(profile.familyLabel);
    const exactQueryFolded = foldSearchText(effectiveQuery);
    const exactQueryWeakPunctuation = foldWeakPunctuationLookupText(effectiveQuery);
    const exactFamilyLabelPhrase = familyLabelFolded === exactQueryFolded || foldWeakPunctuationLookupText(profile.familyLabel) === exactQueryWeakPunctuation;
    const familyLabelUsefulTokens = usefulFamilyLabelTokens(profile.familyLabel, preparedQuery.locale);
    const queryUsefulTokens = uniqueTokenSequence(preparedQueryFamilyScopedFoldedTokens(preparedQuery).filter((token) => isUsefulQueryToken(token, preparedQuery.locale) &&
        !isStopQueryToken(token, preparedQuery.locale) &&
        !isGenericQueryToken(token, preparedQuery.locale)));
    const usefulFamilyLabelPhrase = !exactFamilyLabelPhrase &&
        familyLabelUsefulTokens.length > 0 &&
        familyLabelUsefulTokens.length === queryUsefulTokens.length &&
        familyLabelUsefulTokens.every((token, index) => token === queryUsefulTokens[index]);
    const matchedTerms = new Set();
    const matchedRoleTerms = new Set();
    const matchedDomainTerms = new Set();
    const matchedSources = new Set();
    const matchingLeafIds = new Set();
    const scoreBreakdown = {
        labelAlias: 0,
        leafLabel: 0,
        capability: 0,
        phrase: 0,
        exact: exactFamilyLabelPhrase ? 4.5 : 0,
        usefulExact: usefulFamilyLabelPhrase ? 2.75 : 0,
        coverage: 0,
        roleCoverage: 0,
        domainCoverage: 0,
        querySpecificity: 0
    };
    let roleTermTotal = 0;
    let roleTermMatched = 0;
    let domainTermTotal = 0;
    let domainTermMatched = 0;
    for (const term of queryTerms) {
        const tokenId = familyProfileArtifact.stringId(term.token);
        if (tokenId < 0) {
            continue;
        }
        const querySpecificity = 0.75 + familyTokenRelevanceArtifact.maxTokenRelevance(locale, term.token);
        const weightedTerm = term.weight * querySpecificity;
        let matched = false;
        scoreBreakdown.querySpecificity += weightedTerm;
        if (sourceHasToken(familyProfileArtifact, familyLabelSource, tokenId)) {
            const familyTokenScore = familyTokenRelevanceArtifact.familyTokenRelevance(locale, profile.familyNodeId, term.token);
            scoreBreakdown.labelAlias += (weightedTerm * (SOURCE_KIND_WEIGHT.family_label + familyTokenScore)) / familyLabelNormalization;
            matchedSources.add('family_label');
            matched = true;
        }
        if (sourceHasToken(familyProfileArtifact, aliasSource, tokenId)) {
            const familyTokenScore = familyTokenRelevanceArtifact.familyTokenRelevance(locale, profile.familyNodeId, term.token);
            scoreBreakdown.labelAlias += (weightedTerm * (SOURCE_KIND_WEIGHT.alias + familyTokenScore)) / aliasNormalization;
            matchedSources.add('alias');
            matched = true;
        }
        if (sourceHasToken(familyProfileArtifact, leafSource, tokenId)) {
            scoreBreakdown.leafLabel += (weightedTerm * SOURCE_KIND_WEIGHT.leaf_label) / leafNormalization;
            matchedSources.add('leaf_label');
            matched = true;
        }
        if (sourceHasToken(familyProfileArtifact, capabilitySource, tokenId)) {
            scoreBreakdown.capability += (weightedTerm * SOURCE_KIND_WEIGHT.capability) / capabilityNormalization;
            matchedSources.add('capability');
            matched = true;
        }
        if (matched) {
            matchedTerms.add(term.token);
            for (const leafId of familyProfileArtifact.leafIdsForToken(localeProfile.rowId, tokenId)) {
                matchingLeafIds.add(leafId);
            }
            if (term.kind === 'role' || term.kind === 'role_head') {
                matchedRoleTerms.add(term.token);
                roleTermMatched += 1;
            }
            if (term.kind === 'domain' || term.kind === 'venue') {
                matchedDomainTerms.add(term.token);
                domainTermMatched += 1;
            }
        }
        if (term.kind === 'role' || term.kind === 'role_head') {
            roleTermTotal += 1;
        }
        if (term.kind === 'domain' || term.kind === 'venue') {
            domainTermTotal += 1;
        }
    }
    const matchedTermsList = uniqueSortedStrings(matchedTerms);
    const missingTerms = queryTerms.filter((term) => !matchedTerms.has(term.token)).map((term) => term.token);
    const coverage = queryTerms.length > 0 ? matchedTermsList.length / queryTerms.length : 0;
    const roleCoverage = roleTermTotal > 0 ? roleTermMatched / roleTermTotal : 0;
    const domainCoverage = domainTermTotal > 0 ? domainTermMatched / domainTermTotal : 0;
    scoreBreakdown.phrase = phraseScoreForFamily(familyProfileArtifact, localeProfile, preparedQuery);
    scoreBreakdown.coverage = coverage * 0.75;
    scoreBreakdown.roleCoverage = roleCoverage * 0.65;
    scoreBreakdown.domainCoverage = domainCoverage * 0.35;
    const score = roundScore(scoreBreakdown.labelAlias +
        scoreBreakdown.leafLabel +
        scoreBreakdown.capability +
        scoreBreakdown.phrase +
        scoreBreakdown.exact +
        scoreBreakdown.usefulExact +
        scoreBreakdown.coverage +
        scoreBreakdown.roleCoverage +
        scoreBreakdown.domainCoverage);
    return {
        rank: 0,
        familyNodeId: profile.familyNodeId,
        familyLabel: profile.familyLabel,
        groupNodeId: profile.groupNodeId,
        groupLabel: profile.groupLabel,
        score,
        exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase,
        coverage: clampScore(coverage),
        roleCoverage: clampScore(roleCoverage),
        domainCoverage: clampScore(domainCoverage),
        matchedTerms: matchedTermsList,
        missingTerms,
        matchedRoleTerms: uniqueSortedStrings(matchedRoleTerms),
        missingRoleTerms: queryTerms
            .filter((term) => (term.kind === 'role' || term.kind === 'role_head') && !matchedRoleTerms.has(term.token))
            .map((term) => term.token),
        matchedDomainTerms: uniqueSortedStrings(matchedDomainTerms),
        matchedSources: Array.from(matchedSources).sort(),
        matchingLeafIds: Array.from(matchingLeafIds).sort((left, right) => left - right),
        matchingLeafCount: matchingLeafIds.size,
        profileLeafCount: profile.profileLeafCount,
        scoreBreakdown
    };
}
function phraseScoreForFamily(familyProfileArtifact, localeProfile, preparedQuery) {
    const familyLabelSource = familyProfileArtifact.getSource(localeProfile, 'family_label');
    const aliasSource = familyProfileArtifact.getSource(localeProfile, 'alias');
    const leafSource = familyProfileArtifact.getSource(localeProfile, 'leaf_label');
    const capabilitySource = familyProfileArtifact.getSource(localeProfile, 'capability');
    let score = 0;
    score += exactPhraseScoreForSource(familyProfileArtifact, familyLabelSource, preparedQueryFamilyScopedFoldedTokens(preparedQuery), 2.0);
    score += exactPhraseScoreForSource(familyProfileArtifact, aliasSource, preparedQueryFamilyScopedFoldedTokens(preparedQuery), 1.65);
    score += exactPhraseScoreForSource(familyProfileArtifact, familyLabelSource, preparedQuery.intent.roleTokens, 1.5);
    score += exactPhraseScoreForSource(familyProfileArtifact, aliasSource, preparedQuery.intent.roleTokens, 1.25);
    score += exactPhraseScoreForSource(familyProfileArtifact, leafSource, preparedQuery.intent.roleTokens, 0.9);
    score += exactPhraseScoreForSource(familyProfileArtifact, capabilitySource, preparedQuery.intent.roleTokens, 0.6);
    return score;
}
function sourceNormalization(source) {
    return 1 + Math.log2(2 + source.tokenCount + source.phraseCount);
}
function exactPhraseScoreForSource(familyProfileArtifact, source, tokens, weight) {
    const phrase = uniqueTokenSequence(tokens).join(' ').trim();
    if (!phrase) {
        return 0;
    }
    const phraseId = familyProfileArtifact.stringId(phrase);
    if (phraseId < 0 || !familyProfileArtifact.sourceHasPhrase(source, phraseId)) {
        return 0;
    }
    return weight;
}
function usefulFamilyLabelTokens(value, locale) {
    return tokenizeNormalizedText(foldSearchText(value)).filter((token) => isUsefulQueryToken(token, locale) && !isStopQueryToken(token, locale) && !isGenericQueryToken(token, locale));
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
    return (Number(right.exactFamilyLabelPhrase) - Number(left.exactFamilyLabelPhrase) ||
        Number(right.usefulFamilyLabelPhrase) - Number(left.usefulFamilyLabelPhrase) ||
        right.score - left.score ||
        right.roleCoverage - left.roleCoverage ||
        right.coverage - left.coverage ||
        right.matchingLeafCount - left.matchingLeafCount ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function sourceHasToken(familyProfileArtifact, source, tokenId) {
    return familyProfileArtifact.sourceHasToken(source, tokenId);
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
