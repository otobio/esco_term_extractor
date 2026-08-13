import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import {
  OccupationLeafStructureArtifactManifest,
  OccupationLeafStructureRecord,
  LEAF_AUTHORITY_KINDS,
  LEAF_BASE_ROLE_KINDS,
  LEAF_RISK_LEVELS,
  LEAF_SPECIALIZATION_KINDS
} from './occupation-leaf-structure-contract.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
import {
  closeFixedTable,
  closeUint32Rows,
  findRange,
  readFileBackedFixedTableSync,
  readFileBackedUint32RowsSync,
  readFixedTable,
  readStringTable,
  rowValue,
  stringAt,
  uint32RowsSlice,
  writeFixedTable,
  writeStringTable,
  writeUint32Rows,
  type BinaryStringTable,
  type FileBackedUint32Rows,
  type FixedTable
} from '../utils/binary-table.js';
import {
  configuredRuntimeArtifactCacheSize,
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../utils/runtime-artifact-cache.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';

export type OccupationLeafStructureArtifact = {
  manifestPath: string;
  artifactPath: string;
  manifest: OccupationLeafStructureArtifactManifest;
  strings: BinaryStringTable;
  recordRows: FixedTable;
  familyPostings: FixedTable;
  familyPostingRows: Uint32Array | FileBackedUint32Rows;
  getRecord(graphNodeId: number): OccupationLeafStructureRecord | null;
  getRecordsForFamily(familyNodeId: number): OccupationLeafStructureRecord[];
  getAllRecords(): OccupationLeafStructureRecord[];
};

const LEAF_STRUCTURE_BINARY_SCHEMA_VERSION = 2;
const LEAF_STRUCTURE_NULL_U32 = 0xffffffff;
const LEAF_STRUCTURE_ROW_WIDTH = 11;
const LEAF_STRUCTURE_FAMILY_POSTING_ROW_WIDTH = 3;
const DEFAULT_LEAF_STRUCTURE_CACHE_SIZE = 2;

const CACHE = new Map<string, RuntimeArtifactCacheEntry<OccupationLeafStructureArtifact>>();

export function defaultOccupationLeafStructureManifestPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-leaf-structure.${safeFileSegment(sourceName)}.binary.manifest.json`);
}

export async function loadOccupationLeafStructureArtifactIfAvailable(sourceName: string): Promise<OccupationLeafStructureArtifact | null> {
  const manifestPath = readOptionalEnv('OCCUPATION_LEAF_STRUCTURE_ARTIFACT_PATH') ?? defaultOccupationLeafStructureManifestPath(sourceName);
  const cacheKey = path.resolve(manifestPath);
  return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_LEAF_STRUCTURE_ARTIFACT_CACHE_SIZE', DEFAULT_LEAF_STRUCTURE_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName),
    dispose: closeOccupationLeafStructureArtifact
  });
}

export async function loadOccupationLeafStructureArtifactRequired(sourceName: string): Promise<OccupationLeafStructureArtifact> {
  const manifestPath = readOptionalEnv('OCCUPATION_LEAF_STRUCTURE_ARTIFACT_PATH') ?? defaultOccupationLeafStructureManifestPath(sourceName);
  const artifact = await loadOccupationLeafStructureArtifactIfAvailable(sourceName);

  if (!artifact) {
    throw new Error(
      [
        `Missing required occupation leaf-structure artifact for source="${sourceName}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run query:leaf-structure:export` or `npm run runtime:artifacts-build`.'
      ].join(' ')
    );
  }

  return artifact;
}

async function loadArtifact(manifestPath: string, sourceName: string): Promise<OccupationLeafStructureArtifact> {
  await access(manifestPath);
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = parseManifest(manifestText, manifestPath, sourceName);
  const directory = path.dirname(manifestPath);
  const artifactPath = path.resolve(directory, manifest.files.recordRows);
  const strings = await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount);
  const recordRows = readFileBackedFixedTableSync(artifactPath, LEAF_STRUCTURE_ROW_WIDTH, manifest.count, {
    pageRowCount: 1024,
    maxPages: 8
  });
  const familyPostings = await readFixedTable(
    path.resolve(directory, manifest.files.familyPostings),
    LEAF_STRUCTURE_FAMILY_POSTING_ROW_WIDTH,
    manifest.familyPostingKeyCount
  );
  const familyPostingRows = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.familyPostingRows), {
    pageRowCount: 2048,
    maxPages: 8
  });

  return {
    manifestPath,
    artifactPath,
    manifest,
    strings,
    recordRows,
    familyPostings,
    familyPostingRows,
    getRecord(graphNodeId: number): OccupationLeafStructureRecord | null {
      const rowId = findRecordRowId(recordRows, graphNodeId);
      return rowId === null ? null : decodeRecord(strings, recordRows, rowId);
    },
    getRecordsForFamily(familyNodeId: number): OccupationLeafStructureRecord[] {
      const familyPostingRange = findRange(familyPostings, [familyNodeId]);

      if (familyPostingRange === null) {
        return [];
      }

      return uint32RowsSlice(familyPostingRows, familyPostingRange.offset, familyPostingRange.length).map((rowId) =>
        decodeRecord(strings, recordRows, rowId)
      );
    },
    getAllRecords(): OccupationLeafStructureRecord[] {
      const records: OccupationLeafStructureRecord[] = [];

      for (let rowId = 0; rowId < recordRows.count; rowId += 1) {
        records.push(decodeRecord(strings, recordRows, rowId));
      }

      return records;
    }
  };
}

