import { access, open, readFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import {
  isNullableInteger,
  isNullableString,
  isRecord,
  safeFileSegment
} from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';

export type RuntimeGenericRisk = 'low' | 'medium' | 'high';

export type RuntimeAncestorRecord = {
  graphNodeId: number;
  canonicalLabel: string;
  nodeLevel: string;
  distanceFromLeaf: number;
  ancestorRole: string;
};

export type RuntimeSiblingRecord = {
  graphNodeId: number;
  canonicalLabel: string;
  nodeLevel: string;
  siblingKind: string;
  weight: number | null;
};

export type RuntimeAliasRecord = {
  localeCode: string;
  alias: string;
  normalizedAlias: string;
  aliasRole: 'locale_primary' | 'locale_supporting' | 'reviewed_crosswalk' | 'family_supporting' | 'english_backbone';
  isPrimary: boolean;
  confidence: number | null;
  weight: number | null;
};

export type RuntimeCapabilityRecord = {
  capabilityId: number;
  capabilityType: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
  label: string;
  normalizedLabel: string;
  hintKind: string;
  weight: number | null;
};

export type RuntimeSearchMetaRecord = {
  searchMetaId: number;
  graphNodeId: number;
  canonicalLabel: string;
  genericRisk: RuntimeGenericRisk;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  familyNodeId: number | null;
  familyLabel: string | null;
  groupNodeId: number | null;
  groupLabel: string | null;
  parentNodeId: number | null;
  parentLabel: string | null;
  ancestors: RuntimeAncestorRecord[];
  siblings: RuntimeSiblingRecord[];
  aliases: RuntimeAliasRecord[];
  capabilityLabels: RuntimeCapabilityRecord[];
};

export type OccupationSearchMetaArtifactManifest = {
  schemaVersion: 1;
  sourceName: string;
  generatedAt: string;
  count: number;
  recordsPath: string;
  detailsPath?: string;
  detailsPaths: string[];
};

export type OccupationSearchMetaArtifact = OccupationSearchMetaArtifactManifest & {
  records: RuntimeSearchMetaRecord[];
};

type SearchMetaArtifactCacheEntry = {
  manifestPath: string;
  recordsPath: string;
  detailsPaths: string[];
  artifact: OccupationSearchMetaArtifact;
  recordsByNodeId: Map<number, RuntimeSearchMetaRecord>;
  leafRecordsByFamilyNodeId: Map<number, RuntimeSearchMetaRecord[]>;
  detailsByNodeId: Map<number, SearchMetaDetailsPointer>;
  detailsCacheByNodeId: Map<number, RuntimeSearchMetaDetails>;
};

type RuntimeSearchMetaCoreRecord = Omit<RuntimeSearchMetaRecord, 'aliases' | 'capabilityLabels'> & {
  aliases: [];
  capabilityLabels: [];
  detailsFileIndex: number;
  detailsOffset: number;
  detailsByteLength: number;
};

type RuntimeSearchMetaDetails = {
  graphNodeId: number;
  aliases: RuntimeAliasRecord[];
  capabilityLabels: RuntimeCapabilityRecord[];
};

type SearchMetaDetailsPointer = {
  fileIndex: number;
  offset: number;
  byteLength: number;
};

const ARTIFACT_CACHE = new Map<string, Promise<SearchMetaArtifactCacheEntry | null>>();

export function defaultOccupationSearchMetaManifestPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.manifest.json`);
}

export function defaultOccupationSearchMetaRecordsPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.records.jsonl`);
}

export function defaultOccupationSearchMetaDetailsPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.details.jsonl`);
}

export async function loadOccupationSearchMetaArtifactIfAvailable(sourceName: string): Promise<SearchMetaArtifactCacheEntry | null> {
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

export async function loadOccupationSearchMetaArtifactRequired(sourceName: string): Promise<SearchMetaArtifactCacheEntry> {
  const manifestPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH') ??
    defaultOccupationSearchMetaManifestPath(sourceName);
  const artifactEntry = await loadOccupationSearchMetaArtifactIfAvailable(sourceName);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation search-meta artifact for source="${sourceName}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run search-meta:export-runtime` after rebuilding search meta, or set OCCUPATION_SEARCH_META_ARTIFACT_PATH.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

export async function loadOccupationSearchMetaArtifactWithDetailsRequired(sourceName: string): Promise<SearchMetaArtifactCacheEntry> {
  const artifactEntry = await loadOccupationSearchMetaArtifactRequired(sourceName);
  await hydrateRuntimeSearchMetaRecords(artifactEntry, artifactEntry.artifact.records);
  return artifactEntry;
}

