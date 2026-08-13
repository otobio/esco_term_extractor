import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import {
  findRange,
  readFileBackedFixedTableSync,
  readFixedTable,
  readStringTable,
  readUint32Rows,
  rowValue,
  stringAt,
  writeFixedTable,
  writeStringTable,
  writeUint32Rows,
  type BinaryStringTable,
  type FixedTable
} from '../utils/binary-table.js';
import {
  configuredRuntimeArtifactCacheSize,
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../utils/runtime-artifact-cache.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';

export const SEARCH_META_BINARY_SCHEMA_VERSION = 2;
export const SEARCH_META_NULL_U32 = 0xffffffff;
/**
 * Detail decoding touches a short contiguous run of alias/capability rows per
 * node, scattered across the table. Small pages keep each miss cheap to
 * allocate while a deeper page cache still absorbs the scatter.
 */
const DETAIL_ROW_PAGING = { pageRowCount: 512, maxPages: 48 };

const DEFAULT_SEARCH_META_CORE_CACHE_SIZE = 256;
const DEFAULT_SEARCH_META_DETAILS_CACHE_SIZE = 128;
const DEFAULT_SEARCH_META_ARTIFACT_CACHE_SIZE = 2;

const GENERIC_RISKS = ['low', 'medium', 'high'] as const;
const ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone'] as const;
const CAPABILITY_TYPES = ['skill', 'knowledge', 'tool', 'software', 'language'] as const;
const SCORE_SCALE = 1_000_000;

const CORE_ROW_WIDTH = 16;
const ANCESTOR_ROW_WIDTH = 5;
const SIBLING_ROW_WIDTH = 5;
const FAMILY_LEAF_POSTING_ROW_WIDTH = 3;
const DETAIL_ROW_WIDTH = 5;
const ALIAS_ROW_WIDTH = 7;
const CAPABILITY_ROW_WIDTH = 6;

export type RuntimeGenericRisk = (typeof GENERIC_RISKS)[number];

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
  aliasRole: (typeof ALIAS_ROLES)[number];
  isPrimary: boolean;
  confidence: number | null;
  weight: number | null;
};

export type RuntimeCapabilityRecord = {
  capabilityId: number;
  capabilityType: (typeof CAPABILITY_TYPES)[number];
  label: string;
  normalizedLabel: string;
  hintKind: string;
  weight: number | null;
};

export type RuntimeSearchMetaCoreRecord = {
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
};

export type RuntimeSearchMetaRecord = RuntimeSearchMetaCoreRecord & {
  aliases: RuntimeAliasRecord[];
  capabilityLabels: RuntimeCapabilityRecord[];
};

export type RuntimeSearchMetaDetails = {
  graphNodeId: number;
  aliases: RuntimeAliasRecord[];
  capabilityLabels: RuntimeCapabilityRecord[];
};

export type OccupationSearchMetaArtifactManifest = {
  schemaVersion: 2;
  sourceName: string;
  generatedAt: string;
  count: number;
  stringCount: number;
  ancestorCount: number;
  siblingCount: number;
  familyLeafPostingKeyCount: number;
  familyLeafPostingCount: number;
  detailCount: number;
  aliasCount: number;
  capabilityCount: number;
  files: {
    strings: string;
    coreRows: string;
    ancestorRows: string;
    siblingRows: string;
    familyLeafPostings: string;
    familyLeafPostingRows: string;
    detailRows: string;
    aliasRows: string;
    capabilityRows: string;
  };
};

