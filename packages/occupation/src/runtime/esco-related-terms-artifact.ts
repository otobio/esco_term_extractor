import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import {
  closeFixedTable,
  closeStringTable,
  closeUint32Rows,
  findRange,
  findStringId,
  readFileBackedFixedTableSync,
  readFileBackedStringTableSync,
  readFileBackedUint32RowsSync,
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
import { foldSearchText } from '../utils/texts.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';

export const ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION = 3;
export const ESCO_RELATED_TERMS_DIRECTION_FORWARD = 0;
export const ESCO_RELATED_TERMS_DIRECTION_REVERSE = 1;
export const ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES = 10;

const RELATIONSHIP_TYPE_CODES = [
  'same_skill',
  'same_object',
  'same_verb',
  'esco_related_skill',
  'broader_skill',
  'narrower_skill'
] as const;

export type EscoRelatedTermDirection = 'forward' | 'reverse';
export type EscoRelatedTermRelationshipType = (typeof RELATIONSHIP_TYPE_CODES)[number];

export type EscoRelatedTermBinaryRecord = {
  sourceTerm: string;
  relatedTerm: string;
  relationshipType: string;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExamples: string[];
  relatedLabelExamples: string[];
};

export type EscoRelatedTermSection = {
  sourceIndex: FixedTable;
  sourcePostings: Uint32Array | FileBackedUint32Rows;
  relatedIndex: FixedTable;
  relatedPostings: Uint32Array | FileBackedUint32Rows;
  rows: FixedTable;
};

export type EscoRelatedTermsBinaryManifest = {
  schemaVersion: 3;
  sourceName: string;
  locale: string;
  buildRunId: number;
  generatedAt: string;
  termStringCount: number;
  exampleStringCount: number;
  exampleListCount: number;
  verbRowCount: number;
  verbSourceKeyCount: number;
  verbRelatedKeyCount: number;
  objectRowCount: number;
  objectSourceKeyCount: number;
  objectRelatedKeyCount: number;
  files: {
    termStrings: string;
    exampleStrings: string;
    exampleListIndex: string;
    exampleListValues: string;
    verbRows: string;
    verbSourceIndex: string;
    verbSourcePostings: string;
    verbRelatedIndex: string;
    verbRelatedPostings: string;
    objectRows: string;
    objectSourceIndex: string;
    objectSourcePostings: string;
    objectRelatedIndex: string;
    objectRelatedPostings: string;
  };
};

export type EscoRelatedTermsBinaryArtifactEntry = {
  manifestPath: string;
  manifest: EscoRelatedTermsBinaryManifest;
  termStrings: BinaryStringTable;
  exampleStrings: BinaryStringTable;
  exampleListIndex: FixedTable;
  exampleListValues: Uint32Array | FileBackedUint32Rows;
  verbs: EscoRelatedTermSection;
  objects: EscoRelatedTermSection;
};

export type EscoRelatedTermsBinaryBuildInput = {
  sourceName: string;
  locale: string;
  buildRunId: number;
  verbRows: EscoRelatedTermBinaryRecord[];
  objectRows: EscoRelatedTermBinaryRecord[];
};

type ExamplePool = {
  listIdByKey: Map<string, number>;
  listRows: number[][];
  valueRows: number[];
  exampleStringIdByValue: Map<string, number>;
};

type BinaryRow = {
  sourceTermId: number;
  relatedTermId: number;
  relationshipTypeCode: number;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExampleListId: number;
  relatedLabelExampleListId: number;
};

const CACHE = new Map<string, RuntimeArtifactCacheEntry<EscoRelatedTermsBinaryArtifactEntry>>();
const DEFAULT_CACHE_SIZE = 2;
const RELATED_TERMS_ENV = 'OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH';
const ROW_WIDTH = 7;
const INDEX_ROW_WIDTH = 3;
const EXAMPLE_INDEX_WIDTH = 2;
const EMPTY_EXAMPLE_LIST_KEY = '';
const RELATIONSHIP_TYPE_CODE_BY_VALUE = new Map<string, number>(RELATIONSHIP_TYPE_CODES.map((value, index) => [value, index]));

export function defaultEscoRelatedTermsManifestPath(sourceName: string, locale: string): string {
  return path.join(
    getDefaultRuntimeDir(),
    `esco-related-terms.${safeFileSegment(sourceName)}.${safeFileSegment(locale)}.binary.manifest.json`
  );
}

export async function loadEscoRelatedTermsArtifactIfAvailable(
  sourceName: string,
  locale: string
): Promise<EscoRelatedTermsBinaryArtifactEntry | null> {
  const configuredPath = readOptionalEnv(RELATED_TERMS_ENV);
  const manifestPath = configuredPath ?? defaultEscoRelatedTermsManifestPath(sourceName, locale);
  const cacheKey = path.resolve(manifestPath);

  return getCachedRuntimeArtifact(CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_ESCO_RELATED_TERMS_CACHE_SIZE', DEFAULT_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName, locale),
    dispose: closeArtifact
  });
}

