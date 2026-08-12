import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { closeFixedTable, closeUint32Rows, findRange, findStringId, readFileBackedFixedTableSync, readFileBackedUint32RowsSync, readStringTable, rowValue, stringAt, uint32RowsSlice, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
import { configuredRuntimeArtifactCacheSize, getCachedRuntimeArtifact } from '../utils/runtime-artifact-cache.js';
import { foldSearchText } from '../utils/texts.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
export const ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION = 2;
export const ESCO_RELATED_TERMS_DIRECTION_FORWARD = 0;
export const ESCO_RELATED_TERMS_DIRECTION_REVERSE = 1;
export const ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES = 10;
const CACHE = new Map();
const DEFAULT_CACHE_SIZE = 2;
const RELATED_TERMS_ENV = 'OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH';
const ROW_WIDTH = 9;
const INDEX_ROW_WIDTH = 3;
export function defaultEscoRelatedTermsManifestPath(sourceName, locale) {
    return path.join(DEFAULT_RUNTIME_DIR, `esco-related-terms.${safeFileSegment(sourceName)}.${safeFileSegment(locale)}.binary.manifest.json`);
}
export async function loadEscoRelatedTermsArtifactIfAvailable(sourceName, locale) {
    const configuredPath = readOptionalEnv(RELATED_TERMS_ENV);
    const manifestPath = configuredPath ?? defaultEscoRelatedTermsManifestPath(sourceName, locale);
    const cacheKey = path.resolve(manifestPath);
    return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
        maxSize: configuredRuntimeArtifactCacheSize('OSE_ESCO_RELATED_TERMS_CACHE_SIZE', DEFAULT_CACHE_SIZE),
        load: () => loadArtifact(cacheKey, sourceName, locale),
        dispose: closeArtifact
    });
}
export async function loadEscoRelatedTermsArtifactRequired(sourceName, locale) {
    const manifestPath = readOptionalEnv(RELATED_TERMS_ENV) ?? defaultEscoRelatedTermsManifestPath(sourceName, locale);
    const artifact = await loadEscoRelatedTermsArtifactIfAvailable(sourceName, locale);
    if (!artifact) {
        throw new Error([
            `Missing required ESCO related-terms binary artifact for source="${sourceName}" locale="${locale}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run skills:esco:related-terms:runtime` after building the MySQL storage tables.'
        ].join(' '));
    }
    return artifact;
}
export function buildEscoRelatedTermsBinaryFiles(input, prefix) {
    const strings = collectStrings(input.verbRows, input.objectRows);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const verb = buildSectionFiles(input.verbRows, stringIdByValue, `${prefix}.verb`);
    const object = buildSectionFiles(input.objectRows, stringIdByValue, `${prefix}.object`);
    const files = {
        strings: `${prefix}.strings.bin`,
        verbRows: verb.files.rows,
        verbSourceIndex: verb.files.sourceIndex,
        verbSourcePostings: verb.files.sourcePostings,
        verbRelatedIndex: verb.files.relatedIndex,
        verbRelatedPostings: verb.files.relatedPostings,
        verbSourceLabelExamples: verb.files.sourceLabelExamples,
        verbRelatedLabelExamples: verb.files.relatedLabelExamples,
        objectRows: object.files.rows,
        objectSourceIndex: object.files.sourceIndex,
        objectSourcePostings: object.files.sourcePostings,
        objectRelatedIndex: object.files.relatedIndex,
        objectRelatedPostings: object.files.relatedPostings,
        objectSourceLabelExamples: object.files.sourceLabelExamples,
        objectRelatedLabelExamples: object.files.relatedLabelExamples
    };
    return {
        manifestFiles: files,
        buffers: new Map([[files.strings, writeStringTable(strings)], ...verb.buffers, ...object.buffers]),
        stringCount: strings.length,
        verbRowCount: verb.rowCount,
        verbSourceKeyCount: verb.sourceKeyCount,
        verbRelatedKeyCount: verb.relatedKeyCount,
        objectRowCount: object.rowCount,
        objectSourceKeyCount: object.sourceKeyCount,
        objectRelatedKeyCount: object.relatedKeyCount
    };
}
export function lookupVerbRelatedTerms(artifact, queryVerb, limit) {
    return lookupSectionRows(artifact.strings, artifact.verbs, normalizeRelatedTerm(queryVerb), limit);
}
export function lookupObjectRelatedTerms(artifact, queryObject, limit) {
    return lookupSectionRows(artifact.strings, artifact.objects, normalizeRelatedTerm(queryObject), limit);
}
function loadArtifact(manifestPath, sourceName, locale) {
    return (async () => {
        try {
            await access(manifestPath);
        }
        catch {
            return null;
        }
        const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath);
        if (manifest.sourceName !== sourceName || manifest.locale !== locale) {
            return null;
        }
        const directory = path.dirname(manifestPath);
        return {
            manifestPath,
            manifest,
            strings: await readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
            verbs: await loadSection(directory, manifest.files, 'verb', manifest.verbRowCount, manifest.verbSourceKeyCount, manifest.verbRelatedKeyCount),
            objects: await loadSection(directory, manifest.files, 'object', manifest.objectRowCount, manifest.objectSourceKeyCount, manifest.objectRelatedKeyCount)
        };
    })();
}
function closeArtifact(artifact) {
    closeFixedTable(artifact.verbs.sourceIndex);
    closeUint32Rows(artifact.verbs.sourcePostings);
    closeFixedTable(artifact.verbs.relatedIndex);
    closeUint32Rows(artifact.verbs.relatedPostings);
    closeFixedTable(artifact.verbs.rows);
    closeUint32Rows(artifact.verbs.sourceLabelExamples);
    closeUint32Rows(artifact.verbs.relatedLabelExamples);
    closeFixedTable(artifact.objects.sourceIndex);
    closeUint32Rows(artifact.objects.sourcePostings);
    closeFixedTable(artifact.objects.relatedIndex);
    closeUint32Rows(artifact.objects.relatedPostings);
    closeFixedTable(artifact.objects.rows);
    closeUint32Rows(artifact.objects.sourceLabelExamples);
    closeUint32Rows(artifact.objects.relatedLabelExamples);
}
async function loadSection(directory, files, kind, rowCount, sourceKeyCount, relatedKeyCount) {
    const prefix = kind === 'verb' ? 'verb' : 'object';
    return {
        sourceIndex: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}SourceIndex`]), INDEX_ROW_WIDTH, sourceKeyCount),
        sourcePostings: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}SourcePostings`])),
        relatedIndex: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}RelatedIndex`]), INDEX_ROW_WIDTH, relatedKeyCount),
        relatedPostings: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}RelatedPostings`])),
        rows: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}Rows`]), ROW_WIDTH, rowCount),
        sourceLabelExamples: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}SourceLabelExamples`])),
        relatedLabelExamples: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}RelatedLabelExamples`]))
    };
}
function buildSectionFiles(rows, stringIdByValue, prefix) {
    const sortedRows = rows.filter((row) => !isLowQualityRelatedRow(row)).sort(compareBinaryRows);
    const rowValues = [];
    const sourcePostingsByTerm = new Map();
    const relatedPostingsByTerm = new Map();
    const sourceLabelExamples = [];
    const relatedLabelExamples = [];
    sortedRows.forEach((row, rowId) => {
        const sourceTermId = requiredTermStringId(stringIdByValue, row.sourceTerm);
        const relatedTermId = requiredTermStringId(stringIdByValue, row.relatedTerm);
        const relationshipTypeId = requiredExactStringId(stringIdByValue, row.relationshipType);
        const sourceLabelExamplesOffset = sourceLabelExamples.length;
        const relatedLabelExamplesOffset = relatedLabelExamples.length;
        const cappedSourceLabelExamples = cappedLabelExamples(row.sourceLabelExamples);
        const cappedRelatedLabelExamples = cappedLabelExamples(row.relatedLabelExamples);
        sourceLabelExamples.push(...cappedSourceLabelExamples.map((value) => requiredExactStringId(stringIdByValue, value)));
        relatedLabelExamples.push(...cappedRelatedLabelExamples.map((value) => requiredExactStringId(stringIdByValue, value)));
        rowValues.push([
            sourceTermId,
            relatedTermId,
            relationshipTypeId,
            row.direction === 'forward' ? ESCO_RELATED_TERMS_DIRECTION_FORWARD : ESCO_RELATED_TERMS_DIRECTION_REVERSE,
            row.evidenceCount,
            sourceLabelExamplesOffset,
            cappedSourceLabelExamples.length,
            relatedLabelExamplesOffset,
            cappedRelatedLabelExamples.length
        ]);
        addPosting(sourcePostingsByTerm, sourceTermId, rowId);
        addPosting(relatedPostingsByTerm, relatedTermId, rowId);
    });
    const sourceIndexRows = buildIndexRows(sourcePostingsByTerm);
    const relatedIndexRows = buildIndexRows(relatedPostingsByTerm);
    const sourcePostingsRows = collectPostingRows(sourcePostingsByTerm, sourceIndexRows);
    const relatedPostingsRows = collectPostingRows(relatedPostingsByTerm, relatedIndexRows);
    const files = {
        rows: `${prefix}.rows.bin`,
        sourceIndex: `${prefix}.source.idx`,
        sourcePostings: `${prefix}.source-postings.bin`,
        relatedIndex: `${prefix}.related.idx`,
        relatedPostings: `${prefix}.related-postings.bin`,
        sourceLabelExamples: `${prefix}.source-label-examples.bin`,
        relatedLabelExamples: `${prefix}.related-label-examples.bin`
    };
    return {
        files,
        buffers: [
            [files.rows, writeFixedTable(rowValues, ROW_WIDTH)],
            [files.sourceIndex, writeFixedTable(sourceIndexRows, INDEX_ROW_WIDTH)],
            [files.sourcePostings, writeUint32Rows(sourcePostingsRows)],
            [files.relatedIndex, writeFixedTable(relatedIndexRows, INDEX_ROW_WIDTH)],
            [files.relatedPostings, writeUint32Rows(relatedPostingsRows)],
            [files.sourceLabelExamples, writeUint32Rows(sourceLabelExamples)],
            [files.relatedLabelExamples, writeUint32Rows(relatedLabelExamples)]
        ],
        rowCount: sortedRows.length,
        sourceKeyCount: sourceIndexRows.length,
        relatedKeyCount: relatedIndexRows.length
    };
}
function cappedLabelExamples(values) {
    return [...new Set(values)]
        .filter((value) => !value.startsWith('relation:'))
        .sort()
        .slice(0, ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES);
}
function lookupSectionRows(strings, section, queryTerm, limit) {
    if (!queryTerm) {
        return [];
    }
    const candidateIds = resolveQueryTermIds(strings, queryTerm);
    let sourceRange = null;
    let relatedRange = null;
    let queryTermId = -1;
    for (const candidateId of candidateIds) {
        const candidateSourceRange = findRange(section.sourceIndex, [candidateId]);
        const candidateRelatedRange = findRange(section.relatedIndex, [candidateId]);
        if (candidateSourceRange !== null || candidateRelatedRange !== null) {
            queryTermId = candidateId;
            sourceRange = candidateSourceRange;
            relatedRange = candidateRelatedRange;
            break;
        }
    }
    if (queryTermId < 0) {
        return [];
    }
    const matches = new Map();
    addRange(matches, section.sourcePostings, sourceRange, true);
    addRange(matches, section.relatedPostings, relatedRange, false);
    const results = [];
    for (const [rowId, match] of [...matches.entries()].sort((left, right) => left[0] - right[0])) {
        const row = readRow(section.rows, rowId);
        const oriented = orientRow(strings, section, row, queryTermId, match.sourceSide);
        results.push(oriented);
    }
    return mergeBinaryRows(results).slice(0, limit);
}
function resolveQueryTermIds(strings, queryTerm) {
    const ids = [];
    const exactId = findStringId(strings, queryTerm);
    if (exactId >= 0) {
        ids.push(exactId);
    }
    for (const candidate of pluralFoldedCandidates(queryTerm)) {
        const candidateId = findStringId(strings, candidate);
        if (candidateId >= 0) {
            ids.push(candidateId);
        }
    }
    return ids;
}
function pluralFoldedCandidates(term) {
    const candidates = new Set();
    if (term.endsWith('ies') && term.length > 3) {
        candidates.add(`${term.slice(0, -3)}y`);
    }
    if (term.endsWith('es') && term.length > 2) {
        candidates.add(term.slice(0, -2));
    }
    if (term.endsWith('s') && term.length > 1) {
        candidates.add(term.slice(0, -1));
    }
    if (!term.endsWith('s')) {
        candidates.add(`${term}s`);
        candidates.add(`${term}es`);
        if (term.endsWith('y')) {
            candidates.add(`${term.slice(0, -1)}ies`);
        }
    }
    candidates.delete(term);
    return [...candidates];
}
function addRange(matches, postings, range, sourceSide) {
    if (!range || range.length === 0) {
        return;
    }
    for (const rowId of uint32RowsSlice(postings, range.offset, range.length)) {
        const current = matches.get(rowId) ?? { sourceSide: false, relatedSide: false };
        current[sourceSide ? 'sourceSide' : 'relatedSide'] = true;
        matches.set(rowId, current);
    }
}
function orientRow(strings, section, row, queryTermId, sourceSide) {
    const relatedTermId = sourceSide ? row.relatedTermId : row.sourceTermId;
    const sourceLabelExamples = sourceSide
        ? sliceStringRows(strings, section.sourceLabelExamples, row.sourceLabelExamplesOffset, row.sourceLabelExamplesLength)
        : sliceStringRows(strings, section.relatedLabelExamples, row.relatedLabelExamplesOffset, row.relatedLabelExamplesLength);
    const relatedLabelExamples = sourceSide
        ? sliceStringRows(strings, section.relatedLabelExamples, row.relatedLabelExamplesOffset, row.relatedLabelExamplesLength)
        : sliceStringRows(strings, section.sourceLabelExamples, row.sourceLabelExamplesOffset, row.sourceLabelExamplesLength);
    return {
        sourceTerm: stringAt(strings, queryTermId),
        relatedTerm: stringAt(strings, relatedTermId),
        relationshipType: stringAt(strings, row.relationshipTypeId),
        direction: sourceSide ? row.direction : oppositeDirection(row.direction),
        evidenceCount: row.evidenceCount,
        sourceLabelExamples,
        relatedLabelExamples
    };
}
function mergeBinaryRows(rows) {
    const byKey = new Map();
    for (const row of rows) {
        const key = `${row.relationshipType}\u0000${row.relatedTerm}`;
        const current = byKey.get(key);
        if (!current) {
            byKey.set(key, {
                ...row,
                sourceLabelExamples: [...row.sourceLabelExamples],
                relatedLabelExamples: [...row.relatedLabelExamples]
            });
            continue;
        }
        current.evidenceCount = Math.max(current.evidenceCount, row.evidenceCount);
        current.direction = current.direction === 'forward' ? 'forward' : row.direction;
        current.sourceLabelExamples = mergeUniqueStrings(current.sourceLabelExamples, row.sourceLabelExamples).slice(0, ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES);
        current.relatedLabelExamples = mergeUniqueStrings(current.relatedLabelExamples, row.relatedLabelExamples).slice(0, ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES);
    }
    return [...byKey.values()].sort((left, right) => right.evidenceCount - left.evidenceCount ||
        left.relationshipType.localeCompare(right.relationshipType) ||
        left.relatedTerm.localeCompare(right.relatedTerm) ||
        left.direction.localeCompare(right.direction));
}
function readRow(table, rowIndex) {
    return {
        sourceTermId: rowValue(table, rowIndex, 0),
        relatedTermId: rowValue(table, rowIndex, 1),
        relationshipTypeId: rowValue(table, rowIndex, 2),
        direction: rowValue(table, rowIndex, 3) === ESCO_RELATED_TERMS_DIRECTION_FORWARD ? 'forward' : 'reverse',
        evidenceCount: rowValue(table, rowIndex, 4),
        sourceLabelExamplesOffset: rowValue(table, rowIndex, 5),
        sourceLabelExamplesLength: rowValue(table, rowIndex, 6),
        relatedLabelExamplesOffset: rowValue(table, rowIndex, 7),
        relatedLabelExamplesLength: rowValue(table, rowIndex, 8)
    };
}
function sliceStringRows(strings, rows, offset, length) {
    return uint32RowsSlice(rows, offset, length).map((stringId) => stringAt(strings, stringId));
}
function buildIndexRows(postingsByTerm) {
    return [...postingsByTerm.keys()].sort((left, right) => left - right).map((termId) => [termId, 0, 0]);
}
function collectPostingRows(postingsByTerm, indexRows) {
    const rows = [];
    const sortedTerms = [...postingsByTerm.entries()].sort((left, right) => left[0] - right[0]);
    for (const [termId, postings] of sortedTerms) {
        const uniquePostings = [...new Set(postings)].sort((left, right) => left - right);
        const offset = rows.length;
        rows.push(...uniquePostings);
        const indexRow = indexRows.find((row) => row[0] === termId);
        if (indexRow) {
            indexRow[1] = offset;
            indexRow[2] = uniquePostings.length;
        }
    }
    return rows;
}
function addPosting(postingsByTerm, termId, rowId) {
    const postings = postingsByTerm.get(termId) ?? [];
    postings.push(rowId);
    postingsByTerm.set(termId, postings);
}
function compareBinaryRows(left, right) {
    return (relationshipTypeTier(left.relationshipType) - relationshipTypeTier(right.relationshipType) ||
        right.evidenceCount - left.evidenceCount ||
        left.relationshipType.localeCompare(right.relationshipType) ||
        left.relatedTerm.localeCompare(right.relatedTerm) ||
        left.sourceTerm.localeCompare(right.sourceTerm) ||
        left.direction.localeCompare(right.direction));
}
const WEAK_COOCCURRENCE_RELATIONSHIP_TYPES = new Set(['same_object', 'same_verb']);
const MIN_EVIDENCE_COUNT_FOR_WEAK_COOCCURRENCE = 2;
function relationshipTypeTier(relationshipType) {
    switch (relationshipType) {
        case 'same_skill':
            return 0;
        case 'broader_skill':
        case 'narrower_skill':
            return 1;
        default:
            return 2;
    }
}
function isLowQualityRelatedRow(row) {
    return WEAK_COOCCURRENCE_RELATIONSHIP_TYPES.has(row.relationshipType) && row.evidenceCount < MIN_EVIDENCE_COUNT_FOR_WEAK_COOCCURRENCE;
}
function collectStrings(...sections) {
    const strings = new Set();
    for (const rows of sections) {
        for (const row of rows) {
            strings.add(row.sourceTerm);
            strings.add(row.relatedTerm);
            strings.add(row.relationshipType);
            for (const value of row.sourceLabelExamples)
                strings.add(value);
            for (const value of row.relatedLabelExamples)
                strings.add(value);
        }
    }
    return [...strings].sort();
}
function requiredExactStringId(stringIdByValue, value) {
    const stringId = stringIdByValue.get(value);
    if (stringId === undefined) {
        throw new Error(`Missing binary string table value: ${value}`);
    }
    return stringId;
}
function requiredTermStringId(stringIdByValue, value) {
    const key = normalizeRelatedTerm(value);
    const stringId = stringIdByValue.get(key);
    if (stringId === undefined) {
        throw new Error(`Missing binary string table term value: ${value}`);
    }
    return stringId;
}
function normalizeRelatedTerm(value) {
    return foldSearchText(value).trim();
}
function oppositeDirection(direction) {
    return direction === 'forward' ? 'reverse' : 'forward';
}
function mergeUniqueStrings(left, right) {
    return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`ESCO related-terms manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION ||
        typeof manifest.sourceName !== 'string' ||
        typeof manifest.locale !== 'string' ||
        !isNonNegativeInteger(manifest.buildRunId) ||
        typeof manifest.generatedAt !== 'string' ||
        !isNonNegativeInteger(manifest.stringCount) ||
        !isNonNegativeInteger(manifest.verbRowCount) ||
        !isNonNegativeInteger(manifest.verbSourceKeyCount) ||
        !isNonNegativeInteger(manifest.verbRelatedKeyCount) ||
        !isNonNegativeInteger(manifest.objectRowCount) ||
        !isNonNegativeInteger(manifest.objectSourceKeyCount) ||
        !isNonNegativeInteger(manifest.objectRelatedKeyCount) ||
        !isRecord(manifest.files)) {
        throw new Error(`Invalid ESCO related-terms manifest metadata at ${manifestPath}.`);
    }
    for (const value of Object.values(manifest.files)) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid ESCO related-terms file path in manifest at ${manifestPath}.`);
        }
    }
    return manifest;
}