export type SearchMetaArtifactCacheEntry = {
  manifestPath: string;
  manifest: OccupationSearchMetaArtifactManifest;
  artifact: OccupationSearchMetaArtifactManifest;
  directory: string;
  strings: BinaryStringTable;
  coreRows: FixedTable;
  ancestorRows: FixedTable;
  siblingRows: FixedTable;
  familyLeafPostings: FixedTable;
  familyLeafPostingRows: Uint32Array;
  detailRows: FixedTable;
  readonly aliasRows: FixedTable;
  readonly capabilityRows: FixedTable;
  getCoreRecord(graphNodeId: number): RuntimeSearchMetaCoreRecord | null;
  getCoreRecordByRowId(rowId: number): RuntimeSearchMetaCoreRecord | null;
  getDetails(graphNodeId: number): RuntimeSearchMetaDetails | null;
  getAliases(graphNodeId: number): RuntimeAliasRecord[];
  getCapabilityLabels(graphNodeId: number): RuntimeCapabilityRecord[];
  getAncestors(graphNodeId: number): RuntimeAncestorRecord[];
  getSiblings(graphNodeId: number, limit?: number): RuntimeSiblingRecord[];
  getLeafCoreRecordsForFamilies(familyNodeIds: number[]): RuntimeSearchMetaCoreRecord[];
  getAllCoreRecords(): RuntimeSearchMetaCoreRecord[];
  getAllRecordsWithDetails(): RuntimeSearchMetaRecord[];
};

export type SearchMetaBinaryBuildResult = {
  manifestFiles: OccupationSearchMetaArtifactManifest['files'];
  buffers: Map<string, Buffer>;
  counts: {
    stringCount: number;
    ancestorCount: number;
    siblingCount: number;
    familyLeafPostingKeyCount: number;
    familyLeafPostingCount: number;
    detailCount: number;
    aliasCount: number;
    capabilityCount: number;
  };
};

const CACHE = new Map<string, RuntimeArtifactCacheEntry<SearchMetaArtifactCacheEntry>>();

export function defaultOccupationSearchMetaManifestPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-search-meta.${safeFileSegment(sourceName)}.manifest.json`);
}

export function defaultOccupationSearchMetaRecordsPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-search-meta.${safeFileSegment(sourceName)}.core-rows.bin`);
}

export function defaultOccupationSearchMetaDetailsPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-search-meta.${safeFileSegment(sourceName)}.detail-rows.bin`);
}

export async function loadOccupationSearchMetaArtifactIfAvailable(sourceName: string): Promise<SearchMetaArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationSearchMetaManifestPath(sourceName);
  const cacheKey = path.resolve(manifestPath);
  return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_SEARCH_META_ARTIFACT_CACHE_SIZE', DEFAULT_SEARCH_META_ARTIFACT_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName)
  });
}

export async function loadOccupationSearchMetaArtifactRequired(sourceName: string): Promise<SearchMetaArtifactCacheEntry> {
  const manifestPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH') ?? defaultOccupationSearchMetaManifestPath(sourceName);
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
  return loadOccupationSearchMetaArtifactRequired(sourceName);
}

export async function hydrateRuntimeSearchMetaRecords(
  artifactEntry: SearchMetaArtifactCacheEntry,
  records: RuntimeSearchMetaCoreRecord[]
): Promise<RuntimeSearchMetaRecord[]> {
  return records.map((record) => attachDetails(artifactEntry, record));
}

export async function hydrateAllRuntimeSearchMetaRecords(
  artifactEntry: SearchMetaArtifactCacheEntry,
  records: RuntimeSearchMetaCoreRecord[]
): Promise<RuntimeSearchMetaRecord[]> {
  return hydrateRuntimeSearchMetaRecords(artifactEntry, records);
}

export async function hydrateRuntimeSearchMetaRecord(
  artifactEntry: SearchMetaArtifactCacheEntry,
  record: RuntimeSearchMetaCoreRecord
): Promise<RuntimeSearchMetaRecord> {
  return attachDetails(artifactEntry, record);
}

export function buildOccupationSearchMetaBinaryFiles(records: RuntimeSearchMetaRecord[], prefix: string): SearchMetaBinaryBuildResult {
  const strings = collectStrings(records);
  const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
  const ancestorRows: number[][] = [];
  const siblingRows: number[][] = [];
  const aliasRows: number[][] = [];
  const capabilityRows: number[][] = [];
  const detailRows: number[][] = [];
  const familyPostingRows: number[] = [];
  const familyPostingsByFamilyNodeId = new Map<number, number[]>();
  const sortedRecords = [...records].sort((left, right) => left.graphNodeId - right.graphNodeId);
  const rowIdByGraphNodeId = new Map(sortedRecords.map((record, index) => [record.graphNodeId, index]));
  const coreRows = sortedRecords.map((record) => {
    const ancestorOffset = ancestorRows.length;
    for (const ancestor of record.ancestors) {
      ancestorRows.push([
        ancestor.graphNodeId,
        requiredStringId(stringIdByValue, ancestor.canonicalLabel),
        requiredStringId(stringIdByValue, ancestor.nodeLevel),
        ancestor.distanceFromLeaf,
        requiredStringId(stringIdByValue, ancestor.ancestorRole)
      ]);
    }

    const siblingOffset = siblingRows.length;
    for (const sibling of record.siblings) {
      siblingRows.push([
        sibling.graphNodeId,
        requiredStringId(stringIdByValue, sibling.canonicalLabel),
        requiredStringId(stringIdByValue, sibling.nodeLevel),
        requiredStringId(stringIdByValue, sibling.siblingKind),
        scoreCode(sibling.weight)
      ]);
    }

    const aliasOffset = aliasRows.length;
    for (const alias of record.aliases) {
      aliasRows.push([
        requiredStringId(stringIdByValue, alias.localeCode),
        requiredStringId(stringIdByValue, alias.alias),
        alias.alias === alias.normalizedAlias ? SEARCH_META_NULL_U32 : requiredStringId(stringIdByValue, alias.normalizedAlias),
        enumCode(ALIAS_ROLES, alias.aliasRole, 'aliasRole'),
        alias.isPrimary ? 1 : 0,
        scoreCode(alias.confidence),
        scoreCode(alias.weight)
      ]);
    }

    const capabilityOffset = capabilityRows.length;
    for (const capability of record.capabilityLabels) {
      capabilityRows.push([
        capability.capabilityId,
        enumCode(CAPABILITY_TYPES, capability.capabilityType, 'capabilityType'),
        requiredStringId(stringIdByValue, capability.label),
        capability.label === capability.normalizedLabel
          ? SEARCH_META_NULL_U32
          : requiredStringId(stringIdByValue, capability.normalizedLabel),
        requiredStringId(stringIdByValue, capability.hintKind),
        scoreCode(capability.weight)
      ]);
    }

    detailRows.push([record.graphNodeId, aliasOffset, record.aliases.length, capabilityOffset, record.capabilityLabels.length]);

    if (record.familyNodeId !== null) {
      const postings = familyPostingsByFamilyNodeId.get(record.familyNodeId) ?? [];
      postings.push(requiredRowId(rowIdByGraphNodeId, record.graphNodeId));
      familyPostingsByFamilyNodeId.set(record.familyNodeId, postings);
    }

    return [
      record.graphNodeId,
      record.searchMetaId,
      requiredStringId(stringIdByValue, record.canonicalLabel),
      enumCode(GENERIC_RISKS, record.genericRisk, 'genericRisk'),
      record.hasHierarchy ? 1 : 0,
      record.hasCapabilitySupport ? 1 : 0,
      nullableNumber(record.familyNodeId),
      nullableStringId(stringIdByValue, record.familyLabel),
      nullableNumber(record.groupNodeId),
      nullableStringId(stringIdByValue, record.groupLabel),
      nullableNumber(record.parentNodeId),
      nullableStringId(stringIdByValue, record.parentLabel),
      ancestorOffset,
      record.ancestors.length,
      siblingOffset,
      record.siblings.length
    ];
  });

  const familyLeafPostings = Array.from(familyPostingsByFamilyNodeId.entries())
    .map(([familyNodeId, rowIds]) => {
      const offset = familyPostingRows.length;
      const sortedRowIds = rowIds.sort((left, right) => {
        const leftRecord = sortedRecords[left] as RuntimeSearchMetaRecord;
        const rightRecord = sortedRecords[right] as RuntimeSearchMetaRecord;
        return leftRecord.canonicalLabel.localeCompare(rightRecord.canonicalLabel) || leftRecord.graphNodeId - rightRecord.graphNodeId;
      });
      familyPostingRows.push(...sortedRowIds);
      return [familyNodeId, offset, sortedRowIds.length];
    })
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));

  const files = {
    strings: `${prefix}.strings.bin`,
    coreRows: `${prefix}.core-rows.bin`,
    ancestorRows: `${prefix}.ancestor-rows.bin`,
    siblingRows: `${prefix}.sibling-rows.bin`,
    familyLeafPostings: `${prefix}.family-leaf-postings.idx`,
    familyLeafPostingRows: `${prefix}.family-leaf-posting-rows.bin`,
    detailRows: `${prefix}.detail-rows.bin`,
    aliasRows: `${prefix}.alias-rows.bin`,
    capabilityRows: `${prefix}.capability-rows.bin`
  };

  return {
    manifestFiles: files,
    buffers: new Map([
      [files.strings, writeStringTable(strings)],
      [files.coreRows, writeFixedTable(coreRows, CORE_ROW_WIDTH)],
      [files.ancestorRows, writeFixedTable(ancestorRows, ANCESTOR_ROW_WIDTH)],
      [files.siblingRows, writeFixedTable(siblingRows, SIBLING_ROW_WIDTH)],
      [files.familyLeafPostings, writeFixedTable(familyLeafPostings, FAMILY_LEAF_POSTING_ROW_WIDTH)],
      [files.familyLeafPostingRows, writeUint32Rows(familyPostingRows)],
      [files.detailRows, writeFixedTable(detailRows, DETAIL_ROW_WIDTH)],
      [files.aliasRows, writeFixedTable(aliasRows, ALIAS_ROW_WIDTH)],
      [files.capabilityRows, writeFixedTable(capabilityRows, CAPABILITY_ROW_WIDTH)]
    ]),
    counts: {
      stringCount: strings.length,
      ancestorCount: ancestorRows.length,
      siblingCount: siblingRows.length,
      familyLeafPostingKeyCount: familyLeafPostings.length,
      familyLeafPostingCount: familyPostingRows.length,
      detailCount: detailRows.length,
      aliasCount: aliasRows.length,
      capabilityCount: capabilityRows.length
    }
  };
}

async function loadArtifact(manifestPath: string, sourceName: string): Promise<SearchMetaArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown, manifestPath);

  if (manifest.sourceName !== sourceName) {
    return null;
  }

  const directory = path.dirname(manifestPath);
  const aliasRowsPath = path.resolve(directory, manifest.files.aliasRows);
  const capabilityRowsPath = path.resolve(directory, manifest.files.capabilityRows);
  let aliasRows: FixedTable | null = null;
  let capabilityRows: FixedTable | null = null;
  const entryBase = {
    manifestPath,
    manifest,
    artifact: manifest,
    directory,
    strings: await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
    coreRows: await readFixedTable(path.resolve(directory, manifest.files.coreRows), CORE_ROW_WIDTH, manifest.count),
    ancestorRows: await readFixedTable(path.resolve(directory, manifest.files.ancestorRows), ANCESTOR_ROW_WIDTH, manifest.ancestorCount),
    siblingRows: await readFixedTable(path.resolve(directory, manifest.files.siblingRows), SIBLING_ROW_WIDTH, manifest.siblingCount),
    familyLeafPostings: await readFixedTable(
      path.resolve(directory, manifest.files.familyLeafPostings),
      FAMILY_LEAF_POSTING_ROW_WIDTH,
      manifest.familyLeafPostingKeyCount
    ),
    familyLeafPostingRows: await readUint32Rows(path.resolve(directory, manifest.files.familyLeafPostingRows)),
    detailRows: await readFixedTable(path.resolve(directory, manifest.files.detailRows), DETAIL_ROW_WIDTH, manifest.detailCount)
  };
  const coreCache = new Map<number, RuntimeSearchMetaCoreRecord>();
  const detailsCache = new Map<number, RuntimeSearchMetaDetails>();
  const entry: SearchMetaArtifactCacheEntry = {
    ...entryBase,
    // Alias and capability rows are only read as short contiguous runs while
    // decoding a single node's details, so they stay paged from disk instead of
    // holding the full tables (22MiB + 1.5MiB) resident. Defined as getters on
    // `entry` itself — spreading them from another object would invoke them.
    get aliasRows(): FixedTable {
      aliasRows ??= readFileBackedFixedTableSync(aliasRowsPath, ALIAS_ROW_WIDTH, manifest.aliasCount, DETAIL_ROW_PAGING);
      return aliasRows;
    },
    get capabilityRows(): FixedTable {
      capabilityRows ??= readFileBackedFixedTableSync(
        capabilityRowsPath,
        CAPABILITY_ROW_WIDTH,
        manifest.capabilityCount,
        DETAIL_ROW_PAGING
      );
      return capabilityRows;
    },
    getCoreRecord(graphNodeId: number): RuntimeSearchMetaCoreRecord | null {
      const rowId = findRowByFirstColumn(entryBase.coreRows, graphNodeId);
      return rowId < 0 ? null : this.getCoreRecordByRowId(rowId);
    },
    getCoreRecordByRowId(rowId: number): RuntimeSearchMetaCoreRecord | null {
      if (rowId < 0 || rowId >= entryBase.coreRows.count) {
        return null;
      }

      const graphNodeId = rowValue(entryBase.coreRows, rowId, 0);
      const cached = coreCache.get(graphNodeId);

      if (cached) {
        coreCache.delete(graphNodeId);
        coreCache.set(graphNodeId, cached);
        return cached;
      }

      const record = decodeCoreRecord(entry, rowId);
      coreCache.set(graphNodeId, record);
      trimSearchMetaCache(coreCache, configuredSearchMetaCoreCacheSize());
      return record;
    },
    getDetails(graphNodeId: number): RuntimeSearchMetaDetails | null {
      const cached = detailsCache.get(graphNodeId);

      if (cached) {
        detailsCache.delete(graphNodeId);
        detailsCache.set(graphNodeId, cached);
        return cached;
      }

      const rowId = findRowByFirstColumn(entryBase.detailRows, graphNodeId);

      if (rowId < 0) {
        return null;
      }

      const details = decodeDetails(entry, rowId);
      detailsCache.set(graphNodeId, details);
      trimSearchMetaCache(detailsCache, configuredSearchMetaDetailsCacheSize());
      return details;
    },
    getAliases(graphNodeId: number): RuntimeAliasRecord[] {
      return this.getDetails(graphNodeId)?.aliases ?? [];
    },
    getCapabilityLabels(graphNodeId: number): RuntimeCapabilityRecord[] {
      return this.getDetails(graphNodeId)?.capabilityLabels ?? [];
    },
    getAncestors(graphNodeId: number): RuntimeAncestorRecord[] {
      return this.getCoreRecord(graphNodeId)?.ancestors ?? [];
    },
    getSiblings(graphNodeId: number, limit?: number): RuntimeSiblingRecord[] {
      const siblings = this.getCoreRecord(graphNodeId)?.siblings ?? [];
      return limit === undefined ? siblings : siblings.slice(0, limit);
    },
    getLeafCoreRecordsForFamilies(familyNodeIds: number[]): RuntimeSearchMetaCoreRecord[] {
      const records: RuntimeSearchMetaCoreRecord[] = [];

      for (const familyNodeId of familyNodeIds) {
        const range = findRange(entryBase.familyLeafPostings, [familyNodeId]);

        if (!range) {
          continue;
        }

        for (let cursor = range.offset; cursor < range.offset + range.length; cursor += 1) {
          const rowId = entryBase.familyLeafPostingRows[cursor] ?? SEARCH_META_NULL_U32;
          const record = this.getCoreRecordByRowId(rowId);

          if (record) {
            records.push(record);
          }
        }
      }

      return records.sort(
        (left, right) => (left.familyNodeId ?? 0) - (right.familyNodeId ?? 0) || left.canonicalLabel.localeCompare(right.canonicalLabel)
      );
    },
    getAllCoreRecords(): RuntimeSearchMetaCoreRecord[] {
      const records: RuntimeSearchMetaCoreRecord[] = [];

      for (let rowId = 0; rowId < entryBase.coreRows.count; rowId += 1) {
        const record = this.getCoreRecordByRowId(rowId);
        if (record) records.push(record);
      }

      return records;
    },
    getAllRecordsWithDetails(): RuntimeSearchMetaRecord[] {
      return this.getAllCoreRecords().map((record) => attachDetails(entry, record));
    }
  } satisfies SearchMetaArtifactCacheEntry;

  return entry;
}

function trimSearchMetaCache<T>(cache: Map<number, T>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value as number | undefined;

    if (oldestKey === undefined) {
      return;
    }

    cache.delete(oldestKey);
  }
}

function configuredSearchMetaCoreCacheSize(): number {
  return readPositiveIntegerEnv('OSE_SEARCH_META_CORE_CACHE_SIZE', DEFAULT_SEARCH_META_CORE_CACHE_SIZE);
}

function configuredSearchMetaDetailsCacheSize(): number {
  return readPositiveIntegerEnv('OSE_SEARCH_META_DETAILS_CACHE_SIZE', DEFAULT_SEARCH_META_DETAILS_CACHE_SIZE);
}

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const rawValue = readOptionalEnv(key);

  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}

function validateManifest(value: unknown, manifestPath: string): OccupationSearchMetaArtifactManifest {
  if (!isRecord(value)) {
    throw new Error(`Occupation search-meta manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = value as Partial<OccupationSearchMetaArtifactManifest>;

  if (
    manifest.schemaVersion !== SEARCH_META_BINARY_SCHEMA_VERSION ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.count) ||
    !isNonNegativeInteger(manifest.stringCount) ||
    !isNonNegativeInteger(manifest.ancestorCount) ||
    !isNonNegativeInteger(manifest.siblingCount) ||
    !isNonNegativeInteger(manifest.familyLeafPostingKeyCount) ||
    !isNonNegativeInteger(manifest.familyLeafPostingCount) ||
    !isNonNegativeInteger(manifest.detailCount) ||
    !isNonNegativeInteger(manifest.aliasCount) ||
    !isNonNegativeInteger(manifest.capabilityCount) ||
    !isRecord(manifest.files)
  ) {
    throw new Error(`Invalid occupation search-meta manifest metadata at ${manifestPath}.`);
  }

  for (const value of Object.values(manifest.files)) {
    if (typeof value !== 'string') {
      throw new Error(`Invalid occupation search-meta file path in manifest at ${manifestPath}.`);
    }
  }

  return manifest as OccupationSearchMetaArtifactManifest;
}

