import { expandAcronymToken, isGenericQueryToken } from '../../query/query-preparation.js';
import { foldSearchText, normalizeSearchText, tokenizeNormalizedText } from '../../utils/texts.js';
export class TokenLeafClosenessRanker {
    rank(input) {
        const labelRanks = [
            scoreLabel(input.preparedQuery, input.canonicalLabel, 'canonical'),
            ...(input.aliases ?? []).map((alias) => scoreLabel(input.preparedQuery, alias, 'alias'))
        ];
        return labelRanks.sort(compareLabelRanks)[0] ?? scoreLabel(input.preparedQuery, input.canonicalLabel, 'canonical');
    }
}
function scoreLabel(preparedQuery, label, source) {
    const normalizedLabel = normalizeSearchText(label);
    const foldedLabel = foldSearchText(label);
    const titleTokens = tokenizeNormalizedText(foldedLabel);
    const queryUsefulTokens = preparedQuery.usefulFoldedTokens;
    const titleTokenSet = new Set(titleTokens);
    const queryUsefulTokenSet = new Set(queryUsefulTokens);
    const matchedUsefulTokens = queryUsefulTokens.filter((token) => isUsefulQueryTokenSatisfied(token, titleTokenSet, preparedQuery));
    const missingUsefulTokens = queryUsefulTokens.filter((token) => !isUsefulQueryTokenSatisfied(token, titleTokenSet, preparedQuery));
    const extraTitleTokens = titleTokens.filter((token) => !queryUsefulTokenSet.has(token));
    const extraGenericModifiers = extraTitleTokens.filter((token) => isGenericQueryToken(token, preparedQuery.locale));
    const exactNormalizedLabel = normalizedLabel === preparedQuery.normalized;
    const exactFoldedLabel = foldedLabel === preparedQuery.folded;
    const usefulQueryCoverage = queryUsefulTokens.length > 0 ? matchedUsefulTokens.length / queryUsefulTokens.length : 0;
    const effectiveUsefulQueryCoverage = exactNormalizedLabel || exactFoldedLabel ? 1 : usefulQueryCoverage;
    const titleExtraTokenRatio = titleTokens.length > 0 ? extraTitleTokens.length / titleTokens.length : 0;
    const score = clampScore(effectiveUsefulQueryCoverage * 0.52 +
        (exactNormalizedLabel ? 0.26 : exactFoldedLabel ? 0.2 : 0) -
        titleExtraTokenRatio * 0.14 -
        Math.min(extraGenericModifiers.length, 3) * 0.04 -
        (exactNormalizedLabel || exactFoldedLabel ? 0 : missingUsefulTokens.length * 0.08));
    return {
        score,
        matchedLabel: label,
        matchedLabelSource: source,
        exactNormalizedLabel,
        exactFoldedLabel,
        usefulQueryCoverage: effectiveUsefulQueryCoverage,
        titleExtraTokenRatio,
        extraGenericModifierCount: extraGenericModifiers.length,
        matchedUsefulTokens,
        missingUsefulTokens,
        extraTitleTokens,
        extraGenericModifiers
    };
}
function isUsefulQueryTokenSatisfied(token, titleTokenSet, preparedQuery) {
    if (titleTokenSet.has(token)) {
        return true;
    }
    const expansionTokens = expandAcronymToken(token, preparedQuery.locale).map((expansionToken) => foldSearchText(expansionToken));
    return expansionTokens.length > 0 && expansionTokens.every((expansionToken) => titleTokenSet.has(expansionToken));
}
function compareLabelRanks(left, right) {
    return (right.score - left.score ||
        Number(right.exactNormalizedLabel) - Number(left.exactNormalizedLabel) ||
        Number(right.exactFoldedLabel) - Number(left.exactFoldedLabel) ||
        left.titleExtraTokenRatio - right.titleExtraTokenRatio ||
        sourceRank(left.matchedLabelSource) - sourceRank(right.matchedLabelSource) ||
        left.matchedLabel.localeCompare(right.matchedLabel));
}
function sourceRank(source) {
    return source === 'canonical' ? 0 : 1;
}
function clampScore(value) {
    const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
