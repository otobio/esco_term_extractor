import { normalizeQueryLocale } from '../query/query-preparation.js';
import { detectLeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { isEnglishQuery } from '../utils/lang.js';
import { foldSearchText, foldWeakPunctuationLookupText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { DEFAULT_CLASSIFIER_SOURCE_NAME } from './constants.js';
import { classifySpecializationQuery } from './specialization/specialization-dimension-mapper.js';
export function normalizeInput(input) {
    const query = normalizeSearchSurfaceText(input.query);
    const sourceName = input.sourceName?.trim() || input.runtime?.sourceName || DEFAULT_CLASSIFIER_SOURCE_NAME;
    return {
        query,
        locale: normalizeQueryLocale(input.locale),
        sourceName,
        runtime: input.runtime
    };
}
export async function selectClassifierLocale(query, requestedLocale, sourceName) {
    if (!query || requestedLocale === 'en') {
        return requestedLocale;
    }
    return (await isEnglishQuery(query, sourceName)) ? 'en' : requestedLocale;
}
export async function loadOrUseRuntime(options) {
    return options.runtime ?? OccupationRuntimeContext.load({ sourceName: options.sourceName });
}
// Hard separators are unambiguous span breaks regardless of surrounding whitespace (mirrors the
// legacy pipeline's hasIndependentOccupationSpanSeparator character class). A bare "/" is not
// included here -- it's ambiguous (e.g. "UX/UI Designer" or "steward/stewardess" is one compound
// role, not two spans), so it's only treated as a separator when at least one side has whitespace
// in the user's ORIGINAL input (e.g. "A/ B", "A /B" or "A / B" -- the ragged spacing real pasted
// job titles actually use). This must be checked against rawTitle, not cleanedTitle -- cleaning
// tokenizes and rejoins the surface with uniform single spaces around every "/", so by the time
// cleanedTitle exists, a bare "UX/UI" is indistinguishable from a genuinely spaced "UX / UI".
const HARD_SPAN_SEPARATOR = /[\r\n\t;•·▪‣◦|]|\s\/|\/\s/u;
const SPAN_SPLIT_PATTERN = /\s*[\r\n\t;•·▪‣◦|]\s*|\s*\/\s*/u;
export function splitIndependentSpans(cleanedTitle, _locale) {
    const hasIndependentSpanSeparator = HARD_SPAN_SEPARATOR.test(cleanedTitle.rawTitle);
    if (!hasIndependentSpanSeparator) {
        const unspacedSlashTitle = cleanedTitle.cleanedTitle.replace(/\s*\/\s*/gu, '/');
        return [{ text: normalizeSearchSurfaceText(unspacedSlashTitle) }];
    }
    const spans = cleanedTitle.cleanedTitle
        .split(SPAN_SPLIT_PATTERN)
        .map((text) => normalizeSearchSurfaceText(text))
        .filter(Boolean);
    return spans.length > 0 ? spans.map((text) => ({ text })) : [];
}
export function prepareClassifierSurface(span) {
    const spanText = normalizeSearchSurfaceText(span.text);
    const weakFolded = foldWeakPunctuationLookupText(spanText);
    return {
        spanText,
        weakFolded,
        weakFoldedTokens: tokenizeNormalizedText(weakFolded)
    };
}
export function buildQueryStructuralProfile(query, locale) {
    const foldedQuery = foldSearchText(query);
    const classification = classifySpecializationQuery(foldedQuery, { locale });
    const derivedRoleHeads = classification.structural_combination.flatMap((match) => match.derivedRoleHeads);
    const profileClassification = {
        ...classification,
        role_head: Array.from(new Set([...classification.role_head, ...derivedRoleHeads]))
    };
    const profile = {
        authority: detectLeafLevelKind(new Set(tokenizeNormalizedText(foldedQuery))),
        profile: profileClassification
    };
    return profile;
}