function decodeCoreRecord(entry: SearchMetaArtifactCacheEntry, rowId: number): RuntimeSearchMetaCoreRecord {
  const row = entry.coreRows;
  const graphNodeId = rowValue(row, rowId, 0);
  const ancestorOffset = rowValue(row, rowId, 12);
  const ancestorCount = rowValue(row, rowId, 13);
  const siblingOffset = rowValue(row, rowId, 14);
  const siblingCount = rowValue(row, rowId, 15);

  return {
    graphNodeId,
    searchMetaId: rowValue(row, rowId, 1),
    canonicalLabel: stringAt(entry.strings, rowValue(row, rowId, 2)),
    genericRisk: GENERIC_RISKS[rowValue(row, rowId, 3)] ?? 'medium',
    hasHierarchy: rowValue(row, rowId, 4) === 1,
    hasCapabilitySupport: rowValue(row, rowId, 5) === 1,
    familyNodeId: nullableRowNumber(rowValue(row, rowId, 6)),
    familyLabel: nullableRowString(entry.strings, rowValue(row, rowId, 7)),
    groupNodeId: nullableRowNumber(rowValue(row, rowId, 8)),
    groupLabel: nullableRowString(entry.strings, rowValue(row, rowId, 9)),
    parentNodeId: nullableRowNumber(rowValue(row, rowId, 10)),
    parentLabel: nullableRowString(entry.strings, rowValue(row, rowId, 11)),
    ancestors: decodeAncestors(entry, ancestorOffset, ancestorCount),
    siblings: decodeSiblings(entry, siblingOffset, siblingCount)
  };
}