export async function loadEscoRelatedTermsArtifactRequired(
  sourceName: string,
  locale: string
): Promise<EscoRelatedTermsBinaryArtifactEntry> {
  const manifestPath = readOptionalEnv(RELATED_TERMS_ENV) ?? defaultEscoRelatedTermsManifestPath(sourceName, locale);
  const artifact = await loadEscoRelatedTermsArtifactIfAvailable(sourceName, locale);

  if (!artifact) {
    throw new Error(
      [
        `Missing required ESCO related-terms binary artifact for source="${sourceName}" locale="${locale}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run skills:esco:related-terms:runtime` after building the MySQL storage tables.'
      ].join(' ')
    );
  }

  return artifact;
}

export function buildEscoRelatedTermsBinaryFiles(
  input: EscoRelatedTermsBinaryBuildInput,
  prefix: string
): {
  manifestFiles: EscoRelatedTermsBinaryManifest['files'];
  buffers: Map<string, Buffer>;
  termStringCount: number;
  exampleStringCount: number;
  exampleListCount: number;
  verbRowCount: number;
  verbSourceKeyCount: number;
  verbRelatedKeyCount: number;
  objectRowCount: number;
  objectSourceKeyCount: number;
  objectRelatedKeyCount: number;
} {
  const termStrings = collectTermStrings(input.verbRows, input.objectRows);
  const exampleStrings = collectExampleStrings(input.verbRows, input.objectRows);
  const termStringIdByValue = new Map(termStrings.map((value, index) => [value, index]));
  const exampleStringIdByValue = new Map(exampleStrings.map((value, index) => [value, index]));
  const examplePool = createExamplePool(exampleStringIdByValue);
  const verb = buildSectionFiles(input.verbRows, termStringIdByValue, examplePool, `${prefix}.verb`);
  const object = buildSectionFiles(input.objectRows, termStringIdByValue, examplePool, `${prefix}.object`);
  const exampleFiles = buildExamplePoolFiles(examplePool, `${prefix}.examples`);
  const files = {
    termStrings: `${prefix}.term-strings.bin`,
    exampleStrings: `${prefix}.example-strings.bin`,
    exampleListIndex: exampleFiles.files.index,
    exampleListValues: exampleFiles.files.values,
    verbRows: verb.files.rows,
    verbSourceIndex: verb.files.sourceIndex,
    verbSourcePostings: verb.files.sourcePostings,
    verbRelatedIndex: verb.files.relatedIndex,
    verbRelatedPostings: verb.files.relatedPostings,
    objectRows: object.files.rows,
    objectSourceIndex: object.files.sourceIndex,
    objectSourcePostings: object.files.sourcePostings,
    objectRelatedIndex: object.files.relatedIndex,
    objectRelatedPostings: object.files.relatedPostings
  } satisfies EscoRelatedTermsBinaryManifest['files'];

  return {
    manifestFiles: files,
    buffers: new Map([
      [files.termStrings, writeStringTable(termStrings)],
      [files.exampleStrings, writeStringTable(exampleStrings)],
      ...exampleFiles.buffers,
      ...verb.buffers,
      ...object.buffers
    ]),
    termStringCount: termStrings.length,
    exampleStringCount: exampleStrings.length,
    exampleListCount: examplePool.listRows.length,
    verbRowCount: verb.rowCount,
    verbSourceKeyCount: verb.sourceKeyCount,
    verbRelatedKeyCount: verb.relatedKeyCount,
    objectRowCount: object.rowCount,
    objectSourceKeyCount: object.sourceKeyCount,
    objectRelatedKeyCount: object.relatedKeyCount
  };
}

