import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { DEFAULT_RUNTIME_DIR } from '../runtime/runtime-dir.js';
import { isRecord, isStringArray, safeFileSegment } from '../utils/validation.js';
const FAMILY_TOKEN_RELEVANCE_ENV = 'OCCUPATION_FAMILY_TOKEN_RELEVANCE_ARTIFACT_PATH';
export function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-family-token-relevance.${safeFileSegment(sourceName)}.json`);
}
export function loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName) {
    const artifactPath = readOptionalEnv(FAMILY_TOKEN_RELEVANCE_ENV) ?? defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName);
    return {
        artifactPath,
        artifact: parseOccupationFamilyTokenRelevanceArtifact(readFileSync(artifactPath, 'utf8'), artifactPath)
    };
}
export function parseOccupationFamilyTokenRelevanceArtifact(contents, artifactPath) {
    const parsed = JSON.parse(contents);
    if (!isOccupationFamilyTokenRelevanceArtifact(parsed)) {
        throw new Error(`Invalid occupation family-token relevance artifact: ${artifactPath}`);
    }
    return parsed;
}
function isOccupationFamilyTokenRelevanceArtifact(value) {
    return (isRecord(value) &&
        value.schemaVersion === 1 &&
        typeof value.sourceName === 'string' &&
        typeof value.generatedAt === 'string' &&
        typeof value.totalFamilies === 'number' &&
        isStringArray(value.locales) &&
        isStringArray(value.lowConfidenceLocales) &&
        isRecord(value.familiesByLocale) &&
        Object.values(value.familiesByLocale).every((families) => Array.isArray(families) && families.every(isFamilyEntry)) &&
        isRecord(value.genericityByLocale) &&
        Object.values(value.genericityByLocale).every((byToken) => isRecord(byToken) && Object.values(byToken).every(isGenericityEntry)));
}
function isFamilyEntry(value) {
    return (isRecord(value) &&
        typeof value.familyNodeId === 'number' &&
        typeof value.familyLabel === 'string' &&
        typeof value.leafCount === 'number' &&
        typeof value.totalTokenOccurrences === 'number' &&
        isRecord(value.tokens) &&
        Object.values(value.tokens).every(isTokenStats));
}
function isTokenStats(value) {
    return (isRecord(value) &&
        typeof value.occurrences === 'number' &&
        typeof value.tfRatio === 'number' &&
        typeof value.documentFrequency === 'number' &&
        typeof value.relevance === 'number');
}
function isGenericityEntry(value) {
    return (isRecord(value) &&
        typeof value.documentFrequency === 'number' &&
        typeof value.maxRelevance === 'number' &&
        typeof value.maxRelevanceFamilyNodeId === 'number');
}
const RELEVANCE_LOOKUP_CACHE = new Map();
// The artifact is a first-cut, experimental signal (not part of runtime:artifacts-build), so a
// missing file must degrade to "no discount" rather than take down retrieval.
export function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName) {
    const cached = RELEVANCE_LOOKUP_CACHE.get(sourceName);
    if (cached !== undefined) {
        return cached;
    }
    let lookup = null;
    try {
        lookup = buildOccupationFamilyTokenRelevanceLookup(loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName).artifact);
    }
    catch {
        lookup = null;
    }
    RELEVANCE_LOOKUP_CACHE.set(sourceName, lookup);
    return lookup;
}
function buildOccupationFamilyTokenRelevanceLookup(artifact) {
    const familyTokensByLocale = new Map();
    for (const [locale, families] of Object.entries(artifact.familiesByLocale)) {
        const familyMap = new Map();
        for (const family of families) {
            const tokenMap = new Map();
            for (const [token, stats] of Object.entries(family.tokens)) {
                tokenMap.set(token, stats.relevance);
            }
            familyMap.set(family.familyNodeId, tokenMap);
        }
        familyTokensByLocale.set(locale, familyMap);
    }
    const genericityByLocale = new Map();
    for (const [locale, genericity] of Object.entries(artifact.genericityByLocale)) {
        const tokenMap = new Map();
        for (const [token, entry] of Object.entries(genericity)) {
            tokenMap.set(token, entry.maxRelevance);
        }
        genericityByLocale.set(locale, tokenMap);
    }
    return { familyTokensByLocale, genericityByLocale };
}
// Discounts alias-match evidence for a family by how characteristic the matched tokens actually
// are of that family, relative to the single most-concentrated family for each token (mean across
// matched tokens). Returns 1 (no-op) when there's no lookup, no family, no matched tokens, or no
// genericity data at all for a token (nothing to discount against).
export function familyTokenRelevanceMultiplier(lookup, locale, familyNodeId, matchedTokens) {
    if (!lookup || familyNodeId === null || matchedTokens.length === 0) {
        return 1;
    }
    const familyTokens = lookup.familyTokensByLocale.get(locale)?.get(familyNodeId);
    const genericity = lookup.genericityByLocale.get(locale);
    if (!genericity) {
        return 1;
    }
    let total = 0;
    for (const token of matchedTokens) {
        const maxRelevance = genericity.get(token) ?? 0;
        if (maxRelevance <= 0) {
            total += 1;
            continue;
        }
        total += (familyTokens?.get(token) ?? 0) / maxRelevance;
    }
    return total / matchedTokens.length;
}
