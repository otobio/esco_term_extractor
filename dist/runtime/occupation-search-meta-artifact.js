import { access, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { isNullableInteger, isNullableString, isRecord, safeFileSegment } from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
const ARTIFACT_CACHE = new Map();
export function defaultOccupationSearchMetaManifestPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.manifest.json`);
}
export function defaultOccupationSearchMetaRecordsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.records.jsonl`);
}
export function defaultOccupationSearchMetaDetailsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.details.jsonl`);
}
export async function loadOccupationSearchMetaArtifactIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationSearchMetaManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    let cached = ARTIFACT_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadArtifact(cacheKey, sourceName);
        ARTIFACT_CACHE.set(cacheKey, cached);
    }
    return cached;
}
export async function loadOccupationSearchMetaArtifactRequired(sourceName) {
    const manifestPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH') ??
        defaultOccupationSearchMetaManifestPath(sourceName);
    const artifactEntry = await loadOccupationSearchMetaArtifactIfAvailable(sourceName);
    if (!artifactEntry) {
        throw new Error([
            `Missing required occupation search-meta artifact for source="${sourceName}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run search-meta:export-runtime` after rebuilding search meta, or set OCCUPATION_SEARCH_META_ARTIFACT_PATH.'
        ].join(' '));
    }
    return artifactEntry;
}
export async function loadOccupationSearchMetaArtifactWithDetailsRequired(sourceName) {
    const artifactEntry = await loadOccupationSearchMetaArtifactRequired(sourceName);
    await hydrateRuntimeSearchMetaRecords(artifactEntry, artifactEntry.artifact.records);
    return artifactEntry;
}
export async function hydrateRuntimeSearchMetaRecords(artifactEntry, records) {
    if (records.length === 0) {
        return [];
    }
    const hydrated = [];
    const fileHandles = new Map();
    try {
        for (const record of records) {
            const pointer = artifactEntry.detailsByNodeId.get(record.graphNodeId);
            if (!pointer) {
                hydrated.push(record);
                continue;
            }
            let file = fileHandles.get(pointer.fileIndex);
            if (!file) {
                file = await open(detailsPathForPointer(artifactEntry, pointer), 'r');
                fileHandles.set(pointer.fileIndex, file);
            }
            hydrated.push(await hydrateRuntimeSearchMetaRecordWithHandle(artifactEntry, file, record));
        }
    }
    finally {
        await Promise.all(Array.from(fileHandles.values()).map((file) => file.close()));
    }
    return hydrated;
}
export async function hydrateAllRuntimeSearchMetaRecords(artifactEntry, records) {
    if (records.length === 0) {
        return [];
    }
    const detailsByNodeId = await loadAllRuntimeSearchMetaDetails(artifactEntry);
    return records.map((record) => {
        const details = detailsByNodeId.get(record.graphNodeId);
        if (!details) {
            return record;
        }
        record.aliases = details.aliases;
        record.capabilityLabels = details.capabilityLabels;
        return record;
    });
}
export async function hydrateRuntimeSearchMetaRecord(artifactEntry, record) {
    const details = await loadRuntimeSearchMetaDetails(artifactEntry, record.graphNodeId);
    if (!details) {
        return record;
    }
    record.aliases = details.aliases;
    record.capabilityLabels = details.capabilityLabels;
    return record;
}
async function loadAllRuntimeSearchMetaDetails(artifactEntry) {
    if (artifactEntry.detailsCacheByNodeId.size >= artifactEntry.detailsByNodeId.size) {
        return artifactEntry.detailsCacheByNodeId;
    }
    for (let fileIndex = 0; fileIndex < artifactEntry.detailsPaths.length; fileIndex += 1) {
        const detailsPath = artifactEntry.detailsPaths[fileIndex];
        const raw = await readFile(detailsPath, 'utf8');
        const lines = raw.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]?.trim();
            if (!line) {
                continue;
            }
            const parsed = JSON.parse(line);
            const graphNodeId = isRecord(parsed) && typeof parsed.graphNodeId === 'number' ? parsed.graphNodeId : index + 1;
            const details = validateDetailsRecord(parsed, detailsPath, graphNodeId);
            artifactEntry.detailsCacheByNodeId.set(details.graphNodeId, details);
        }
    }
    return artifactEntry.detailsCacheByNodeId;
}
async function hydrateRuntimeSearchMetaRecordWithHandle(artifactEntry, file, record) {
    const details = await loadRuntimeSearchMetaDetailsWithHandle(artifactEntry, file, record.graphNodeId);
    if (!details) {
        return record;
    }
    record.aliases = details.aliases;
    record.capabilityLabels = details.capabilityLabels;
    return record;
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
    const detailsPaths = manifest.detailsPaths.map((detailsPath) => path.resolve(path.dirname(manifestPath), detailsPath));
    await Promise.all(detailsPaths.map((detailsPath) => access(detailsPath)));
    const records = await loadRecords(recordsPath);
    if (records.length !== manifest.count) {
        throw new Error(`Occupation search-meta artifact count mismatch: manifest=${manifest.count}, records=${records.length}.`);
    }
    return {
        manifestPath,
        recordsPath,
        detailsPaths,
        artifact: {
            ...manifest,
            records
        },
        recordsByNodeId: buildRecordsByNodeId(records),
        leafRecordsByFamilyNodeId: buildLeafRecordsByFamilyNodeId(records),
        detailsByNodeId: buildDetailsByNodeId(records),
        detailsCacheByNodeId: new Map()
    };
}
function buildRecordsByNodeId(records) {
    return new Map(records.map((record) => [record.graphNodeId, record]));
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
    for (const recordsForFamily of recordsByFamilyId.values()) {
        recordsForFamily.sort((left, right) => left.canonicalLabel.localeCompare(right.canonicalLabel));
    }
    return recordsByFamilyId;
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
        records.push(coreRecordToRuntimeRecord(validateCoreRecord(JSON.parse(line), recordsPath, index + 1)));
    }
    return records;
}
function buildDetailsByNodeId(records) {
    const detailsByNodeId = new Map();
    for (const record of records) {
        const coreRecord = record;
        if (typeof coreRecord.detailsOffset === 'number' &&
            typeof coreRecord.detailsByteLength === 'number') {
            detailsByNodeId.set(record.graphNodeId, {
                fileIndex: coreRecord.detailsFileIndex ?? 0,
                offset: coreRecord.detailsOffset,
                byteLength: coreRecord.detailsByteLength
            });
            delete coreRecord.detailsFileIndex;
            delete coreRecord.detailsOffset;
            delete coreRecord.detailsByteLength;
        }
    }
    return detailsByNodeId;
}
async function loadRuntimeSearchMetaDetails(artifactEntry, graphNodeId) {
    const cached = artifactEntry.detailsCacheByNodeId.get(graphNodeId);
    if (cached) {
        return cached;
    }
    const pointer = artifactEntry.detailsByNodeId.get(graphNodeId);
    if (!pointer || pointer.byteLength <= 0) {
        return null;
    }
    const file = await open(detailsPathForPointer(artifactEntry, pointer), 'r');
    try {
        return await loadRuntimeSearchMetaDetailsWithHandle(artifactEntry, file, graphNodeId);
    }
    finally {
        await file.close();
    }
}
async function loadRuntimeSearchMetaDetailsWithHandle(artifactEntry, file, graphNodeId) {
    const cached = artifactEntry.detailsCacheByNodeId.get(graphNodeId);
    if (cached) {
        return cached;
    }
    const pointer = artifactEntry.detailsByNodeId.get(graphNodeId);
    if (!pointer || pointer.byteLength <= 0) {
        return null;
    }
    const buffer = Buffer.allocUnsafe(pointer.byteLength);
    const { bytesRead } = await file.read(buffer, 0, pointer.byteLength, pointer.offset);
    if (bytesRead !== pointer.byteLength) {
        throw new Error(`Could not read complete search-meta details record for graph_node_id=${graphNodeId} at ${detailsPathForPointer(artifactEntry, pointer)}.`);
    }
    const details = validateDetailsRecord(JSON.parse(buffer.toString('utf8')), detailsPathForPointer(artifactEntry, pointer), graphNodeId);
    artifactEntry.detailsCacheByNodeId.set(graphNodeId, details);
    return details;
}
function detailsPathForPointer(artifactEntry, pointer) {
    const detailsPath = artifactEntry.detailsPaths[pointer.fileIndex];
    if (!detailsPath) {
        throw new Error(`Missing search-meta details shard index=${pointer.fileIndex} for ${artifactEntry.manifestPath}.`);
    }
    return detailsPath;
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation search-meta manifest at ${manifestPath} must be a JSON object.`);
    }
    const schemaVersion = value.schemaVersion;
    const sourceName = value.sourceName;
    const generatedAt = value.generatedAt;
    const count = value.count;
    const recordsPath = value.recordsPath;
    const detailsPath = value.detailsPath;
    const detailsPathsValue = value.detailsPaths;
    const detailsPaths = Array.isArray(detailsPathsValue)
        ? detailsPathsValue
        : typeof detailsPath === 'string'
            ? [detailsPath]
            : [];
    if (schemaVersion !== 1 ||
        typeof sourceName !== 'string' ||
        typeof generatedAt !== 'string' ||
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        typeof recordsPath !== 'string' ||
        detailsPaths.length === 0 ||
        !detailsPaths.every((item) => typeof item === 'string')) {
        throw new Error(`Invalid occupation search-meta manifest metadata at ${manifestPath}.`);
    }
    return {
        schemaVersion,
        sourceName,
        generatedAt,
        count,
        recordsPath,
        detailsPath: typeof detailsPath === 'string' ? detailsPath : undefined,
        detailsPaths: detailsPaths
    };
}
function validateCoreRecord(value, recordsPath, lineNumber) {
    if (!isRecord(value)) {
        throw new Error(`Invalid search-meta record at ${recordsPath}:${lineNumber}.`);
    }
    const record = value;
    const coreRecord = value;
    if (!Number.isInteger(record.searchMetaId) ||
        !Number.isInteger(record.graphNodeId) ||
        typeof record.canonicalLabel !== 'string' ||
        !isGenericRisk(record.genericRisk) ||
        typeof record.hasHierarchy !== 'boolean' ||
        typeof record.hasCapabilitySupport !== 'boolean' ||
        !isNullableInteger(record.familyNodeId) ||
        !isNullableString(record.familyLabel) ||
        !isNullableInteger(record.groupNodeId) ||
        !isNullableString(record.groupLabel) ||
        !isNullableInteger(record.parentNodeId) ||
        !isNullableString(record.parentLabel) ||
        !Array.isArray(record.ancestors) ||
        !Array.isArray(record.siblings) ||
        !Array.isArray(record.aliases) ||
        record.aliases.length !== 0 ||
        !Array.isArray(record.capabilityLabels) ||
        record.capabilityLabels.length !== 0 ||
        (coreRecord.detailsFileIndex !== undefined && (typeof coreRecord.detailsFileIndex !== 'number' ||
            !Number.isInteger(coreRecord.detailsFileIndex) ||
            coreRecord.detailsFileIndex < 0)) ||
        typeof coreRecord.detailsOffset !== 'number' ||
        !Number.isInteger(coreRecord.detailsOffset) ||
        typeof coreRecord.detailsByteLength !== 'number' ||
        !Number.isInteger(coreRecord.detailsByteLength)) {
        throw new Error(`Invalid search-meta record at ${recordsPath}:${lineNumber}.`);
    }
    return {
        searchMetaId: record.searchMetaId,
        graphNodeId: record.graphNodeId,
        canonicalLabel: record.canonicalLabel,
        genericRisk: record.genericRisk,
        hasHierarchy: record.hasHierarchy,
        hasCapabilitySupport: record.hasCapabilitySupport,
        familyNodeId: record.familyNodeId,
        familyLabel: record.familyLabel,
        groupNodeId: record.groupNodeId,
        groupLabel: record.groupLabel,
        parentNodeId: record.parentNodeId,
        parentLabel: record.parentLabel,
        ancestors: record.ancestors,
        siblings: record.siblings,
        aliases: [],
        capabilityLabels: [],
        detailsFileIndex: coreRecord.detailsFileIndex ?? 0,
        detailsOffset: coreRecord.detailsOffset,
        detailsByteLength: coreRecord.detailsByteLength
    };
}
function coreRecordToRuntimeRecord(record) {
    return record;
}
function validateDetailsRecord(value, detailsPath, graphNodeId) {
    if (!isRecord(value)) {
        throw new Error(`Invalid search-meta details record for graph_node_id=${graphNodeId} at ${detailsPath}.`);
    }
    const record = value;
    if (record.graphNodeId !== graphNodeId ||
        !Array.isArray(record.aliases) ||
        !Array.isArray(record.capabilityLabels)) {
        throw new Error(`Invalid search-meta details record for graph_node_id=${graphNodeId} at ${detailsPath}.`);
    }
    return {
        graphNodeId,
        aliases: record.aliases,
        capabilityLabels: record.capabilityLabels
    };
}
function isGenericRisk(value) {
    return value === 'low' || value === 'medium' || value === 'high';
}