function decodeAncestors(entry: SearchMetaArtifactCacheEntry, offset: number, count: number): RuntimeAncestorRecord[] {
  const ancestors: RuntimeAncestorRecord[] = [];

  for (let rowId = offset; rowId < offset + count; rowId += 1) {
    ancestors.push({
      graphNodeId: rowValue(entry.ancestorRows, rowId, 0),
      canonicalLabel: stringAt(entry.strings, rowValue(entry.ancestorRows, rowId, 1)),
      nodeLevel: stringAt(entry.strings, rowValue(entry.ancestorRows, rowId, 2)),
      distanceFromLeaf: rowValue(entry.ancestorRows, rowId, 3),
      ancestorRole: stringAt(entry.strings, rowValue(entry.ancestorRows, rowId, 4))
    });
  }

  return ancestors;
}

function decodeSiblings(entry: SearchMetaArtifactCacheEntry, offset: number, count: number): RuntimeSiblingRecord[] {
  const siblings: RuntimeSiblingRecord[] = [];

  for (let rowId = offset; rowId < offset + count; rowId += 1) {
    siblings.push({
      graphNodeId: rowValue(entry.siblingRows, rowId, 0),
      canonicalLabel: stringAt(entry.strings, rowValue(entry.siblingRows, rowId, 1)),
      nodeLevel: stringAt(entry.strings, rowValue(entry.siblingRows, rowId, 2)),
      siblingKind: stringAt(entry.strings, rowValue(entry.siblingRows, rowId, 3)),
      weight: scoreValue(rowValue(entry.siblingRows, rowId, 4))
    });
  }

  return siblings;
}

