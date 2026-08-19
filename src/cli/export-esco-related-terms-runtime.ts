import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import {
  buildEscoRelatedTermsBinaryFiles,
  defaultEscoRelatedTermsManifestPath,
  ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION,
  type EscoRelatedTermBinaryRecord
} from '../runtime/esco-related-terms-artifact.js';
import { foldSearchText } from '../utils/texts.js';

type CliOptions = {
  sourceName: string;
  locales: string[] | null;
  outPath: string | null;
};

type BuildRunRow = RowDataPacket & {
  id: number;
  locale_scope_json: unknown;
};

type RelatedTermRow = RowDataPacket & {
  source_term: string;
  related_term: string;
  relationship_type: string;
  evidence_count: number;
  direction: 'forward' | 'reverse';
  source_skill_ids_json: unknown;
  related_skill_ids_json: unknown;
  source_skill_uris_json: unknown;
  related_skill_uris_json: unknown;
  source_label_examples_json: unknown;
  related_label_examples_json: unknown;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  await withConnection(async (connection) => {
    const buildRun = await loadLatestBuildRun(connection, options.sourceName);
    const locales = options.locales ?? (await resolveLocales(connection, buildRun, options.sourceName));

    if (locales.length === 0) {
      throw new Error(`No locales found for build run ${buildRun.id}.`);
    }

    for (const locale of locales) {
      const [verbRows, objectRows] = await Promise.all([
        loadVerbRows(connection, buildRun.id, options.sourceName, locale),
        loadObjectRows(connection, buildRun.id, options.sourceName, locale)
      ]);

      const manifestPath = path.resolve(options.outPath ?? defaultEscoRelatedTermsManifestPath(options.sourceName, locale));
      const prefix = path.basename(manifestPath, '.manifest.json');
      const binary = buildEscoRelatedTermsBinaryFiles(
        {
          sourceName: options.sourceName,
          locale,
          buildRunId: buildRun.id,
          verbRows,
          objectRows
        },
        prefix
      );
      const manifest = {
        schemaVersion: ESCO_RELATED_TERMS_BINARY_SCHEMA_VERSION,
        sourceName: options.sourceName,
        locale,
        buildRunId: buildRun.id,
        generatedAt: new Date().toISOString(),
        termStringCount: binary.termStringCount,
        exampleStringCount: binary.exampleStringCount,
        exampleListCount: binary.exampleListCount,
        verbRowCount: binary.verbRowCount,
        verbSourceKeyCount: binary.verbSourceKeyCount,
        verbRelatedKeyCount: binary.verbRelatedKeyCount,
        objectRowCount: binary.objectRowCount,
        objectSourceKeyCount: binary.objectSourceKeyCount,
        objectRelatedKeyCount: binary.objectRelatedKeyCount,
        files: binary.manifestFiles
      };
      const manifestDir = path.dirname(manifestPath);
      const outputBuffers = [...binary.buffers.entries()];
      const staleFileNames = legacyEscoRelatedTermsFileNames(prefix);

      await mkdir(manifestDir, { recursive: true });
      await Promise.all(staleFileNames.map((fileName) => rm(path.resolve(manifestDir, fileName), { force: true })));

      await Promise.all([
        writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
        ...outputBuffers.map(([fileName, buffer]) => writeFile(path.resolve(manifestDir, fileName), buffer))
      ]);

      console.log(
        [
          `source=${options.sourceName}`,
          `locale=${locale}`,
          `build_run_id=${buildRun.id}`,
          `verb_rows=${binary.verbRowCount}`,
          `object_rows=${binary.objectRowCount}`,
          `manifest=${manifestPath}`
        ].join('  ')
      );
    }
  });
}

async function loadLatestBuildRun(connection: Connection, sourceName: string): Promise<BuildRunRow> {
  const [rows] = await connection.query<BuildRunRow[]>(
    `
      SELECT id, locale_scope_json
      FROM ose_esco_related_term_build_runs
      WHERE source_kind = 'esco'
        AND source_name = ?
        AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `,
    [sourceName]
  );

  const buildRun = rows[0];

  if (!buildRun) {
    throw new Error(`No completed ESCO related-term build run found for source_name="${sourceName}".`);
  }

  return buildRun;
}

async function resolveLocales(connection: Connection, buildRun: BuildRunRow, sourceName: string): Promise<string[]> {
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

async function loadVerbRows(
  connection: Connection,
  buildRunId: number,
  sourceName: string,
  locale: string
): Promise<EscoRelatedTermBinaryRecord[]> {
  const [rows] = await connection.query<RelatedTermRow[]>(
    `
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
    `,
    [buildRunId, sourceName, locale]
  );

  return rows.map(normalizeStoredRow);
}

async function loadObjectRows(
  connection: Connection,
  buildRunId: number,
  sourceName: string,
  locale: string
): Promise<EscoRelatedTermBinaryRecord[]> {
  const [rows] = await connection.query<RelatedTermRow[]>(
    `
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
    `,
    [buildRunId, sourceName, locale]
  );

  return rows.map(normalizeStoredRow);
}

function normalizeStoredRow(row: RelatedTermRow): EscoRelatedTermBinaryRecord {
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

function parseLocaleScope(value: unknown): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = parseMaybeJson(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseMaybeJson(value);

  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function parseMaybeJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
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
  } catch {
    return value;
  }
}

async function loadLocalesFromData(connection: Connection, buildRunId: number, sourceName: string): Promise<string[]> {
  const [verbRows] = await connection.query<RowDataPacket[]>(
    `
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
    `,
    [buildRunId, sourceName, buildRunId, sourceName]
  );

  return verbRows
    .map((row) => row.locale_code)
    .filter((locale): locale is string => typeof locale === 'string' && locale.trim().length > 0);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    locales: null,
    outPath: null
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

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-esco-related-terms-runtime.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--locales=en,ro]',
      `[--out=${defaultEscoRelatedTermsManifestPath(DEFAULT_ESCO_SOURCE_NAME, 'en')}]`
    ].join(' ')
  );
}

function legacyEscoRelatedTermsFileNames(prefix: string): string[] {
  return [
    `${prefix}.strings.bin`,
    `${prefix}.verb.source-label-examples.bin`,
    `${prefix}.verb.related-label-examples.bin`,
    `${prefix}.object.source-label-examples.bin`,
    `${prefix}.object.related-label-examples.bin`
  ];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('ESCO related-terms runtime artifact export failed.');
  console.error(message);
  process.exitCode = 1;
});
