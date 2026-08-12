import reviewedCommonRolePhraseSeedsJson from '../runtime/seeds/occupation-reviewed-common-role-phrases.json' with { type: 'json' };
import reviewedFamilyAliasSeedsJson from '../runtime/seeds/occupation-reviewed-family-alias-anchors.json' with { type: 'json' };
import reviewedNoiseRuleSeedsJson from '../runtime/seeds/occupation-reviewed-noise-rules.json' with { type: 'json' };
let cachedCommonRolePhrases = null;
let cachedFamilyAliasAnchors = null;
let cachedNoiseRules = null;
export function reviewedCommonRolePhraseEntries() {
    if (!cachedCommonRolePhrases) {
        cachedCommonRolePhrases = parseCommonRolePhraseSeeds(reviewedCommonRolePhraseSeedsJson);
    }
    return cachedCommonRolePhrases;
}
export function reviewedFamilyAliasEntries() {
    if (!cachedFamilyAliasAnchors) {
        cachedFamilyAliasAnchors = parseFamilyAliasSeeds(reviewedFamilyAliasSeedsJson);
    }
    return cachedFamilyAliasAnchors;
}
export function reviewedNoiseRules(locale) {
    if (!cachedNoiseRules) {
        cachedNoiseRules = parseNoiseRuleSeeds(reviewedNoiseRuleSeedsJson);
    }
    return cachedNoiseRules
        .filter((rule) => rule.locale === locale)
        .map((rule) => ({
        kind: rule.kind,
        matchType: rule.matchType,
        confidence: rule.confidence,
        terms: Array.isArray(rule.terms) ? [...rule.terms] : []
    }));
}
function parseCommonRolePhraseSeeds(value) {
    const entries = Array.isArray(value) ? value : [];
    return entries.filter(isReviewedCommonRolePhraseSeed).map((entry) => ({
        locale: entry.locale,
        surface: entry.surface,
        canonicalEnglish: entry.canonicalEnglish,
        roleKey: entry.roleKey,
        priority: entry.priority
    }));
}
function parseFamilyAliasSeeds(value) {
    const entries = Array.isArray(value) ? value : [];
    return entries.filter(isReviewedFamilyAliasSeed).map((entry) => ({
        locale: entry.locale,
        surface: entry.surface,
        canonicalEnglish: entry.canonicalEnglish,
        roleKey: entry.roleKey,
        priority: entry.priority
    }));
}
function parseNoiseRuleSeeds(value) {
    const entries = Array.isArray(value) ? value : [];
    return entries.filter(isReviewedNoiseRuleSeed);
}
function isReviewedCommonRolePhraseSeed(value) {
    return (isRecord(value) &&
        isSupportedQueryLocale(value.locale) &&
        isNonEmptyString(value.surface) &&
        isNonEmptyString(value.canonicalEnglish) &&
        isNonEmptyString(value.roleKey) &&
        isFinitePriority(value.priority));
}
function isReviewedFamilyAliasSeed(value) {
    return (isRecord(value) &&
        isSupportedQueryLocale(value.locale) &&
        isNonEmptyString(value.surface) &&
        isNonEmptyString(value.canonicalEnglish) &&
        isNonEmptyString(value.roleKey) &&
        isFinitePriority(value.priority));
}
function isReviewedNoiseRuleSeed(value) {
    return (isRecord(value) &&
        (value.locale === 'ro' || value.locale === 'hu') &&
        isNonEmptyString(value.kind) &&
        (value.matchType === 'phrase' || value.matchType === 'token') &&
        typeof value.confidence === 'number' &&
        Number.isFinite(value.confidence) &&
        (value.terms === undefined || (Array.isArray(value.terms) && value.terms.every(isNonEmptyString))));
}
function isSupportedQueryLocale(value) {
    return value === 'en' || value === 'ro' || value === 'hu' || value === 'et' || value === 'unknown';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isFinitePriority(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