function decodeDetails(entry: SearchMetaArtifactCacheEntry, rowId: number): RuntimeSearchMetaDetails {
  const graphNodeId = rowValue(entry.detailRows, rowId, 0);
  const aliasOffset = rowValue(entry.detailRows, rowId, 1);
  const aliasCount = rowValue(entry.detailRows, rowId, 2);
  const capabilityOffset = rowValue(entry.detailRows, rowId, 3);
  const capabilityCount = rowValue(entry.detailRows, rowId, 4);

  return {
    graphNodeId,
    aliases: decodeAliases(entry, aliasOffset, aliasCount),
    capabilityLabels: decodeCapabilityLabels(entry, capabilityOffset, capabilityCount)
  };
}

function decodeAliases(entry: SearchMetaArtifactCacheEntry, offset: number, count: number): RuntimeAliasRecord[] {
  const aliases: RuntimeAliasRecord[] = [];
  // A node carries ~270 alias rows, so resolve the paged table once instead of
  // re-entering the lazy getter (and re-locating the page) for all seven columns
  // of every row.
  const rows = entry.aliasRows;
  const strings = entry.strings;

  for (let rowId = offset; rowId < offset + count; rowId += 1) {
    const alias = stringAt(strings, rowValue(rows, rowId, 1));
    const normalizedAliasId = rowValue(rows, rowId, 2);
    aliases.push({
      localeCode: internedStringAt(strings, rowValue(rows, rowId, 0)),
      alias,
      normalizedAlias: normalizedAliasId === SEARCH_META_NULL_U32 ? alias : stringAt(strings, normalizedAliasId),
      aliasRole: ALIAS_ROLES[rowValue(rows, rowId, 3)] ?? 'locale_supporting',
      isPrimary: rowValue(rows, rowId, 4) === 1,
      confidence: scoreValue(rowValue(rows, rowId, 5)),
      weight: scoreValue(rowValue(rows, rowId, 6))
    });
  }

  return aliases;
}

