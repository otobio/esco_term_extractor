import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { foldSearchLookupText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { isNonNegativeInteger, isNullableInteger, isNullableString, isRecord, isStringArray, safeFileSegment } from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
export const FAMILY_PROFILE_SOURCE_KINDS = ['family_label', 'alias', 'leaf_label', 'capability'];
const ARTIFACT_CACHE = new Map();
export function defaultOccupationFamilyProfileManifestPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-family-profiles.${safeFileSegment(sourceName)}.manifest.json`);
}
export function defaultOccupationFamilyProfileRecordsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-family-profiles.${safeFileSegment(sourceName)}.records.jsonl`);
}
export async function loadOccupationFamilyProfileArtifactIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationFamilyProfileManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    let cached = ARTIFACT_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadArtifact(cacheKey, sourceName);
        ARTIFACT_CACHE.set(cacheKey, cached);
    }
    return cached;
}
export async function loadOccupationFamilyProfileArtifactRequired(sourceName) {
    const manifestPath = readOptionalEnv('OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH') ??
        defaultOccupationFamilyProfileManifestPath(sourceName);
    const artifactEntry = await loadOccupationFamilyProfileArtifactIfAvailable(sourceName);
    if (!artifactEntry) {
        throw new Error([
            `Missing required occupation family-profile artifact for source="${sourceName}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run search-meta:export-family-profiles` after rebuilding search meta, or set OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH.'
        ].join(' '));
    }
    return artifactEntry;
}
export function buildOccupationFamilyProfileRecords(records) {
    const recordsByFamilyId = buildLeafRecordsByFamilyNodeId(records);
    const profiles = Array.from(recordsByFamilyId.entries())
        .map(([familyNodeId, familyRecords]) => buildFamilyProfile(familyNodeId, familyRecords))
        .filter((profile) => profile !== null)
        .sort((left, right) => left.familyLabel.localeCompare(right.familyLabel));
    return profiles;
}
async function loadArtifact(manifestPath, sourceName) {
    try {
        await access(manifestPath);
    }
    catch {
        return null;
    }
    const rawManifest = await readFile(manifestPath, 'utf8');
    const manifest = validateManifest(JSON.parse(rawManifest), manifestPath);
    if (manifest.sourceName !== sourceName) {
        return null;
    }
    const recordsPath = path.resolve(path.dirname(manifestPath), manifest.recordsPath);
    const records = await loadRecords(recordsPath);
    if (records.length !== manifest.count) {
        throw new Error(`Occupation family-profile artifact count mismatch: manifest=${manifest.count}, records=${records.length}.`);
    }
    return {
        manifestPath,
        recordsPath,
        artifact: {
            ...manifest,
            records
        },
        recordsByFamilyNodeId: new Map(records.map((record) => [record.familyNodeId, record]))
    };
}
async function loadRecords(recordsPath) {
    const raw = await readFile(recordsPath, 'utf8');
    const records = [];
    const lines = raw.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]?.trim();
        if (!line) {
            continue;
        }
        records.push(validateRecord(JSON.parse(line), recordsPath, index + 1));
    }
    return records;
}
function buildLeafRecordsByFamilyNodeId(records) {
    const recordsByFamilyId = new Map();
    for (const record of records) {
        if (record.familyNodeId === null) {
            continue;
        }
        const recordsForFamily = recordsByFamilyId.get(record.familyNodeId) ?? [];
        recordsForFamily.push(record);
        recordsByFamilyId.set(record.familyNodeId, recordsForFamily);
    }
    return recordsByFamilyId;
}
function buildFamilyProfile(familyNodeId, records) {
    const firstRecord = records[0] ?? null;
    const familyLabel = firstRecord?.familyLabel?.trim();
    if (!firstRecord || !familyLabel) {
        return null;
    }
    const texts = buildFamilyProfileTexts(familyLabel, records);
    const localeCodes = familyProfileLocaleCodes(texts);
    const localeProfiles = localeCodes.map((localeCode) => buildLocaleProfile(localeCode, texts));
    return {
        familyNodeId,
        familyLabel,
        groupNodeId: firstRecord.groupNodeId,
        groupLabel: firstRecord.groupLabel,
        profileLeafCount: records.length,
        localeProfiles
    };
}
function buildFamilyProfileTexts(familyLabel, records) {
    const texts = [];
    const textKeys = new Set();
    addProfileText(texts, textKeys, {
        value: familyLabel,
        source: 'family_label',
        localeCode: null,
        leafId: null,
        aliasRole: null
    });
    for (const record of records) {
        addProfileText(texts, textKeys, {
            value: record.canonicalLabel,
            source: 'leaf_label',
            localeCode: null,
            leafId: record.graphNodeId,
            aliasRole: null
        });
        for (const alias of record.aliases) {
            addProfileText(texts, textKeys, {
                value: alias.normalizedAlias,
                source: 'alias',
                localeCode: alias.localeCode,
                leafId: record.graphNodeId,
                aliasRole: alias.aliasRole
            });
        }
        for (const capability of record.capabilityLabels) {
            addProfileText(texts, textKeys, {
                value: capability.normalizedLabel,
                source: 'capability',
                localeCode: null,
                leafId: record.graphNodeId,
                aliasRole: null
            });
        }
    }
    return texts;
}
function addProfileText(texts, textKeys, input) {
    const value = input.value.trim();
    if (!value) {
        return;
    }
    const tokens = tokenizeNormalizedText(foldSearchLookupText(value));
    if (tokens.length === 0) {
        return;
    }
    const key = [
        input.source,
        input.localeCode ?? '',
        input.leafId ?? '',
        input.aliasRole ?? '',
        tokens.join(' ')
    ].join('\u0000');
    if (textKeys.has(key)) {
        return;
    }
    textKeys.add(key);
    texts.push({
        tokens,
        tokenSet: new Set(tokens),
        source: input.source,
        localeCode: input.localeCode,
        leafId: input.leafId,
        aliasRole: input.aliasRole
    });
}
function familyProfileLocaleCodes(texts) {
    const localeCodes = new Set(['en', 'unknown']);
    for (const text of texts) {
        if (text.localeCode) {
            localeCodes.add(text.localeCode);
        }
    }
    return Array.from(localeCodes).sort();
}
function buildLocaleProfile(localeCode, texts) {
    const scoped = emptyScopedLocaleBuilder(localeCode);
    for (const text of texts) {
        if (!textAppliesToLocale(text, localeCode)) {
            continue;
        }
        const source = scoped.sources[text.source];
        source.phrases.add(text.tokens.join(' '));
        for (const token of text.tokenSet) {
            source.tokenSet.add(token);
        }
        if (text.leafId === null || text.aliasRole === 'family_supporting') {
            continue;
        }
        for (const token of text.tokenSet) {
            const leafIds = scoped.leafIdsByToken.get(token) ?? new Set();
            leafIds.add(text.leafId);
            scoped.leafIdsByToken.set(token, leafIds);
        }
    }
    return {
        localeCode,
        sources: {
            family_label: finalizeSource(scoped.sources.family_label),
            alias: finalizeSource(scoped.sources.alias),
            leaf_label: finalizeSource(scoped.sources.leaf_label),
            capability: finalizeSource(scoped.sources.capability)
        },
        leafIdsByToken: Array.from(scoped.leafIdsByToken.entries())
            .map(([token, leafIds]) => [token, Array.from(leafIds).sort((left, right) => left - right)])
            .sort(([left], [right]) => left.localeCompare(right))
    };
}
function emptyScopedLocaleBuilder(localeCode) {
    return {
        localeCode,
        sources: {
            family_label: emptySourceBuilder(),
            alias: emptySourceBuilder(),
            leaf_label: emptySourceBuilder(),
            capability: emptySourceBuilder()
        },
        leafIdsByToken: new Map()
    };
}
function emptySourceBuilder() {
    return {
        phrases: new Set(),
        tokenSet: new Set()
    };
}
function finalizeSource(source) {
    return {
        tokens: Array.from(source.tokenSet).sort(),
        phrases: Array.from(source.phrases).sort()
    };
}
function textAppliesToLocale(text, locale) {
    return text.localeCode === null || text.localeCode === locale || text.localeCode === 'en';
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation family-profile manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== 1 ||
        typeof manifest.sourceName !== 'string' ||
        typeof manifest.generatedAt !== 'string' ||
        !isNonNegativeInteger(manifest.count) ||
        typeof manifest.recordsPath !== 'string') {
        throw new Error(`Invalid occupation family-profile manifest metadata at ${manifestPath}.`);
    }
    return manifest;
}
function validateRecord(value, recordsPath, lineNumber) {
    if (!isRecord(value)) {
        throw new Error(`Invalid family-profile record at ${recordsPath}:${lineNumber}.`);
    }
    const record = value;
    if (!Number.isInteger(record.familyNodeId) ||
        typeof record.familyLabel !== 'string' ||
        !isNullableInteger(record.groupNodeId) ||
        !isNullableString(record.groupLabel) ||
        !isNonNegativeInteger(record.profileLeafCount) ||
        !Array.isArray(record.localeProfiles)) {
        throw new Error(`Invalid family-profile record metadata at ${recordsPath}:${lineNumber}.`);
    }
    return {
        familyNodeId: record.familyNodeId,
        familyLabel: record.familyLabel,
        groupNodeId: record.groupNodeId,
        groupLabel: record.groupLabel,
        profileLeafCount: record.profileLeafCount,
        localeProfiles: record.localeProfiles.map((profile, index) => validateLocaleRecord(profile, recordsPath, lineNumber, index))
    };
}
function validateLocaleRecord(value, recordsPath, lineNumber, index) {
    if (!isRecord(value)) {
        throw new Error(`Invalid family-profile locale record at ${recordsPath}:${lineNumber}:${index}.`);
    }
    const record = value;
    if (typeof record.localeCode !== 'string' ||
        !isSourceRecord(record.sources) ||
        !Array.isArray(record.leafIdsByToken) ||
        !record.leafIdsByToken.every(isTokenLeafIdsEntry)) {
        throw new Error(`Invalid family-profile locale record at ${recordsPath}:${lineNumber}:${index}.`);
    }
    return {
        localeCode: record.localeCode,
        sources: record.sources,
        leafIdsByToken: record.leafIdsByToken
    };
}
function isSourceRecord(value) {
    if (!isRecord(value)) {
        return false;
    }
    return FAMILY_PROFILE_SOURCE_KINDS.every((source) => isProfileSource(value[source]));
}
function isProfileSource(value) {
    return isRecord(value) &&
        isStringArray(value.tokens) &&
        isStringArray(value.phrases);
}
function isTokenLeafIdsEntry(value) {
    return Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        Array.isArray(value[1]) &&
        value[1].every((leafId) => Number.isInteger(leafId));
}