export function lookupVerbRelatedTerms(
  artifact: EscoRelatedTermsBinaryArtifactEntry,
  queryVerb: string,
  limit: number
): EscoRelatedTermBinaryRecord[] {
  return lookupSectionRows(artifact, artifact.verbs, normalizeRelatedTerm(queryVerb), limit);
}

export function lookupObjectRelatedTerms(
  artifact: EscoRelatedTermsBinaryArtifactEntry,
  queryObject: string,
  limit: number
): EscoRelatedTermBinaryRecord[] {
  return lookupSectionRows(artifact, artifact.objects, normalizeRelatedTerm(queryObject), limit);
}

function loadArtifact(manifestPath: string, sourceName: string, locale: string): Promise<EscoRelatedTermsBinaryArtifactEntry | null> {
  return (async () => {
    try {
      await access(manifestPath);
    } catch {
      return null;
    }

    const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown, manifestPath);

    if (manifest.sourceName !== sourceName || manifest.locale !== locale) {
      return null;
    }

    const directory = path.dirname(manifestPath);

    return {
      manifestPath,
      manifest,
      termStrings: await readStringTable(path.resolve(directory, manifest.files.termStrings), manifest.termStringCount),
      exampleStrings: readFileBackedStringTableSync(path.resolve(directory, manifest.files.exampleStrings), manifest.exampleStringCount),
      exampleListIndex: readFileBackedFixedTableSync(
        path.resolve(directory, manifest.files.exampleListIndex),
        EXAMPLE_INDEX_WIDTH,
        manifest.exampleListCount
      ),
      exampleListValues: readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.exampleListValues)),
      verbs: loadSection(
        directory,
        manifest.files,
        'verb',
        manifest.verbRowCount,
        manifest.verbSourceKeyCount,
        manifest.verbRelatedKeyCount
      ),
      objects: loadSection(
        directory,
        manifest.files,
        'object',
        manifest.objectRowCount,
        manifest.objectSourceKeyCount,
        manifest.objectRelatedKeyCount
      )
    };
  })();
}

function closeArtifact(artifact: EscoRelatedTermsBinaryArtifactEntry): void {
  closeStringTable(artifact.termStrings);
  closeStringTable(artifact.exampleStrings);
  closeFixedTable(artifact.exampleListIndex);
  closeUint32Rows(artifact.exampleListValues);
  closeFixedTable(artifact.verbs.sourceIndex);
  closeUint32Rows(artifact.verbs.sourcePostings);
  closeFixedTable(artifact.verbs.relatedIndex);
  closeUint32Rows(artifact.verbs.relatedPostings);
  closeFixedTable(artifact.verbs.rows);
  closeFixedTable(artifact.objects.sourceIndex);
  closeUint32Rows(artifact.objects.sourcePostings);
  closeFixedTable(artifact.objects.relatedIndex);
  closeUint32Rows(artifact.objects.relatedPostings);
  closeFixedTable(artifact.objects.rows);
}