/**
 * Decoded rows repeat a handful of columns drawn from a tiny closed set — every
 * alias row names one of four locale codes, every capability row one of a few
 * hint kinds. `stringAt` materialises a fresh string per call, so decoding a
 * single node minted hundreds of duplicates. Interning by string-table id keeps
 * one instance per distinct value; the pool is bounded by the number of distinct
 * values in those columns, not by the number of rows read.
 */
const INTERNED_STRINGS_BY_TABLE = new WeakMap<BinaryStringTable, Map<number, string>>();

function internedStringAt(strings: BinaryStringTable, stringId: number): string {
  let pool = INTERNED_STRINGS_BY_TABLE.get(strings);

  if (!pool) {
    pool = new Map<number, string>();
    INTERNED_STRINGS_BY_TABLE.set(strings, pool);
  }

  const pooled = pool.get(stringId);

  if (pooled !== undefined) {
    return pooled;
  }

  const value = stringAt(strings, stringId);
  pool.set(stringId, value);
  return value;
}

function decodeCapabilityLabels(entry: SearchMetaArtifactCacheEntry, offset: number, count: number): RuntimeCapabilityRecord[] {
  const capabilities: RuntimeCapabilityRecord[] = [];
  const rows = entry.capabilityRows;
  const strings = entry.strings;

  for (let rowId = offset; rowId < offset + count; rowId += 1) {
    const label = stringAt(strings, rowValue(rows, rowId, 2));
    const normalizedLabelId = rowValue(rows, rowId, 3);
    capabilities.push({
      capabilityId: rowValue(rows, rowId, 0),
      capabilityType: CAPABILITY_TYPES[rowValue(rows, rowId, 1)] ?? 'skill',
      label,
      normalizedLabel: normalizedLabelId === SEARCH_META_NULL_U32 ? label : stringAt(strings, normalizedLabelId),
      hintKind: internedStringAt(strings, rowValue(rows, rowId, 4)),
      weight: scoreValue(rowValue(rows, rowId, 5))
    });
  }

  return capabilities;
}