function parseManifest(contents: string, manifestPath: string, sourceName: string): OccupationLeafStructureArtifactManifest {
  const parsed = JSON.parse(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Occupation leaf-structure manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = parsed as Partial<OccupationLeafStructureArtifactManifest>;

  if (
    manifest.schemaVersion !== LEAF_STRUCTURE_BINARY_SCHEMA_VERSION ||
    manifest.sourceName !== sourceName ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.count) ||
    !isNonNegativeInteger(manifest.stringCount) ||
    !isNonNegativeInteger(manifest.familyPostingKeyCount) ||
    !isNonNegativeInteger(manifest.familyPostingCount) ||
    !isRecord(manifest.files) ||
    typeof manifest.files.strings !== 'string' ||
    typeof manifest.files.recordRows !== 'string' ||
    typeof manifest.files.familyPostings !== 'string' ||
    typeof manifest.files.familyPostingRows !== 'string'
  ) {
    throw new Error(`Invalid occupation leaf-structure manifest shape in ${manifestPath}`);
  }

  return manifest as OccupationLeafStructureArtifactManifest;
}

export function buildOccupationLeafStructureBinaryFiles(
  records: OccupationLeafStructureRecord[],
  prefix: string
): {
  manifestFiles: OccupationLeafStructureArtifactManifest['files'];
  buffers: Map<string, Buffer>;
  stringCount: number;
  familyPostingKeyCount: number;
  familyPostingCount: number;
} {
  const sortedRecords = [...records].sort((left, right) => left.graphNodeId - right.graphNodeId);
  const strings = collectStrings(sortedRecords);
  const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
  const recordRows = sortedRecords.map((record) => [
    record.graphNodeId,
    requiredStringId(stringIdByValue, record.canonicalLabel),
    nullableNumber(record.familyNodeId),
    nullableNumber(record.groupNodeId),
    nullableNumber(record.parentNodeId),
    enumCode(LEAF_BASE_ROLE_KINDS, record.baseRoleKind, 'baseRoleKind'),
    enumCode(LEAF_AUTHORITY_KINDS, record.authorityKind, 'authorityKind'),
    specializationMask(record.specializationKinds),
    record.headPreservingSpecialization ? 1 : 0,
    enumCode(LEAF_RISK_LEVELS, record.broadAliasRisk, 'broadAliasRisk'),
    enumCode(LEAF_RISK_LEVELS, record.capabilityDominanceRisk, 'capabilityDominanceRisk')
  ]);
  const rowIdByGraphNodeId = new Map(sortedRecords.map((record, rowId) => [record.graphNodeId, rowId]));
  const familyPostingRows: number[] = [];
  const familyPostings = Array.from(groupFamilyRowIds(sortedRecords, rowIdByGraphNodeId).entries())
    .map(([familyNodeId, rowIds]) => {
      const offset = familyPostingRows.length;
      const sortedRowIds = [...rowIds].sort((left, right) => compareRecordRows(sortedRecords[left] ?? null, sortedRecords[right] ?? null));
      familyPostingRows.push(...sortedRowIds);
      return [familyNodeId, offset, sortedRowIds.length];
    })
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
  const files = {
    strings: `${prefix}.strings.bin`,
    recordRows: `${prefix}.record-rows.bin`,
    familyPostings: `${prefix}.family-postings.idx`,
    familyPostingRows: `${prefix}.family-posting-rows.bin`
  };

  return {
    manifestFiles: files,
    buffers: new Map([
      [files.strings, writeStringTable(strings)],
      [files.recordRows, writeFixedTable(recordRows, LEAF_STRUCTURE_ROW_WIDTH)],
      [files.familyPostings, writeFixedTable(familyPostings, LEAF_STRUCTURE_FAMILY_POSTING_ROW_WIDTH)],
      [files.familyPostingRows, writeUint32Rows(familyPostingRows)]
    ]),
    stringCount: strings.length,
    familyPostingKeyCount: familyPostings.length,
    familyPostingCount: familyPostingRows.length
  };
}

