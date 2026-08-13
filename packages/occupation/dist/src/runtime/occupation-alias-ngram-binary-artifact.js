import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { closeFixedTable, closeUint32Rows, findRange, findStringId, readFileBackedFixedTableSync, readFileBackedUint32RowsSync, readFixedTable, readStringTable, rowValue, stringAt, uint32RowsSlice, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
import { configuredRuntimeArtifactCacheSize, getCachedRuntimeArtifact } from '../utils/runtime-artifact-cache.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
export const ALIAS_NGRAM_BINARY_SCHEMA_VERSION = 1;
export const ALIAS_NGRAM_NULL_U32 = 0xffffffff;
export const ALIAS_NGRAM_WEIGHT_SCALE = 1_000_000;
const CACHE = new Map();
const DEFAULT_ALIAS_NGRAM_BINARY_CACHE_SIZE = 2;
export function defaultOccupationAliasNgramBinaryManifestPath(sourceName, locale, includeFamilySupportingAliases) {
    return path.join(getDefaultRuntimeDir(), `occupation-alias-ngrams.${safeFileSegment(sourceName)}.${safeFileSegment(locale)}.${includeFamilySupportingAliases ? 'family' : 'leaf'}.binary.manifest.json`);
}
export async function loadOccupationAliasNgramBinaryIfAvailable(sourceName, locale, includeFamilySupportingAliases) {
    const configuredPath = readOptionalEnv('OCCUPATION_ALIAS_NGRAM_BINARY_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationAliasNgramBinaryManifestPath(sourceName, locale, includeFamilySupportingAliases);
    const cacheKey = path.resolve(manifestPath);
    return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
        maxSize: configuredRuntimeArtifactCacheSize('OSE_ALIAS_NGRAM_CACHE_SIZE', DEFAULT_ALIAS_NGRAM_BINARY_CACHE_SIZE),
        load: () => loadBinaryArtifact(cacheKey, sourceName, locale, includeFamilySupportingAliases),
        dispose: closeBinaryAliasNgramIndex
    });
}
function closeBinaryAliasNgramIndex(index) {
    closeFixedTable(index.featureValues);
    closeUint32Rows(index.featurePostingRows);
}
async function loadBinaryArtifact(manifestPath, sourceName, locale, includeFamilySupportingAliases) {
    try {
        await access(manifestPath);
    }
    catch {
        return null;
    }
    const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
    if (manifest.sourceName !== sourceName ||
        manifest.locale !== locale ||
        manifest.includeFamilySupportingAliases !== includeFamilySupportingAliases) {
        return null;
    }
    const directory = path.dirname(manifestPath);
    return {
        manifestPath,
        manifest,
        strings: await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
        rows: await readFixedTable(path.resolve(directory, manifest.files.rows), 14, manifest.count),
        featureValues: readFileBackedFixedTableSync(path.resolve(directory, manifest.files.featureValues), 2, manifest.featureValueCount),
        featurePostings: await readFixedTable(path.resolve(directory, manifest.files.featurePostings), 3, manifest.featurePostingKeyCount),
        featurePostingRows: readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.featurePostingRows))
    };
}
export function buildAliasNgramBinaryFiles(records, prefix) {
    const strings = collectStrings(records);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const featureValues = [];
    const postingsByFeatureId = new Map();
    const rows = records.map((record, index) => {
        const featureOffset = featureValues.length;
        for (const [feature, weight] of record.weightedFeatures) {
            const featureId = requiredStringId(stringIdByValue, feature);
            featureValues.push([featureId, Math.round(weight * ALIAS_NGRAM_WEIGHT_SCALE)]);
            const postings = postingsByFeatureId.get(featureId) ?? [];
            postings.push(index);
            postingsByFeatureId.set(featureId, postings);
        }
        return [
            record.graphNodeId,
            requiredStringId(stringIdByValue, record.canonicalLabel),
            record.familyNodeId ?? ALIAS_NGRAM_NULL_U32,
            record.familyLabel ? requiredStringId(stringIdByValue, record.familyLabel) : ALIAS_NGRAM_NULL_U32,
            requiredStringId(stringIdByValue, record.alias),
            requiredStringId(stringIdByValue, record.normalizedAlias),
            requiredStringId(stringIdByValue, record.aliasRole),
            record.aliasWeight === null ? ALIAS_NGRAM_NULL_U32 : Math.round(record.aliasWeight * ALIAS_NGRAM_WEIGHT_SCALE),
            Math.round(record.aliasRoleScoreFactor * ALIAS_NGRAM_WEIGHT_SCALE),
            requiredStringId(stringIdByValue, tokenText(record.foldedTokens)),
            requiredStringId(stringIdByValue, tokenText(record.usefulFoldedTokens)),
            Math.round(record.norm * ALIAS_NGRAM_WEIGHT_SCALE),
            featureOffset,
            record.weightedFeatures.length
        ];
    });
    const postingRows = [];
    const featurePostingRows = Array.from(postingsByFeatureId.entries())
        .map(([featureId, postings]) => {
        const uniquePostings = Array.from(new Set(postings)).sort((left, right) => left - right);
        const offset = postingRows.length;
        postingRows.push(...uniquePostings);
        return [featureId, offset, uniquePostings.length];
    })
        .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
    const files = {
        strings: `${prefix}.strings.bin`,
        rows: `${prefix}.rows.bin`,
        featureValues: `${prefix}.feature-values.bin`,
        featurePostings: `${prefix}.feature-postings.idx`,
        featurePostingRows: `${prefix}.feature-posting-rows.bin`
    };
    return {
        manifestFiles: files,
        buffers: new Map([
            [files.strings, writeStringTable(strings)],
            [files.rows, writeFixedTable(rows, 14)],
            [files.featureValues, writeFixedTable(featureValues, 2)],
            [files.featurePostings, writeFixedTable(featurePostingRows, 3)],
            [files.featurePostingRows, writeUint32Rows(postingRows)]
        ]),
        stringCount: strings.length,
        featurePostingKeyCount: featurePostingRows.length,
        featureValueCount: featureValues.length
    };
}
export function binaryRowFeatureWeight(index, rowId, featureId) {
    const offset = rowValue(index.rows, rowId, 12);
    const length = rowValue(index.rows, rowId, 13);
    for (let cursor = offset; cursor < offset + length; cursor += 1) {
        if (rowValue(index.featureValues, cursor, 0) === featureId) {
            return rowValue(index.featureValues, cursor, 1) / ALIAS_NGRAM_WEIGHT_SCALE;
        }
    }
    return 0;
}
export function binaryFeaturePostings(index, featureId) {
    const range = findRange(index.featurePostings, [featureId]);
    if (!range || range.length === 0) {
        return [];
    }
    return uint32RowsSlice(index.featurePostingRows, range.offset, range.length);
}
export function binaryStringId(index, value) {
    return findStringId(index.strings, value);
}
export function binaryStringAt(index, stringId) {
    return stringAt(index.strings, stringId);
}
function collectStrings(records) {
    const strings = new Set();
    for (const record of records) {
        strings.add(record.canonicalLabel);
        if (record.familyLabel)
            strings.add(record.familyLabel);
        strings.add(record.alias);
        strings.add(record.normalizedAlias);
        strings.add(record.aliasRole);
        strings.add(tokenText(record.foldedTokens));
        strings.add(tokenText(record.usefulFoldedTokens));
        for (const [feature] of record.weightedFeatures) {
            strings.add(feature);
        }
    }
    return Array.from(strings).sort();
}
function tokenText(tokens) {
    return tokens.join('\n');
}
function requiredStringId(stringIdByValue, value) {
    const id = stringIdByValue.get(value);
    if (id === undefined) {
        throw new Error(`Missing string id for "${value}".`);
    }
    return id;
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation alias-ngram binary manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== ALIAS_NGRAM_BINARY_SCHEMA_VERSION ||
        typeof manifest.sourceName !== 'string' ||
        typeof manifest.locale !== 'string' ||
        typeof manifest.includeFamilySupportingAliases !== 'boolean' ||
        typeof manifest.generatedAt !== 'string' ||
        !isNonNegativeInteger(manifest.count) ||
        !isNonNegativeInteger(manifest.stringCount) ||
        !isNonNegativeInteger(manifest.featurePostingKeyCount) ||
        !isNonNegativeInteger(manifest.featureValueCount) ||
        !isRecord(manifest.files)) {
        throw new Error(`Invalid occupation alias-ngram binary manifest metadata at ${manifestPath}.`);
    }
    for (const value of Object.values(manifest.files)) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid occupation alias-ngram binary file path in manifest at ${manifestPath}.`);
        }
    }
    return manifest;
}
