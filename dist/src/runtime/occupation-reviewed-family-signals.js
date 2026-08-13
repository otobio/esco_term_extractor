import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { occupationRoleHeadSharesEquivalentClass } from '../query/occupation-role-head-equivalence.js';
import { foldSearchText } from '../query/query-preparation.js';
import { closeFixedTable, closeUint32Rows, readFileBackedUint32RowsSync, readFixedTableSync, readStringTableSync, rowValue, stringAt, uint32RowsSlice, writeFixedTable, writeStringTable, writeUint32Rows } from '../utils/binary-table.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
import { isNonNegativeInteger, isPositiveInteger, isRecord, isStringArray } from '../utils/validation.js';
const REVIEWED_FAMILY_SIGNAL_BINARY_SCHEMA_VERSION = 1;
const REVIEWED_FAMILY_SIGNAL_ROW_WIDTH = 13;
const REVIEWED_FAMILY_SIGNAL_SCORE_SCALE = 1_000_000;
const REVIEWED_FAMILY_SIGNAL_NULL_U32 = 0xffffffff;
const REVIEWED_FAMILY_SIGNALS_ENV = 'OCCUPATION_REVIEWED_FAMILY_SIGNALS_ARTIFACT_PATH';
const LOCALE_CODE_BY_VALUE = new Map([
    ['en', 0],
    ['ro', 1],
    ['hu', 2],
    ['et', 3],
    ['unknown', 4]
]);
const LOCALE_VALUE_BY_CODE = ['en', 'ro', 'hu', 'et', 'unknown'];
let cachedArtifact = null;
let cachedArtifactPath = null;
export function defaultOccupationReviewedFamilySignalsArtifactPath() {
    return path.join(getDefaultRuntimeDir(), 'occupation-reviewed-family-signals.binary.manifest.json');
}
export function loadOccupationReviewedFamilySignalsArtifactRequired() {
    const artifactPath = readOptionalEnv(REVIEWED_FAMILY_SIGNALS_ENV) ?? defaultOccupationReviewedFamilySignalsArtifactPath();
    if (!cachedArtifact || cachedArtifactPath !== artifactPath) {
        cachedArtifact = loadBinaryReviewedFamilySignalArtifact(artifactPath);
        cachedArtifactPath = artifactPath;
    }
    return {
        artifactPath,
        artifact: cachedArtifact
    };
}
export function parseReviewedFamilySignalArtifact(contents, artifactPath) {
    const parsed = JSON.parse(contents);
    if (!isReviewedFamilySignalArtifact(parsed)) {
        throw new Error(`Invalid reviewed family signal artifact: ${artifactPath}`);
    }
    return {
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        rules: parsed.rules.map(normalizeRule)
    };
}
export function buildReviewedFamilySignalBinaryFiles(artifact, prefix) {
    const strings = collectStrings(artifact.rules);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const termIds = [];
    const rows = artifact.rules.map((rule) => {
        const roleHeadsAny = foldTerms(rule.roleHeadsAny ?? []);
        const queryTermsAny = foldTerms(rule.queryTermsAny ?? []);
        const queryTermsAll = foldTerms(rule.queryTermsAll ?? []);
        const roleHeadOffset = termIds.length;
        termIds.push(...roleHeadsAny.map((term) => requiredStringId(stringIdByValue, term)));
        const queryAnyOffset = termIds.length;
        termIds.push(...queryTermsAny.map((term) => requiredStringId(stringIdByValue, term)));
        const queryAllOffset = termIds.length;
        termIds.push(...queryTermsAll.map((term) => requiredStringId(stringIdByValue, term)));
        return [
            requiredStringId(stringIdByValue, rule.id),
            requiredLocaleCode(rule.locale),
            rule.familyNodeId,
            requiredStringId(stringIdByValue, rule.familyLabel),
            rule.action === 'support' ? 1 : 2,
            Math.round(rule.score * REVIEWED_FAMILY_SIGNAL_SCORE_SCALE),
            roleHeadOffset,
            roleHeadsAny.length,
            queryAnyOffset,
            queryTermsAny.length,
            queryAllOffset,
            queryTermsAll.length,
            rule.notes ? requiredStringId(stringIdByValue, rule.notes) : REVIEWED_FAMILY_SIGNAL_NULL_U32
        ];
    });
    const files = {
        strings: `${prefix}.strings.bin`,
        rows: `${prefix}.rows.bin`,
        termIds: `${prefix}.term-ids.bin`
    };
    return {
        manifestFiles: files,
        buffers: new Map([
            [files.strings, writeStringTable(strings)],
            [files.rows, writeFixedTable(rows, REVIEWED_FAMILY_SIGNAL_ROW_WIDTH)],
            [files.termIds, writeUint32Rows(termIds)]
        ]),
        stringCount: strings.length,
        termIdCount: termIds.length
    };
}
export function findReviewedFamilySignalMatches(preparedQuery, artifact) {
    const locale = preparedQuery.locale;
    const queryTerms = queryTermsForPreparedQuery(preparedQuery);
    const queryTermSet = new Set(queryTerms);
    const roleTokens = preparedQuery.intent.roleTokens.length > 0 ? preparedQuery.intent.roleTokens : preparedQuery.usefulFoldedTokens;
    return artifact.rules
        .filter((rule) => rule.locale === locale || rule.locale === 'unknown')
        .map((rule) => matchRule(rule, roleTokens, queryTermSet, locale))
        .filter((match) => match !== null);
}
function loadBinaryReviewedFamilySignalArtifact(manifestPath) {
    const manifest = validateBinaryManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath);
    const directory = path.dirname(manifestPath);
    const strings = readStringTableSync(path.resolve(directory, manifest.files.strings), manifest.stringCount);
    const rows = readFixedTableSync(path.resolve(directory, manifest.files.rows), REVIEWED_FAMILY_SIGNAL_ROW_WIDTH, manifest.ruleCount);
    const termIds = readFileBackedUint32RowsSync(path.resolve(directory, manifest.files.termIds));
    try {
        const rules = [];
        for (let rowIndex = 0; rowIndex < rows.count; rowIndex += 1) {
            rules.push({
                id: stringAt(strings, rowValue(rows, rowIndex, 0)),
                locale: localeFromCode(rowValue(rows, rowIndex, 1)),
                familyNodeId: rowValue(rows, rowIndex, 2),
                familyLabel: stringAt(strings, rowValue(rows, rowIndex, 3)),
                action: rowValue(rows, rowIndex, 4) === 1 ? 'support' : 'suppress',
                score: rowValue(rows, rowIndex, 5) / REVIEWED_FAMILY_SIGNAL_SCORE_SCALE,
                roleHeadsAny: decodeTerms(strings, termIds, rowValue(rows, rowIndex, 6), rowValue(rows, rowIndex, 7)),
                queryTermsAny: decodeTerms(strings, termIds, rowValue(rows, rowIndex, 8), rowValue(rows, rowIndex, 9)),
                queryTermsAll: decodeTerms(strings, termIds, rowValue(rows, rowIndex, 10), rowValue(rows, rowIndex, 11)),
                notes: decodeOptionalString(strings, rowValue(rows, rowIndex, 12))
            });
        }
        return {
            description: typeof manifest.description === 'string' ? manifest.description : undefined,
            rules: rules.map(normalizeRule)
        };
    }
    finally {
        closeFixedTable(rows);
        closeUint32Rows(termIds);
    }
}
function matchRule(rule, roleTokens, queryTermSet, locale) {
    const foldedRuleRoleHeads = foldTerms(rule.roleHeadsAny ?? []);
    const matchedRoleHeads = foldedRuleRoleHeads.length === 0
        ? []
        : roleTokens.filter((token) => {
            const foldedToken = foldSearchText(token);
            const labelTokens = new Set(foldedRuleRoleHeads);
            return labelTokens.has(foldedToken) || occupationRoleHeadSharesEquivalentClass(foldedToken, locale, labelTokens);
        });
    if (foldedRuleRoleHeads.length > 0 && matchedRoleHeads.length === 0) {
        return null;
    }
    const queryTermsAny = foldTerms(rule.queryTermsAny ?? []);
    const queryTermsAll = foldTerms(rule.queryTermsAll ?? []);
    const matchedAnyTerms = queryTermsAny.filter((term) => queryTermSet.has(term));
    const matchedAllTerms = queryTermsAll.filter((term) => queryTermSet.has(term));
    if (queryTermsAny.length > 0 && matchedAnyTerms.length === 0) {
        return null;
    }
    if (queryTermsAll.length > 0 && matchedAllTerms.length !== queryTermsAll.length) {
        return null;
    }
    if (queryTermsAny.length === 0 && queryTermsAll.length === 0) {
        return null;
    }
    return {
        rule,
        matchedRoleHeads: uniqueSortedStrings(matchedRoleHeads.map((token) => foldSearchText(token))),
        matchedQueryTerms: uniqueSortedStrings([...matchedAnyTerms, ...matchedAllTerms]),
        missingAllTerms: queryTermsAll.filter((term) => !matchedAllTerms.includes(term))
    };
}
function queryTermsForPreparedQuery(preparedQuery) {
    return uniqueSortedStrings([
        ...preparedQuery.usefulFoldedTokens,
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.roleHeadTokens,
        ...preparedQuery.intent.domainTokens,
        ...preparedQuery.intent.venueTokens
    ]
        .map((token) => foldSearchText(token))
        .filter((token) => token.length > 0));
}
function collectStrings(rules) {
    return uniqueSortedStrings(rules.flatMap((rule) => [
        rule.id,
        rule.familyLabel,
        ...(rule.roleHeadsAny ?? []),
        ...(rule.queryTermsAny ?? []),
        ...(rule.queryTermsAll ?? []),
        ...(rule.notes ? [rule.notes] : [])
    ]));
}
function decodeTerms(strings, termIds, offset, length) {
    if (length === 0) {
        return [];
    }
    return uniqueSortedStrings(uint32RowsSlice(termIds, offset, length)
        .map((stringId) => stringAt(strings, stringId))
        .filter(Boolean));
}
function decodeOptionalString(strings, stringId) {
    if (stringId === REVIEWED_FAMILY_SIGNAL_NULL_U32) {
        return undefined;
    }
    const value = stringAt(strings, stringId);
    return value || undefined;
}
function foldTerms(terms) {
    return uniqueSortedStrings(terms.map((term) => foldSearchText(term)).filter((term) => term.length > 0));
}
function normalizeRule(rule) {
    return {
        ...rule,
        roleHeadsAny: foldTerms(rule.roleHeadsAny ?? []),
        queryTermsAny: foldTerms(rule.queryTermsAny ?? []),
        queryTermsAll: foldTerms(rule.queryTermsAll ?? [])
    };
}
function validateBinaryManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation reviewed family signals binary manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== REVIEWED_FAMILY_SIGNAL_BINARY_SCHEMA_VERSION ||
        typeof manifest.generatedAt !== 'string' ||
        !isNonNegativeInteger(manifest.ruleCount) ||
        !isNonNegativeInteger(manifest.stringCount) ||
        !isNonNegativeInteger(manifest.termIdCount) ||
        !isRecord(manifest.files)) {
        throw new Error(`Invalid occupation reviewed family signals binary manifest metadata at ${manifestPath}.`);
    }
    for (const value of Object.values(manifest.files)) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`Invalid reviewed family signals binary file path in manifest at ${manifestPath}.`);
        }
    }
    return manifest;
}
function isReviewedFamilySignalArtifact(value) {
    return isRecord(value) && Array.isArray(value.rules) && value.rules.every(isReviewedFamilySignalRule);
}
function isReviewedFamilySignalRule(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        isSupportedLocale(value.locale) &&
        isPositiveInteger(value.familyNodeId) &&
        typeof value.familyLabel === 'string' &&
        value.familyLabel.trim().length > 0 &&
        (value.action === 'support' || value.action === 'suppress') &&
        (value.roleHeadsAny === undefined || isStringArray(value.roleHeadsAny)) &&
        (value.queryTermsAny === undefined || isStringArray(value.queryTermsAny)) &&
        (value.queryTermsAll === undefined || isStringArray(value.queryTermsAll)) &&
        typeof value.score === 'number' &&
        Number.isFinite(value.score) &&
        value.score > 0 &&
        value.score <= 1 &&
        (value.notes === undefined || typeof value.notes === 'string'));
}
function isSupportedLocale(locale) {
    return locale === 'en' || locale === 'ro' || locale === 'hu' || locale === 'et' || locale === 'unknown';
}
function localeFromCode(code) {
    return LOCALE_VALUE_BY_CODE[code] ?? 'unknown';
}
function requiredLocaleCode(locale) {
    const code = LOCALE_CODE_BY_VALUE.get(locale);
    if (code === undefined) {
        throw new Error(`Unsupported reviewed family signal locale: ${locale}`);
    }
    return code;
}
function requiredStringId(stringIdByValue, value) {
    const stringId = stringIdByValue.get(value);
    if (stringId === undefined) {
        throw new Error(`Missing reviewed family signal string id for value="${value}".`);
    }
    return stringId;
}
function uniqueSortedStrings(values) {
    return [...new Set(values.filter(Boolean))].sort();
}
