import { longestContiguousTokenMatch } from '../../query/query-preparation.js';
import { foldSearchText, tokenizeNormalizedText } from '../../utils/texts.js';
export class FamilyScopedLeafRanker {
    rank(input) {
        const queryTokens = input.preparedQuery.familyScopedFoldedTokens;
        const labels = [input.canonicalLabel, ...input.aliases].filter((label) => label.trim().length > 0);
        const labelTokenSets = labels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
        const capabilityTokenSets = input.capabilityLabels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
        const matchedTerms = unique(queryTokens.filter((token) => labelTokenSets.some((labelTokens) => labelTokens.includes(token))));
        const missingTerms = unique(queryTokens.filter((token) => !matchedTerms.includes(token)));
        const matchedCapabilityTerms = unique(queryTokens.filter((token) => capabilityTokenSets.some((capabilityTokens) => capabilityTokens.includes(token))));
        const exactLabel = labels.some((label) => foldSearchText(label) === input.preparedQuery.folded);
        const longestLabelMatch = Math.max(...labelTokenSets.map((labelTokens) => longestContiguousTokenMatch(labelTokens, queryTokens, input.preparedQuery.locale).length), 0);
        const reasons = [];
        if (exactLabel) {
            reasons.push('exact family-scoped canonical or alias match');
            return fit('exact', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        if (queryTokens.length > 0 && matchedTerms.length === queryTokens.length) {
            reasons.push('all family-scoped query terms matched canonical or alias text');
            return fit('alias_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        if (matchedCapabilityTerms.length > 0 && matchedTerms.length > 0) {
            reasons.push('family-scoped query terms matched both title/alias and capability text');
            return fit('capability_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        if (input.hasSemanticEvidence && matchedTerms.length > 0) {
            reasons.push('semantic retrieval agreed with a family-scoped role term');
            return fit('semantic_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        if (longestLabelMatch > 0 || matchedTerms.length > 0 || matchedCapabilityTerms.length > 0) {
            reasons.push('some family-scoped lexical overlap found');
            return fit('lexical_related', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        if (input.hasSemanticEvidence) {
            reasons.push('semantic retrieval found this leaf, but family-scoped lexical/capability fit is weak');
            return fit('semantic_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
        }
        reasons.push('no family-scoped leaf fit evidence found');
        return fit('weak', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
    }
}
function fit(tier, reasons, matchedTerms, missingTerms, matchedCapabilityTerms) {
    return {
        tier,
        tierRank: tierRank(tier),
        reasons,
        matchedTerms,
        missingTerms,
        matchedCapabilityTerms
    };
}
function tierRank(tier) {
    if (tier === 'exact') {
        return 1;
    }
    if (tier === 'alias_aligned') {
        return 2;
    }
    if (tier === 'capability_aligned') {
        return 3;
    }
    if (tier === 'semantic_aligned') {
        return 4;
    }
    if (tier === 'lexical_related') {
        return 5;
    }
    return 6;
}
function unique(values) {
    return Array.from(new Set(values)).sort();
}
