import { timed } from '../utils/timing.js';
import { cleanOccupationTitleSignals } from './occupation-signal-oov-cleaner.js';
import { selectOccupationRoleSpan } from './occupation-role-span-selector.js';
import { foldSearchText, normalizeQueryLocale, prepareQuery, tokenizeNormalizedText } from './query-preparation.js';
export async function prepareOccupationRetrievalQuery(options) {
    const timings = options.timings ?? {};
    const signalCleaning = await timed(() => cleanOccupationTitleSignals({
        sourceName: options.sourceName,
        locale: options.locale,
        title: options.originalQuery
    }), 'candidate.query_signal_cleaning', timings);
    const querySignalCleaningMs = timings['candidate.query_signal_cleaning'] ?? 0;
    const querySpans = await refineStructuredOccupationSpans(signalCleaning.keptSignals.length > 0 ? signalCleaning.keptSignals : [options.originalQuery], options.originalQuery, options.locale, options.sourceName);
    const roleSpanSelection = await timed(() => selectOccupationRoleSpan({
        sourceName: options.sourceName,
        locale: options.locale,
        originalQuery: options.originalQuery,
        querySpans
    }), 'candidate.role_span_selection', timings);
    const query = roleSpanSelection.roleQuery.trim() || querySpans.join(' ').trim() || options.originalQuery;
    const preparedQuery = await prepareQuery(query, options.locale, { sourceName: options.sourceName });
    return {
        originalQuery: options.originalQuery,
        query,
        querySpans,
        locale: options.locale,
        normalizedQuery: preparedQuery.normalized,
        foldedQuery: preparedQuery.folded,
        querySignals: signalCleaning.signals,
        keptQuerySignals: signalCleaning.keptSignals,
        querySignalCleaningMs,
        roleSpanSelection,
        preparedQuery
    };
}
async function refineStructuredOccupationSpans(spans, originalQuery, locale, sourceName) {
    if (spans.length <= 1) {
        return spans;
    }
    const normalizedLocale = normalizeQueryLocale(locale);
    const refined = [];
    let current = spans[0] ?? '';
    let currentCursor = 0;
    for (let index = 1; index < spans.length; index += 1) {
        const next = spans[index] ?? '';
        const separator = spanSeparatorBetween(originalQuery, current, next, currentCursor);
        if (await shouldMergeStructuredSpans(current, next, separator, normalizedLocale, sourceName)) {
            current = `${current} ${next}`.replace(/\s+/gu, ' ').trim();
            continue;
        }
        refined.push(current);
        currentCursor = advanceCursor(originalQuery, current, currentCursor);
        current = next;
    }
    refined.push(current);
    return refined;
}
async function shouldMergeStructuredSpans(left, right, separator, locale, sourceName) {
    const leftTokens = tokenizeNormalizedText(foldSearchText(left));
    const rightTokens = tokenizeNormalizedText(foldSearchText(right));
    if (leftTokens.length === 0 || rightTokens.length === 0) {
        return false;
    }
    const slashLike = /[|/]/u.test(separator);
    const combined = `${left} ${right}`.replace(/\s+/gu, ' ').trim();
    const [leftPrepared, rightPrepared, combinedPrepared] = await Promise.all([
        prepareQuery(left, locale, { sourceName }),
        prepareQuery(right, locale, { sourceName }),
        prepareQuery(combined, locale, { sourceName })
    ]);
    if (slashLike && isIndependentOccupationSpan(leftPrepared) && isIndependentOccupationSpan(rightPrepared)) {
        return false;
    }
    if ((leftPrepared.commonRolePhraseMatch || leftPrepared.familyAliasMatch) &&
        (rightPrepared.commonRolePhraseMatch || rightPrepared.familyAliasMatch)) {
        return false;
    }
    if (combinedCreatesStructuredGain(leftPrepared, rightPrepared, combinedPrepared)) {
        if (!slashLike) {
            return true;
        }
        return isWeakOrContextSpan(leftPrepared) || isWeakOrContextSpan(rightPrepared);
    }
    if (separator.includes('&')) {
        return isWeakOrContextSpan(leftPrepared) || isWeakOrContextSpan(rightPrepared);
    }
    if (!slashLike && (leftTokens.length === 1 || rightTokens.length === 1)) {
        return (combinedPrepared.intent.roleTokens.length > Math.max(leftPrepared.intent.roleTokens.length, rightPrepared.intent.roleTokens.length));
    }
    return false;
}
function combinedCreatesStructuredGain(left, right, combined) {
    if ((combined.commonRolePhraseMatch || combined.familyAliasMatch) && !(left.commonRolePhraseMatch || right.commonRolePhraseMatch)) {
        return true;
    }
    const sideConfidence = Math.max(left.intent.confidence, right.intent.confidence);
    const combinedAddsRoleTerms = combined.intent.roleTokens.length > Math.max(left.intent.roleTokens.length, right.intent.roleTokens.length);
    const combinedImprovesConfidence = combined.intent.confidence >= sideConfidence;
    if ((isWeakOrContextSpan(left) || isWeakOrContextSpan(right)) && combined.intent.confidence >= 0.8 && combinedAddsRoleTerms) {
        return true;
    }
    return combinedAddsRoleTerms && combinedImprovesConfidence;
}
function isIndependentOccupationSpan(prepared) {
    return !prepared.isGenericShape && prepared.intent.roleTokens.length > 0 && prepared.intent.confidence >= 0.75;
}
function isWeakOrContextSpan(prepared) {
    return (prepared.isGenericShape ||
        prepared.intent.roleTokens.length <= 1 ||
        prepared.intent.confidence < 0.6 ||
        prepared.intent.domainTokens.length > 0 ||
        prepared.intent.venueTokens.length > 0 ||
        prepared.intent.unresolvedModifierTokens.length > 0);
}
function spanSeparatorBetween(originalQuery, left, right, cursor) {
    const foldedOriginal = foldSearchText(originalQuery);
    const foldedLeft = foldSearchText(left);
    const foldedRight = foldSearchText(right);
    const leftIndex = foldedOriginal.indexOf(foldedLeft, cursor);
    if (leftIndex < 0) {
        return '';
    }
    const rightIndex = foldedOriginal.indexOf(foldedRight, leftIndex + foldedLeft.length);
    if (rightIndex < 0) {
        return '';
    }
    return foldedOriginal.slice(leftIndex + foldedLeft.length, rightIndex);
}
function advanceCursor(originalQuery, span, cursor) {
    const foldedOriginal = foldSearchText(originalQuery);
    const foldedSpan = foldSearchText(span);
    const index = foldedOriginal.indexOf(foldedSpan, cursor);
    return index < 0 ? cursor : index + foldedSpan.length;
}
