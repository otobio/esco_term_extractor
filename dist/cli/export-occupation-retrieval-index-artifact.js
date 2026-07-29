import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { RETRIEVAL_INDEX_SCHEMA_VERSION, RETRIEVAL_TEXT_FIELDS, defaultOccupationRetrievalIndexManifestPath, writeFixedTable, writeStringTable, writeUint32Rows } from '../runtime/occupation-retrieval-index-artifact.js';
import { normalizeSearchText } from '../utils/texts.js';
const SEARCH_ALIAS_ROLES = new Set(['locale_primary', 'locale_supporting', 'reviewed_crosswalk']);
const NULL_U32 = 0xffffffff;
const ALIAS_AUTHORITY_WEIGHT_SCALE = 100;
const ALIAS_ROLE_RANK = {
    locale_primary: 5,
    reviewed_crosswalk: 4,
    locale_supporting: 3,
    family_supporting: 2,
    english_backbone: 1
};
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationRetrievalIndexManifestPath(options.sourceName));
    const outDir = path.dirname(manifestPath);
    const prefix = path.basename(manifestPath, '.manifest.json');
    const artifactEntry = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const records = artifactEntry.getAllRecordsWithDetails();
    const aliasRows = buildAliasRows(records);
    const textRecords = records.map(buildTextRecord);
    const locales = Array.from(new Set([...aliasRows.map((row) => row.localeCode), ...textRecords.flatMap((record) => record.localeCodes)])).sort();
    const localeIdByCode = new Map(locales.map((locale, index) => [locale, index + 1]));
    const strings = collectStrings(locales, aliasRows, textRecords);
    const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
    const aliasFixedRows = aliasRows.map((row) => [
        row.graphNodeId,
        stringId(stringIdByValue, row.canonicalLabel),
        stringId(stringIdByValue, row.alias),
        stringId(stringIdByValue, row.normalizedAlias),
        stringId(stringIdByValue, tokenPhraseText(row.aliasTokens)),
        aliasRoleId(row.aliasRole),
        row.aliasRoleRank,
        Math.round(row.weight * 1000),
        Math.round(row.authorityScore * 1000),
        row.aliasTokens.length
    ]);
    const textFixedRows = textRecords.map((record) => [
        record.graphNodeId,
        stringId(stringIdByValue, record.canonicalLabel),
        stringId(stringIdByValue, record.normalizedLabel),
        record.familyNodeId ?? NULL_U32,
        ...RETRIEVAL_TEXT_FIELDS.map((field) => stringId(stringIdByValue, record.fieldTokenText[field]))
    ]);
    const exactAlias = buildAliasKeyIndex(aliasRows, stringIdByValue, localeIdByCode, (row) => row.normalizedAlias);
    const foldedAlias = buildAliasKeyIndex(aliasRows, stringIdByValue, localeIdByCode, (row) => foldSearchText(row.normalizedAlias));
    const aliasTokenPostings = buildAliasTokenPostings(aliasRows, stringIdByValue, localeIdByCode);
    const canonical = buildCanonicalIndex(textRecords, stringIdByValue, localeIdByCode);
    const textFieldPostings = buildTextFieldPostings(textRecords, stringIdByValue, localeIdByCode);
    const files = {
        strings: `${prefix}.strings.bin`,
        aliasRows: `${prefix}.alias-rows.bin`,
        textRecords: `${prefix}.text-records.bin`,
        exactAliasIndex: `${prefix}.alias-exact.idx`,
        exactAliasRows: `${prefix}.alias-exact-rows.bin`,
        foldedAliasIndex: `${prefix}.alias-folded.idx`,
        foldedAliasRows: `${prefix}.alias-folded-rows.bin`,
        canonicalIndex: `${prefix}.canonical.idx`,
        canonicalRows: `${prefix}.canonical-rows.bin`,
        aliasTokenIndex: `${prefix}.alias-token-postings.idx`,
        aliasTokenRows: `${prefix}.alias-token-rows.bin`,
        textFieldPostingIndex: `${prefix}.field-postings.idx`,
        textPostingRows: `${prefix}.text-posting-rows.bin`
    };
    const manifest = {
        schemaVersion: RETRIEVAL_INDEX_SCHEMA_VERSION,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        locales,
        stringCount: strings.length,
        aliasRowCount: aliasRows.length,
        textRecordCount: textRecords.length,
        exactAliasKeyCount: exactAlias.indexRows.length,
        foldedAliasKeyCount: foldedAlias.indexRows.length,
        canonicalKeyCount: canonical.indexRows.length,
        aliasTokenKeyCount: aliasTokenPostings.indexRows.length,
        fieldPostingKeyCount: textFieldPostings.indexRows.length,
        files
    };
    await mkdir(outDir, { recursive: true });
    await Promise.all([
        writeFile(path.join(outDir, files.strings), writeStringTable(strings)),
        writeFile(path.join(outDir, files.aliasRows), writeFixedTable(aliasFixedRows, 10)),
        writeFile(path.join(outDir, files.textRecords), writeFixedTable(textFixedRows, 4 + RETRIEVAL_TEXT_FIELDS.length)),
        writeFile(path.join(outDir, files.exactAliasIndex), writeFixedTable(exactAlias.indexRows, 4)),
        writeFile(path.join(outDir, files.exactAliasRows), writeUint32Rows(exactAlias.postings)),
        writeFile(path.join(outDir, files.foldedAliasIndex), writeFixedTable(foldedAlias.indexRows, 4)),
        writeFile(path.join(outDir, files.foldedAliasRows), writeUint32Rows(foldedAlias.postings)),
        writeFile(path.join(outDir, files.canonicalIndex), writeFixedTable(canonical.indexRows, 4)),
        writeFile(path.join(outDir, files.canonicalRows), writeUint32Rows(canonical.postings)),
        writeFile(path.join(outDir, files.aliasTokenIndex), writeFixedTable(aliasTokenPostings.indexRows, 4)),
        writeFile(path.join(outDir, files.aliasTokenRows), writeUint32Rows(aliasTokenPostings.postings)),
        writeFile(path.join(outDir, files.textFieldPostingIndex), writeFixedTable(textFieldPostings.indexRows, 5)),
        writeFile(path.join(outDir, files.textPostingRows), writeUint32Rows(textFieldPostings.postings)),
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    ]);
    console.log(`Wrote occupation retrieval-index artifact for source=${options.sourceName}`);
    console.log(`manifest=${manifestPath}`);
    console.log(`strings=${strings.length} aliases=${aliasRows.length} records=${textRecords.length}`);
    console.log(`exact_keys=${exactAlias.indexRows.length} folded_keys=${foldedAlias.indexRows.length} field_posting_keys=${textFieldPostings.indexRows.length}`);
}
function buildAliasRows(records) {
    const rows = [];
    for (const record of records) {
        for (const alias of record.aliases) {
            if (!SEARCH_ALIAS_ROLES.has(alias.aliasRole)) {
                continue;
            }
            const normalizedAlias = alias.normalizedAlias || normalizeSearchText(alias.alias);
            const aliasRoleRank = ALIAS_ROLE_RANK[alias.aliasRole];
            const weight = alias.weight ?? 1;
            rows.push({
                graphNodeId: record.graphNodeId,
                canonicalLabel: record.canonicalLabel,
                alias: alias.alias,
                normalizedAlias,
                aliasRole: alias.aliasRole,
                aliasRoleRank,
                weight,
                authorityScore: aliasRoleRank * ALIAS_AUTHORITY_WEIGHT_SCALE + weight,
                aliasTokens: tokenizeNormalizedText(foldSearchText(normalizedAlias || alias.alias)),
                localeCode: alias.localeCode
            });
        }
    }
    return rows;
}
function buildTextRecord(record) {
    const aliasBundle = buildAliasBundle(record.aliases);
    const ancestors = record.ancestors.map((ancestor) => ancestor.canonicalLabel);
    const capabilityLabels = record.capabilityLabels.map((capability) => capability.normalizedLabel || capability.label);
    const searchText = uniqueValues([
        record.canonicalLabel,
        ...aliasBundle.aliases,
        record.familyLabel ?? '',
        record.groupLabel ?? '',
        record.parentLabel ?? '',
        ...ancestors
    ]).join('\n');
    const fields = {
        canonical_label: record.canonicalLabel,
        locale_primary_aliases_text: aliasBundle.roleAliases.locale_primary.join('\n'),
        locale_supporting_aliases_text: aliasBundle.roleAliases.locale_supporting.join('\n'),
        reviewed_crosswalk_aliases_text: aliasBundle.roleAliases.reviewed_crosswalk.join('\n'),
        family_supporting_aliases_text: aliasBundle.roleAliases.family_supporting.join('\n'),
        english_backbone_aliases_text: aliasBundle.roleAliases.english_backbone.join('\n'),
        aliases_text: aliasBundle.aliases.join('\n'),
        search_text: searchText,
        capability_text: uniqueValues(capabilityLabels).join('\n'),
        ancestor_text: uniqueValues(ancestors).join('\n')
    };
    const fieldTokens = mapTextFields((field) => tokenizeNormalizedText(foldSearchText(fields[field])));
    return {
        graphNodeId: record.graphNodeId,
        canonicalLabel: record.canonicalLabel,
        normalizedLabel: normalizeSearchText(record.canonicalLabel),
        familyNodeId: record.familyNodeId,
        localeCodes: Array.from(aliasBundle.localeCodes).sort(),
        fields,
        fieldTokens,
        fieldTokenText: mapTextFields((field) => tokenPhraseText(fieldTokens[field]))
    };
}
function buildAliasBundle(aliases) {
    const localeCodes = new Set();
    const aliasesText = [];
    const aliasSeen = new Set();
    const roleAliases = {
        locale_primary: [],
        locale_supporting: [],
        reviewed_crosswalk: [],
        family_supporting: [],
        english_backbone: []
    };
    const roleSeen = new Set();
    for (const row of aliases) {
        const alias = row.alias.trim();
        if (!alias) {
            continue;
        }
        if (row.aliasRole !== 'family_supporting') {
            localeCodes.add(row.localeCode);
            if (!aliasSeen.has(alias)) {
                aliasSeen.add(alias);
                aliasesText.push(alias);
            }
        }
        const roleKey = `${row.aliasRole}\0${alias}`;
        if (!roleSeen.has(roleKey)) {
            roleSeen.add(roleKey);
            roleAliases[row.aliasRole].push(alias);
        }
    }
    return {
        localeCodes,
        aliases: aliasesText,
        roleAliases
    };
}
function collectStrings(locales, aliasRows, textRecords) {
    const values = new Set(locales);
    for (const row of aliasRows) {
        values.add(row.canonicalLabel);
        values.add(row.alias);
        values.add(row.normalizedAlias);
        values.add(foldSearchText(row.normalizedAlias));
        values.add(tokenPhraseText(row.aliasTokens));
        for (const token of row.aliasTokens) {
            values.add(token);
        }
    }
    for (const record of textRecords) {
        values.add(record.canonicalLabel);
        values.add(record.normalizedLabel);
        values.add(foldSearchText(record.normalizedLabel));
        for (const field of RETRIEVAL_TEXT_FIELDS) {
            values.add(record.fieldTokenText[field]);
            for (const token of record.fieldTokens[field]) {
                values.add(token);
            }
        }
    }
    return Array.from(values).sort();
}
function buildAliasKeyIndex(rows, stringIdByValue, localeIdByCode, keyForRow) {
    const grouped = new Map();
    rows.forEach((row, rowIndex) => {
        const currentLocaleId = localeId(localeIdByCode, row.localeCode);
        const keyId = stringId(stringIdByValue, keyForRow(row));
        pushMap(grouped, `${currentLocaleId}\0${keyId}`, rowIndex);
    });
    return buildRangeIndex(grouped, 2);
}
function buildAliasTokenPostings(rows, stringIdByValue, localeIdByCode) {
    const grouped = new Map();
    rows.forEach((row, rowIndex) => {
        const currentLocaleId = localeId(localeIdByCode, row.localeCode);
        for (const token of new Set(row.aliasTokens)) {
            pushMap(grouped, `${currentLocaleId}\0${stringId(stringIdByValue, token)}`, rowIndex);
        }
    });
    return buildRangeIndex(grouped, 2);
}
function buildCanonicalIndex(records, stringIdByValue, localeIdByCode) {
    const grouped = new Map();
    records.forEach((record, recordIndex) => {
        const keyId = stringId(stringIdByValue, foldSearchText(record.normalizedLabel));
        for (const locale of record.localeCodes) {
            pushMap(grouped, `${localeId(localeIdByCode, locale)}\0${keyId}`, recordIndex);
        }
    });
    return buildRangeIndex(grouped, 2);
}
function buildTextFieldPostings(records, stringIdByValue, localeIdByCode) {
    const grouped = new Map();
    records.forEach((record, recordIndex) => {
        for (const locale of record.localeCodes) {
            const currentLocaleId = localeId(localeIdByCode, locale);
            RETRIEVAL_TEXT_FIELDS.forEach((field, fieldIndex) => {
                for (const token of new Set(record.fieldTokens[field])) {
                    pushMap(grouped, `${currentLocaleId}\0${fieldIndex}\0${stringId(stringIdByValue, token)}`, recordIndex);
                }
            });
        }
    });
    return buildRangeIndex(grouped, 3);
}
function buildRangeIndex(grouped, keyWidth) {
    const postings = [];
    const indexRows = Array.from(grouped.entries())
        .map(([key, values]) => {
        const keyColumns = key.split('\0').map((value) => Number.parseInt(value, 10));
        const uniqueValues = Array.from(new Set(values)).sort((left, right) => left - right);
        const offset = postings.length;
        postings.push(...uniqueValues);
        return [...keyColumns, offset, uniqueValues.length];
    })
        .sort((left, right) => {
        for (let index = 0; index < keyWidth; index += 1) {
            const delta = (left[index] ?? 0) - (right[index] ?? 0);
            if (delta !== 0) {
                return delta;
            }
        }
        return 0;
    });
    return { indexRows, postings };
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: null
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-retrieval-index-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--out=artifacts/runtime/occupation-retrieval-index.esco_1_2_1.manifest.json]'
    ].join(' '));
}
function mapTextFields(callback) {
    return Object.fromEntries(RETRIEVAL_TEXT_FIELDS.map((field) => [field, callback(field)]));
}
function tokenPhraseText(tokens) {
    return ` ${tokens.join(' ')} `;
}
function stringId(stringIdByValue, value) {
    const id = stringIdByValue.get(value);
    if (id === undefined) {
        throw new Error(`Missing string id for "${value}".`);
    }
    return id;
}
function localeId(localeIdByCode, locale) {
    const id = localeIdByCode.get(locale);
    if (id === undefined) {
        throw new Error(`Missing locale id for "${locale}".`);
    }
    return id;
}
function aliasRoleId(role) {
    if (role === 'locale_primary') {
        return 1;
    }
    if (role === 'reviewed_crosswalk') {
        return 2;
    }
    if (role === 'locale_supporting') {
        return 3;
    }
    if (role === 'family_supporting') {
        return 4;
    }
    return 5;
}
function pushMap(map, key, value) {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
}
function uniqueValues(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}
main().catch((error) => {
    console.error('Occupation retrieval-index export failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
