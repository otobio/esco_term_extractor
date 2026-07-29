import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { foldSearchLookupText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
import {
  closeFixedTable,
  closeUint32Rows,
  findRange,
  findStringId,
  readFileBackedFixedTableSync,
  readFileBackedUint32RowsSync,
  readFixedTable,
  readStringTable,
  rowValue,
  stringAt,
  uint32RowsSlice,
  uint32RowValue,
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

export const FAMILY_PROFILE_SOURCE_KINDS = ['family_label', 'alias', 'leaf_label', 'capability'] as const;
export const FAMILY_PROFILE_BINARY_SCHEMA_VERSION = 3;
export const FAMILY_PROFILE_NULL_U32 = 0xffffffff;
export const FAMILY_PROFILE_ROW_WIDTH = 7;
export const FAMILY_PROFILE_LOCALE_ROW_WIDTH = 4;
export const FAMILY_PROFILE_SOURCE_ROW_WIDTH = 5;
export const FAMILY_PROFILE_LEAF_TOKEN_INDEX_ROW_WIDTH = 4;
export const FAMILY_PROFILE_PROFILE_TOKEN_INDEX_ROW_WIDTH = 4;

export type RuntimeFamilyProfileSourceKind = (typeof FAMILY_PROFILE_SOURCE_KINDS)[number];

export type RuntimeFamilyProfileSource = {
  tokens: string[];
  phrases: string[];
};

export type RuntimeFamilyProfileLocaleRecord = {
  localeCode: string;
  sources: Record<RuntimeFamilyProfileSourceKind, RuntimeFamilyProfileSource>;
  leafIdsByToken: Array<[string, number[]]>;
};

export type RuntimeFamilyProfileRecord = {
  familyNodeId: number;
  familyLabel: string;
  groupNodeId: number | null;
  groupLabel: string | null;
  profileLeafCount: number;
  localeProfiles: RuntimeFamilyProfileLocaleRecord[];
};

export type OccupationFamilyProfileArtifactManifest = {
  schemaVersion: 3;
  sourceName: string;
  generatedAt: string;
  count: number;
  localeProfileCount: number;
  sourceRowCount: number;
  tokenValueCount: number;
  phraseValueCount: number;
  leafTokenKeyCount: number;
  leafIdCount: number;
  profileTokenKeyCount: number;
  profileTokenPostingCount: number;
  stringCount: number;
  files: {
    strings: string;
    profileRows: string;
    localeRows: string;
    sourceRows: string;
    tokenRows: string;
    phraseRows: string;
    leafTokenIndex: string;
    leafIdRows: string;
    profileTokenIndex: string;
    profileTokenRows: string;
  };
};

export type OccupationFamilyProfileArtifact = OccupationFamilyProfileArtifactManifest;

export type FamilyProfileCoreRecord = {
  rowId: number;
  familyNodeId: number;
  familyLabel: string;
  groupNodeId: number | null;
  groupLabel: string | null;
  profileLeafCount: number;
  localeOffset: number;
  localeCount: number;
};

export type FamilyProfileLocaleRecordRef = {
  rowId: number;
  localeCode: string;
  sourceOffset: number;
  sourceCount: number;
};

export type FamilyProfileSourceRef = {
  tokenOffset: number;
  tokenCount: number;
  phraseOffset: number;
  phraseCount: number;
};

export type FamilyProfileArtifactCacheEntry = {
  manifestPath: string;
  artifact: OccupationFamilyProfileArtifact;
  strings: BinaryStringTable;
  profileRows: FixedTable;
  localeRows: FixedTable;
  sourceRows: FixedTable;
  tokenRows: Uint32Array | FileBackedUint32Rows;
  phraseRows: Uint32Array | FileBackedUint32Rows;
  leafTokenIndex: FixedTable;
  leafIdRows: Uint32Array | FileBackedUint32Rows;
  profileTokenIndex: FixedTable;
  profileTokenRows: Uint32Array | FileBackedUint32Rows;
  getProfileCore(rowId: number): FamilyProfileCoreRecord | null;
  getLocaleProfile(profile: FamilyProfileCoreRecord, locale: string): FamilyProfileLocaleRecordRef | null;
  getSource(localeRow: FamilyProfileLocaleRecordRef, sourceKind: RuntimeFamilyProfileSourceKind): FamilyProfileSourceRef;
  sourceHasToken(source: FamilyProfileSourceRef, tokenId: number): boolean;
  sourceHasPhrase(source: FamilyProfileSourceRef, phraseId: number): boolean;
  sourcePhrases(source: FamilyProfileSourceRef): Iterable<string>;
  leafIdsForToken(localeRowId: number, tokenId: number): readonly number[];
  profileRowIdsForTokens(locale: string, tokens: readonly string[]): readonly number[];
  stringId(value: string): number;
  stringAt(stringId: number): string;
};

type FamilyProfileText = {
  tokens: string[];
  tokenSet: Set<string>;
  source: RuntimeFamilyProfileSourceKind;
  localeCode: string | null;
  leafId: number | null;
  aliasRole: RuntimeSearchMetaRecord['aliases'][number]['aliasRole'] | null;
};

type ScopedSourceBuilder = {
  phrases: Set<string>;
  tokenSet: Set<string>;
};

type ScopedLocaleBuilder = {
  localeCode: string;
  sources: Record<RuntimeFamilyProfileSourceKind, ScopedSourceBuilder>;
  leafIdsByToken: Map<string, Set<number>>;
};

const ARTIFACT_CACHE = new Map<string, RuntimeArtifactCacheEntry<FamilyProfileArtifactCacheEntry>>();
const DEFAULT_FAMILY_PROFILE_CACHE_SIZE = 2;

export function defaultOccupationFamilyProfileManifestPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-family-profiles.${safeFileSegment(sourceName)}.manifest.json`);
}

export async function loadOccupationFamilyProfileArtifactIfAvailable(sourceName: string): Promise<FamilyProfileArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationFamilyProfileManifestPath(sourceName);
  const cacheKey = path.resolve(manifestPath);
  return getCachedRuntimeArtifact(ARTIFACT_CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_FAMILY_PROFILE_CACHE_SIZE', DEFAULT_FAMILY_PROFILE_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName),
    dispose: closeFamilyProfileArtifact
  });
}

function closeFamilyProfileArtifact(artifact: FamilyProfileArtifactCacheEntry): void {
  closeUint32Rows(artifact.tokenRows);
  closeUint32Rows(artifact.phraseRows);
  closeFixedTable(artifact.leafTokenIndex);
  closeUint32Rows(artifact.leafIdRows);
  closeFixedTable(artifact.profileTokenIndex);
  closeUint32Rows(artifact.profileTokenRows);
}

export async function loadOccupationFamilyProfileArtifactRequired(sourceName: string): Promise<FamilyProfileArtifactCacheEntry> {
  const manifestPath = readOptionalEnv('OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH') ?? defaultOccupationFamilyProfileManifestPath(sourceName);
  const artifactEntry = await loadOccupationFamilyProfileArtifactIfAvailable(sourceName);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation family-profile artifact for source="${sourceName}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run search-meta:export-family-profiles` after rebuilding search meta, or set OCCUPATION_FAMILY_PROFILE_ARTIFACT_PATH.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

export function buildOccupationFamilyProfileRecords(records: RuntimeSearchMetaRecord[]): RuntimeFamilyProfileRecord[] {
  const recordsByFamilyId = buildLeafRecordsByFamilyNodeId(records);
  const profiles = Array.from(recordsByFamilyId.entries())
    .map(([familyNodeId, familyRecords]) => buildFamilyProfile(familyNodeId, familyRecords))
    .filter((profile): profile is RuntimeFamilyProfileRecord => profile !== null)
    .sort((left, right) => left.familyLabel.localeCompare(right.familyLabel));

  return profiles;
}

export function buildOccupationFamilyProfileBinaryFiles(
  records: RuntimeFamilyProfileRecord[],
  prefix: string
): {
  manifestFiles: OccupationFamilyProfileArtifactManifest['files'];
  buffers: Map<string, Buffer>;
  localeProfileCount: number;
  sourceRowCount: number;
  tokenValueCount: number;
  phraseValueCount: number;
  leafTokenKeyCount: number;
  leafIdCount: number;
  profileTokenKeyCount: number;
  profileTokenPostingCount: number;
  stringCount: number;
} {
  const strings = collectFamilyProfileStrings(records);
  const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
  const profileRows: number[][] = [];
  const localeRows: number[][] = [];
  const sourceRows: number[][] = [];
  const tokenRows: number[] = [];
  const phraseRows: number[] = [];
  const leafTokenIndexRows: number[][] = [];
  const leafIdRows: number[] = [];
  const profileRowsByLocaleToken = new Map<string, Set<number>>();

  records.forEach((record, profileRowId) => {
    const localeOffset = localeRows.length;

    for (const localeProfile of record.localeProfiles) {
      const localeRowId = localeRows.length;
      const sourceOffset = sourceRows.length;
      const localeStringId = requiredStringId(stringIdByValue, localeProfile.localeCode);
      const profileTokenIds = new Set<number>();

      for (const sourceKind of FAMILY_PROFILE_SOURCE_KINDS) {
        const source = localeProfile.sources[sourceKind];
        const tokenOffset = tokenRows.length;
        const tokenIds = source.tokens.map((token) => requiredStringId(stringIdByValue, token)).sort((left, right) => left - right);
        tokenRows.push(...tokenIds);
        for (const tokenId of tokenIds) {
          profileTokenIds.add(tokenId);
        }
        const phraseOffset = phraseRows.length;
        const phraseIds = source.phrases.map((phrase) => requiredStringId(stringIdByValue, phrase)).sort((left, right) => left - right);
        phraseRows.push(...phraseIds);
        sourceRows.push([sourceKindToId(sourceKind), tokenOffset, tokenIds.length, phraseOffset, phraseIds.length]);
      }

      for (const tokenId of profileTokenIds) {
        const key = profileTokenKey(localeStringId, tokenId);
        const profileRowIds = profileRowsByLocaleToken.get(key) ?? new Set<number>();
        profileRowIds.add(profileRowId);
        profileRowsByLocaleToken.set(key, profileRowIds);
      }

      for (const [token, leafIds] of localeProfile.leafIdsByToken) {
        const leafOffset = leafIdRows.length;
        const sortedLeafIds = Array.from(new Set(leafIds)).sort((left, right) => left - right);
        leafIdRows.push(...sortedLeafIds);
        leafTokenIndexRows.push([localeRowId, requiredStringId(stringIdByValue, token), leafOffset, sortedLeafIds.length]);
      }

      localeRows.push([profileRowId, localeStringId, sourceOffset, FAMILY_PROFILE_SOURCE_KINDS.length]);
    }

    profileRows.push([
      record.familyNodeId,
      requiredStringId(stringIdByValue, record.familyLabel),
      record.groupNodeId ?? FAMILY_PROFILE_NULL_U32,
      record.groupLabel ? requiredStringId(stringIdByValue, record.groupLabel) : FAMILY_PROFILE_NULL_U32,
      record.profileLeafCount,
      localeOffset,
      record.localeProfiles.length
    ]);
  });

  leafTokenIndexRows.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0));
  const profileTokenRows: number[] = [];
  const profileTokenIndexRows = Array.from(profileRowsByLocaleToken.entries())
    .map(([key, profileRowIds]) => {
      const [localeStringId, tokenId] = parseProfileTokenKey(key);
      const sortedProfileRowIds = Array.from(profileRowIds).sort((left, right) => left - right);
      const offset = profileTokenRows.length;
      profileTokenRows.push(...sortedProfileRowIds);
      return [localeStringId, tokenId, offset, sortedProfileRowIds.length];
    })
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0));

  const manifestFiles = {
    strings: `${prefix}.strings.bin`,
    profileRows: `${prefix}.profile-rows.bin`,
    localeRows: `${prefix}.locale-rows.bin`,
    sourceRows: `${prefix}.source-rows.bin`,
    tokenRows: `${prefix}.token-rows.bin`,
    phraseRows: `${prefix}.phrase-rows.bin`,
    leafTokenIndex: `${prefix}.leaf-token.idx`,
    leafIdRows: `${prefix}.leaf-id-rows.bin`,
    profileTokenIndex: `${prefix}.profile-token.idx`,
    profileTokenRows: `${prefix}.profile-token-rows.bin`
  };

  return {
    manifestFiles,
    buffers: new Map([
      [manifestFiles.strings, writeStringTable(strings)],
      [manifestFiles.profileRows, writeFixedTable(profileRows, FAMILY_PROFILE_ROW_WIDTH)],
      [manifestFiles.localeRows, writeFixedTable(localeRows, FAMILY_PROFILE_LOCALE_ROW_WIDTH)],
      [manifestFiles.sourceRows, writeFixedTable(sourceRows, FAMILY_PROFILE_SOURCE_ROW_WIDTH)],
      [manifestFiles.tokenRows, writeUint32Rows(tokenRows)],
      [manifestFiles.phraseRows, writeUint32Rows(phraseRows)],
      [manifestFiles.leafTokenIndex, writeFixedTable(leafTokenIndexRows, FAMILY_PROFILE_LEAF_TOKEN_INDEX_ROW_WIDTH)],
      [manifestFiles.leafIdRows, writeUint32Rows(leafIdRows)],
      [manifestFiles.profileTokenIndex, writeFixedTable(profileTokenIndexRows, FAMILY_PROFILE_PROFILE_TOKEN_INDEX_ROW_WIDTH)],
      [manifestFiles.profileTokenRows, writeUint32Rows(profileTokenRows)]
    ]),
    localeProfileCount: localeRows.length,
    sourceRowCount: sourceRows.length,
    tokenValueCount: tokenRows.length,
    phraseValueCount: phraseRows.length,
    leafTokenKeyCount: leafTokenIndexRows.length,
    leafIdCount: leafIdRows.length,
    profileTokenKeyCount: profileTokenIndexRows.length,
    profileTokenPostingCount: profileTokenRows.length,
    stringCount: strings.length
  };
}

