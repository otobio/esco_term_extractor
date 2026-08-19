import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { buildEscoRelatedTermsDataset } from '../skills/esco-related-terms.js';
import { foldSearchText } from '../utils/texts.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    await withConnection(async (connection) => {
        const sourceImportRunId = await loadLatestSourceImportRunId(connection, options.sourceName);
        const buildRunId = await insertBuildRun(connection, {
            sourceName: options.sourceName,
            sourceImportRunId,
            locales: options.locales,
            minVerbOccurrences: options.minVerbOccurrences,
            minObjectOccurrences: options.minObjectOccurrences
        });
        try {
            const localeSummaries = [];
            await connection.beginTransaction();
            for (const locale of options.locales) {
                const labels = await loadSkillLabels(connection, options.sourceName, locale);
                const relations = await loadSkillRelations(connection, options.sourceName, locale);
                const dataset = buildEscoRelatedTermsDataset(labels, relations, {
                    minVerbOccurrences: options.minVerbOccurrences,
                    minObjectOccurrences: options.minObjectOccurrences
                });
                const verbRows = mergeSerializedRows(serializeVerbRows(options.sourceName, locale, dataset.verbRelatedRows));
                const objectRows = mergeSerializedRows(serializeObjectRows(options.sourceName, locale, dataset.objectRelatedRows));
                await deleteExistingRows(connection, options.sourceName, locale);
                await insertVerbRows(connection, buildRunId, verbRows);
                await insertObjectRows(connection, buildRunId, objectRows);
                localeSummaries.push({
                    locale,
                    verbCount: dataset.verbRelatedRows.length,
                    objectCount: dataset.objectRelatedRows.length
                });
            }
            await markBuildRunCompleted(connection, buildRunId, localeSummaries, null);
            await connection.commit();
            for (const summary of localeSummaries) {
                console.log([
                    `source=${options.sourceName}`,
                    `locale=${summary.locale}`,
                    `verb_rows=${summary.verbCount}`,
                    `object_rows=${summary.objectCount}`,
                    `build_run_id=${buildRunId}`
                ].join('  '));
            }
        }
        catch (error) {
            await connection.rollback();
            const message = error instanceof Error ? error.message : String(error);
            await markBuildRunFailed(connection, buildRunId, message);
            throw error;
        }
    });
}
async function loadLatestSourceImportRunId(connection, sourceName) {
    const [rows] = await connection.query(`
      SELECT id
      FROM ose_import_runs
      WHERE source_kind = 'esco'
        AND source_name = ?
        AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `, [sourceName]);
    const sourceImportRunId = rows[0]?.id;
    if (!sourceImportRunId) {
        throw new Error(`No completed ESCO import run found for source_name="${sourceName}". Run import:esco first.`);
    }
    return sourceImportRunId;
}
async function loadSkillLabels(connection, sourceName, locale) {
    const [preferredRows] = await connection.query(`
      SELECT
        c.id AS skill_id,
        c.external_uri AS skill_uri,
        c.preferred_label AS label,
        'preferred_label' AS label_type,
        c.preferred_label AS source_label
      FROM ose_source_concepts c
      WHERE c.source_name = ?
        AND c.locale_code = ?
        AND c.entity_kind = 'skill'
    `, [sourceName, locale]);
    const [aliasRows] = await connection.query(`
      SELECT
        c.id AS skill_id,
        c.external_uri AS skill_uri,
        a.alias AS label,
        CASE
          WHEN a.is_preferred = 1 THEN 'preferred_label'
          WHEN a.alias_type = 'hidden_label' THEN 'hidden_label'
          ELSE 'alt_label'
        END AS label_type,
        a.alias AS source_label
      FROM ose_source_aliases a
      INNER JOIN ose_source_concepts c
        ON c.id = a.source_concept_id
      WHERE c.source_name = ?
        AND c.locale_code = ?
        AND c.entity_kind = 'skill'
        AND a.locale_code = ?
    `, [sourceName, locale, locale]);
    return [...preferredRows, ...aliasRows].map((row) => ({
        skillId: row.skill_id,
        skillUri: row.skill_uri,
        label: row.label,
        labelType: normalizeLabelType(row.label_type),
        sourceLabel: row.source_label
    }));
}
async function loadSkillRelations(connection, sourceName, locale) {
    const [rows] = await connection.query(`
      SELECT
        r.id AS relation_id,
        r.relation_kind,
        r.locale_code,
        parent.id AS source_skill_id,
        parent.external_uri AS source_skill_uri,
        parent.preferred_label AS source_label,
        child.id AS related_skill_id,
        child.external_uri AS related_skill_uri,
        child.preferred_label AS related_label
      FROM ose_source_relations r
      INNER JOIN ose_source_concepts parent
        ON parent.source_name = r.source_name
        AND parent.locale_code = r.locale_code
        AND parent.external_uri = r.parent_external_uri
      INNER JOIN ose_source_concepts child
        ON child.source_name = r.source_name
        AND child.locale_code = r.locale_code
        AND child.external_uri = r.child_external_uri
      WHERE r.source_name = ?
        AND r.locale_code = ?
        AND r.relation_kind IN ('skill_skill', 'broader_skill')
        AND parent.entity_kind = 'skill'
        AND child.entity_kind = 'skill'
    `, [sourceName, locale]);
    return rows.map((row) => ({
        relationId: row.relation_id,
        relationKind: row.relation_kind,
        localeCode: row.locale_code,
        sourceSkillId: row.source_skill_id,
        sourceSkillUri: row.source_skill_uri,
        sourceLabel: row.source_label,
        relatedSkillId: row.related_skill_id,
        relatedSkillUri: row.related_skill_uri,
        relatedLabel: row.related_label
    }));
}
async function insertBuildRun(connection, input) {
    const [result] = await connection.execute(`
      INSERT INTO ose_esco_related_term_build_runs
        (source_kind, source_name, source_import_run_id, locale_scope_json, min_verb_occurrences, min_object_occurrences, status)
      VALUES
        ('esco', ?, ?, ?, ?, ?, 'running')
    `, [input.sourceName, input.sourceImportRunId, JSON.stringify(input.locales), input.minVerbOccurrences, input.minObjectOccurrences]);
    return result.insertId;
}
async function deleteExistingRows(connection, sourceName, locale) {
    await Promise.all([
        connection.execute(`
        DELETE FROM ose_esco_verb_related
        WHERE source_name = ?
          AND locale_code = ?
      `, [sourceName, locale]),
        connection.execute(`
        DELETE FROM ose_esco_object_related
        WHERE source_name = ?
          AND locale_code = ?
      `, [sourceName, locale])
    ]);
}
async function insertVerbRows(connection, buildRunId, rows) {
    for (const row of rows) {
        await connection.execute(`
        INSERT IGNORE INTO ose_esco_verb_related
          (
            build_run_id,
            source_kind,
            source_name,
            locale_code,
            source_verb,
            related_verb,
            relationship_type,
            evidence_count,
            source_skill_ids_json,
            related_skill_ids_json,
            source_skill_uris_json,
            related_skill_uris_json,
            source_label_examples_json,
            related_label_examples_json
          )
        VALUES
          (?, 'esco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
            buildRunId,
            row.sourceName,
            row.localeCode,
            row.sourceTerm,
            row.relatedTerm,
            row.relationshipType,
            row.evidenceCount,
            JSON.stringify(row.sourceSkillIds),
            JSON.stringify(row.relatedSkillIds),
            JSON.stringify(row.sourceSkillUris),
            JSON.stringify(row.relatedSkillUris),
            JSON.stringify(row.sourceLabelExamples),
            JSON.stringify(row.relatedLabelExamples)
        ]);
    }
}
async function insertObjectRows(connection, buildRunId, rows) {
    for (const row of rows) {
        await connection.execute(`
        INSERT IGNORE INTO ose_esco_object_related
          (
            build_run_id,
            source_kind,
            source_name,
            locale_code,
            source_object,
            related_object,
            relationship_type,
            evidence_count,
            source_skill_ids_json,
            related_skill_ids_json,
            source_skill_uris_json,
            related_skill_uris_json,
            source_label_examples_json,
            related_label_examples_json
          )
        VALUES
          (?, 'esco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
            buildRunId,
            row.sourceName,
            row.localeCode,
            row.sourceTerm,
            row.relatedTerm,
            row.relationshipType,
            row.evidenceCount,
            JSON.stringify(row.sourceSkillIds),
            JSON.stringify(row.relatedSkillIds),
            JSON.stringify(row.sourceSkillUris),
            JSON.stringify(row.relatedSkillUris),
            JSON.stringify(row.sourceLabelExamples),
            JSON.stringify(row.relatedLabelExamples)
        ]);
    }
}
async function markBuildRunCompleted(connection, buildRunId, localeSummaries, notes) {
    await connection.execute(`
      UPDATE ose_esco_related_term_build_runs
      SET status = 'completed',
          notes = ?,
          finished_at = UTC_TIMESTAMP()
      WHERE id = ?
    `, [notes, buildRunId]);
    console.log(`persisted_locale_counts=${localeSummaries.map((summary) => `${summary.locale}:${summary.verbCount}/${summary.objectCount}`).join(',')}`);
}
async function markBuildRunFailed(connection, buildRunId, notes) {
    await connection.execute(`
      UPDATE ose_esco_related_term_build_runs
      SET status = 'failed',
          notes = ?,
          finished_at = UTC_TIMESTAMP()
      WHERE id = ?
    `, [notes, buildRunId]);
}
function serializeVerbRows(sourceName, localeCode, rows) {
    return rows.map((row) => ({
        sourceName,
        localeCode,
        sourceTerm: row.source_verb,
        relatedTerm: row.related_verb,
        relationshipType: row.relationship_type,
        evidenceCount: row.evidence_count,
        sourceSkillIds: row.source_skill_ids,
        relatedSkillIds: row.related_skill_ids,
        sourceSkillUris: row.source_skill_uris,
        relatedSkillUris: row.related_skill_uris,
        sourceLabelExamples: row.source_label_examples,
        relatedLabelExamples: row.related_label_examples
    }));
}
function serializeObjectRows(sourceName, localeCode, rows) {
    return rows.map((row) => ({
        sourceName,
        localeCode,
        sourceTerm: row.source_object,
        relatedTerm: row.related_object,
        relationshipType: row.relationship_type,
        evidenceCount: row.evidence_count,
        sourceSkillIds: row.source_skill_ids,
        relatedSkillIds: row.related_skill_ids,
        sourceSkillUris: row.source_skill_uris,
        relatedSkillUris: row.related_skill_uris,
        sourceLabelExamples: row.source_label_examples,
        relatedLabelExamples: row.related_label_examples
    }));
}
function mergeSerializedRows(rows) {
    const byKey = new Map();
    for (const row of rows) {
        const key = [
            foldSearchText(row.sourceName),
            foldSearchText(row.localeCode),
            foldSearchText(row.sourceTerm),
            foldSearchText(row.relatedTerm),
            foldSearchText(row.relationshipType)
        ].join('\u0000');
        const current = byKey.get(key);
        if (!current) {
            byKey.set(key, {
                ...row,
                sourceSkillIds: [...row.sourceSkillIds],
                relatedSkillIds: [...row.relatedSkillIds],
                sourceSkillUris: [...row.sourceSkillUris],
                relatedSkillUris: [...row.relatedSkillUris],
                sourceLabelExamples: [...row.sourceLabelExamples],
                relatedLabelExamples: [...row.relatedLabelExamples]
            });
            continue;
        }
        current.evidenceCount += row.evidenceCount;
        current.sourceSkillIds = mergeUniqueNumbers(current.sourceSkillIds, row.sourceSkillIds);
        current.relatedSkillIds = mergeUniqueNumbers(current.relatedSkillIds, row.relatedSkillIds);
        current.sourceSkillUris = mergeUniqueStrings(current.sourceSkillUris, row.sourceSkillUris);
        current.relatedSkillUris = mergeUniqueStrings(current.relatedSkillUris, row.relatedSkillUris);
        current.sourceLabelExamples = mergeDisplayStrings(current.sourceLabelExamples, row.sourceLabelExamples);
        current.relatedLabelExamples = mergeDisplayStrings(current.relatedLabelExamples, row.relatedLabelExamples);
    }
    return [...byKey.values()].sort((left, right) => right.evidenceCount - left.evidenceCount ||
        left.relationshipType.localeCompare(right.relationshipType) ||
        left.sourceTerm.localeCompare(right.sourceTerm) ||
        left.relatedTerm.localeCompare(right.relatedTerm));
}
function mergeUniqueNumbers(left, right) {
    return [...new Set([...left, ...right])].sort((a, b) => a - b);
}
function mergeUniqueStrings(left, right) {
    return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}
