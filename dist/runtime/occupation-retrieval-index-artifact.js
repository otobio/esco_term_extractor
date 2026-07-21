import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
export const RETRIEVAL_INDEX_SCHEMA_VERSION = 1;
export const RETRIEVAL_TEXT_FIELDS = [
    'canonical_label',
    'locale_primary_aliases_text',
    'locale_supporting_aliases_text',
    'reviewed_crosswalk_aliases_text',
    'family_supporting_aliases_text',
    'english_backbone_aliases_text',
    'aliases_text',
    'search_text',
    'capability_text',
    'ancestor_text'
];
const CACHE = new Map();
export function defaultOccupationRetrievalIndexManifestPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-retrieval-index.${safeFileSegment(sourceName)}.manifest.json`);
}
export async function loadOccupationRetrievalIndexIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_RETRIEVAL_INDEX_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationRetrievalIndexManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    let cached = CACHE.get(cacheKey);
    if (!cached) {
        cached = loadIndex(cacheKey, sourceName);
        CACHE.set(cacheKey, cached);
    }
    return cached;
}
export async function loadOccupationRetrievalIndexRequired(sourceName) {
    const manifestPath = readOptionalEnv('OCCUPATION_RETRIEVAL_INDEX_ARTIFACT_PATH') ??
        defaultOccupationRetrievalIndexManifestPath(sourceName);
    const entry = await loadOccupationRetrievalIndexIfAvailable(sourceName);
    if (!entry) {
        throw new Error([
            `Missing required occupation retrieval-index artifact for source="${sourceName}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run retrieval:index:export` or set OCCUPATION_RETRIEVAL_INDEX_ARTIFACT_PATH.'
        ].join(' '));
    }
    return entry;
}
async function loadIndex(manifestPath, sourceName) {
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
    return {
        manifestPath,
        manifest,
        directory,
        strings: await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
        aliasRows: await readFixedTable(path.resolve(directory, manifest.files.aliasRows), 10, manifest.aliasRowCount),
        textRecords: await readFixedTable(path.resolve(directory, manifest.files.textRecords), 4 + RETRIEVAL_TEXT_FIELDS.length, manifest.textRecordCount),
        exactAliasIndex: await readFixedTable(path.resolve(directory, manifest.files.exactAliasIndex), 4, manifest.exactAliasKeyCount),
        exactAliasRows: await readUint32Rows(path.resolve(directory, manifest.files.exactAliasRows)),
        foldedAliasIndex: await readFixedTable(path.resolve(directory, manifest.files.foldedAliasIndex), 4, manifest.foldedAliasKeyCount),
        foldedAliasRows: await readUint32Rows(path.resolve(directory, manifest.files.foldedAliasRows)),
        canonicalIndex: await readFixedTable(path.resolve(directory, manifest.files.canonicalIndex), 4, manifest.canonicalKeyCount),
        canonicalRows: await readUint32Rows(path.resolve(directory, manifest.files.canonicalRows)),
        aliasTokenIndex: await readFixedTable(path.resolve(directory, manifest.files.aliasTokenIndex), 4, manifest.aliasTokenKeyCount),
        aliasTokenRows: await readUint32Rows(path.resolve(directory, manifest.files.aliasTokenRows)),
        textFieldPostingIndex: await readFixedTable(path.resolve(directory, manifest.files.textFieldPostingIndex), 5, manifest.fieldPostingKeyCount),
        textPostingRows: await readUint32Rows(path.resolve(directory, manifest.files.textPostingRows))
    };
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation retrieval-index manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== RETRIEVAL_INDEX_SCHEMA_VERSION ||
        typeof manifest.sourceName !== 'string' ||
        typeof manifest.generatedAt !== 'string' ||
        !Array.isArray(manifest.locales) ||
        !manifest.locales.every((locale) => typeof locale === 'string') ||
        !isNonNegativeInteger(manifest.stringCount) ||
        !isNonNegativeInteger(manifest.aliasRowCount) ||
        !isNonNegativeInteger(manifest.textRecordCount) ||
        !isNonNegativeInteger(manifest.exactAliasKeyCount) ||
        !isNonNegativeInteger(manifest.foldedAliasKeyCount) ||
        !isNonNegativeInteger(manifest.canonicalKeyCount) ||
        !isNonNegativeInteger(manifest.aliasTokenKeyCount) ||
        !isNonNegativeInteger(manifest.fieldPostingKeyCount) ||
        !isRecord(manifest.files)) {
        throw new Error(`Invalid occupation retrieval-index manifest metadata at ${manifestPath}.`);
    }
    for (const value of Object.values(manifest.files)) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid occupation retrieval-index file path in manifest at ${manifestPath}.`);
        }
    }
    return manifest;
}
export async function readStringTable(filePath, expectedCount) {
    const buffer = await readFile(filePath);
    const count = buffer.readUInt32LE(0);
    if (count !== expectedCount) {
        throw new Error(`String table count mismatch at ${filePath}: manifest=${expectedCount}, file=${count}.`);
    }
    const offsets = new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count + 1);
    const bytesOffset = 4 + (count + 1) * 4;
    return {
        count,
        offsets,
        bytes: buffer.subarray(bytesOffset)
    };
}
export async function readFixedTable(filePath, width, expectedCount) {
    const buffer = await readFile(filePath);
    const count = buffer.readUInt32LE(0);
    const rowWidth = buffer.readUInt32LE(4);
    if (count !== expectedCount || rowWidth !== width) {
        throw new Error(`Fixed table shape mismatch at ${filePath}: manifest=${expectedCount}x${width}, file=${count}x${rowWidth}.`);
    }
    return {
        count,
        width,
        values: new Uint32Array(buffer.buffer, buffer.byteOffset + 8, count * width)
    };
}
export async function readUint32Rows(filePath) {
    const buffer = await readFile(filePath);
    const count = buffer.readUInt32LE(0);
    return new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count);
}
export function stringAt(table, stringId) {
    if (stringId >= table.count) {
        return '';
    }
    return table.bytes.toString('utf8', table.offsets[stringId], table.offsets[stringId + 1]);
}
export function findStringId(table, value) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = stringAt(table, mid);
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
export function rowValue(table, rowIndex, columnIndex) {
    return table.values[rowIndex * table.width + columnIndex] ?? 0;
}
export function findRange(table, keyColumns) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const comparison = compareKeyAt(table, mid, keyColumns);
        if (comparison < 0) {
            low = mid + 1;
        }
        else if (comparison > 0) {
            high = mid - 1;
        }
        else {
            return {
                offset: rowValue(table, mid, table.width - 2),
                length: rowValue(table, mid, table.width - 1)
            };
        }
    }
    return null;
}
function compareKeyAt(table, rowIndex, keyColumns) {
    for (let index = 0; index < keyColumns.length; index += 1) {
        const left = rowValue(table, rowIndex, index);
        const right = keyColumns[index] ?? 0;
        if (left !== right) {
            return left - right;
        }
    }
    return 0;
}
export function writeStringTable(strings) {
    const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
    const offsets = new Uint32Array(strings.length + 1);
    let byteLength = 0;
    encoded.forEach((buffer, index) => {
        offsets[index] = byteLength;
        byteLength += buffer.byteLength;
    });
    offsets[strings.length] = byteLength;
    const output = Buffer.allocUnsafe(4 + offsets.byteLength + byteLength);
    output.writeUInt32LE(strings.length, 0);
    Buffer.from(offsets.buffer).copy(output, 4);
    let offset = 4 + offsets.byteLength;
    for (const buffer of encoded) {
        buffer.copy(output, offset);
        offset += buffer.byteLength;
    }
    return output;
}
export function writeFixedTable(rows, width) {
    const output = Buffer.allocUnsafe(8 + rows.length * width * 4);
    output.writeUInt32LE(rows.length, 0);
    output.writeUInt32LE(width, 4);
    const values = new Uint32Array(output.buffer, output.byteOffset + 8, rows.length * width);
    rows.forEach((row, rowIndex) => {
        for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
            values[rowIndex * width + columnIndex] = row[columnIndex] ?? 0;
        }
    });
    return output;
}
export function writeUint32Rows(rows) {
    const output = Buffer.allocUnsafe(4 + rows.length * 4);
    output.writeUInt32LE(rows.length, 0);
    new Uint32Array(output.buffer, output.byteOffset + 4, rows.length).set(rows);
    return output;
}