function decodeRecord(strings: BinaryStringTable, recordRows: FixedTable, rowId: number): OccupationLeafStructureRecord {
  return {
    graphNodeId: rowValue(recordRows, rowId, 0),
    canonicalLabel: stringAt(strings, rowValue(recordRows, rowId, 1)),
    familyNodeId: nullableRowValue(recordRows, rowId, 2),
    groupNodeId: nullableRowValue(recordRows, rowId, 3),
    parentNodeId: nullableRowValue(recordRows, rowId, 4),
    baseRoleKind: LEAF_BASE_ROLE_KINDS[rowValue(recordRows, rowId, 5)] ?? LEAF_BASE_ROLE_KINDS[0],
    authorityKind: LEAF_AUTHORITY_KINDS[rowValue(recordRows, rowId, 6)] ?? LEAF_AUTHORITY_KINDS[0],
    specializationKinds: specializationKindsFromMask(rowValue(recordRows, rowId, 7)),
    headPreservingSpecialization: rowValue(recordRows, rowId, 8) === 1,
    broadAliasRisk: LEAF_RISK_LEVELS[rowValue(recordRows, rowId, 9)] ?? LEAF_RISK_LEVELS[0],
    capabilityDominanceRisk: LEAF_RISK_LEVELS[rowValue(recordRows, rowId, 10)] ?? LEAF_RISK_LEVELS[0]
  };
}

function closeOccupationLeafStructureArtifact(artifact: OccupationLeafStructureArtifact): void {
  closeFixedTable(artifact.recordRows);
  closeFixedTable(artifact.familyPostings);
  closeUint32Rows(artifact.familyPostingRows);
}

function findRecordRowId(recordRows: FixedTable, graphNodeId: number): number | null {
  let low = 0;
  let high = recordRows.count - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const current = rowValue(recordRows, mid, 0);

    if (current < graphNodeId) {
      low = mid + 1;
    } else if (current > graphNodeId) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  return null;
}

function compareRecordRows(left: OccupationLeafStructureRecord | null, right: OccupationLeafStructureRecord | null): number {
  if (!left || !right) {
    return 0;
  }

  return left.canonicalLabel.localeCompare(right.canonicalLabel) || left.graphNodeId - right.graphNodeId;
}

function collectStrings(records: OccupationLeafStructureRecord[]): string[] {
  return [...new Set(records.map((record) => record.canonicalLabel))].sort((left, right) => left.localeCompare(right));
}

function groupFamilyRowIds(records: OccupationLeafStructureRecord[], rowIdByGraphNodeId: Map<number, number>): Map<number, number[]> {
  const familyRowIds = new Map<number, number[]>();

  for (const record of records) {
    if (record.familyNodeId === null) {
      continue;
    }

    const rowIds = familyRowIds.get(record.familyNodeId) ?? [];
    rowIds.push(requiredRowId(rowIdByGraphNodeId, record.graphNodeId));
    familyRowIds.set(record.familyNodeId, rowIds);
  }

  return familyRowIds;
}

function specializationMask(kinds: OccupationLeafStructureRecord['specializationKinds']): number {
  let mask = 0;

  for (const kind of kinds) {
    const index = LEAF_SPECIALIZATION_KINDS.indexOf(kind);

    if (index >= 0) {
      mask |= 1 << index;
    }
  }

  return mask >>> 0;
}

function specializationKindsFromMask(mask: number): OccupationLeafStructureRecord['specializationKinds'] {
  const kinds: OccupationLeafStructureRecord['specializationKinds'] = [];

  for (let index = 0; index < LEAF_SPECIALIZATION_KINDS.length; index += 1) {
    if ((mask & (1 << index)) !== 0) {
      kinds.push(LEAF_SPECIALIZATION_KINDS[index] ?? LEAF_SPECIALIZATION_KINDS[0]);
    }
  }

  return kinds;
}

function nullableNumber(value: number | null): number {
  return value === null ? LEAF_STRUCTURE_NULL_U32 : value;
}

function nullableRowValue(table: FixedTable, rowId: number, columnId: number): number | null {
  const value = rowValue(table, rowId, columnId);
  return value === LEAF_STRUCTURE_NULL_U32 ? null : value;
}

function enumCode<T extends readonly string[]>(values: T, value: string, fieldName: string): number {
  const index = values.indexOf(value as T[number]);

  if (index < 0) {
    throw new Error(`Unknown ${fieldName}: ${value}`);
  }

  return index;
}

function requiredStringId(stringIdByValue: Map<string, number>, value: string): number {
  const stringId = stringIdByValue.get(value);

  if (stringId === undefined) {
    throw new Error(`Missing string id for "${value}"`);
  }

  return stringId;
}

function requiredRowId(rowIdByGraphNodeId: Map<number, number>, graphNodeId: number): number {
  const rowId = rowIdByGraphNodeId.get(graphNodeId);

  if (rowId === undefined) {
    throw new Error(`Missing row id for graph node ${graphNodeId}`);
  }

  return rowId;
}
