import { normalizeSearchText } from '../utils/texts.js';
import reviewedAliasSeedsJson from './seeds/occupation-reviewed-alias-seeds.json' with { type: 'json' };
const ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone'];
let cachedAliasSeeds = null;
let cachedAliasSeedsByKey = null;
export function reviewedAliasSeeds() {
    return aliasSeeds();
}
export function applyReviewedAliasSeeds(sourceName, record) {
    const seeds = aliasSeedsByKey().get(overrideKey(sourceName, record.graphNodeId));
    if (!seeds || seeds.length === 0) {
        return record;
    }
    const existingKeys = new Set(record.aliases.map((alias) => aliasKey(alias.localeCode, alias.normalizedAlias)));
    const additions = [];
    for (const seed of seeds) {
        const normalizedAlias = normalizeSearchText(seed.alias);
        const key = aliasKey(seed.locale, normalizedAlias);
        if (existingKeys.has(key)) {
            continue;
        }
        existingKeys.add(key);
        additions.push({
            localeCode: seed.locale,
            alias: seed.alias,
            normalizedAlias,
            aliasRole: seed.aliasRole,
            isPrimary: seed.aliasRole === 'locale_primary',
            confidence: seed.weight,
            weight: seed.weight
        });
    }
    if (additions.length === 0) {
        return record;
    }
    return {
        ...record,
        aliases: [...record.aliases, ...additions]
    };
}
function aliasSeeds() {
    if (!cachedAliasSeeds) {
        const entries = Array.isArray(reviewedAliasSeedsJson) ? reviewedAliasSeedsJson : [];
        cachedAliasSeeds = entries.filter(isReviewedAliasSeed);
    }
    return cachedAliasSeeds;
}
function aliasSeedsByKey() {
    if (!cachedAliasSeedsByKey) {
        cachedAliasSeedsByKey = new Map();
        for (const seed of aliasSeeds()) {
            const key = overrideKey(seed.sourceName, seed.leafNodeId);
            const grouped = cachedAliasSeedsByKey.get(key) ?? [];
            grouped.push(seed);
            cachedAliasSeedsByKey.set(key, grouped);
        }
    }
    return cachedAliasSeedsByKey;
}
function aliasKey(locale, normalizedAlias) {
    return `${locale}:${normalizedAlias}`;
}
function overrideKey(sourceName, leafNodeId) {
    return `${sourceName}:${leafNodeId}`;
}
function isReviewedAliasSeed(value) {
    return (isRecord(value) &&
        isNonEmptyString(value.sourceName) &&
        isPositiveInteger(value.leafNodeId) &&
        isNonEmptyString(value.leafLabel) &&
        isNonEmptyString(value.locale) &&
        isNonEmptyString(value.alias) &&
        isAliasRole(value.aliasRole) &&
        typeof value.weight === 'number' &&
        Number.isFinite(value.weight) &&
        (value.note === undefined || typeof value.note === 'string'));
}
function isAliasRole(value) {
    return typeof value === 'string' && ALIAS_ROLES.includes(value);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isPositiveInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