function loadSection(
  directory: string,
  files: EscoRelatedTermsBinaryManifest['files'],
  kind: 'verb' | 'object',
  rowCount: number,
  sourceKeyCount: number,
  relatedKeyCount: number
): EscoRelatedTermSection {
  const prefix = kind === 'verb' ? 'verb' : 'object';

  return {
    sourceIndex: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}SourceIndex`]), INDEX_ROW_WIDTH, sourceKeyCount),
    sourcePostings: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}SourcePostings`])),
    relatedIndex: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}RelatedIndex`]), INDEX_ROW_WIDTH, relatedKeyCount),
    relatedPostings: readFileBackedUint32RowsSync(path.resolve(directory, files[`${prefix}RelatedPostings`])),
    rows: readFileBackedFixedTableSync(path.resolve(directory, files[`${prefix}Rows`]), ROW_WIDTH, rowCount)
  };
}

function buildSectionFiles(
  rows: EscoRelatedTermBinaryRecord[],
  termStringIdByValue: Map<string, number>,
  examplePool: ExamplePool,
  prefix: string
): {
  files: {
    rows: string;
    sourceIndex: string;
    sourcePostings: string;
    relatedIndex: string;
    relatedPostings: string;
  };
  buffers: Array<[string, Buffer]>;
  rowCount: number;
  sourceKeyCount: number;
  relatedKeyCount: number;
} {
  const sortedRows = rows.filter((row) => !isLowQualityRelatedRow(row)).sort(compareBinaryRows);
  const rowValues: number[][] = [];
  const sourcePostingsByTerm = new Map<number, number[]>();
  const relatedPostingsByTerm = new Map<number, number[]>();

  sortedRows.forEach((row, rowId) => {
    const sourceTermId = requiredTermStringId(termStringIdByValue, row.sourceTerm);
    const relatedTermId = requiredTermStringId(termStringIdByValue, row.relatedTerm);
    const relationshipTypeCode = requiredRelationshipTypeCode(row.relationshipType);
    const sourceLabelExampleListId = internExampleList(examplePool, cappedLabelExamples(row.sourceLabelExamples));
    const relatedLabelExampleListId = internExampleList(examplePool, cappedLabelExamples(row.relatedLabelExamples));

    rowValues.push([
      sourceTermId,
      relatedTermId,
      relationshipTypeCode,
      row.direction === 'forward' ? ESCO_RELATED_TERMS_DIRECTION_FORWARD : ESCO_RELATED_TERMS_DIRECTION_REVERSE,
      row.evidenceCount,
      sourceLabelExampleListId,
      relatedLabelExampleListId
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
    relatedPostings: `${prefix}.related-postings.bin`
  };

  return {
    files,
    buffers: [
      [files.rows, writeFixedTable(rowValues, ROW_WIDTH)],
      [files.sourceIndex, writeFixedTable(sourceIndexRows, INDEX_ROW_WIDTH)],
      [files.sourcePostings, writeUint32Rows(sourcePostingsRows)],
      [files.relatedIndex, writeFixedTable(relatedIndexRows, INDEX_ROW_WIDTH)],
      [files.relatedPostings, writeUint32Rows(relatedPostingsRows)]
    ],
    rowCount: sortedRows.length,
    sourceKeyCount: sourceIndexRows.length,
    relatedKeyCount: relatedIndexRows.length
  };
}

function createExamplePool(exampleStringIdByValue: Map<string, number>): ExamplePool {
  return {
    listIdByKey: new Map([[EMPTY_EXAMPLE_LIST_KEY, 0]]),
    listRows: [[0, 0]],
    valueRows: [],
    exampleStringIdByValue
  };
}

function buildExamplePoolFiles(
  examplePool: ExamplePool,
  prefix: string
): {
  files: {
    index: string;
    values: string;
  };
  buffers: Array<[string, Buffer]>;
} {
  const files = {
    index: `${prefix}.index.bin`,
    values: `${prefix}.values.bin`
  };

  return {
    files,
    buffers: [
      [files.index, writeFixedTable(examplePool.listRows, EXAMPLE_INDEX_WIDTH)],
      [files.values, writeUint32Rows(examplePool.valueRows)]
    ]
  };
}

function internExampleList(examplePool: ExamplePool, values: string[]): number {
  if (values.length === 0) {
    return 0;
  }

  const exampleIds = values.map((value) => requiredExampleStringId(examplePool.exampleStringIdByValue, value));
  const key = exampleIds.join('\u0000');
  const existing = examplePool.listIdByKey.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const offset = examplePool.valueRows.length;
  const listId = examplePool.listRows.length;
  examplePool.valueRows.push(...exampleIds);
  examplePool.listRows.push([offset, exampleIds.length]);
  examplePool.listIdByKey.set(key, listId);
  return listId;
}

function cappedLabelExamples(values: string[]): string[] {
  return dedupeLabelExamples(values)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES);
}

function lookupSectionRows(
  artifact: EscoRelatedTermsBinaryArtifactEntry,
  section: EscoRelatedTermSection,
  queryTerm: string,
  limit: number
): EscoRelatedTermBinaryRecord[] {
  if (!queryTerm) {
    return [];
  }

  const candidateIds = resolveQueryTermIds(artifact.termStrings, queryTerm);
  let sourceRange: { offset: number; length: number } | null = null;
  let relatedRange: { offset: number; length: number } | null = null;
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

  const matches = new Map<number, { sourceSide: boolean; relatedSide: boolean }>();

  addRange(matches, section.sourcePostings, sourceRange, true);
  addRange(matches, section.relatedPostings, relatedRange, false);

  const results: EscoRelatedTermBinaryRecord[] = [];

  for (const [rowId, match] of [...matches.entries()].sort((left, right) => left[0] - right[0])) {
    const row = readRow(section.rows, rowId);
    results.push(orientRow(artifact, row, queryTermId, match.sourceSide));
  }

  return mergeBinaryRows(results).slice(0, limit);
}

function resolveQueryTermIds(strings: BinaryStringTable, queryTerm: string): number[] {
  const ids: number[] = [];
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

function pluralFoldedCandidates(term: string): string[] {
  const candidates = new Set<string>();

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

function addRange(
  matches: Map<number, { sourceSide: boolean; relatedSide: boolean }>,
  postings: Uint32Array | FileBackedUint32Rows,
  range: { offset: number; length: number } | null,
  sourceSide: boolean
): void {
  if (!range || range.length === 0) {
    return;
  }

  for (const rowId of uint32RowsSlice(postings, range.offset, range.length)) {
    const current = matches.get(rowId) ?? { sourceSide: false, relatedSide: false };
    current[sourceSide ? 'sourceSide' : 'relatedSide'] = true;
    matches.set(rowId, current);
  }
}

function orientRow(
  artifact: EscoRelatedTermsBinaryArtifactEntry,
  row: BinaryRow,
  queryTermId: number,
  sourceSide: boolean
): EscoRelatedTermBinaryRecord {
  const relatedTermId = sourceSide ? row.relatedTermId : row.sourceTermId;
  const sourceLabelExamples = sourceSide
    ? readExampleList(artifact, row.sourceLabelExampleListId)
    : readExampleList(artifact, row.relatedLabelExampleListId);
  const relatedLabelExamples = sourceSide
    ? readExampleList(artifact, row.relatedLabelExampleListId)
    : readExampleList(artifact, row.sourceLabelExampleListId);

  return {
    sourceTerm: stringAt(artifact.termStrings, queryTermId),
    relatedTerm: stringAt(artifact.termStrings, relatedTermId),
    relationshipType: relationshipTypeFromCode(row.relationshipTypeCode),
    direction: sourceSide ? row.direction : oppositeDirection(row.direction),
    evidenceCount: row.evidenceCount,
    sourceLabelExamples,
    relatedLabelExamples
  };
}

function readExampleList(artifact: EscoRelatedTermsBinaryArtifactEntry, listId: number): string[] {
  if (listId < 0 || listId >= artifact.exampleListIndex.count) {
    return [];
  }

  const offset = rowValue(artifact.exampleListIndex, listId, 0);
  const length = rowValue(artifact.exampleListIndex, listId, 1);

  if (length <= 0) {
    return [];
  }

  return uint32RowsSlice(artifact.exampleListValues, offset, length).map((stringId) => stringAt(artifact.exampleStrings, stringId));
}

function mergeBinaryRows(rows: EscoRelatedTermBinaryRecord[]): EscoRelatedTermBinaryRecord[] {
  const byKey = new Map<string, EscoRelatedTermBinaryRecord>();

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
    current.sourceLabelExamples = mergeUniqueStrings(current.sourceLabelExamples, row.sourceLabelExamples).slice(
      0,
      ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES
    );
    current.relatedLabelExamples = mergeUniqueStrings(current.relatedLabelExamples, row.relatedLabelExamples).slice(
      0,
      ESCO_RELATED_TERMS_MAX_LABEL_EXAMPLES
    );
  }

  return [...byKey.values()].sort(
    (left, right) =>
      right.evidenceCount - left.evidenceCount ||
      left.relationshipType.localeCompare(right.relationshipType) ||
      left.relatedTerm.localeCompare(right.relatedTerm) ||
      left.direction.localeCompare(right.direction)
  );
}

function readRow(table: FixedTable, rowIndex: number): BinaryRow {
  return {
    sourceTermId: rowValue(table, rowIndex, 0),
    relatedTermId: rowValue(table, rowIndex, 1),
    relationshipTypeCode: rowValue(table, rowIndex, 2),
    direction: rowValue(table, rowIndex, 3) === ESCO_RELATED_TERMS_DIRECTION_FORWARD ? 'forward' : 'reverse',
    evidenceCount: rowValue(table, rowIndex, 4),
    sourceLabelExampleListId: rowValue(table, rowIndex, 5),
    relatedLabelExampleListId: rowValue(table, rowIndex, 6)
  };
}

function buildIndexRows(postingsByTerm: Map<number, number[]>): number[][] {
  return [...postingsByTerm.keys()].sort((left, right) => left - right).map((termId) => [termId, 0, 0]);
}

function collectPostingRows(postingsByTerm: Map<number, number[]>, indexRows: number[][]): number[] {
  const rows: number[] = [];
  const sortedTerms = [...postingsByTerm.entries()].sort((left, right) => left[0] - right[0]);

  sortedTerms.forEach(([termId, postings], index) => {
    const uniquePostings = [...new Set(postings)].sort((left, right) => left - right);
    const offset = rows.length;
    rows.push(...uniquePostings);
    const indexRow = indexRows[index];

    if (indexRow?.[0] !== termId) {
      throw new Error(`Posting index term mismatch for term id ${termId}.`);
    }

    indexRow[1] = offset;
    indexRow[2] = uniquePostings.length;
  });

  return rows;
}

function addPosting(postingsByTerm: Map<number, number[]>, termId: number, rowId: number): void {
  const postings = postingsByTerm.get(termId) ?? [];
  postings.push(rowId);
  postingsByTerm.set(termId, postings);
}

function compareBinaryRows(left: EscoRelatedTermBinaryRecord, right: EscoRelatedTermBinaryRecord): number {
  return (
    relationshipTypeTier(left.relationshipType) - relationshipTypeTier(right.relationshipType) ||
    right.evidenceCount - left.evidenceCount ||
    left.relationshipType.localeCompare(right.relationshipType) ||
    left.relatedTerm.localeCompare(right.relatedTerm) ||
    left.sourceTerm.localeCompare(right.sourceTerm) ||
    left.direction.localeCompare(right.direction)
  );
}

const WEAK_COOCCURRENCE_RELATIONSHIP_TYPES = new Set(['same_object', 'same_verb']);
const MIN_EVIDENCE_COUNT_FOR_WEAK_COOCCURRENCE = 2;

function relationshipTypeTier(relationshipType: string): number {
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

function isLowQualityRelatedRow(row: EscoRelatedTermBinaryRecord): boolean {
  return WEAK_COOCCURRENCE_RELATIONSHIP_TYPES.has(row.relationshipType) && row.evidenceCount < MIN_EVIDENCE_COUNT_FOR_WEAK_COOCCURRENCE;
}

function collectTermStrings(...sections: EscoRelatedTermBinaryRecord[][]): string[] {
  const strings = new Set<string>();

  for (const rows of sections) {
    for (const row of rows) {
      strings.add(row.sourceTerm);
      strings.add(row.relatedTerm);
    }
  }

  return [...strings].sort();
}

function collectExampleStrings(...sections: EscoRelatedTermBinaryRecord[][]): string[] {
  const strings = new Set<string>();

  for (const rows of sections) {
    for (const row of rows) {
      for (const value of cappedLabelExamples(row.sourceLabelExamples)) strings.add(value);
      for (const value of cappedLabelExamples(row.relatedLabelExamples)) strings.add(value);
    }
  }

  return [...strings].sort();
}

function requiredTermStringId(stringIdByValue: Map<string, number>, value: string): number {
  const key = normalizeRelatedTerm(value);
  const stringId = stringIdByValue.get(key);

  if (stringId === undefined) {
    throw new Error(`Missing binary term string table value: ${value}`);
  }

  return stringId;
}

function requiredExampleStringId(stringIdByValue: Map<string, number>, value: string): number {
  const stringId = stringIdByValue.get(value);

  if (stringId === undefined) {
    throw new Error(`Missing binary example string table value: ${value}`);
  }

  return stringId;
}

function requiredRelationshipTypeCode(value: string): number {
  const code = RELATIONSHIP_TYPE_CODE_BY_VALUE.get(value);

  if (code === undefined) {
    throw new Error(`Unsupported ESCO related-term relationship type: ${value}`);
  }

  return code;
}

function relationshipTypeFromCode(code: number): EscoRelatedTermRelationshipType {
  const value = RELATIONSHIP_TYPE_CODES[code];

  if (!value) {
    throw new Error(`Unsupported ESCO related-term relationship type code: ${code}`);
  }

  return value;
}

function normalizeRelatedTerm(value: string): string {
  return foldSearchText(value).trim();
}

function oppositeDirection(direction: EscoRelatedTermDirection): EscoRelatedTermDirection {
  return direction === 'forward' ? 'reverse' : 'forward';
}

function mergeUniqueStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}

function dedupeLabelExamples(values: string[]): string[] {
  const byNormalizedValue = new Map<string, string>();

  for (const value of values) {
    if (value.startsWith('relation:')) {
      continue;
    }

    const normalized = foldSearchText(value).trim();

    if (!normalized) {
      continue;
    }

    const current = byNormalizedValue.get(normalized);

    if (!current || compareDisplayLabelExample(value, current) < 0) {
      byNormalizedValue.set(normalized, value);
    }
  }

  return [...byNormalizedValue.values()];
}

function compareDisplayLabelExample(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function validateManifest(value: unknown, manifestPath: string): EscoRelatedTermsBinaryManifest {
  if (!isRecord(value)) {
    throw new Error(`ESCO related-terms manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = value as Partial<EscoRelatedTermsBinaryManifest>;

  if (
    manifest.schemaVersion !== ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.locale !== 'string' ||
    !isNonNegativeInteger(manifest.buildRunId) ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.termStringCount) ||
    !isNonNegativeInteger(manifest.exampleStringCount) ||
    !isNonNegativeInteger(manifest.exampleListCount) ||
    !isNonNegativeInteger(manifest.verbRowCount) ||
    !isNonNegativeInteger(manifest.verbSourceKeyCount) ||
    !isNonNegativeInteger(manifest.verbRelatedKeyCount) ||
    !isNonNegativeInteger(manifest.objectRowCount) ||
    !isNonNegativeInteger(manifest.objectSourceKeyCount) ||
    !isNonNegativeInteger(manifest.objectRelatedKeyCount) ||
    !isRecord(manifest.files)
  ) {
    throw new Error(`Invalid ESCO related-terms manifest metadata at ${manifestPath}.`);
  }

  for (const fileValue of Object.values(manifest.files)) {
    if (typeof fileValue !== 'string') {
      throw new Error(`Invalid ESCO related-terms file path in manifest at ${manifestPath}.`);
    }
  }

  return manifest as EscoRelatedTermsBinaryManifest;
}
