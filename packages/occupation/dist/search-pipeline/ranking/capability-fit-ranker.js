import { foldSearchText, tokenizeNormalizedText } from '../../utils/texts.js';
export class CapabilityFitRanker {
    rank(input) {
        const queryTokens = input.preparedQuery.familyScopedFoldedTokens;
        const capabilityTokenSets = input.capabilityLabels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
        const matchedCapabilityTerms = unique(queryTokens.filter((token) => capabilityTokenSets.some((tokens) => tokens.includes(token))));
        const missingCapabilityTerms = unique(queryTokens.filter((token) => !matchedCapabilityTerms.includes(token)));
        const coverage = queryTokens.length > 0 ? matchedCapabilityTerms.length / queryTokens.length : 0;
        if (queryTokens.length > 0 && matchedCapabilityTerms.length === queryTokens.length) {
            return fit('strong', coverage, matchedCapabilityTerms, missingCapabilityTerms);
        }
        if (matchedCapabilityTerms.length > 0) {
            return fit('partial', coverage, matchedCapabilityTerms, missingCapabilityTerms);
        }
        return fit('none', 0, matchedCapabilityTerms, missingCapabilityTerms);
    }
}
function fit(tier, coverage, matchedCapabilityTerms, missingCapabilityTerms) {
    return {
        tier,
        tierRank: tierRank(tier),
        coverage: clampScore(coverage),
        matchedCapabilityTerms,
        missingCapabilityTerms
    };
}
function tierRank(tier) {
    if (tier === 'strong') {
        return 1;
    }
    if (tier === 'partial') {
        return 2;
    }
    return 3;
}
function unique(values) {
    return Array.from(new Set(values)).sort();
}
function clampScore(value) {
    const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