function mergeDisplayStrings(left, right) {
    const byNormalized = new Map();
    for (const value of [...left, ...right]) {
        const normalized = foldSearchText(value).trim();
        if (!normalized) {
            continue;
        }
        const current = byNormalized.get(normalized);
        if (!current || compareDisplayString(value, current) < 0) {
            byNormalized.set(normalized, value);
        }
    }
    return [...byNormalized.values()].sort((a, b) => a.localeCompare(b));
}
function compareDisplayString(left, right) {
    return left.length - right.length || left.localeCompare(right);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        locales: ['en'],
        minVerbOccurrences: 2,
        minObjectOccurrences: 2
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
        if (arg.startsWith('--min-verb-occurrences=')) {
            options.minVerbOccurrences = parsePositiveInteger(arg.slice('--min-verb-occurrences='.length).trim(), 'min-verb-occurrences');
            continue;
        }
        if (arg.startsWith('--min-object-occurrences=')) {
            options.minObjectOccurrences = parsePositiveInteger(arg.slice('--min-object-occurrences='.length).trim(), 'min-object-occurrences');
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.locales.length === 0) {
        options.locales = ['en'];
    }
    return options;
}
function normalizeLabelType(value) {
    if (value === 'preferred_label' || value === 'hidden_label' || value === 'alt_label') {
        return value;
    }
    return 'alt_label';
}
function parsePositiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/build-esco-related-terms.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--locales=en,ro]',
        '[--min-verb-occurrences=2]',
        '[--min-object-occurrences=2]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ESCO related-term build failed.');
    console.error(message);
    process.exitCode = 1;
});
