import { foldSearchLookupText as foldUtilityLookupText, foldSearchText as foldUtilityText, isAcronymToken as isUtilityAcronymToken, normalizeSearchSurfaceText as normalizeUtilitySurfaceText, normalizeSearchText as normalizeUtilityText } from '../utils/texts.js';
import { findCommonRolePhraseMatch } from './common-role-phrase-atlas.js';
import { findFamilyAliasMatch } from './family-alias-atlas.js';
import { classifyOccupationQueryIntent } from './query-intent.js';
const DEFAULT_INTENT_VOCABULARY_SOURCE_NAME = 'esco_1_2_1';
const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦|/&]+|\s+[\p{Pd}]\s+|(?<=\p{L})-(?=\p{Lu})|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;
const BRACKETED_TEXT = /\s*[\p{Ps}[{<][^)\]}>]*[\p{Pe}\]}>]\s*/gu;
const FUNCTION_WORDS_BY_LOCALE = {
    en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'it', 'of', 'on', 'or', 'the', 'to', 'who', 'with']),
    ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'un', 'în', 'și']),
    hu: new Set(['a', 'az', 'egy', 'es', 'és', 'hogy', 'meg', 'vagy']),
    et: new Set(['ja', 'koos', 'ning', 'on', 'voi', 'või']),
    unknown: new Set()
};
const GENERIC_ROLE_TERMS_BY_LOCALE = {
    en: new Set([
        'assistant',
        'associate',
        'consultant',
        'coordinator',
        'developer',
        'developers',
        'employee',
        'expert',
        'job',
        'jobs',
        'officer',
        'operator',
        'role',
        'roles',
        'specialist',
        'staff',
        'supervisor',
        'technician',
        'worker'
    ]),
    ro: new Set(),
    hu: new Set(),
    et: new Set(),
    unknown: new Set()
};
const SAFE_JOB_LEVEL_MODIFIERS_BY_LOCALE = {
    en: new Set(['apprentice', 'certified', 'graduate', 'intern', 'junior', 'licensed', 'registered', 'senior', 'trainee']),
    ro: new Set(['debutant', 'incepator', 'junior', 'senior', 'stagiar', 'ucenic', 'începător']),
    hu: new Set(['gyakornok', 'junior', 'palyakezdo', 'pályakezdő', 'senior', 'tanulo', 'tanuló']),
    et: new Set(['algaja', 'juunior', 'noorem', 'praktikant', 'senior', 'vanem']),
    unknown: new Set()
};
const COMMON_TITLE_NOISE_PHRASES_BY_LOCALE = {
    en: [['apply', 'as'], ['hiring'], ['hiring', 'for'], ['looking', 'for'], ['need'], ['need', 'a'], ['seeking'], ['seeking', 'a']],
    ro: [['angajez'], ['angajam'], ['angajăm'], ['caut'], ['cautam'], ['căutăm'], ['aplica', 'pentru'], ['aplică', 'pentru']],
    hu: [['allas'], ['állás'], ['felveszunk'], ['felveszünk'], ['keresunk'], ['keresünk'], ['jelentkezz']],
    et: [['kandideeri'], ['otsime'], ['toopakkumine'], ['tööpakkumine'], ['vajame']],
    unknown: []
};
const COMPOUND_SPLIT_PARTS_BY_LOCALE = {
    en: new Set(),
    ro: new Set(),
    hu: new Set([
        'adat',
        'elemző',
        'elemzo',
        'fejlesztő',
        'fejleszto',
        'mérnök',
        'mernok',
        'programozó',
        'programozo',
        'szoftver',
        'tanár',
        'tanar',
        'tervező',
        'tervezo',
        'vezető',
        'vezeto'
    ]),
    et: new Set(['andme', 'analuutik', 'analüütik', 'arendaja', 'insener', 'juht', 'opetaja', 'õpetaja', 'spetsialist', 'tarkvara']),
    unknown: new Set()
};
const ACRONYM_EXPANSIONS_BY_LOCALE = {
    en: new Map([
        ['AI', ['artificial', 'intelligence']],
        ['BI', ['business', 'intelligence']],
        ['CAD', ['computer', 'aided', 'design']],
        ['CNC', ['computer', 'numerical', 'control']],
        ['HR', ['human', 'resources']],
        ['HVAC', ['heating', 'ventilation', 'air', 'conditioning']],
        ['HVACR', ['heating', 'ventilation', 'air', 'conditioning', 'refrigeration']],
        ['IT', ['information', 'technology']],
        ['QA', ['quality', 'assurance']],
        ['UI', ['user', 'interface']],
        ['UX', ['user', 'experience']]
    ]),
    ro: new Map(),
    hu: new Map(),
    et: new Map(),
    unknown: new Map()
};
const TOKEN_VARIANT_RULES_BY_LOCALE = {
    en: [expandEnglishToken],
    ro: [expandRomanianToken],
    hu: [expandHungarianToken],
    et: [expandEstonianToken],
    unknown: []
};
export function prepareOccupationQueryInput(value, locale) {
    const resolvedLocale = normalizeQueryLocale(locale);
    const clauses = splitOccupationSignalClauses(value);
    const preparedClauses = clauses
        .map((clause) => ({
        raw: clause,
        signal: prepareOccupationSignalClause(clause, resolvedLocale)
    }))
        .filter((clause) => clause.signal);
    const extractedSignals = preparedClauses.map((clause) => clause.signal);
    const fallbackClause = extractedSignals.length > 0 ? extractedSignals : [normalizeSearchSurfaceText(value)];
    const signals = uniqueNonEmpty(fallbackClause);
    return {
        raw: value,
        locale: resolvedLocale,
        signals
    };
}
export async function prepareQuery(value, locale, options = {}) {
    const surface = normalizeSearchSurfaceText(value);
    const normalized = normalizeSearchText(value);
    const folded = foldSearchText(value);
    const resolvedLocale = normalizeQueryLocale(locale);
    const surfaceTokens = tokenizeSurfaceText(surface);
    const tokens = tokenizeNormalizedText(normalized);
    const foldedTokens = tokenizeNormalizedText(folded);
    const compoundSplitTokens = splitCompoundTokens(tokens, resolvedLocale);
    const compoundSplitFoldedTokens = splitCompoundTokens(foldedTokens, resolvedLocale);
    const acronymExpansionTokens = expandAcronyms(surfaceTokens, resolvedLocale);
    const acronymExpansionFoldedTokens = acronymExpansionTokens.map((token) => foldSearchText(token));
    const intentFoldedTokens = expandAcronymsInlineForIntent(surfaceTokens, foldedTokens, resolvedLocale);
    const lexicalTokens = appendUnique(tokens, compoundSplitTokens);
    const lexicalFoldedTokens = appendUnique(foldedTokens, compoundSplitFoldedTokens);
    const noiseTokens = Array.from(new Set(findCommonTitleNoiseTokens(foldedTokens, resolvedLocale))).sort();
    const noiseTokenSet = new Set(noiseTokens);
    const usefulTokens = lexicalTokens.filter((token, index) => {
        const surfaceToken = surfaceTokens[index];
        if (surfaceToken && isAcronymToken(surfaceToken)) {
            return !isGenericQueryToken(token, resolvedLocale) && !isSafeJobLevelModifierToken(token, resolvedLocale);
        }
        return !noiseTokenSet.has(foldSearchText(token)) && isUsefulQueryToken(token, resolvedLocale);
    });
    const usefulFoldedTokens = lexicalFoldedTokens.filter((token, index) => {
        const surfaceToken = surfaceTokens[index];
        if (surfaceToken && isAcronymToken(surfaceToken)) {
            return !isGenericQueryToken(token, resolvedLocale) && !isSafeJobLevelModifierToken(token, resolvedLocale);
        }
        return !noiseTokenSet.has(token) && isUsefulQueryToken(token, resolvedLocale);
    });
    const expandedUsefulTokens = appendUnique(usefulTokens, acronymExpansionTokens);
    const expandedUsefulFoldedTokens = appendUnique(usefulFoldedTokens, acronymExpansionFoldedTokens);
    const genericTokens = Array.from(new Set(foldedTokens.filter((token) => isGenericQueryToken(token, resolvedLocale)))).sort();
    const stopTokens = Array.from(new Set(foldedTokens.filter((token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isStopQueryToken(token, resolvedLocale)))).sort();
    const modifierTokens = Array.from(new Set(foldedTokens.filter((token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isSafeJobLevelModifierToken(token, resolvedLocale)))).sort();
    const acronymTokens = Array.from(new Set(surfaceTokens.filter((token) => isAcronymToken(token)))).sort();
    const intentVocabulary = options.intentVocabulary ?? (await loadRequiredIntentVocabulary(options.sourceName ?? DEFAULT_INTENT_VOCABULARY_SOURCE_NAME));
    const intent = classifyOccupationQueryIntent({
        locale: resolvedLocale,
        foldedTokens: intentFoldedTokens,
        usefulFoldedTokens: expandedUsefulFoldedTokens,
        roleExpansionFoldedTokens: acronymExpansionFoldedTokens,
        stopTokens,
        noiseTokens,
        modifierTokens,
        vocabulary: intentVocabulary
    });
    const commonRolePhraseMatch = findCommonRolePhraseMatch(value, resolvedLocale);
    const familyAliasMatch = commonRolePhraseMatch ? null : findFamilyAliasMatch(value, resolvedLocale);
    const anchoredRolePhraseMatch = commonRolePhraseMatch ?? familyAliasMatch;
    const anchoredIntent = commonRolePhraseMatch
        ? anchorIntentWithCommonRolePhrase(intent, commonRolePhraseMatch)
        : familyAliasMatch
            ? anchorIntentWithFamilyAlias(intent, familyAliasMatch)
            : intent;
    return {
        raw: value,
        locale: resolvedLocale,
        normalized,
        folded,
        surfaceTokens,
        tokens,
        foldedTokens,
        usefulTokens: expandedUsefulTokens,
        usefulFoldedTokens: expandedUsefulFoldedTokens,
        expandedTokens: expandTokenVariants(expandedUsefulTokens, resolvedLocale),
        expandedFoldedTokens: expandTokenVariants(expandedUsefulFoldedTokens, resolvedLocale),
        genericTokens,
        stopTokens,
        noiseTokens,
        modifierTokens,
        acronymTokens,
        compoundSplitTokens,
        compoundSplitFoldedTokens,
        intent: anchoredIntent,
        commonRolePhraseMatch: anchoredRolePhraseMatch,
        familyAliasMatch,
        isGenericShape: isGenericQueryShape(foldedTokens, resolvedLocale)
    };
}
export async function prepareFamilyScopedQuery(value, locale, options = {}) {
    const prepared = await prepareQuery(value, locale, options);
    return prepareFamilyScopedQueryFromPrepared(prepared);
}
export function prepareFamilyScopedQueryFromPrepared(prepared) {
    const lexicalTokens = appendUnique(prepared.tokens, prepared.compoundSplitTokens);
    const lexicalFoldedTokens = appendUnique(prepared.foldedTokens, prepared.compoundSplitFoldedTokens);
    const usefulExpansionTokens = prepared.usefulTokens.filter((token) => !lexicalTokens.includes(token));
    const usefulExpansionFoldedTokens = prepared.usefulFoldedTokens.filter((token) => !lexicalFoldedTokens.includes(token));
    const noiseTokenSet = new Set(prepared.noiseTokens);
    const acronymTokenSet = new Set(prepared.acronymTokens.map((token) => foldSearchText(token)));
    const familyScopedTokens = appendUnique(lexicalTokens.filter((token) => isFamilyScopedUsefulToken(token, prepared)), usefulExpansionTokens);
    const familyScopedFoldedTokens = appendUnique(lexicalFoldedTokens.filter((token) => isFamilyScopedUsefulToken(token, prepared)), usefulExpansionFoldedTokens);
    return {
        ...prepared,
        familyScopedTokens,
        familyScopedFoldedTokens,
        usefulTokens: familyScopedTokens,
        usefulFoldedTokens: familyScopedFoldedTokens,
        expandedTokens: expandTokenVariants(familyScopedTokens, prepared.locale),
        expandedFoldedTokens: expandTokenVariants(familyScopedFoldedTokens, prepared.locale)
    };
    function isFamilyScopedUsefulToken(token, query) {
        const foldedToken = foldSearchText(token);
        return ((token.length >= 3 || acronymTokenSet.has(foldedToken)) &&
            !noiseTokenSet.has(foldedToken) &&
            !isStopQueryToken(token, query.locale) &&
            !isSafeJobLevelModifierToken(token, query.locale));
    }
}
async function loadRequiredIntentVocabulary(sourceName) {
    const { loadOccupationIntentVocabularyArtifactRequired } = await import('../runtime/occupation-intent-vocabulary-artifact.js');
    const entry = await loadOccupationIntentVocabularyArtifactRequired(sourceName);
    return entry.artifact;
}
function anchorIntentWithCommonRolePhrase(intent, match) {
    const canonicalRoleTokens = tokenizeNormalizedText(match.canonicalEnglish);
    if (canonicalRoleTokens.length < 2) {
        return intent;
    }
    return {
        ...intent,
        roleTokens: canonicalRoleTokens,
        roleHeadTokens: canonicalRoleTokens.slice(-1),
        confidence: Math.max(intent.confidence, Math.min(1, 0.9 + Math.min(match.priority, 10) / 100)),
        diagnostics: [
            {
                token: match.surface,
                normalizedToken: foldSearchText(match.surface),
                index: match.startToken,
                kind: 'role_head',
                reason: `matched curated role phrase "${match.surface}" -> "${match.canonicalEnglish}"`
            },
            ...intent.diagnostics
        ]
    };
}
function anchorIntentWithFamilyAlias(intent, match) {
    const canonicalRoleTokens = tokenizeNormalizedText(match.canonicalEnglish);
    if (canonicalRoleTokens.length < 2) {
        return intent;
    }
    return {
        ...intent,
        roleTokens: canonicalRoleTokens,
        roleHeadTokens: canonicalRoleTokens.slice(-1),
        confidence: Math.max(intent.confidence, Math.min(1, 0.86 + Math.min(match.priority, 10) / 100)),
        diagnostics: [
            {
                token: match.surface,
                normalizedToken: foldSearchText(match.surface),
                index: match.startToken,
                kind: 'role_head',
                reason: `matched curated family alias "${match.surface}" -> "${match.canonicalEnglish}"`
            },
            ...intent.diagnostics
        ]
    };
}
export function normalizeSearchSurfaceText(value) {
    return normalizeUtilitySurfaceText(value);
}
export function normalizeSearchText(value) {
    return normalizeUtilityText(value);
}
export function foldSearchText(value) {
    return foldUtilityText(value);
}
export function foldSearchLookupText(value) {
    return foldUtilityLookupText(value);
}
export function tokenizeNormalizedText(value) {
    return value
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}
export function tokenizeSurfaceText(value) {
    return tokenizeNormalizedText(value);
}
export function isUsefulQueryToken(token, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    return token.length >= 3 && !isLowSignalQueryToken(token, normalizedLocale);
}
export function isGenericQueryToken(token, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    const foldedToken = foldSearchText(token);
    return localeSetHasEnglishBackbone(GENERIC_ROLE_TERMS_BY_LOCALE, normalizedLocale, foldedToken);
}
export function isStopQueryToken(token, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    const foldedToken = foldSearchText(token);
    return localeSetHasEnglishBackbone(FUNCTION_WORDS_BY_LOCALE, normalizedLocale, foldedToken);
}
export function isSafeJobLevelModifierToken(token, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    const foldedToken = foldSearchText(token);
    return localeSetHasEnglishBackbone(SAFE_JOB_LEVEL_MODIFIERS_BY_LOCALE, normalizedLocale, foldedToken);
}
export function isAcronymToken(token) {
    return isUtilityAcronymToken(token);
}
export function expandTokenVariants(tokens, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    const expanded = new Set();
    const variantRules = TOKEN_VARIANT_RULES_BY_LOCALE[normalizedLocale];
    for (const token of tokens) {
        expanded.add(token);
        for (const rule of variantRules) {
            for (const variant of rule(token)) {
                expanded.add(variant);
            }
        }
    }
    return Array.from(expanded);
}
export function expandAcronymToken(token, locale) {
    const normalizedLocale = normalizeQueryLocale(locale);
    const normalizedToken = token.toLocaleUpperCase('en-US');
    return ACRONYM_EXPANSIONS_BY_LOCALE[normalizedLocale].get(normalizedToken) ?? ACRONYM_EXPANSIONS_BY_LOCALE.en.get(normalizedToken) ?? [];
}
export function containsTokenPhrase(haystackTokens, needleTokens, locale) {
    return longestContiguousTokenMatch(haystackTokens, needleTokens, locale).length === needleTokens.length && needleTokens.length > 0;
}
export function longestContiguousTokenMatch(leftTokens, rightTokens, locale) {
    let best = [];
    for (let leftIndex = 0; leftIndex < leftTokens.length; leftIndex += 1) {
        for (let rightIndex = 0; rightIndex < rightTokens.length; rightIndex += 1) {
            const current = [];
            let offset = 0;
            while (leftIndex + offset < leftTokens.length &&
                rightIndex + offset < rightTokens.length &&
                tokensEquivalent(leftTokens[leftIndex + offset], rightTokens[rightIndex + offset], locale)) {
                current.push(leftTokens[leftIndex + offset]);
                offset += 1;
            }
            if (current.length > best.length) {
                best = current;
            }
        }
    }
    return best;
}
export function normalizeQueryLocale(locale) {
    const normalized = locale?.trim().toLowerCase();
    if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et') {
        return normalized;
    }
    return 'unknown';
}
function isGenericQueryShape(tokens, locale) {
    if (tokens.length <= 1) {
        return true;
    }
    return tokens.every((token) => isLowSignalQueryToken(token, locale));
}
function isLowSignalQueryToken(token, locale) {
    return (isGenericQueryToken(token, locale) ||
        isStopQueryToken(token, locale) ||
        isSafeJobLevelModifierToken(token, locale) ||
        isCommonTitleNoiseToken(token, locale));
}
function isCommonTitleNoiseToken(token, locale) {
    return findCommonTitleNoiseTokens([token], locale).length > 0;
}
function findCommonTitleNoiseTokens(tokens, locale) {
    const noiseTokens = new Set();
    for (const phrase of localePhrasesWithEnglishBackbone(COMMON_TITLE_NOISE_PHRASES_BY_LOCALE, locale)) {
        if (phrase.length === 0 || phrase.length > tokens.length) {
            continue;
        }
        for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
            const candidate = tokens.slice(index, index + phrase.length);
            if (candidate.every((token, offset) => token === foldSearchText(phrase[offset]))) {
                for (const token of candidate) {
                    noiseTokens.add(token);
                }
            }
        }
    }
    return Array.from(noiseTokens);
}
function localeSetHasEnglishBackbone(valuesByLocale, locale, value) {
    return valuesByLocale[locale].has(value) || (locale !== 'en' && valuesByLocale.en.has(value));
}
function localePhrasesWithEnglishBackbone(valuesByLocale, locale) {
    if (locale === 'en') {
        return valuesByLocale.en;
    }
    return [...valuesByLocale[locale], ...valuesByLocale.en];
}
function splitCompoundTokens(tokens, locale) {
    const knownParts = COMPOUND_SPLIT_PARTS_BY_LOCALE[locale];
    if (knownParts.size === 0) {
        return [];
    }
    return tokens.flatMap((token) => splitCompoundToken(token, knownParts));
}
function splitCompoundToken(token, knownParts) {
    if (knownParts.has(token) || token.length < 8) {
        return [];
    }
    for (const left of knownParts) {
        if (!token.startsWith(left) || left.length < 4) {
            continue;
        }
        const right = token.slice(left.length);
        if (knownParts.has(right) && right.length >= 4) {
            return [left, right];
        }
    }
    for (const right of knownParts) {
        if (!token.endsWith(right) || right.length < 4) {
            continue;
        }
        const left = token.slice(0, -right.length);
        if (knownParts.has(left) && left.length >= 4) {
            return [left, right];
        }
    }
    return [];
}
function expandAcronyms(surfaceTokens, locale) {
    const expanded = [];
    for (const surfaceToken of surfaceTokens) {
        const expansion = expandAcronymToken(surfaceToken, locale);
        if (expansion.length === 0) {
            continue;
        }
        expanded.push(...expansion);
    }
    return Array.from(new Set(expanded));
}
function expandAcronymsInlineForIntent(surfaceTokens, foldedTokens, locale) {
    const expanded = [];
    for (let index = 0; index < foldedTokens.length; index += 1) {
        const foldedToken = foldedTokens[index];
        if (foldedToken) {
            expanded.push(foldedToken);
        }
        const surfaceToken = surfaceTokens[index];
        if (!surfaceToken) {
            continue;
        }
        for (const expansionToken of expandAcronymToken(surfaceToken, locale)) {
            expanded.push(foldSearchText(expansionToken));
        }
    }
    return expanded;
}
function appendUnique(tokens, extraTokens) {
    const merged = [...tokens];
    const seen = new Set(tokens);
    for (const token of extraTokens) {
        if (!seen.has(token)) {
            merged.push(token);
            seen.add(token);
        }
    }
    return merged;
}
function expandEnglishToken(token) {
    if (token.length < 3) {
        return [];
    }
    if (isAcronymToken(token)) {
        return [];
    }
    if (token.endsWith('ies') && token.length > 4) {
        return [`${token.slice(0, -3)}y`];
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return [token.slice(0, -1)];
    }
    if (token.endsWith('y') && token.length > 3) {
        return [`${token.slice(0, -1)}ies`];
    }
    return [`${token}s`];
}
function expandRomanianToken(token) {
    if (token.length < 4) {
        return [];
    }
    const variants = new Set();
    if (token.endsWith('i') && token.length > 4) {
        variants.add(token.replace(/i$/u, ''));
    }
    if ((token.endsWith('a') || token.endsWith('ă')) && token.length > 5) {
        variants.add(token.slice(0, -1));
    }
    if (!/[aeiă]$/u.test(token) && token.length > 4) {
        variants.add(`${token}i`);
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function expandHungarianToken(token) {
    if (token.length < 4) {
        return [];
    }
    const variants = new Set();
    if (token.endsWith('k') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    if ((token.endsWith('ok') || token.endsWith('ek') || token.endsWith('ak') || token.endsWith('ök')) && token.length > 5) {
        variants.add(token.slice(0, -2));
    }
    if (!token.endsWith('k') && token.length > 4) {
        variants.add(`${token}k`);
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function expandEstonianToken(token) {
    if (token.length < 4) {
        return [];
    }
    const variants = new Set();
    if (token.endsWith('id') && token.length > 5) {
        variants.add(token.slice(0, -2));
    }
    if (token.endsWith('d') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    if (!token.endsWith('d') && token.length > 4) {
        variants.add(`${token}d`);
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function tokensEquivalent(left, right, locale) {
    if (left === right) {
        return true;
    }
    if (foldSearchLookupText(left) === foldSearchLookupText(right)) {
        return true;
    }
    const normalizedLocale = normalizeQueryLocale(locale);
    return expandTokenVariants([left], normalizedLocale).includes(right) || expandTokenVariants([right], normalizedLocale).includes(left);
}
function splitOccupationSignalClauses(value) {
    return stripBracketedText(normalizeSearchSurfaceText(value))
        .split(CLAUSE_SPLIT)
        .map((clause) => clause.trim())
        .filter(Boolean);
}
function stripBracketedText(value) {
    return value.replace(BRACKETED_TEXT, ' ').trim();
}
function prepareOccupationSignalClause(value, locale) {
    const raw = normalizeSearchSurfaceText(value);
    const surfaceTokens = tokenizeSurfaceText(raw);
    const comparisonTokens = surfaceTokens.map((token) => foldSearchText(token));
    const noiseTokens = new Set(findCommonTitleNoiseTokens(comparisonTokens, locale));
    const tokenPairs = surfaceTokens.map((token, index) => ({
        surfaceToken: token,
        comparisonToken: comparisonTokens[index] ?? foldSearchText(token)
    }));
    const signalTokenPairs = tokenPairs.filter(({ comparisonToken, surfaceToken }) => isOccupationSignalToken(comparisonToken, surfaceToken, locale, noiseTokens));
    const signalTokens = signalTokenPairs.map(({ surfaceToken }) => surfaceToken);
    return signalTokens.join(' ').trim();
}
function isOccupationSignalToken(foldedToken, surfaceToken, locale, noiseTokens) {
    if (isAcronymToken(surfaceToken)) {
        return !noiseTokens.has(foldedToken) && !isSafeJobLevelModifierToken(foldedToken, locale);
    }
    return foldedToken.length >= 2 && !noiseTokens.has(foldedToken) && !isSafeJobLevelModifierToken(foldedToken, locale);
}
function uniqueNonEmpty(values) {
    const seen = new Set();
    const uniqueValues = [];
    for (const value of values) {
        const normalized = value.trim().replace(/\s+/gu, ' ');
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        uniqueValues.push(normalized);
    }
    return uniqueValues;
}
