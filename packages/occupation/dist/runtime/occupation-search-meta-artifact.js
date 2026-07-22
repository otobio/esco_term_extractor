import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { findRange, readFixedTable, readFixedTableSync, readStringTable, readUint32Rows, rowValue, stringAt, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
import { configuredRuntimeArtifactCacheSize, getCachedRuntimeArtifact } from '../utils/runtime-artifact-cache.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
export const SEARCH_META_BINARY_SCHEMA_VERSION = 2;
export const SEARCH_META_NULL_U32 = 0xFFFFFFFF;
const DEFAULT_SEARCH_META_CORE_CACHE_SIZE = 256;
const DEFAULT_SEARCH_META_DETAILS_CACHE_SIZE = 128;
const DEFAULT_SEARCH_META_ARTIFACT_CACHE_SIZE = 2;
const GENERIC_RISKS = ['low', 'medium', 'high'];
const ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone'];
const CAPABILITY_TYPES = ['skill', 'knowledge', 'tool', 'software', 'language'];
const SCORE_SCALE = 1_000_000;
const CORE_ROW_WIDTH = 16;
const ANCESTOR_ROW_WIDTH = 5;
const SIBLING_ROW_WIDTH = 5;
const FAMILY_LEAF_POSTING_ROW_WIDTH = 3;
const DETAIL_ROW_WIDTH = 5;
const ALIAS_ROW_WIDTH = 7;
const CAPABILITY_ROW_WIDTH = 6;
const CACHE = new Map();
export function defaultOccupationSearchMetaManifestPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.manifest.json`);
}
export function defaultOccupationSearchMetaRecordsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.core-rows.bin`);
}
export function defaultOccupationSearchMetaDetailsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-search-meta.${safeFileSegment(sourceName)}.detail-rows.bin`);
}
export async function loadOccupationSearchMetaArtifactIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_SEARCH_META_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationSearchMetaManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
        maxSize: configuredRuntimeArtifactCacheSize('OSE_SEARCH_META_ARTIFACT_CACHE_SIZE', DEFAULT_SEARCH_META_ARTIFACT_CACHE_SIZE),
        load: () => loadArtifact(cacheKey, sourceName)
    });
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
    return loadOccupationSearchMetaArtifactRequired(sourceName);
}
export async function hydrateRuntimeSearchMetaRecords(artifactEntry, records) {
    return records.map((record) => attachDetails(artifactEntry, record));
}
export async function hydrateAllRuntimeSearchMetaRecords(artifactEntry, records) {
    return hydrateRuntimeSearchMetaRecords(artifactEntry, records);
}
export async function hydrateRuntimeSearchMetaRecord(artifactEntry, record) {
    return attachDetails(artifactEntry, record);
}
export function buildOccupationSearchMetaBinaryFiles(records, prefix) {
    const strings = collectStrings(records);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const ancestorRows = [];
    const siblingRows = [];
    const aliasRows = [];
    const capabilityRows = [];
    const detailRows = [];
    const familyPostingRows = [];
    const familyPostingsByFamilyNodeId = new Map();
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
                capability.label === capability.normalizedLabel ? SEARCH_META_NULL_U32 : requiredStringId(stringIdByValue, capability.normalizedLabel),
                requiredStringId(stringIdByValue, capability.hintKind),
                scoreCode(capability.weight)
            ]);
        }
        detailRows.push([
            record.graphNodeId,
            aliasOffset,
            record.aliases.length,
            capabilityOffset,
            record.capabilityLabels.length
        ]);
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
            const leftRecord = sortedRecords[left];
            const rightRecord = sortedRecords[right];
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
async function loadArtifact(manifestPath, sourceName) {
    try {
        await access(manifestPath);
    }
    catch {
        return null;
    }
    const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
    if (manifest.sourceName !== sourceName) {
        return null;
    }
    const directory = path.dirname(manifestPath);
    const aliasRowsPath = path.resolve(directory, manifest.files.aliasRows);
    const capabilityRowsPath = path.resolve(directory, manifest.files.capabilityRows);
    let aliasRows = null;
    let capabilityRows = null;
    const entryBase = {
        manifestPath,
        manifest,
        artifact: manifest,
        directory,
        strings: await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
        coreRows: await readFixedTable(path.resolve(directory, manifest.files.coreRows), CORE_ROW_WIDTH, manifest.count),
        ancestorRows: await readFixedTable(path.resolve(directory, manifest.files.ancestorRows), ANCESTOR_ROW_WIDTH, manifest.ancestorCount),
        siblingRows: await readFixedTable(path.resolve(directory, manifest.files.siblingRows), SIBLING_ROW_WIDTH, manifest.siblingCount),
        familyLeafPostings: await readFixedTable(path.resolve(directory, manifest.files.familyLeafPostings), FAMILY_LEAF_POSTING_ROW_WIDTH, manifest.familyLeafPostingKeyCount),
        familyLeafPostingRows: await readUint32Rows(path.resolve(directory, manifest.files.familyLeafPostingRows)),
        detailRows: await readFixedTable(path.resolve(directory, manifest.files.detailRows), DETAIL_ROW_WIDTH, manifest.detailCount),
        get aliasRows() {
            aliasRows ??= readFixedTableSync(aliasRowsPath, ALIAS_ROW_WIDTH, manifest.aliasCount);
            return aliasRows;
        },
        get capabilityRows() {
            capabilityRows ??= readFixedTableSync(capabilityRowsPath, CAPABILITY_ROW_WIDTH, manifest.capabilityCount);
            return capabilityRows;
        }
    };
    const coreCache = new Map();
    const detailsCache = new Map();
    const entry = {
        ...entryBase,
        getCoreRecord(graphNodeId) {
            const rowId = findRowByFirstColumn(entryBase.coreRows, graphNodeId);
            return rowId < 0 ? null : this.getCoreRecordByRowId(rowId);
        },
        getCoreRecordByRowId(rowId) {
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
        getDetails(graphNodeId) {
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
        getAliases(graphNodeId) {
            return this.getDetails(graphNodeId)?.aliases ?? [];
        },
        getCapabilityLabels(graphNodeId) {
            return this.getDetails(graphNodeId)?.capabilityLabels ?? [];
        },
        getAncestors(graphNodeId) {
            return this.getCoreRecord(graphNodeId)?.ancestors ?? [];
        },
        getSiblings(graphNodeId, limit) {
            const siblings = this.getCoreRecord(graphNodeId)?.siblings ?? [];
            return limit === undefined ? siblings : siblings.slice(0, limit);
        },
        getLeafCoreRecordsForFamilies(familyNodeIds) {
            const records = [];
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
            return records.sort((left, right) => (left.familyNodeId ?? 0) - (right.familyNodeId ?? 0) ||
                left.canonicalLabel.localeCompare(right.canonicalLabel));
        },
        getAllCoreRecords() {
            const records = [];
            for (let rowId = 0; rowId < entryBase.coreRows.count; rowId += 1) {
                const record = this.getCoreRecordByRowId(rowId);
                if (record)
                    records.push(record);
            }
            return records;
        },
        getAllRecordsWithDetails() {
            return this.getAllCoreRecords().map((record) => attachDetails(entry, record));
        }
    };
    return entry;
}
function trimSearchMetaCache(cache, maxSize) {
    while (cache.size > maxSize) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) {
            return;
        }
        cache.delete(oldestKey);
    }
}
function configuredSearchMetaCoreCacheSize() {
    return readPositiveIntegerEnv('OSE_SEARCH_META_CORE_CACHE_SIZE', DEFAULT_SEARCH_META_CORE_CACHE_SIZE);
}
function configuredSearchMetaDetailsCacheSize() {
    return readPositiveIntegerEnv('OSE_SEARCH_META_DETAILS_CACHE_SIZE', DEFAULT_SEARCH_META_DETAILS_CACHE_SIZE);
}
function readPositiveIntegerEnv(key, fallback) {
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
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation search-meta manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== SEARCH_META_BINARY_SCHEMA_VERSION ||
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
        !isRecord(manifest.files)) {
        throw new Error(`Invalid occupation search-meta manifest metadata at ${manifestPath}.`);
    }
    for (const value of Object.values(manifest.files)) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid occupation search-meta file path in manifest at ${manifestPath}.`);
        }
    }
    return manifest;
}
function decodeCoreRecord(entry, rowId) {
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
function decodeAncestors(entry, offset, count) {
    const ancestors = [];
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
function decodeSiblings(entry, offset, count) {
    const siblings = [];
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
function decodeDetails(entry, rowId) {
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
function decodeAliases(entry, offset, count) {
    const aliases = [];
    for (let rowId = offset; rowId < offset + count; rowId += 1) {
        const alias = stringAt(entry.strings, rowValue(entry.aliasRows, rowId, 1));
        const normalizedAliasId = rowValue(entry.aliasRows, rowId, 2);
        aliases.push({
            localeCode: stringAt(entry.strings, rowValue(entry.aliasRows, rowId, 0)),
            alias,
            normalizedAlias: normalizedAliasId === SEARCH_META_NULL_U32 ? alias : stringAt(entry.strings, normalizedAliasId),
            aliasRole: ALIAS_ROLES[rowValue(entry.aliasRows, rowId, 3)] ?? 'locale_supporting',
            isPrimary: rowValue(entry.aliasRows, rowId, 4) === 1,
            confidence: scoreValue(rowValue(entry.aliasRows, rowId, 5)),
            weight: scoreValue(rowValue(entry.aliasRows, rowId, 6))
        });
    }
    return aliases;
}
function decodeCapabilityLabels(entry, offset, count) {
    const capabilities = [];
    for (let rowId = offset; rowId < offset + count; rowId += 1) {
        const label = stringAt(entry.strings, rowValue(entry.capabilityRows, rowId, 2));
        const normalizedLabelId = rowValue(entry.capabilityRows, rowId, 3);
        capabilities.push({
            capabilityId: rowValue(entry.capabilityRows, rowId, 0),
            capabilityType: CAPABILITY_TYPES[rowValue(entry.capabilityRows, rowId, 1)] ?? 'skill',
            label,
            normalizedLabel: normalizedLabelId === SEARCH_META_NULL_U32 ? label : stringAt(entry.strings, normalizedLabelId),
            hintKind: stringAt(entry.strings, rowValue(entry.capabilityRows, rowId, 4)),
            weight: scoreValue(rowValue(entry.capabilityRows, rowId, 5))
        });
    }
    return capabilities;
}
function attachDetails(entry, record) {
    const details = entry.getDetails(record.graphNodeId);
    return {
        ...record,
        aliases: details?.aliases ?? [],
        capabilityLabels: details?.capabilityLabels ?? []
    };
}
function collectStrings(records) {
    const strings = new Set();
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
function addNullableString(strings, value) {
    if (value !== null) {
        strings.add(value);
    }
}
function nullableNumber(value) {
    return value ?? SEARCH_META_NULL_U32;
}
function nullableStringId(stringIdByValue, value) {
    return value === null ? SEARCH_META_NULL_U32 : requiredStringId(stringIdByValue, value);
}
function nullableRowNumber(value) {
    return value === SEARCH_META_NULL_U32 ? null : value;
}
function nullableRowString(strings, stringId) {
    return stringId === SEARCH_META_NULL_U32 ? null : stringAt(strings, stringId);
}
function requiredStringId(stringIdByValue, value) {
    const id = stringIdByValue.get(value);
    if (id === undefined) {
        throw new Error(`Missing string id for "${value}".`);
    }
    return id;
}
function requiredRowId(rowIdByGraphNodeId, graphNodeId) {
    const rowId = rowIdByGraphNodeId.get(graphNodeId);
    if (rowId === undefined) {
        throw new Error(`Missing core row id for graph_node_id=${graphNodeId}.`);
    }
    return rowId;
}
function enumCode(values, value, fieldName) {
    const index = values.indexOf(value);
    if (index < 0) {
        throw new Error(`Unknown ${fieldName}: ${value}`);
    }
    return index;
}
function scoreCode(value) {
    if (value === null) {
        return SEARCH_META_NULL_U32;
    }
    return Math.round(value * SCORE_SCALE);
}
function scoreValue(code) {
    return code === SEARCH_META_NULL_U32 ? null : code / SCORE_SCALE;
}
function findRowByFirstColumn(table, key) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = rowValue(table, mid, 0);
        if (current < key) {
            low = mid + 1;
        }
        else if (current > key) {
            high = mid - 1;
        }
        else {
            return mid;
        }
    }
    return -1;
}
