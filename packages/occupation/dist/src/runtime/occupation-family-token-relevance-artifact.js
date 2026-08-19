import { accessSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { aliasRoleScoreFactor, CANONICAL_ALIAS_ROLE, isSearchAliasRole } from '../query/alias-role-policy.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { readFileBackedFixedTableSync, readFixedTableSync, readStringTableSync, rowValue, stringAt, writeFixedTable, writeStringTable } from '../utils/binary-table.js';
import { roundScore } from '../utils/operators.js';
import { isNonNegativeInteger, isRecord, isStringArray, safeFileSegment } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
export const FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION = 1;
export const FAMILY_TOKEN_RELEVANCE_SCORE_SCALE = 1_000_000;
export const FAMILY_TOKEN_RELEVANCE_FAMILY_ROW_WIDTH = 4;
export const FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH = 2;
export const FAMILY_TOKEN_RELEVANCE_GENERICITY_LOCALE_ROW_WIDTH = 3;
const FAMILY_TOKEN_RELEVANCE_ENV = 'OCCUPATION_FAMILY_TOKEN_RELEVANCE_ARTIFACT_PATH';
const KNOWN_LOCALES = ['en', 'ro', 'hu', 'et'];
const LOW_CONFIDENCE_LOCALES = new Set(['hu', 'et']);
const MIN_FAMILY_TOKEN_OCCURRENCES = 2;
const MAX_TOKENS_PER_FAMILY = 500;
const CACHE = new Map();
export function defaultOccupationFamilyTokenRelevanceManifestPath(sourceName) {
    return path.join(getDefaultRuntimeDir(), `occupation-family-token-relevance.${safeFileSegment(sourceName)}.binary.manifest.json`);
}
export function loadOccupationFamilyTokenRelevanceArtifactIfAvailable(sourceName) {
    const manifestPath = readOptionalEnv(FAMILY_TOKEN_RELEVANCE_ENV) ?? defaultOccupationFamilyTokenRelevanceManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    const cached = CACHE.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }
    let artifact = null;
    try {
        accessSync(cacheKey);
        artifact = loadArtifact(cacheKey, sourceName);
    }
    catch {
        artifact = null;
    }
    CACHE.set(cacheKey, artifact);
    return artifact;
}
export function loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName) {
    const manifestPath = readOptionalEnv(FAMILY_TOKEN_RELEVANCE_ENV) ?? defaultOccupationFamilyTokenRelevanceManifestPath(sourceName);
    const artifact = loadOccupationFamilyTokenRelevanceArtifactIfAvailable(sourceName);
    if (!artifact) {
        throw new Error([
            `Missing required occupation family-token relevance artifact for source="${sourceName}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run query:family-token-relevance:export` after rebuilding search meta, or set OCCUPATION_FAMILY_TOKEN_RELEVANCE_ARTIFACT_PATH.'
        ].join(' '));
    }
    return artifact;
}
export function buildOccupationFamilyTokenRelevanceBinaryFiles(records, prefix) {
    const data = buildArtifactData(records);
    const strings = collectStrings(data);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const familyRows = [];
    const familyTokenRows = [];
    const genericityLocaleRows = [];
    const genericityTokenRows = [];
    for (const locale of data.locales) {
        const localeId = requiredStringId(stringIdByValue, locale);
        for (const family of data.familiesByLocale.get(locale) ?? []) {
            const tokenOffset = familyTokenRows.length;
            const tokenRows = family.tokens
                .map(([token, relevance]) => [requiredStringId(stringIdByValue, token), scaleScore(relevance)])
                .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
            familyTokenRows.push(...tokenRows);
            familyRows.push([localeId, family.familyNodeId, tokenOffset, tokenRows.length]);
        }
        const genericityOffset = genericityTokenRows.length;
        const genericityRows = (data.genericityByLocale.get(locale) ?? [])
            .map(([token, maxRelevance]) => [requiredStringId(stringIdByValue, token), scaleScore(maxRelevance)])
            .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
        genericityTokenRows.push(...genericityRows);
        genericityLocaleRows.push([localeId, genericityOffset, genericityRows.length]);
    }
    familyRows.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0));
    genericityLocaleRows.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
    const files = {
        strings: `${prefix}.strings.bin`,
        familyRows: `${prefix}.family-rows.idx`,
        familyTokenRows: `${prefix}.family-token-rows.bin`,
        genericityLocaleRows: `${prefix}.genericity-locale-rows.idx`,
        genericityTokenRows: `${prefix}.genericity-token-rows.bin`
    };
    return {
        manifestFiles: files,
        buffers: new Map([
            [files.strings, writeStringTable(strings)],
            [files.familyRows, writeFixedTable(familyRows, FAMILY_TOKEN_RELEVANCE_FAMILY_ROW_WIDTH)],
            [files.familyTokenRows, writeFixedTable(familyTokenRows, FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH)],
            [files.genericityLocaleRows, writeFixedTable(genericityLocaleRows, FAMILY_TOKEN_RELEVANCE_GENERICITY_LOCALE_ROW_WIDTH)],
            [files.genericityTokenRows, writeFixedTable(genericityTokenRows, FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH)]
        ]),
        totalFamilies: data.totalFamilies,
        locales: data.locales,
        lowConfidenceLocales: data.lowConfidenceLocales,
        stringCount: strings.length,
        familyKeyCount: familyRows.length,
        familyTokenValueCount: familyTokenRows.length,
        genericityLocaleCount: genericityLocaleRows.length,
        genericityTokenValueCount: genericityTokenRows.length
    };
}
export function buildOccupationFamilyTokenRelevanceReviewData(records) {
    const data = buildArtifactData(records);
    return {
        totalFamilies: data.totalFamilies,
        locales: [...data.locales],
        lowConfidenceLocales: [...data.lowConfidenceLocales],
        familiesByLocale: Object.fromEntries([...data.familiesByLocale.entries()].map(([locale, families]) => [
            locale,
            families.map((family) => ({
                familyNodeId: family.familyNodeId,
                tokens: family.tokens.map(([token, relevance]) => [token, relevance])
            }))
        ])),
        genericityByLocale: Object.fromEntries([...data.genericityByLocale.entries()].map(([locale, tokens]) => [
            locale,
            tokens.map(([token, relevance]) => [token, relevance])
        ]))
    };
}
function loadArtifact(manifestPath, sourceName) {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath);
    if (manifest.sourceName !== sourceName) {
        return null;
    }
    const directory = path.dirname(manifestPath);
    const strings = readStringTableSync(path.resolve(directory, manifest.files.strings), manifest.stringCount);
    const familyRows = readFixedTableSync(path.resolve(directory, manifest.files.familyRows), FAMILY_TOKEN_RELEVANCE_FAMILY_ROW_WIDTH, manifest.familyKeyCount);
    const familyTokenRows = readFileBackedFixedTableSync(path.resolve(directory, manifest.files.familyTokenRows), FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH, manifest.familyTokenValueCount);
    const genericityLocaleRows = readFixedTableSync(path.resolve(directory, manifest.files.genericityLocaleRows), FAMILY_TOKEN_RELEVANCE_GENERICITY_LOCALE_ROW_WIDTH, manifest.genericityLocaleCount);
    const genericityTokenRows = readFileBackedFixedTableSync(path.resolve(directory, manifest.files.genericityTokenRows), FAMILY_TOKEN_RELEVANCE_TOKEN_ROW_WIDTH, manifest.genericityTokenValueCount);
    return {
        manifestPath,
        artifact: manifest,
        strings,
        familyRows,
        familyTokenRows,
        genericityLocaleRows,
        genericityTokenRows,
        familyTokenRelevance(locale, familyNodeId, token) {
            const localeId = stringId(strings, locale);
            const tokenId = stringId(strings, token);
            if (localeId < 0 || tokenId < 0) {
                return 0;
            }
            const familyRange = findFamilyRange(familyRows, localeId, familyNodeId);
            if (!familyRange) {
                return 0;
            }
            return lookupScaledValue(familyTokenRows, familyRange.offset, familyRange.length, tokenId) / FAMILY_TOKEN_RELEVANCE_SCORE_SCALE;
        },
        maxTokenRelevance(locale, token) {
            const localeId = stringId(strings, locale);
            const tokenId = stringId(strings, token);
            if (localeId < 0 || tokenId < 0) {
                return 0;
            }
            const genericityRange = findLocaleGenericityRange(genericityLocaleRows, localeId);
            if (!genericityRange) {
                return 0;
            }
            return (lookupScaledValue(genericityTokenRows, genericityRange.offset, genericityRange.length, tokenId) / FAMILY_TOKEN_RELEVANCE_SCORE_SCALE);
        }
    };
}
function validateManifest(value, manifestPath) {
    if (!isOccupationFamilyTokenRelevanceArtifactManifest(value)) {
        throw new Error(`Invalid occupation family-token relevance artifact manifest: ${manifestPath}`);
    }
    return value;
}
function isOccupationFamilyTokenRelevanceArtifactManifest(value) {
    return (isRecord(value) &&
        value.schemaVersion === FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION &&
        typeof value.sourceName === 'string' &&
        typeof value.generatedAt === 'string' &&
        isNonNegativeInteger(value.totalFamilies) &&
        isStringArray(value.locales) &&
        isStringArray(value.lowConfidenceLocales) &&
        isNonNegativeInteger(value.stringCount) &&
        isNonNegativeInteger(value.familyKeyCount) &&
        isNonNegativeInteger(value.familyTokenValueCount) &&
        isNonNegativeInteger(value.genericityLocaleCount) &&
        isNonNegativeInteger(value.genericityTokenValueCount) &&
        isRecord(value.files) &&
        typeof value.files.strings === 'string' &&
        typeof value.files.familyRows === 'string' &&
        typeof value.files.familyTokenRows === 'string' &&
        typeof value.files.genericityLocaleRows === 'string' &&
        typeof value.files.genericityTokenRows === 'string');
}
function buildArtifactData(records) {
    const totalFamilies = new Set(records.map((record) => record.familyNodeId).filter((id) => id !== null)).size;
    const familiesByLocale = new Map();
    const genericityByLocale = new Map();
    for (const locale of KNOWN_LOCALES) {
        const { families, genericity } = buildLocaleData(records, locale, totalFamilies);
        familiesByLocale.set(locale, families);
        genericityByLocale.set(locale, genericity);
    }
    return {
        totalFamilies,
        locales: [...KNOWN_LOCALES],
        lowConfidenceLocales: KNOWN_LOCALES.filter((locale) => LOW_CONFIDENCE_LOCALES.has(locale)),
        familiesByLocale,
        genericityByLocale
    };
}
function buildLocaleData(records, locale, totalFamilies) {
    const accumulatorsByFamily = new Map();
    for (const record of records) {
        if (record.familyNodeId === null) {
            continue;
        }
        const accumulator = familyAccumulator(accumulatorsByFamily, record.familyNodeId);
        if (locale === 'en') {
            addTokenOccurrences(accumulator, record.canonicalLabel, aliasRoleScoreFactor(CANONICAL_ALIAS_ROLE));
        }
        for (const alias of record.aliases) {
            if (alias.localeCode !== locale || !isSearchAliasRole(alias.aliasRole, true)) {
                continue;
            }
            const text = alias.normalizedAlias.trim() || alias.alias.trim();
            addTokenOccurrences(accumulator, text, aliasRoleScoreFactor(alias.aliasRole));
        }
    }
    const documentFrequency = new Map();
    for (const accumulator of accumulatorsByFamily.values()) {
        for (const [token, matchCount] of accumulator.tokenMatchCounts) {
            if (matchCount >= MIN_FAMILY_TOKEN_OCCURRENCES) {
                documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
            }
        }
    }
    const genericity = new Map();
    const families = Array.from(accumulatorsByFamily.values())
        .map((accumulator) => {
        const totalTokenOccurrences = sumOccurrences(accumulator.tokenOccurrences);
        const rankedTokens = Array.from(accumulator.tokenOccurrences.entries())
            .filter(([token]) => (accumulator.tokenMatchCounts.get(token) ?? 0) >= MIN_FAMILY_TOKEN_OCCURRENCES)
            .sort(([, left], [, right]) => right - left)
            .slice(0, MAX_TOKENS_PER_FAMILY);
        const tokens = [];
        for (const [token, occurrences] of rankedTokens) {
            const tfRatio = totalTokenOccurrences > 0 ? occurrences / totalTokenOccurrences : 0;
            const df = documentFrequency.get(token) ?? 0;
            const relevance = roundScore(tfRatio * Math.log(1 + (totalFamilies + 1) / (df + 1)));
            tokens.push([token, relevance]);
            if (relevance > (genericity.get(token) ?? 0)) {
                genericity.set(token, relevance);
            }
        }
        return {
            familyNodeId: accumulator.familyNodeId,
            tokens
        };
    })
        .sort((left, right) => left.familyNodeId - right.familyNodeId);
    return {
        families,
        genericity: Array.from(genericity.entries()).sort(([left], [right]) => left.localeCompare(right))
    };
}
function familyAccumulator(accumulatorsByFamily, familyNodeId) {
    let accumulator = accumulatorsByFamily.get(familyNodeId);
    if (!accumulator) {
        accumulator = { familyNodeId, tokenOccurrences: new Map(), tokenMatchCounts: new Map() };
        accumulatorsByFamily.set(familyNodeId, accumulator);
    }
    return accumulator;
}
function addTokenOccurrences(accumulator, text, weight) {
    for (const token of tokenizeNormalizedText(foldSearchText(text))) {
        accumulator.tokenOccurrences.set(token, (accumulator.tokenOccurrences.get(token) ?? 0) + weight);
        accumulator.tokenMatchCounts.set(token, (accumulator.tokenMatchCounts.get(token) ?? 0) + 1);
    }
}
function sumOccurrences(tokenOccurrences) {
    let total = 0;
    for (const occurrences of tokenOccurrences.values()) {
        total += occurrences;
    }
    return total;
}
function collectStrings(data) {
    const strings = new Set();
    for (const locale of data.locales) {
        strings.add(locale);
        for (const family of data.familiesByLocale.get(locale) ?? []) {
            for (const [token] of family.tokens) {
                strings.add(token);
            }
        }
        for (const [token] of data.genericityByLocale.get(locale) ?? []) {
            strings.add(token);
        }
    }
    return Array.from(strings).sort();
}
function requiredStringId(stringIdByValue, value) {
    const id = stringIdByValue.get(value);
    if (id === undefined) {
        throw new Error(`Missing binary family-token relevance string: ${value}`);
    }
    return id;
}
function stringId(strings, value) {
    let low = 0;
    let high = strings.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = stringAt(strings, mid);
        if (current < value) {
            low = mid + 1;
        }
        else if (current > value) {
            high = mid - 1;
        }
        else {
            return mid;
        }
    }
    return -1;
}
function scaleScore(value) {
    return Math.max(0, Math.round(value * FAMILY_TOKEN_RELEVANCE_SCORE_SCALE));
}
function findFamilyRange(table, localeId, familyNodeId) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const locale = rowValue(table, mid, 0);
        const family = rowValue(table, mid, 1);
        if (locale < localeId || (locale === localeId && family < familyNodeId)) {
            low = mid + 1;
            continue;
        }
        if (locale > localeId || (locale === localeId && family > familyNodeId)) {
            high = mid - 1;
            continue;
        }
        return {
            offset: rowValue(table, mid, 2),
            length: rowValue(table, mid, 3)
        };
    }
    return null;
}
function findLocaleGenericityRange(table, localeId) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const locale = rowValue(table, mid, 0);
        if (locale < localeId) {
            low = mid + 1;
            continue;
        }
        if (locale > localeId) {
            high = mid - 1;
            continue;
        }
        return {
            offset: rowValue(table, mid, 1),
            length: rowValue(table, mid, 2)
        };
    }
    return null;
}
function lookupScaledValue(table, offset, length, tokenId) {
    let low = offset;
    let high = offset + length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const currentTokenId = rowValue(table, mid, 0);
        if (currentTokenId < tokenId) {
            low = mid + 1;
            continue;
        }
        if (currentTokenId > tokenId) {
            high = mid - 1;
            continue;
        }
        return rowValue(table, mid, 1);
    }
    return 0;
}
