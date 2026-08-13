import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { foldSearchText } from '../query/query-preparation.js';
import { closeFixedTable, closeUint32Rows, readFileBackedUint32RowsSync, readFixedTableSync, readStringTableSync, rowValue, stringAt, uint32RowsSlice, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
import { isNonNegativeInteger, isRecord } from '../utils/validation.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
import { defaultRuntimeReviewJsonPath, runtimeReviewArtifactBaseName } from './runtime-review-artifacts.js';
const SUPPORTED_EQUIVALENCE_LOCALES = ['en', 'ro', 'hu', 'et', 'unknown'];
const LOCALE_CODE_BY_VALUE = new Map([
    ['en', 0],
    ['ro', 1],
    ['hu', 2],
    ['et', 3],
    ['unknown', 4]
]);
const LOCALE_VALUE_BY_CODE = ['en', 'ro', 'hu', 'et', 'unknown'];
const ROLE_HEAD_EQUIVALENCE_BINARY_SCHEMA_VERSION = 1;
const ROLE_HEAD_EQUIVALENCE_TERM_ROW_WIDTH = 4;
const ROLE_HEAD_EQUIVALENTS_ENV = 'OCCUPATION_ROLE_HEAD_EQUIVALENTS_ARTIFACT_PATH';
let cachedEquivalents = null;
let cachedEquivalentsPath = null;
export function defaultOccupationRoleHeadEquivalentsArtifactPath() {
    return path.join(getDefaultRuntimeDir(), 'occupation-role-head-equivalents.binary.manifest.json');
}
export function defaultOccupationRoleHeadEquivalentsReviewPath() {
    return defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-role-head-equivalents'));
}
export function loadOccupationRoleHeadEquivalenceArtifactRequired() {
    const artifactPath = readOptionalEnv(ROLE_HEAD_EQUIVALENTS_ENV) ?? defaultOccupationRoleHeadEquivalentsArtifactPath();
    if (!cachedEquivalents || cachedEquivalentsPath !== artifactPath) {
        cachedEquivalents = loadRoleHeadEquivalenceArtifact(artifactPath);
        cachedEquivalentsPath = artifactPath;
    }
    return cachedEquivalents;
}
export function buildRoleHeadEquivalenceBinaryFiles(artifact, prefix) {
    const normalizedClasses = normalizeArtifactClasses(artifact);
    const strings = collectStrings(normalizedClasses);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const classIdsByLocaleAndTerm = new Map();
    const termRows = [];
    const classIds = [];
    for (const equivalenceClass of normalizedClasses.classes) {
        for (const [locale, terms] of Object.entries(equivalenceClass.termsByLocale)) {
            for (const term of terms ?? []) {
                const localeLookup = mutableLookupForLocale(classIdsByLocaleAndTerm, locale);
                let termClassIds = localeLookup.get(term);
                if (!termClassIds) {
                    termClassIds = new Set();
                    localeLookup.set(term, termClassIds);
                }
                termClassIds.add(equivalenceClass.id);
            }
        }
    }
    for (const [locale, localeTerms] of [...classIdsByLocaleAndTerm.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        for (const [term, ids] of [...localeTerms.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            const offset = classIds.length;
            const sortedIds = [...ids].sort();
            classIds.push(...sortedIds.map((id) => requiredStringId(stringIdByValue, id)));
            termRows.push([requiredLocaleCode(locale), requiredStringId(stringIdByValue, term), offset, sortedIds.length]);
        }
    }
    const files = {
        strings: `${prefix}.strings.bin`,
        termRows: `${prefix}.term-rows.bin`,
        classIds: `${prefix}.class-ids.bin`
    };
    return {
        manifestFiles: files,
        buffers: new Map([
            [files.strings, writeStringTable(strings)],
            [files.termRows, writeFixedTable(termRows, ROLE_HEAD_EQUIVALENCE_TERM_ROW_WIDTH)],
            [files.classIds, writeUint32Rows(classIds)]
        ]),
        stringCount: strings.length,
        termCount: termRows.length,
        classIdValueCount: classIds.length
    };
}
export function parseRoleHeadEquivalenceArtifact(contents, artifactPath) {
    const parsed = JSON.parse(contents);
    if (!isRoleHeadEquivalenceArtifact(parsed)) {
        throw new Error(`Invalid role-head equivalence artifact: ${artifactPath}`);
    }
    return {
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        classes: parsed.classes.map((equivalenceClass) => ({
            id: equivalenceClass.id,
            terms: equivalenceClass.terms,
            termsByLocale: equivalenceClass.termsByLocale
        }))
    };
}
function loadRoleHeadEquivalenceArtifact(artifactPath) {
    const manifest = validateManifest(JSON.parse(readFileSync(artifactPath, 'utf8')), artifactPath);
    const directory = path.dirname(artifactPath);
    const strings = readStringTableSync(path.resolve(directory, manifest.files.strings), manifest.stringCount);
    const termRows = readFixedTableSync(path.resolve(directory, manifest.files.termRows), ROLE_HEAD_EQUIVALENCE_TERM_ROW_WIDTH, manifest.termCount);
    const classIds = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.classIds));
    try {
        const mutable = new Map();
        for (let rowIndex = 0; rowIndex < termRows.count; rowIndex += 1) {
            const locale = localeFromCode(rowValue(termRows, rowIndex, 0));
            const term = stringAt(strings, rowValue(termRows, rowIndex, 1));
            const offset = rowValue(termRows, rowIndex, 2);
            const count = rowValue(termRows, rowIndex, 3);
            const ids = uint32RowsSlice(classIds, offset, count).map((stringId) => stringAt(strings, stringId));
            const localeLookup = mutableLookupForLocale(mutable, locale);
            localeLookup.set(term, new Set(ids));
        }
        return {
            artifactPath,
            manifest,
            lookup: {
                classIdsByLocaleAndTerm: freezeLookup(mutable)
            }
        };
    }
    finally {
        closeFixedTable(termRows);
        closeUint32Rows(classIds);
    }
}
function normalizeArtifactClasses(artifact) {
    const normalizedClasses = artifact.classes
        .map((equivalenceClass) => {
        const globalTerms = uniqueFoldedTerms(equivalenceClass.terms ?? []);
        const termsByLocale = new Map();
        for (const locale of SUPPORTED_EQUIVALENCE_LOCALES) {
            const localeTerms = uniqueFoldedTerms(equivalenceClass.termsByLocale[locale] ?? []);
            const terms = uniqueSortedStrings([...globalTerms, ...localeTerms]);
            if (terms.length > 0) {
                termsByLocale.set(locale, terms);
            }
        }
        const conceptTerms = uniqueSortedStrings([...globalTerms, ...[...termsByLocale.values()].flat()]);
        if (conceptTerms.length < 2) {
            throw new Error(`Invalid role-head equivalence class "${equivalenceClass.id}"; expected at least two folded terms.`);
        }
        return {
            id: equivalenceClass.id,
            termsByLocale: compactTermsByLocaleRecord(termsByLocale)
        };
    })
        .sort((left, right) => left.id.localeCompare(right.id));
    return {
        description: artifact.description,
        classes: normalizedClasses
    };
}
function isRoleHeadEquivalenceArtifact(value) {
    return isRecord(value) && Array.isArray(value.classes) && value.classes.every(isRoleHeadEquivalenceClass);
}
function isRoleHeadEquivalenceClass(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        (value.terms === undefined || isStringArray(value.terms)) &&
        isLocaleTermMap(value.termsByLocale));
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function isLocaleTermMap(value) {
    return isRecord(value) && Object.entries(value).every(([locale, terms]) => isSupportedEquivalenceLocale(locale) && isStringArray(terms));
}
function isSupportedEquivalenceLocale(locale) {
    return SUPPORTED_EQUIVALENCE_LOCALES.includes(locale);
}
function collectStrings(artifact) {
    const values = new Set();
    for (const equivalenceClass of artifact.classes) {
        values.add(equivalenceClass.id);
        for (const terms of Object.values(equivalenceClass.termsByLocale)) {
            for (const term of terms ?? []) {
                values.add(term);
            }
        }
    }
    return [...values].sort();
}
function requiredStringId(stringIdByValue, value) {
    const id = stringIdByValue.get(value);
    if (id === undefined) {
        throw new Error(`Missing string id for "${value}".`);
    }
    return id;
}
function requiredLocaleCode(locale) {
    const code = LOCALE_CODE_BY_VALUE.get(locale);
    if (code === undefined) {
        throw new Error(`Unsupported role-head equivalence locale: ${locale}`);
    }
    return code;
}
function localeFromCode(code) {
    const locale = LOCALE_VALUE_BY_CODE[code];
    if (!locale) {
        throw new Error(`Unsupported role-head equivalence locale code: ${code}`);
    }
    return locale;
}
function compactTermsByLocaleRecord(termsByLocale) {
    const record = {};
    for (const [locale, terms] of termsByLocale) {
        if (terms.length > 0) {
            record[locale] = [...terms].sort();
        }
    }
    return record;
}
function mutableLookupForLocale(mutable, locale) {
    let lookup = mutable.get(locale);
    if (!lookup) {
        lookup = new Map();
        mutable.set(locale, lookup);
    }
    return lookup;
}
function freezeLookup(mutable) {
    return new Map([...mutable.entries()].map(([locale, terms]) => [
        locale,
        new Map([...terms.entries()].map(([term, values]) => [term, [...values].sort()]))
    ]));
}
function uniqueFoldedTerms(terms) {
    return uniqueSortedStrings(terms.map((term) => foldSearchText(term)).filter((term) => term.length > 0));
}
function uniqueSortedStrings(values) {
    return [...new Set(values)].sort();
}
function validateManifest(value, artifactPath) {
    if (!isRecord(value)) {
        throw new Error(`Invalid role-head equivalence artifact manifest: ${artifactPath}`);
    }
    const schemaVersion = value.schemaVersion;
    const classCount = value.classCount;
    const stringCount = value.stringCount;
    const termCount = value.termCount;
    const classIdValueCount = value.classIdValueCount;
    const files = value.files;
    if (schemaVersion !== ROLE_HEAD_EQUIVALENCE_BINARY_SCHEMA_VERSION ||
        !isNonNegativeInteger(classCount) ||
        !isNonNegativeInteger(stringCount) ||
        !isNonNegativeInteger(termCount) ||
        !isNonNegativeInteger(classIdValueCount) ||
        !isRecord(files) ||
        typeof files.strings !== 'string' ||
        typeof files.termRows !== 'string' ||
        typeof files.classIds !== 'string') {
        throw new Error(`Invalid role-head equivalence artifact manifest: ${artifactPath}`);
    }
    return {
        schemaVersion: ROLE_HEAD_EQUIVALENCE_BINARY_SCHEMA_VERSION,
        generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
        description: typeof value.description === 'string' ? value.description : undefined,
        classCount,
        stringCount,
        termCount,
        classIdValueCount,
        files: {
            strings: files.strings,
            termRows: files.termRows,
            classIds: files.classIds
        }
    };
}