async function loadArtifact(manifestPath: string, sourceName: string): Promise<FamilyProfileArtifactCacheEntry | null> {
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

  const directory = path.dirname(manifestPath);
  const strings = await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount);
  const profileRows = await readFixedTable(path.resolve(directory, manifest.files.profileRows), FAMILY_PROFILE_ROW_WIDTH, manifest.count);
  const localeRows = await readFixedTable(
    path.resolve(directory, manifest.files.localeRows),
    FAMILY_PROFILE_LOCALE_ROW_WIDTH,
    manifest.localeProfileCount
  );
  const sourceRows = await readFixedTable(
    path.resolve(directory, manifest.files.sourceRows),
    FAMILY_PROFILE_SOURCE_ROW_WIDTH,
    manifest.sourceRowCount
  );
  const tokenRows = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.tokenRows));
  const phraseRows = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.phraseRows));
  const leafTokenIndex = readFileBackedFixedTableSync(
    path.resolve(directory, manifest.files.leafTokenIndex),
    FAMILY_PROFILE_LEAF_TOKEN_INDEX_ROW_WIDTH,
    manifest.leafTokenKeyCount
  );
  const leafIdRows = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.leafIdRows));
  const profileTokenIndex = readFileBackedFixedTableSync(
    path.resolve(directory, manifest.files.profileTokenIndex),
    FAMILY_PROFILE_PROFILE_TOKEN_INDEX_ROW_WIDTH,
    manifest.profileTokenKeyCount
  );
  const profileTokenRows = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.profileTokenRows));
  const entryBase = {
    manifestPath,
    artifact: manifest,
    strings,
    profileRows,
    localeRows,
    sourceRows,
    tokenRows,
    phraseRows,
    leafTokenIndex,
    leafIdRows,
    profileTokenIndex,
    profileTokenRows
  };

  return {
    ...entryBase,
    getProfileCore(rowId: number): FamilyProfileCoreRecord | null {
      if (rowId < 0 || rowId >= entryBase.profileRows.count) {
        return null;
      }

      const groupNodeId = rowValue(entryBase.profileRows, rowId, 2);
      const groupLabelId = rowValue(entryBase.profileRows, rowId, 3);

      return {
        rowId,
        familyNodeId: rowValue(entryBase.profileRows, rowId, 0),
        familyLabel: stringAt(entryBase.strings, rowValue(entryBase.profileRows, rowId, 1)),
        groupNodeId: groupNodeId === FAMILY_PROFILE_NULL_U32 ? null : groupNodeId,
        groupLabel: groupLabelId === FAMILY_PROFILE_NULL_U32 ? null : stringAt(entryBase.strings, groupLabelId),
        profileLeafCount: rowValue(entryBase.profileRows, rowId, 4),
        localeOffset: rowValue(entryBase.profileRows, rowId, 5),
        localeCount: rowValue(entryBase.profileRows, rowId, 6)
      };
    },
    getLocaleProfile(profile: FamilyProfileCoreRecord, locale: string): FamilyProfileLocaleRecordRef | null {
      const localeId = findStringId(entryBase.strings, locale);
      const unknownLocaleId = findStringId(entryBase.strings, 'unknown');
      let unknownMatch: FamilyProfileLocaleRecordRef | null = null;

      for (let offset = 0; offset < profile.localeCount; offset += 1) {
        const rowId = profile.localeOffset + offset;
        const localeStringId = rowValue(entryBase.localeRows, rowId, 1);
        const record = {
          rowId,
          localeCode: stringAt(entryBase.strings, localeStringId),
          sourceOffset: rowValue(entryBase.localeRows, rowId, 2),
          sourceCount: rowValue(entryBase.localeRows, rowId, 3)
        };

        if (localeStringId === localeId) {
          return record;
        }

        if (localeStringId === unknownLocaleId) {
          unknownMatch = record;
        }
      }

      return unknownMatch;
    },
    getSource(localeRow: FamilyProfileLocaleRecordRef, sourceKind: RuntimeFamilyProfileSourceKind): FamilyProfileSourceRef {
      const sourceKindId = sourceKindToId(sourceKind);

      for (let offset = 0; offset < localeRow.sourceCount; offset += 1) {
        const rowId = localeRow.sourceOffset + offset;

        if (rowValue(entryBase.sourceRows, rowId, 0) !== sourceKindId) {
          continue;
        }

        return {
          tokenOffset: rowValue(entryBase.sourceRows, rowId, 1),
          tokenCount: rowValue(entryBase.sourceRows, rowId, 2),
          phraseOffset: rowValue(entryBase.sourceRows, rowId, 3),
          phraseCount: rowValue(entryBase.sourceRows, rowId, 4)
        };
      }

      return {
        tokenOffset: 0,
        tokenCount: 0,
        phraseOffset: 0,
        phraseCount: 0
      };
    },
    sourceHasToken(source: FamilyProfileSourceRef, tokenId: number): boolean {
      let low = source.tokenOffset;
      let high = source.tokenOffset + source.tokenCount - 1;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = uint32RowValue(entryBase.tokenRows, mid);

        if (current < tokenId) {
          low = mid + 1;
        } else if (current > tokenId) {
          high = mid - 1;
        } else {
          return true;
        }
      }

      return false;
    },
    sourceHasPhrase(source: FamilyProfileSourceRef, phraseId: number): boolean {
      let low = source.phraseOffset;
      let high = source.phraseOffset + source.phraseCount - 1;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = uint32RowValue(entryBase.phraseRows, mid);

        if (current < phraseId) {
          low = mid + 1;
        } else if (current > phraseId) {
          high = mid - 1;
        } else {
          return true;
        }
      }

      return false;
    },
    *sourcePhrases(source: FamilyProfileSourceRef): Iterable<string> {
      for (let index = 0; index < source.phraseCount; index += 1) {
        yield stringAt(entryBase.strings, uint32RowValue(entryBase.phraseRows, source.phraseOffset + index));
      }
    },
    leafIdsForToken(localeRowId: number, tokenId: number): readonly number[] {
      const range = findRange(entryBase.leafTokenIndex, [localeRowId, tokenId]);

      if (!range || range.length === 0) {
        return [];
      }

      return uint32RowsSlice(entryBase.leafIdRows, range.offset, range.length);
    },
    profileRowIdsForTokens(locale: string, tokens: readonly string[]): readonly number[] {
      const localeIds = uniqueNumbers(
        [findStringId(entryBase.strings, locale), findStringId(entryBase.strings, 'unknown')].filter((id) => id >= 0)
      );
      const tokenIds = uniqueNumbers(tokens.map((token) => findStringId(entryBase.strings, token)).filter((id) => id >= 0));
      const profileRowIds = new Set<number>();

      for (const localeId of localeIds) {
        for (const tokenId of tokenIds) {
          const range = findRange(entryBase.profileTokenIndex, [localeId, tokenId]);

          if (!range || range.length === 0) {
            continue;
          }

          for (const profileRowId of uint32RowsSlice(entryBase.profileTokenRows, range.offset, range.length)) {
            profileRowIds.add(profileRowId);
          }
        }
      }

      return Array.from(profileRowIds).sort((left, right) => left - right);
    },
    stringId(value: string): number {
      return findStringId(entryBase.strings, value);
    },
    stringAt(stringId: number): string {
      return stringAt(entryBase.strings, stringId);
    }
  };
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

  return recordsByFamilyId;
}

