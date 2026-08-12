import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { buildEscoRelatedTermsBinaryFiles, ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION } from '../runtime/esco-related-terms-artifact.js';
import { DEFAULT_RUNTIME_DIR } from '../runtime/runtime-dir.js';
import { foldSearchText } from '../utils/texts.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    await withConnection(async (connection) => {
        const buildRun = await loadLatestBuildRun(connection, options.sourceName);
        const locales = options.locales ?? (await resolveLocales(connection, buildRun, options.sourceName));
        if (locales.length === 0) {
            throw new Error(`No locales found for build run ${buildRun.id}.`);
        }
        await mkdir(options.outDir, { recursive: true });
        for (const locale of locales) {
            const [verbRows, objectRows] = await Promise.all([
                loadVerbRows(connection, buildRun.id, options.sourceName, locale),
                loadObjectRows(connection, buildRun.id, options.sourceName, locale)
            ]);
            const prefix = path.join(options.outDir, `esco-related-terms.${safeSegment(options.sourceName)}.${safeSegment(locale)}.binary`);
            const binary = buildEscoRelatedTermsBinaryFiles({
                sourceName: options.sourceName,
                locale,
                buildRunId: buildRun.id,
                verbRows,
                objectRows
            }, prefix);
            const manifestPath = `${prefix}.manifest.json`;
            const manifest = {
                schemaVersion: ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION,
                sourceName: options.sourceName,
                locale,
                buildRunId: buildRun.id,
                generatedAt: new Date().toISOString(),
                stringCount: binary.stringCount,
                verbRowCount: binary.verbRowCount,
                verbSourceKeyCount: binary.verbSourceKeyCount,
                verbRelatedKeyCount: binary.verbRelatedKeyCount,
                objectRowCount: binary.objectRowCount,
                objectSourceKeyCount: binary.objectSourceKeyCount,
                objectRelatedKeyCount: binary.objectRelatedKeyCount,
                files: binary.manifestFiles
            };
            await Promise.all([
                writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
                ...[...binary.buffers.entries()].map(([filePath, buffer]) => writeFile(filePath, buffer))
            ]);
            console.log([
                `source=${options.sourceName}`,
                `locale=${locale}`,
                `build_run_id=${buildRun.id}`,
                `verb_rows=${binary.verbRowCount}`,
                `object_rows=${binary.objectRowCount}`,
                `manifest=${manifestPath}`
            ].join('  '));
        }
    });
}
async function loadLatestBuildRun(connection, sourceName) {
    const [rows] = await connection.query(`
      SELECT id, locale_scope_json
      FROM ose_esco_related_term_build_runs
      WHERE source_kind = 'esco'
        AND source_name = ?
        AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `, [sourceName]);
    const buildRun = rows[0];
    if (!buildRun) {
        throw new Error(`No completed ESCO related-term build run found for source_name="${sourceName}".`);
    }
    return buildRun;
}
async function resolveLocales(connection, buildRun, sourceName) {
    const localeScope = parseLocaleScope(buildRun.locale_scope_json);
    if (localeScope.length > 0) {
        return localeScope;
    }
    const derivedLocales = await loadLocalesFromData(connection, buildRun.id, sourceName);
    if (derivedLocales.length > 0) {
        return derivedLocales;
    }
    return localeScope;
}
async function loadVerbRows(connection, buildRunId, sourceName, locale) {
    const [rows] = await connection.query(`
      SELECT
        source_verb AS source_term,
        related_verb AS related_term,
        relationship_type,
        evidence_count,
        'forward' AS direction,
        source_skill_ids_json,
        related_skill_ids_json,
        source_skill_uris_json,
        related_skill_uris_json,
        source_label_examples_json,
        related_label_examples_json
      FROM ose_esco_verb_related
      WHERE build_run_id = ?
        AND source_name = ?
        AND locale_code = ?
      ORDER BY evidence_count DESC, relationship_type, source_term, related_term
    `, [buildRunId, sourceName, locale]);
    return rows.map(normalizeStoredRow);
}
async function loadObjectRows(connection, buildRunId, sourceName, locale) {
    const [rows] = await connection.query(`
      SELECT
        source_object AS source_term,
        related_object AS related_term,
        relationship_type,
        evidence_count,
        'forward' AS direction,
        source_skill_ids_json,
        related_skill_ids_json,
        source_skill_uris_json,
        related_skill_uris_json,
        source_label_examples_json,
        related_label_examples_json
      FROM ose_esco_object_related
      WHERE build_run_id = ?
        AND source_name = ?
        AND locale_code = ?
      ORDER BY evidence_count DESC, relationship_type, source_term, related_term
    `, [buildRunId, sourceName, locale]);
    return rows.map(normalizeStoredRow);
}
function normalizeStoredRow(row) {
    return {
        sourceTerm: foldSearchText(row.source_term).trim(),
        relatedTerm: foldSearchText(row.related_term).trim(),
        relationshipType: row.relationship_type,
        direction: row.direction,
        evidenceCount: Number(row.evidence_count) || 0,
        sourceLabelExamples: parseStringArray(row.source_label_examples_json),
        relatedLabelExamples: parseStringArray(row.related_label_examples_json)
    };
}
function parseLocaleScope(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = parseMaybeJson(value);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    catch {
        return [];
    }
}
function parseStringArray(value) {
    const parsed = parseMaybeJson(value);
    if (Array.isArray(parsed)) {
        return parsed.filter((item) => typeof item === 'string');
    }
    return [];
}
function parseMaybeJson(value) {
    if (Buffer.isBuffer(value)) {
        const text = value.toString('utf8').trim();
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
async function loadLocalesFromData(connection, buildRunId, sourceName) {
    const [verbRows] = await connection.query(`
      SELECT DISTINCT locale_code
      FROM ose_esco_verb_related
      WHERE build_run_id = ?
        AND source_name = ?
        AND locale_code IS NOT NULL
      UNION
      SELECT DISTINCT locale_code
      FROM ose_esco_object_related
      WHERE build_run_id = ?
        AND source_name = ?
        AND locale_code IS NOT NULL
      ORDER BY locale_code
    `, [buildRunId, sourceName, buildRunId, sourceName]);
    return verbRows
        .map((row) => row.locale_code)
        .filter((locale) => typeof locale === 'string' && locale.trim().length > 0);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        locales: null,
        outDir: DEFAULT_RUNTIME_DIR
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--locales=')) {
            options.locales = arg
                .slice('--locales='.length)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            continue;
        }
        if (arg.startsWith('--out-dir=')) {
            options.outDir = path.resolve(arg.slice('--out-dir='.length).trim());
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
        'Usage: node dist/cli/export-esco-related-terms-runtime.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--locales=en,ro]',
        `[--out-dir=${DEFAULT_RUNTIME_DIR}]`
    ].join(' '));
}
function safeSegment(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ESCO related-terms runtime artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
