import { foldSearchLookupText, isGenericQueryToken } from '../query/query-preparation.js';
import { FAMILY_PROFILE_SCORING_POLICY } from '../scoring/scoring-policy.js';
import { clampScore, containsTokenPhrase, lookupSortedPairValue, sortedIncludes, uniqueSortedStrings } from '../utils/operators.js';
export class FamilyProfileRetriever {
    retrieve(options) {
        const fullQueryTokens = uniqueSortedStrings(options.preparedQuery.familyScopedFoldedTokens.map((token) => foldSearchLookupText(token)));
        const roleTokenSource = options.preparedQuery.intent.roleTokens.length > 0
            ? options.preparedQuery.intent.roleTokens
            : options.preparedQuery.familyScopedFoldedTokens;
        const fullRoleTokens = uniqueSortedStrings(roleTokenSource.map((token) => foldSearchLookupText(token)));
        const fullRoleHeadTokens = uniqueSortedStrings(options.preparedQuery.intent.roleHeadTokens.map((token) => foldSearchLookupText(token)));
        const queryTokens = fullQueryTokens.filter((token) => !isGenericQueryToken(token, options.preparedQuery.locale));
        const queryTokenSet = new Set(queryTokens);
        const roleTokens = fullRoleTokens.filter((token) => queryTokenSet.has(token));
        const roleHeadTokens = fullRoleHeadTokens.filter((token) => queryTokenSet.has(token));
        const domainTokens = uniqueSortedStrings(options.preparedQuery.intent.domainTokens.map((token) => foldSearchLookupText(token)));
        const primaryHits = retrieveWithTokens(options, queryTokens, roleTokens.length > 0 ? roleTokens : queryTokens, roleHeadTokens, domainTokens);
        if (primaryHits.length > 0 || queryTokens.length === fullQueryTokens.length) {
            return primaryHits;
        }
        return retrieveWithTokens(options, fullQueryTokens, fullRoleTokens.length > 0 ? fullRoleTokens : fullQueryTokens, fullRoleHeadTokens, domainTokens);
    }
}
function retrieveWithTokens(options, queryTokens, roleTokens, roleHeadTokens, domainTokens) {
    if (roleTokens.length === 0 && queryTokens.length === 0) {
        return [];
    }
    const hits = [];
    for (const profile of options.profiles) {
        const localeProfile = profileForLocale(profile, options.locale);
        if (!localeProfile) {
            continue;
        }
        const hit = scoreFamilyProfile(profile, localeProfile, queryTokens, roleTokens, roleHeadTokens, domainTokens);
        if (hit && hit.score >= FAMILY_PROFILE_SCORING_POLICY.MIN_SCORE) {
            hits.push(hit);
        }
    }
    return hits
        .sort(compareFamilyProfileHits)
        .slice(0, options.limit);
}
function profileForLocale(profile, locale) {
    return profile.localeProfiles.find((localeProfile) => localeProfile.localeCode === locale) ??
        profile.localeProfiles.find((localeProfile) => localeProfile.localeCode === 'unknown') ??
        null;
}
function scoreFamilyProfile(profile, localeProfile, queryTokens, roleTokens, roleHeadTokens, domainTokens) {
    const familyLabelMatches = scoreTextCollection(localeProfile.sources.family_label, roleTokens);
    const aliasMatches = scoreTextCollection(localeProfile.sources.alias, roleTokens);
    const leafMatches = scoreTextCollection(localeProfile.sources.leaf_label, roleTokens);
    const capabilityMatches = scoreTextCollection(localeProfile.sources.capability, roleTokens);
    const domainMatches = scoreDomainCollections(localeProfile, domainTokens);
    const matchedTerms = uniqueSortedStrings([
        ...familyLabelMatches.matchedTerms,
        ...aliasMatches.matchedTerms,
        ...leafMatches.matchedTerms,
        ...capabilityMatches.matchedTerms,
        ...domainMatches.matchedTerms
    ]);
    const matchedRoleTerms = uniqueSortedStrings([
        ...familyLabelMatches.matchedTerms,
        ...aliasMatches.matchedTerms,
        ...leafMatches.matchedTerms,
        ...capabilityMatches.matchedTerms
    ]);
    const matchedRoleHeadTerms = roleHeadTokens.filter((token) => tokenListHasEquivalent(matchedRoleTerms, token));
    if (roleHeadTokens.length > 0 && matchedRoleHeadTerms.length === 0) {
        return null;
    }
    if (roleTokens.length > 0 && matchedRoleTerms.length === 0) {
        return null;
    }
    if (matchedTerms.length === 0) {
        return null;
    }
    const missingTerms = queryTokens.filter((token) => !matchedTerms.includes(token));
    const coverage = queryTokens.length > 0 ? matchedTerms.length / queryTokens.length : 0;
    const roleCoverage = roleTokens.length > 0 ? matchedRoleTerms.length / roleTokens.length : 0;
    const domainCoverage = domainTokens.length > 0 ? domainMatches.matchedTerms.length / domainTokens.length : 0;
    const matchingLeafIds = matchingProfileLeafIds(localeProfile.leafIdsByToken, roleTokens.length > 0 ? roleTokens : queryTokens);
    const clusterAgreement = Math.min(matchingLeafIds.length, FAMILY_PROFILE_SCORING_POLICY.MAX_CLUSTER_LEAVES) /
        FAMILY_PROFILE_SCORING_POLICY.MAX_CLUSTER_LEAVES;
    const matchedSources = matchedSourceKinds({
        familyLabel: familyLabelMatches,
        alias: aliasMatches,
        leaf: leafMatches,
        capability: capabilityMatches
    });
    const score = familyProfileScore({
        familyLabelMatches,
        aliasMatches,
        leafMatches,
        capabilityMatches,
        coverage,
        domainCoverage,
        clusterAgreement
    });
    if (score <= 0) {
        return null;
    }
    return {
        familyNodeId: profile.familyNodeId,
        familyLabel: profile.familyLabel,
        groupNodeId: profile.groupNodeId,
        groupLabel: profile.groupLabel,
        score,
        coverage: clampScore(coverage),
        roleCoverage: clampScore(roleCoverage),
        domainCoverage: clampScore(domainCoverage),
        matchedTerms,
        missingTerms,
        matchedRoleTerms,
        missingRoleTerms: roleTokens.filter((token) => !matchedRoleTerms.includes(token)),
        matchedDomainTerms: domainMatches.matchedTerms,
        matchedSources,
        matchingLeafIds,
        matchingLeafCount: matchingLeafIds.length,
        profileLeafCount: profile.profileLeafCount
    };
}
function scoreDomainCollections(localeProfile, domainTokens) {
    if (domainTokens.length === 0) {
        return {
            exactPhrase: false,
            allTerms: false,
            matchedTerms: []
        };
    }
    const sources = [
        localeProfile.sources.family_label,
        localeProfile.sources.alias,
        localeProfile.sources.leaf_label,
        localeProfile.sources.capability
    ];
    const matchedTerms = uniqueSortedStrings(domainTokens.filter((token) => sources.some((source) => sortedIncludes(source.tokens, token))));
    return {
        exactPhrase: false,
        allTerms: domainTokens.length > 0 && matchedTerms.length === domainTokens.length,
        matchedTerms
    };
}
function scoreTextCollection(value, queryTokens) {
    const matchedTerms = queryTokens.filter((token) => sortedIncludes(value.tokens, token));
    let exactPhrase = queryTokens.length === 1 && matchedTerms.length === 1;
    if (!exactPhrase && matchedTerms.length > 0) {
        exactPhrase = value.phrases.some((phrase) => containsTokenPhrase(phrase, queryTokens));
    }
    return {
        exactPhrase,
        allTerms: queryTokens.length > 0 && matchedTerms.length === queryTokens.length,
        matchedTerms
    };
}
function matchingProfileLeafIds(leafIdsByToken, queryTokens) {
    const matchingIds = new Set();
    for (const token of queryTokens) {
        const leafIds = lookupSortedPairValue(leafIdsByToken, token, []);
        for (const leafId of leafIds) {
            matchingIds.add(leafId);
        }
    }
    return Array.from(matchingIds).sort((left, right) => left - right);
}
function matchedSourceKinds(input) {
    const sources = [];
    if (input.familyLabel.matchedTerms.length > 0) {
        sources.push('family_label');
    }
    if (input.alias.matchedTerms.length > 0) {
        sources.push('alias');
    }
    if (input.leaf.matchedTerms.length > 0) {
        sources.push('leaf_label');
    }
    if (input.capability.matchedTerms.length > 0) {
        sources.push('capability');
    }
    return sources;
}
function familyProfileScore(input) {
    if (input.familyLabelMatches.exactPhrase || input.aliasMatches.exactPhrase) {
        return FAMILY_PROFILE_SCORING_POLICY.EXACT_FAMILY_OR_ALIAS_PHRASE;
    }
    if (input.familyLabelMatches.allTerms || input.aliasMatches.allTerms) {
        return FAMILY_PROFILE_SCORING_POLICY.ALL_TERMS_FAMILY_OR_ALIAS;
    }
    if (input.leafMatches.allTerms || input.capabilityMatches.allTerms) {
        return FAMILY_PROFILE_SCORING_POLICY.ALL_TERMS_LEAF_OR_CAPABILITY;
    }
    if (input.coverage <= 0) {
        return 0;
    }
    return clampScore(FAMILY_PROFILE_SCORING_POLICY.PARTIAL_BASE +
        input.coverage * FAMILY_PROFILE_SCORING_POLICY.PARTIAL_COVERAGE_WEIGHT +
        input.domainCoverage * FAMILY_PROFILE_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        input.clusterAgreement * FAMILY_PROFILE_SCORING_POLICY.CLUSTER_AGREEMENT_WEIGHT);
}
function compareFamilyProfileHits(left, right) {
    return (right.score - left.score ||
        right.coverage - left.coverage ||
        right.matchingLeafCount - left.matchingLeafCount ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function tokenListHasEquivalent(values, token) {
    const valueSet = new Set(values);
    if (valueSet.has(token)) {
        return true;
    }
    return simpleEnglishVariants(token).some((variant) => valueSet.has(variant));
}
function simpleEnglishVariants(token) {
    if (token.endsWith('ies') && token.length > 4) {
        return [`${token.slice(0, -3)}y`];
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return [token.slice(0, -1)];
    }
    return [];
}