export async function hydrateRuntimeSearchMetaRecords(
  artifactEntry: SearchMetaArtifactCacheEntry,
  records: RuntimeSearchMetaRecord[]
): Promise<RuntimeSearchMetaRecord[]> {
  if (records.length === 0) {
    return [];
  }

  const hydrated: RuntimeSearchMetaRecord[] = [];
  const fileHandles = new Map<number, FileHandle>();

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
  } finally {
    await Promise.all(Array.from(fileHandles.values()).map((file) => file.close()));
  }

  return hydrated;
}

export async function hydrateAllRuntimeSearchMetaRecords(
  artifactEntry: SearchMetaArtifactCacheEntry,
  records: RuntimeSearchMetaRecord[]
): Promise<RuntimeSearchMetaRecord[]> {
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

export async function hydrateRuntimeSearchMetaRecord(
  artifactEntry: SearchMetaArtifactCacheEntry,
  record: RuntimeSearchMetaRecord
): Promise<RuntimeSearchMetaRecord> {
  const details = await loadRuntimeSearchMetaDetails(artifactEntry, record.graphNodeId);

  if (!details) {
    return record;
  }

  record.aliases = details.aliases;
  record.capabilityLabels = details.capabilityLabels;
  return record;
}

async function loadAllRuntimeSearchMetaDetails(
  artifactEntry: SearchMetaArtifactCacheEntry
): Promise<Map<number, RuntimeSearchMetaDetails>> {
  if (artifactEntry.detailsCacheByNodeId.size >= artifactEntry.detailsByNodeId.size) {
    return artifactEntry.detailsCacheByNodeId;
  }

  for (let fileIndex = 0; fileIndex < artifactEntry.detailsPaths.length; fileIndex += 1) {
    const detailsPath = artifactEntry.detailsPaths[fileIndex] as string;
    const raw = await readFile(detailsPath, 'utf8');
    const lines = raw.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();

      if (!line) {
        continue;
      }

      const parsed = JSON.parse(line) as unknown;
      const graphNodeId = isRecord(parsed) && typeof parsed.graphNodeId === 'number' ? parsed.graphNodeId : index + 1;
      const details = validateDetailsRecord(parsed, detailsPath, graphNodeId);
      artifactEntry.detailsCacheByNodeId.set(details.graphNodeId, details);
    }
  }

  return artifactEntry.detailsCacheByNodeId;
}

async function hydrateRuntimeSearchMetaRecordWithHandle(
  artifactEntry: SearchMetaArtifactCacheEntry,
  file: FileHandle,
  record: RuntimeSearchMetaRecord
): Promise<RuntimeSearchMetaRecord> {
  const details = await loadRuntimeSearchMetaDetailsWithHandle(artifactEntry, file, record.graphNodeId);

  if (!details) {
    return record;
  }

  record.aliases = details.aliases;
  record.capabilityLabels = details.capabilityLabels;
  return record;
}

async function loadArtifact(manifestPath: string, sourceName: string): Promise<SearchMetaArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = validateManifest(JSON.parse(rawManifest) as unknown, manifestPath);

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

function buildRecordsByNodeId(records: RuntimeSearchMetaRecord[]): Map<number, RuntimeSearchMetaRecord> {
  return new Map(records.map((record) => [record.graphNodeId, record]));
}

function buildLeafRecordsByFamilyNodeId(records: RuntimeSearchMetaRecord[]): Map<number, RuntimeSearchMetaRecord[]> {
  const recordsByFamilyId = new Map<number, RuntimeSearchMetaRecord[]>();

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

async function loadRecords(recordsPath: string): Promise<RuntimeSearchMetaRecord[]> {
  const raw = await readFile(recordsPath, 'utf8');
  const records: RuntimeSearchMetaRecord[] = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    records.push(coreRecordToRuntimeRecord(validateCoreRecord(JSON.parse(line) as unknown, recordsPath, index + 1)));
  }

  return records;
}

