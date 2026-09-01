import { isGenericQueryToken, isStopQueryToken, isUsefulQueryToken, preparedQueryFamilyScopedFoldedTokens } from '../query/query-preparation.js';
import { supportAliasGroundingTokens } from '../retrieval/intent-support-grounding.js';
import { FAMILY_PROFILE_SCORING_POLICY } from '../scoring/scoring-policy.js';
import { clampScore, uniqueSortedStrings } from '../utils/operators.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { FAMILY_PROFILE_SOURCE_KINDS } from '../runtime/occupation-family-profile-artifact.js';
export class FamilyProfileRetriever {
    retrieveExactCanonicalFamilies(options) {
        const rawQuery = options.rawQuery?.trim() || options.preparedQuery.raw;
        const exactCanonicalQuery = buildExactCanonicalFamilyQuery(rawQuery, options.locale);
        const exactHit = findExactCanonicalFamilyHit(options, exactCanonicalQuery, preparedQueryFamilyScopedFoldedTokens(options.preparedQuery));
        return exactHit ? [exactHit] : [];
    }
    retrieve(options) {
        const rawQuery = options.rawQuery?.trim() || options.preparedQuery.raw;
        const exactCanonicalQuery = buildExactCanonicalFamilyQuery(rawQuery, options.locale);
        const familyScopedFoldedTokens = preparedQueryFamilyScopedFoldedTokens(options.preparedQuery);
        const fullQueryTokens = uniqueSortedStrings(familyScopedFoldedTokens);
        const groundedRoleTokens = uniqueSortedStrings(Array.from(supportAliasGroundingTokens(options.preparedQuery)));
        const roleTokenSource = options.preparedQuery.intent.roleTokens.length > 0
            ? options.preparedQuery.intent.roleTokens
            : groundedRoleTokens.length > 0
                ? groundedRoleTokens
                : familyScopedFoldedTokens;
        const fullRoleTokens = uniqueSortedStrings(roleTokenSource);
        const authoritativeHeadSource = options.preparedQuery.intent.authoritativeRoleHeadTokens.length > 0
            ? options.preparedQuery.intent.authoritativeRoleHeadTokens
            : options.preparedQuery.intent.roleHeadRequiresContext && !options.preparedQuery.intent.roleHeadHasContext
                ? []
                : options.preparedQuery.intent.roleHeadTokens.length > 0
                    ? options.preparedQuery.intent.roleHeadTokens
                    : groundedRoleTokens;
        const fullRoleHeadTokens = uniqueSortedStrings(authoritativeHeadSource);
        const queryTokens = fullQueryTokens.filter((token) => !isGenericQueryToken(token, options.preparedQuery.locale));
        const queryTokenSet = new Set(queryTokens);
        const roleTokens = fullRoleTokens.filter((token) => queryTokenSet.has(token));
        const roleHeadTokens = fullRoleHeadTokens.filter((token) => queryTokenSet.has(token));
        const domainTokens = uniqueSortedStrings(options.preparedQuery.intent.domainTokens);
        const primaryHits = retrieveWithTokens(options, queryTokens, roleTokens.length > 0 ? roleTokens : queryTokens, roleHeadTokens, domainTokens, exactCanonicalQuery);
        if (primaryHits.length > 0 || queryTokens.length === fullQueryTokens.length) {
            return withExactCanonicalFamilySupplement(options, primaryHits, exactCanonicalQuery);
        }
        return withExactCanonicalFamilySupplement(options, retrieveWithTokens(options, fullQueryTokens, fullRoleTokens.length > 0 ? fullRoleTokens : fullQueryTokens, fullRoleHeadTokens, domainTokens, exactCanonicalQuery), exactCanonicalQuery);
    }
}
function retrieveWithTokens(options, queryTokens, roleTokens, roleHeadTokens, domainTokens, exactCanonicalQuery) {
    if (roleTokens.length === 0 && queryTokens.length === 0) {
        return [];
    }
    const hits = [];
    const candidateProfileRowIds = options.artifact.profileRowIdsForTokens(options.locale, roleTokens.length > 0 ? roleTokens : queryTokens);
    for (const rowId of candidateProfileRowIds) {
        const profile = options.artifact.getProfileCore(rowId);
        if (!profile) {
            continue;
        }
        const localeProfile = options.artifact.getLocaleProfile(profile, options.locale);
        if (!localeProfile) {
            continue;
        }
        const hit = scoreFamilyProfile(options.artifact, profile, localeProfile, queryTokens, roleTokens, roleHeadTokens, options.preparedQuery.capabilityVerbFoldedAdditionTokens.length > 0
            ? options.preparedQuery.capabilityVerbFoldedAdditionTokens
            : roleTokens, domainTokens, exactCanonicalQuery, options.locale, options.preparedQuery.intent.altRoleHeadTokens, options.preparedQuery.intent.altRoleModifierTokens);
        if (hit && hit.score >= FAMILY_PROFILE_SCORING_POLICY.MIN_SCORE) {
            hits.push(hit);
        }
    }
    return hits.sort(compareFamilyProfileHits).slice(0, options.limit);
}
function scoreFamilyProfile(artifact, profile, localeProfile, queryTokens, roleTokens, roleHeadTokens, capabilityTokens, domainTokens, exactCanonicalQuery, locale, altRoleHeadTokens, altRoleModifierTokens) {
    const familyLabelMatches = scoreTextCollection(artifact, artifact.getSource(localeProfile, 'family_label'), roleTokens);
    const aliasMatches = scoreTextCollection(artifact, artifact.getSource(localeProfile, 'alias'), roleTokens);
    const leafMatches = scoreTextCollection(artifact, artifact.getSource(localeProfile, 'leaf_label'), roleTokens);
    const capabilityMatches = scoreTextCollection(artifact, artifact.getSource(localeProfile, 'capability'), capabilityTokens);
    const domainMatches = scoreDomainCollections(artifact, localeProfile, domainTokens);
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
    // roleHeadTokens/matchedRoleTerms are both in `locale` -- a real curated cross-locale synonym
    // (e.g. ro "consilier" for a family whose ro alias list only has "vanzator") would otherwise hard-
    // reject this family. altRoleHeadTokens is the safe English equivalent resolved once at intent-build
    // time (query-intent.ts); check it against this family's English profile text before giving up.
    if (roleHeadTokens.length > 0 &&
        matchedRoleHeadTerms.length === 0 &&
        !altRoleHeadMatchesEnglishProfile(artifact, profile, altRoleHeadTokens)) {
        return null;
    }
    // A query whose only useful token is a modifier the head-based check above never looks at (e.g.
    // ro "vanzari" when the head itself is a generic filler like "consultant") deserves the same
    // English-profile forgiveness as the role-head case before hard-rejecting the family.
    if (roleTokens.length > 0 &&
        matchedRoleTerms.length === 0 &&
        !altRoleHeadMatchesEnglishProfile(artifact, profile, altRoleModifierTokens)) {
        return null;
    }
    if (matchedTerms.length === 0) {
        return null;
    }
    const missingTerms = queryTokens.filter((token) => !matchedTerms.includes(token));
    const coverage = queryTokens.length > 0 ? matchedTerms.length / queryTokens.length : 0;
    const roleCoverage = roleTokens.length > 0 ? matchedRoleTerms.length / roleTokens.length : 0;
    const domainCoverage = domainTokens.length > 0 ? domainMatches.matchedTerms.length / domainTokens.length : 0;
    const matchingLeafIds = matchingProfileLeafIds(artifact, localeProfile, roleTokens.length > 0 ? roleTokens : queryTokens);
    const clusterAgreement = Math.min(matchingLeafIds.length, FAMILY_PROFILE_SCORING_POLICY.MAX_CLUSTER_LEAVES) / FAMILY_PROFILE_SCORING_POLICY.MAX_CLUSTER_LEAVES;
    const exactFamilyLabelPhrase = isExactFamilyLabelCanonicalMatch(profile.familyLabel, exactCanonicalQuery, locale);
    const usefulFamilyLabelPhrase = !exactFamilyLabelPhrase && isUsefulFamilyLabelCanonicalMatch(profile.familyLabel, exactCanonicalQuery, locale);
    const matchedSources = matchedSourceKinds({
        familyLabel: familyLabelMatches,
        alias: aliasMatches,
        leaf: leafMatches,
        capability: capabilityMatches
    });
    const score = familyProfileScore({
        exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase,
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
        exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase,
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
function buildExactCanonicalFamilyQuery(rawQuery, locale) {
    const folded = foldSearchText(rawQuery);
    return {
        folded,
        weakPunctuationFolded: foldWeakPunctuationLookupText(rawQuery),
        usefulTokens: usefulFamilyLabelTokens(rawQuery, locale)
    };
}
function isExactFamilyLabelCanonicalMatch(familyLabel, exactCanonicalQuery, _locale) {
    const foldedFamilyLabel = foldSearchText(familyLabel);
    if (foldedFamilyLabel === exactCanonicalQuery.folded) {
        return true;
    }
    if (foldWeakPunctuationLookupText(familyLabel) === exactCanonicalQuery.weakPunctuationFolded) {
        return true;
    }
    return false;
}
function isUsefulFamilyLabelCanonicalMatch(familyLabel, exactCanonicalQuery, locale) {
    const familyLabelUsefulTokens = usefulFamilyLabelTokens(familyLabel, locale);
    if (familyLabelUsefulTokens.length !== exactCanonicalQuery.usefulTokens.length) {
        return false;
    }
    const uniqueQueryTokens = uniqueSortedStrings(exactCanonicalQuery.usefulTokens);
    const uniqueFamilyLabelTokens = uniqueSortedStrings(familyLabelUsefulTokens);
    return (uniqueFamilyLabelTokens.length === uniqueQueryTokens.length &&
        uniqueFamilyLabelTokens.every((token, index) => token === uniqueQueryTokens[index]));
}
function usefulFamilyLabelTokens(value, locale) {
    return tokenizeNormalizedText(foldSearchText(value)).filter((token) => isUsefulQueryToken(token, locale) && !isStopQueryToken(token, locale));
}
function withExactCanonicalFamilySupplement(options, hits, exactCanonicalQuery) {
    const exactHit = findExactCanonicalFamilyHit(options, exactCanonicalQuery, preparedQueryFamilyScopedFoldedTokens(options.preparedQuery));
    if (!exactHit) {
        return hits;
    }
    const existingIndex = hits.findIndex((hit) => hit.familyNodeId === exactHit.familyNodeId);
    const mergedHits = existingIndex >= 0 ? hits.map((hit, index) => (index === existingIndex ? exactHit : hit)) : [exactHit, ...hits];
    return mergedHits.sort(compareFamilyProfileHits).slice(0, options.limit);
}
function findExactCanonicalFamilyHit(options, exactCanonicalQuery, familyScopedFoldedTokens) {
    for (let rowId = 0; rowId < options.artifact.profileRows.count; rowId += 1) {
        const profile = options.artifact.getProfileCore(rowId);
        if (!profile) {
            continue;
        }
        const weakPunctuationExact = profile.familyLabelWeakPunctuationFolded === exactCanonicalQuery.weakPunctuationFolded;
        if (!weakPunctuationExact && !isExactFamilyLabelCanonicalMatch(profile.familyLabel, exactCanonicalQuery, options.locale)) {
            continue;
        }
        const localeProfile = options.artifact.getLocaleProfile(profile, options.locale);
        if (!localeProfile) {
            continue;
        }
        const hit = scoreFamilyProfile(options.artifact, profile, localeProfile, uniqueSortedStrings(familyScopedFoldedTokens), uniqueSortedStrings(options.preparedQuery.intent.roleTokens), uniqueSortedStrings(options.preparedQuery.intent.authoritativeRoleHeadTokens), options.preparedQuery.capabilityVerbFoldedAdditionTokens.length > 0
            ? uniqueSortedStrings(options.preparedQuery.capabilityVerbFoldedAdditionTokens)
            : uniqueSortedStrings(options.preparedQuery.intent.roleTokens), uniqueSortedStrings(options.preparedQuery.intent.domainTokens), exactCanonicalQuery, options.locale, options.preparedQuery.intent.altRoleHeadTokens, options.preparedQuery.intent.altRoleModifierTokens);
        if (hit) {
            return hit;
        }
    }
    return null;
}
function scoreDomainCollections(artifact, localeProfile, domainTokens) {
    if (domainTokens.length === 0) {
        return {
            exactPhrase: false,
            allTerms: false,
            matchedTerms: []
        };
    }
    const sources = FAMILY_PROFILE_SOURCE_KINDS.map((sourceKind) => artifact.getSource(localeProfile, sourceKind));
    const matchedTerms = uniqueSortedStrings(domainTokens.filter((token) => {
        const tokenId = artifact.stringId(token);
        return tokenId >= 0 && sources.some((source) => artifact.sourceHasToken(source, tokenId));
    }));
    return {
        exactPhrase: false,
        allTerms: domainTokens.length > 0 && matchedTerms.length === domainTokens.length,
        matchedTerms
    };
}
function scoreTextCollection(artifact, source, queryTokens) {
    const matchedTerms = queryTokens.filter((token) => {
        const tokenId = artifact.stringId(token);
        return tokenId >= 0 && artifact.sourceHasToken(source, tokenId);
    });
    let exactPhrase = queryTokens.length === 1 && matchedTerms.length === 1;
    if (!exactPhrase && matchedTerms.length > 0) {
        const phraseId = artifact.stringId(queryTokens.join(' '));
        exactPhrase = phraseId >= 0 && artifact.sourceHasPhrase(source, phraseId);
    }
    return {
        exactPhrase,
        allTerms: queryTokens.length > 0 && matchedTerms.length === queryTokens.length,
        matchedTerms
    };
}
function matchingProfileLeafIds(artifact, localeProfile, queryTokens) {
    const matchingIds = new Set();
    for (const token of queryTokens) {
        const tokenId = artifact.stringId(token);
        if (tokenId < 0) {
            continue;
        }
        for (const leafId of artifact.leafIdsForToken(localeProfile.rowId, tokenId)) {
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
    if (input.exactFamilyLabelPhrase) {
        return FAMILY_PROFILE_SCORING_POLICY.EXACT_FAMILY_OR_ALIAS_PHRASE;
    }
    if (input.usefulFamilyLabelPhrase) {
        return FAMILY_PROFILE_SCORING_POLICY.ALL_TERMS_FAMILY_OR_ALIAS;
    }
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
    return (Number(right.exactFamilyLabelPhrase) - Number(left.exactFamilyLabelPhrase) ||
        Number(right.usefulFamilyLabelPhrase) - Number(left.usefulFamilyLabelPhrase) ||
        right.score - left.score ||
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
function altRoleHeadMatchesEnglishProfile(artifact, profile, altRoleHeadTokens) {
    if (altRoleHeadTokens.length === 0) {
        return false;
    }
    const englishLocaleProfile = artifact.getLocaleProfile(profile, 'en');
    if (!englishLocaleProfile) {
        return false;
    }
    const sources = FAMILY_PROFILE_SOURCE_KINDS.map((sourceKind) => artifact.getSource(englishLocaleProfile, sourceKind));
    return altRoleHeadTokens.some((term) => {
        const tokenId = artifact.stringId(term);
        return tokenId >= 0 && sources.some((source) => artifact.sourceHasToken(source, tokenId));
    });
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
