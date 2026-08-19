import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { closeFixedTable, closeUint32Rows, readFixedTable, readFileBackedUint32RowsSync, readStringTable, readUint32Rows } from '../utils/binary-table.js';
import { configuredRuntimeArtifactCacheSize, getCachedRuntimeArtifact } from '../utils/runtime-artifact-cache.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
export const RETRIEVAL_INDEX_SCHEMA_VERSION = 2;
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
const DEFAULT_RETRIEVAL_INDEX_CACHE_SIZE = 2;
export function defaultOccupationRetrievalIndexManifestPath(sourceName) {
    return path.join(getDefaultRuntimeDir(), `occupation-retrieval-index.${safeFileSegment(sourceName)}.manifest.json`);
}
export async function loadOccupationRetrievalIndexIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_RETRIEVAL_INDEX_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationRetrievalIndexManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
        maxSize: configuredRuntimeArtifactCacheSize('OSE_RETRIEVAL_INDEX_CACHE_SIZE', DEFAULT_RETRIEVAL_INDEX_CACHE_SIZE),
        load: () => loadIndex(cacheKey, sourceName),
        dispose: closeRetrievalIndex
    });
}
function closeRetrievalIndex(index) {
    closeFixedTable(index.aliasRows);
    closeFixedTable(index.textRecords);
    closeFixedTable(index.tokenListIndex);
    closeFixedTable(index.exactAliasIndex);
    closeFixedTable(index.foldedAliasIndex);
    closeFixedTable(index.canonicalIndex);
    closeFixedTable(index.aliasTokenIndex);
    closeFixedTable(index.textFieldPostingIndex);
    closeUint32Rows(index.textPostingRows);
}
export async function loadOccupationRetrievalIndexRequired(sourceName) {
    const manifestPath = readOptionalEnv('OCCUPATION_RETRIEVAL_INDEX_ARTIFACT_PATH') ?? defaultOccupationRetrievalIndexManifestPath(sourceName);
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
        tokenListIndex: await readFixedTable(path.resolve(directory, manifest.files.tokenListIndex), 2, manifest.tokenListCount),
        tokenListValues: await readUint32Rows(path.resolve(directory, manifest.files.tokenListValues)),
        exactAliasIndex: await readFixedTable(path.resolve(directory, manifest.files.exactAliasIndex), 4, manifest.exactAliasKeyCount),
        exactAliasRows: await readUint32Rows(path.resolve(directory, manifest.files.exactAliasRows)),
        foldedAliasIndex: await readFixedTable(path.resolve(directory, manifest.files.foldedAliasIndex), 4, manifest.foldedAliasKeyCount),
        foldedAliasRows: await readUint32Rows(path.resolve(directory, manifest.files.foldedAliasRows)),
        canonicalIndex: await readFixedTable(path.resolve(directory, manifest.files.canonicalIndex), 4, manifest.canonicalKeyCount),
        canonicalRows: await readUint32Rows(path.resolve(directory, manifest.files.canonicalRows)),
        aliasTokenIndex: await readFixedTable(path.resolve(directory, manifest.files.aliasTokenIndex), 4, manifest.aliasTokenKeyCount),
        aliasTokenRows: await readUint32Rows(path.resolve(directory, manifest.files.aliasTokenRows)),
        textFieldPostingIndex: await readFixedTable(path.resolve(directory, manifest.files.textFieldPostingIndex), 5, manifest.fieldPostingKeyCount),
        textPostingRows: readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.textPostingRows))
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
        !isNonNegativeInteger(manifest.tokenListCount) ||
        !isNonNegativeInteger(manifest.tokenListValueCount) ||
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
export { findRange, findStringId, readFixedTable, readStringTable, readUint32Rows, rowValue, stringAt, uint32RowValue, uint32RowsSlice, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