function attachDetails(entry: SearchMetaArtifactCacheEntry, record: RuntimeSearchMetaCoreRecord): RuntimeSearchMetaRecord {
  const details = entry.getDetails(record.graphNodeId);

  return {
    ...record,
    aliases: details?.aliases ?? [],
    capabilityLabels: details?.capabilityLabels ?? []
  };
}

function collectStrings(records: RuntimeSearchMetaRecord[]): string[] {
  const strings = new Set<string>();

  for (const record of records) {
    strings.add(record.canonicalLabel);
    addNullableString(strings, record.familyLabel);
    addNullableString(strings, record.groupLabel);
    addNullableString(strings, record.parentLabel);

    for (const ancestor of record.ancestors) {
      strings.add(ancestor.canonicalLabel);
      strings.add(ancestor.nodeLevel);
      strings.add(ancestor.ancestorRole);
    }

    for (const sibling of record.siblings) {
      strings.add(sibling.canonicalLabel);
      strings.add(sibling.nodeLevel);
      strings.add(sibling.siblingKind);
    }

    for (const alias of record.aliases) {
      strings.add(alias.localeCode);
      strings.add(alias.alias);
      strings.add(alias.normalizedAlias);
    }

    for (const capability of record.capabilityLabels) {
      strings.add(capability.label);
      strings.add(capability.normalizedLabel);
      strings.add(capability.hintKind);
    }
  }

  return Array.from(strings).sort();
}

function addNullableString(strings: Set<string>, value: string | null): void {
  if (value !== null) {
    strings.add(value);
  }
}

function nullableNumber(value: number | null): number {
  return value ?? SEARCH_META_NULL_U32;
}

function nullableStringId(stringIdByValue: Map<string, number>, value: string | null): number {
  return value === null ? SEARCH_META_NULL_U32 : requiredStringId(stringIdByValue, value);
}

function nullableRowNumber(value: number): number | null {
  return value === SEARCH_META_NULL_U32 ? null : value;
}

function nullableRowString(strings: BinaryStringTable, stringId: number): string | null {
  return stringId === SEARCH_META_NULL_U32 ? null : stringAt(strings, stringId);
}

function requiredStringId(stringIdByValue: Map<string, number>, value: string): number {
  const id = stringIdByValue.get(value);

  if (id === undefined) {
    throw new Error(`Missing string id for "${value}".`);
  }

  return id;
}

function requiredRowId(rowIdByGraphNodeId: Map<number, number>, graphNodeId: number): number {
  const rowId = rowIdByGraphNodeId.get(graphNodeId);

  if (rowId === undefined) {
    throw new Error(`Missing core row id for graph_node_id=${graphNodeId}.`);
  }

  return rowId;
}

function enumCode<T extends readonly string[]>(values: T, value: T[number], fieldName: string): number {
  const index = values.indexOf(value);

  if (index < 0) {
    throw new Error(`Unknown ${fieldName}: ${value}`);
  }

  return index;
}

function scoreCode(value: number | null): number {
  if (value === null) {
    return SEARCH_META_NULL_U32;
  }

  return Math.round(value * SCORE_SCALE);
}

function scoreValue(code: number): number | null {
  return code === SEARCH_META_NULL_U32 ? null : code / SCORE_SCALE;
}

function findRowByFirstColumn(table: FixedTable, key: number): number {
  let low = 0;
  let high = table.count - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const current = rowValue(table, mid, 0);

    if (current < key) {
      low = mid + 1;
    } else if (current > key) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  return -1;
}
