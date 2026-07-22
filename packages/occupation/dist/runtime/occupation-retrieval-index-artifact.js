import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { readFixedTable, readStringTable, readUint32Rows } from '../utils/binary-table.js';
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
export { findRange, findStringId, readFixedTable, readStringTable, readUint32Rows, rowValue, stringAt, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