function buildFamilyProfile(familyNodeId: number, records: RuntimeSearchMetaRecord[]): RuntimeFamilyProfileRecord | null {
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

function buildFamilyProfileTexts(familyLabel: string, records: RuntimeSearchMetaRecord[]): FamilyProfileText[] {
  const texts: FamilyProfileText[] = [];
  const textKeys = new Set<string>();

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

function addProfileText(
  texts: FamilyProfileText[],
  textKeys: Set<string>,
  input: {
    value: string;
    source: RuntimeFamilyProfileSourceKind;
    localeCode: string | null;
    leafId: number | null;
    aliasRole: RuntimeSearchMetaRecord['aliases'][number]['aliasRole'] | null;
  }
): void {
  const value = input.value.trim();

  if (!value) {
    return;
  }

  const tokens = tokenizeNormalizedText(foldSearchLookupText(value));

  if (tokens.length === 0) {
    return;
  }

  const key = [input.source, input.localeCode ?? '', input.leafId ?? '', input.aliasRole ?? '', tokens.join(' ')].join('\u0000');

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

function familyProfileLocaleCodes(texts: FamilyProfileText[]): string[] {
  const localeCodes = new Set(['en', 'unknown']);

  for (const text of texts) {
    if (text.localeCode) {
      localeCodes.add(text.localeCode);
    }
  }

  return Array.from(localeCodes).sort();
}

function buildLocaleProfile(localeCode: string, texts: FamilyProfileText[]): RuntimeFamilyProfileLocaleRecord {
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
      const leafIds = scoped.leafIdsByToken.get(token) ?? new Set<number>();
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
      .map(([token, leafIds]) => [token, Array.from(leafIds).sort((left, right) => left - right)] as [string, number[]])
      .sort(([left], [right]) => left.localeCompare(right))
  };
}

function emptyScopedLocaleBuilder(localeCode: string): ScopedLocaleBuilder {
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

function emptySourceBuilder(): ScopedSourceBuilder {
  return {
    phrases: new Set(),
    tokenSet: new Set()
  };
}

function finalizeSource(source: ScopedSourceBuilder): RuntimeFamilyProfileSource {
  return {
    tokens: Array.from(source.tokenSet).sort(),
    phrases: Array.from(source.phrases).sort()
  };
}

function textAppliesToLocale(text: FamilyProfileText, locale: string): boolean {
  return text.localeCode === null || text.localeCode === locale || text.localeCode === 'en';
}

function collectFamilyProfileStrings(records: RuntimeFamilyProfileRecord[]): string[] {
  const strings = new Set<string>();

  for (const record of records) {
    strings.add(record.familyLabel);

    if (record.groupLabel) {
      strings.add(record.groupLabel);
    }

    for (const localeProfile of record.localeProfiles) {
      strings.add(localeProfile.localeCode);

      for (const sourceKind of FAMILY_PROFILE_SOURCE_KINDS) {
        for (const token of localeProfile.sources[sourceKind].tokens) {
          strings.add(token);
        }

        for (const phrase of localeProfile.sources[sourceKind].phrases) {
          strings.add(phrase);
        }
      }

      for (const [token] of localeProfile.leafIdsByToken) {
        strings.add(token);
      }
    }
  }

  strings.add('unknown');
  return Array.from(strings).sort();
}

function sourceKindToId(sourceKind: RuntimeFamilyProfileSourceKind): number {
  const id = FAMILY_PROFILE_SOURCE_KINDS.indexOf(sourceKind);

  if (id < 0) {
    throw new Error(`Unknown family-profile source kind: ${sourceKind}`);
  }

  return id;
}

function profileTokenKey(localeStringId: number, tokenId: number): string {
  return `${localeStringId}\0${tokenId}`;
}

function parseProfileTokenKey(key: string): [number, number] {
  const [localeStringId = '0', tokenId = '0'] = key.split('\0');
  return [Number.parseInt(localeStringId, 10), Number.parseInt(tokenId, 10)];
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function requiredStringId(stringIdByValue: Map<string, number>, value: string): number {
  const stringId = stringIdByValue.get(value);

  if (stringId === undefined) {
    throw new Error(`Missing family-profile string table value: ${value}`);
  }

  return stringId;
}

function validateManifest(value: unknown, manifestPath: string): OccupationFamilyProfileArtifactManifest {
  if (!isRecord(value)) {
    throw new Error(`Occupation family-profile manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = value as Partial<OccupationFamilyProfileArtifactManifest>;

  if (
    manifest.schemaVersion !== FAMILY_PROFILE_BINARY_SCHEMA_VERSION ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.count) ||
    !isNonNegativeInteger(manifest.localeProfileCount) ||
    !isNonNegativeInteger(manifest.sourceRowCount) ||
    !isNonNegativeInteger(manifest.tokenValueCount) ||
    !isNonNegativeInteger(manifest.phraseValueCount) ||
    !isNonNegativeInteger(manifest.leafTokenKeyCount) ||
    !isNonNegativeInteger(manifest.leafIdCount) ||
    !isNonNegativeInteger(manifest.profileTokenKeyCount) ||
    !isNonNegativeInteger(manifest.profileTokenPostingCount) ||
    !isNonNegativeInteger(manifest.stringCount) ||
    !isRecord(manifest.files) ||
    typeof manifest.files.strings !== 'string' ||
    typeof manifest.files.profileRows !== 'string' ||
    typeof manifest.files.localeRows !== 'string' ||
    typeof manifest.files.sourceRows !== 'string' ||
    typeof manifest.files.tokenRows !== 'string' ||
    typeof manifest.files.phraseRows !== 'string' ||
    typeof manifest.files.leafTokenIndex !== 'string' ||
    typeof manifest.files.leafIdRows !== 'string' ||
    typeof manifest.files.profileTokenIndex !== 'string' ||
    typeof manifest.files.profileTokenRows !== 'string'
  ) {
    throw new Error(`Invalid occupation family-profile manifest metadata at ${manifestPath}.`);
  }

  return manifest as OccupationFamilyProfileArtifactManifest;
}