function buildDetailsByNodeId(records: RuntimeSearchMetaRecord[]): Map<number, SearchMetaDetailsPointer> {
  const detailsByNodeId = new Map<number, SearchMetaDetailsPointer>();

  for (const record of records) {
    const coreRecord = record as RuntimeSearchMetaRecord & Partial<RuntimeSearchMetaCoreRecord>;

    if (
      typeof coreRecord.detailsOffset === 'number' &&
      typeof coreRecord.detailsByteLength === 'number'
    ) {
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

async function loadRuntimeSearchMetaDetails(
  artifactEntry: SearchMetaArtifactCacheEntry,
  graphNodeId: number
): Promise<RuntimeSearchMetaDetails | null> {
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
  } finally {
    await file.close();
  }
}

async function loadRuntimeSearchMetaDetailsWithHandle(
  artifactEntry: SearchMetaArtifactCacheEntry,
  file: FileHandle,
  graphNodeId: number
): Promise<RuntimeSearchMetaDetails | null> {
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
    throw new Error(
      `Could not read complete search-meta details record for graph_node_id=${graphNodeId} at ${detailsPathForPointer(artifactEntry, pointer)}.`
    );
  }

  const details = validateDetailsRecord(JSON.parse(buffer.toString('utf8')) as unknown, detailsPathForPointer(artifactEntry, pointer), graphNodeId);
  artifactEntry.detailsCacheByNodeId.set(graphNodeId, details);
  return details;
}

function detailsPathForPointer(artifactEntry: SearchMetaArtifactCacheEntry, pointer: SearchMetaDetailsPointer): string {
  const detailsPath = artifactEntry.detailsPaths[pointer.fileIndex];

  if (!detailsPath) {
    throw new Error(`Missing search-meta details shard index=${pointer.fileIndex} for ${artifactEntry.manifestPath}.`);
  }

  return detailsPath;
}

function validateManifest(value: unknown, manifestPath: string): OccupationSearchMetaArtifactManifest {
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

  if (
    schemaVersion !== 1 ||
    typeof sourceName !== 'string' ||
    typeof generatedAt !== 'string' ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    typeof recordsPath !== 'string' ||
    detailsPaths.length === 0 ||
    !detailsPaths.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Invalid occupation search-meta manifest metadata at ${manifestPath}.`);
  }

  return {
    schemaVersion,
    sourceName,
    generatedAt,
    count,
    recordsPath,
    detailsPath: typeof detailsPath === 'string' ? detailsPath : undefined,
    detailsPaths: detailsPaths as string[]
  };
}

function validateCoreRecord(value: unknown, recordsPath: string, lineNumber: number): RuntimeSearchMetaCoreRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid search-meta record at ${recordsPath}:${lineNumber}.`);
  }

  const record = value as Partial<RuntimeSearchMetaRecord>;
  const coreRecord = value as Partial<RuntimeSearchMetaCoreRecord>;

  if (
    !Number.isInteger(record.searchMetaId) ||
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
    (coreRecord.detailsFileIndex !== undefined && (
      typeof coreRecord.detailsFileIndex !== 'number' ||
      !Number.isInteger(coreRecord.detailsFileIndex) ||
      coreRecord.detailsFileIndex < 0
    )) ||
    typeof coreRecord.detailsOffset !== 'number' ||
    !Number.isInteger(coreRecord.detailsOffset) ||
    typeof coreRecord.detailsByteLength !== 'number' ||
    !Number.isInteger(coreRecord.detailsByteLength)
  ) {
    throw new Error(`Invalid search-meta record at ${recordsPath}:${lineNumber}.`);
  }

  return {
    searchMetaId: record.searchMetaId as number,
    graphNodeId: record.graphNodeId as number,
    canonicalLabel: record.canonicalLabel as string,
    genericRisk: record.genericRisk as RuntimeGenericRisk,
    hasHierarchy: record.hasHierarchy as boolean,
    hasCapabilitySupport: record.hasCapabilitySupport as boolean,
    familyNodeId: record.familyNodeId as number | null,
    familyLabel: record.familyLabel as string | null,
    groupNodeId: record.groupNodeId as number | null,
    groupLabel: record.groupLabel as string | null,
    parentNodeId: record.parentNodeId as number | null,
    parentLabel: record.parentLabel as string | null,
    ancestors: record.ancestors as RuntimeAncestorRecord[],
    siblings: record.siblings as RuntimeSiblingRecord[],
    aliases: [],
    capabilityLabels: [],
    detailsFileIndex: coreRecord.detailsFileIndex ?? 0,
    detailsOffset: coreRecord.detailsOffset,
    detailsByteLength: coreRecord.detailsByteLength
  };
}

function coreRecordToRuntimeRecord(record: RuntimeSearchMetaCoreRecord): RuntimeSearchMetaRecord {
  return record as RuntimeSearchMetaRecord;
}

function validateDetailsRecord(value: unknown, detailsPath: string, graphNodeId: number): RuntimeSearchMetaDetails {
  if (!isRecord(value)) {
    throw new Error(`Invalid search-meta details record for graph_node_id=${graphNodeId} at ${detailsPath}.`);
  }

  const record = value as Partial<RuntimeSearchMetaDetails>;

  if (
    record.graphNodeId !== graphNodeId ||
    !Array.isArray(record.aliases) ||
    !Array.isArray(record.capabilityLabels)
  ) {
    throw new Error(`Invalid search-meta details record for graph_node_id=${graphNodeId} at ${detailsPath}.`);
  }

  return {
    graphNodeId,
    aliases: record.aliases as RuntimeAliasRecord[],
    capabilityLabels: record.capabilityLabels as RuntimeCapabilityRecord[]
  };
}

function isGenericRisk(value: unknown): value is RuntimeGenericRisk {
  return value === 'low' || value === 'medium' || value === 'high';
}
