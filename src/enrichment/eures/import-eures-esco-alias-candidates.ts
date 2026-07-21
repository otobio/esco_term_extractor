import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  foldSearchText,
  isGenericQueryToken,
  normalizeSearchText,
  tokenizeNormalizedText,
  type SupportedQueryLocale
} from '../../query/query-preparation.js';

export const DEFAULT_EURES_DOWNLOAD_DIR = '/private/tmp/ose-eures-esco';
export const DEFAULT_EURES_REPORT_DIR = 'artifacts/enrichment/eures';

type SupportedEuresCountry = 'ee' | 'hu' | 'ro';
type CandidateMode = 'generate' | 'review' | 'exclude';

type EuresCountryConfig = {
  locale: Extract<SupportedQueryLocale, 'et' | 'hu' | 'ro'>;
  sourceTag: string;
  downloadUrl: string;
  filename: string;
};

export const EURES_COUNTRY_CONFIG: Record<SupportedEuresCountry, EuresCountryConfig> = {
  ee: {
    locale: 'et',
    sourceTag: 'eures_ee_bridge',
    downloadUrl: 'https://esco.ec.europa.eu/system/files/2024-10/EURESmapping_occs_EE.csv',
    filename: 'EURESmapping_occs_EE.csv'
  },
  hu: {
    locale: 'hu',
    sourceTag: 'eures_hu_bridge',
    downloadUrl: 'https://esco.ec.europa.eu/system/files/2024-10/EURESmapping_occs_HU.csv',
    filename: 'EURESmapping_occs_HU.csv'
  },
  ro: {
    locale: 'ro',
    sourceTag: 'eures_ro_bridge',
    downloadUrl: 'https://esco.ec.europa.eu/system/files/2024-10/EURESmapping_occs_RO.csv',
    filename: 'EURESmapping_occs_RO.csv'
  }
};

export type ImportEuresEscoAliasCandidatesOptions = {
  sourceName?: string;
  countries?: SupportedEuresCountry[];
  downloadDir?: string;
  reportDir?: string;
  sampleLimit?: number;
  writeArtifact?: boolean;
};

export type EuresAliasCandidate = {
  candidateMode: CandidateMode;
  reviewReason: string | null;
  alias: string;
  normalizedAlias: string;
  localeCode: 'et' | 'hu' | 'ro';
  graphNodeId: number | null;
  canonicalLabel: string | null;
  confidence: number;
  sourceTag: string;
  sourceRecordType: 'eures_mapping_label';
  mappingRelation: string;
  escoUri: string;
  escoPrefLabel: string | null;
  nationalUri: string;
  nationalPrefLabel: string;
  conflictTargets: Array<{ graphNodeId: number; canonicalLabel: string; source: string }>;
};

export type ImportEuresEscoAliasCandidatesResult = {
  sourceName: string;
  downloadDir: string;
  reportPath: string;
  countries: SupportedEuresCountry[];
  summary: {
    mappingRows: number;
    uniqueAliases: number;
    generate: number;
    review: number;
    exclude: number;
  };
  bySourceTag: Record<string, { locale: string; mappingRows: number; generate: number; review: number; exclude: number }>;
  samples: Record<CandidateMode, EuresAliasCandidate[]>;
};

type MappingRow = {
  escoUri: string;
  escoPrefLabel: string | null;
  nationalUri: string;
  nationalPrefLabel: string;
  mappingRelation: string;
};

type TargetNode = {
  graphNodeId: number;
  canonicalLabel: string;
  externalUri: string;
};

type ExistingAliasTarget = {
  graphNodeId: number;
  canonicalLabel: string;
  source: string;
};

const GENERIC_ONE_WORD_ALIASES = new Set([
  'assistant',
  'asszisztens',
  'consultant',
  'consultant',
  'developer',
  'expert',
  'lucrator',
  'lucrător',
  'manager',
  'munkas',
  'munkás',
  'operator',
  'operaator',
  'spetsialist',
  'specialist',
  'specialistă',
  'tehnician',
  'tehnik',
  'worker'
]);

export async function importEuresEscoAliasCandidates(
  connection: Connection,
  options: ImportEuresEscoAliasCandidatesOptions = {}
): Promise<ImportEuresEscoAliasCandidatesResult> {
  const sourceName = options.sourceName?.trim() || 'esco_1_2_1';
  const countries = normalizeCountries(options.countries);
  const downloadDir = options.downloadDir?.trim() || DEFAULT_EURES_DOWNLOAD_DIR;
  const reportDir = options.reportDir?.trim() || path.resolve(process.cwd(), DEFAULT_EURES_REPORT_DIR);
  const sampleLimit = options.sampleLimit ?? 20;
  const writeArtifact = options.writeArtifact ?? true;

  await mkdir(downloadDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });

  const targetNodesByUri = await loadTargetNodesByUri(connection, sourceName);
  const existingAliasesByKey = await loadExistingAliases(connection);
  const allCandidates: EuresAliasCandidate[] = [];
  const bySourceTag: ImportEuresEscoAliasCandidatesResult['bySourceTag'] = {};
  let mappingRowsCount = 0;

  for (const country of countries) {
    const config = EURES_COUNTRY_CONFIG[country];
    const filePath = path.join(downloadDir, config.filename);
    await downloadIfMissing(config.downloadUrl, filePath);

    const mappingRows = await loadEuresMappingRows(filePath);
    mappingRowsCount += mappingRows.length;
    const candidates = buildCandidateRows(config, mappingRows, targetNodesByUri, existingAliasesByKey);
    allCandidates.push(...candidates);
    bySourceTag[config.sourceTag] = {
      locale: config.locale,
      mappingRows: mappingRows.length,
      generate: candidates.filter((candidate) => candidate.candidateMode === 'generate').length,
      review: candidates.filter((candidate) => candidate.candidateMode === 'review').length,
      exclude: candidates.filter((candidate) => candidate.candidateMode === 'exclude').length
    };
  }

  allCandidates.sort(compareCandidates);
  const reportPath = path.join(reportDir, 'eures-esco-alias-candidates-report.json');
  const result: ImportEuresEscoAliasCandidatesResult = {
    sourceName,
    downloadDir,
    reportPath,
    countries,
    summary: {
      mappingRows: mappingRowsCount,
      uniqueAliases: allCandidates.length,
      generate: allCandidates.filter((candidate) => candidate.candidateMode === 'generate').length,
      review: allCandidates.filter((candidate) => candidate.candidateMode === 'review').length,
      exclude: allCandidates.filter((candidate) => candidate.candidateMode === 'exclude').length
    },
    bySourceTag,
    samples: {
      generate: allCandidates.filter((candidate) => candidate.candidateMode === 'generate').slice(0, sampleLimit),
      review: allCandidates.filter((candidate) => candidate.candidateMode === 'review').slice(0, sampleLimit),
      exclude: allCandidates.filter((candidate) => candidate.candidateMode === 'exclude').slice(0, sampleLimit)
    }
  };

  await writeFile(reportPath, `${JSON.stringify({ ...result, candidates: allCandidates }, null, 2)}\n`, 'utf8');

  if (writeArtifact) {
    await writeBuildArtifact(connection, sourceName, result);
  }

  return result;
}

function buildCandidateRows(
  config: EuresCountryConfig,
  mappingRows: MappingRow[],
  targetNodesByUri: Map<string, TargetNode>,
  existingAliasesByKey: Map<string, ExistingAliasTarget[]>
): EuresAliasCandidate[] {
  const deduped = new Map<string, EuresAliasCandidate>();
  const ownersByAlias = new Map<string, Set<number>>();

  for (const row of mappingRows) {
    const target = targetNodesByUri.get(row.escoUri);

    for (const alias of expandNationalLabels(row.nationalPrefLabel)) {
      const normalizedAlias = normalizeSearchText(alias);

      if (!target || !normalizedAlias) {
        continue;
      }

      const key = buildAliasKey(config.locale, normalizedAlias);
      const owners = ownersByAlias.get(key) ?? new Set<number>();
      owners.add(target.graphNodeId);
      ownersByAlias.set(key, owners);
    }
  }

  for (const row of mappingRows) {
    const target = targetNodesByUri.get(row.escoUri) ?? null;

    for (const alias of expandNationalLabels(row.nationalPrefLabel)) {
      const candidate = buildCandidate(config, row, alias, target, ownersByAlias, existingAliasesByKey);
      const dedupeKey = [candidate.sourceTag, candidate.localeCode, candidate.normalizedAlias, candidate.graphNodeId ?? 'no_target'].join('\u0000');
      const current = deduped.get(dedupeKey);

      if (!current || scoreCandidateMode(candidate.candidateMode) > scoreCandidateMode(current.candidateMode)) {
        deduped.set(dedupeKey, candidate);
      }
    }
  }

  return Array.from(deduped.values());
}

function buildCandidate(
  config: EuresCountryConfig,
  row: MappingRow,
  alias: string,
  target: TargetNode | null,
  ownersByAlias: Map<string, Set<number>>,
  existingAliasesByKey: Map<string, ExistingAliasTarget[]>
): EuresAliasCandidate {
  const normalizedAlias = normalizeSearchText(alias);
  const foldedAlias = foldSearchText(alias);
  const aliasTokens = tokenizeNormalizedText(foldedAlias);
  const existingTargets = existingAliasesByKey.get(buildAliasKey(config.locale, normalizedAlias)) ?? [];
  const conflictTargets = target ? existingTargets.filter((existing) => existing.graphNodeId !== target.graphNodeId) : existingTargets;
  const sameTarget = target ? existingTargets.some((existing) => existing.graphNodeId === target.graphNodeId) : false;
  const importOwners = ownersByAlias.get(buildAliasKey(config.locale, normalizedAlias)) ?? new Set<number>();
  const reasons: string[] = [];

  if (!normalizedAlias) {
    reasons.push('empty_alias');
  }

  if (!target) {
    reasons.push(row.escoUri.includes('/occupation/') ? 'missing_esco_target' : 'non_esco_occupation_uri');
  }

  if (sameTarget) {
    reasons.push('already_existing_alias_for_target');
  }

  if (isGenericOneWordAlias(aliasTokens, config.locale)) {
    reasons.push('generic_one_word_alias');
  }

  if (conflictTargets.length > 0 || importOwners.size > 1) {
    reasons.push('occupation_conflict');
  }

  if (row.mappingRelation && !['skos:exactMatch', 'skos:closeMatch', 'skos:narrowMatch'].includes(row.mappingRelation)) {
    reasons.push('weak_mapping_relation');
  }

  const candidateMode: CandidateMode =
    reasons.some((reason) => ['empty_alias', 'missing_esco_target', 'non_esco_occupation_uri', 'already_existing_alias_for_target', 'generic_one_word_alias'].includes(reason))
      ? 'exclude'
      : reasons.length > 0
        ? 'review'
        : 'generate';

  return {
    candidateMode,
    reviewReason: reasons.join(', ') || null,
    alias,
    normalizedAlias,
    localeCode: config.locale,
    graphNodeId: target?.graphNodeId ?? null,
    canonicalLabel: target?.canonicalLabel ?? null,
    confidence: scoreFromMappingRelation(row.mappingRelation),
    sourceTag: config.sourceTag,
    sourceRecordType: 'eures_mapping_label',
    mappingRelation: row.mappingRelation,
    escoUri: row.escoUri,
    escoPrefLabel: row.escoPrefLabel,
    nationalUri: row.nationalUri,
    nationalPrefLabel: row.nationalPrefLabel,
    conflictTargets
  };
}

async function downloadIfMissing(url: string, destinationPath: string): Promise<void> {
  if (existsSync(destinationPath)) {
    return;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  execFileSync(
    'curl',
    ['-fL', '-A', 'Mozilla/5.0', '-H', 'Accept: text/csv,*/*', '-e', 'https://esco.ec.europa.eu/en/use-esco/eures-countries-mapping-tables', '-o', destinationPath, url],
    { stdio: 'inherit' }
  );
}

async function loadEuresMappingRows(filePath: string): Promise<MappingRow[]> {
  const csv = await readFile(filePath, 'utf8');
  const delimiter = detectDelimiter(csv);
  const rows = parse(csv, {
    bom: true,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  }) as string[][];
  const headerIndex = rows.findIndex((row) => row[0]?.trim() === 'Classification 1 URI');

  if (headerIndex === -1) {
    throw new Error(`Could not find EURES mapping header row in ${filePath}`);
  }

  const [header, ...dataRows] = rows.slice(headerIndex);

  return dataRows
    .filter((row) => row.some((value) => value.trim() !== ''))
    .map((row) => {
      const record = toRecord(header, row);
      return {
        escoUri: record['Classification 1 URI'] ?? '',
        escoPrefLabel: record['Classification 1 PrefLabel'] || null,
        nationalUri: record['Classification 2 URI'] ?? '',
        nationalPrefLabel: record['Classification 2 PrefLabel'] ?? '',
        mappingRelation: record['Mapping relation'] ?? ''
      };
    });
}

async function loadTargetNodesByUri(connection: Connection, sourceName: string): Promise<Map<string, TargetNode>> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT DISTINCT
        node.id AS graph_node_id,
        node.canonical_label,
        concept.external_uri
      FROM ose_graph_nodes node
      JOIN ose_graph_node_sources source ON source.graph_node_id = node.id
      JOIN ose_source_concepts concept ON concept.id = source.source_concept_id
      WHERE source.source_name = ?
        AND concept.source_name = ?
        AND concept.locale_code = 'en'
        AND concept.external_uri IS NOT NULL
        AND node.bucket = 'occupation'
        AND node.node_level = 'occupation'
        AND node.status = 'active'
        AND node.is_searchable = 1
    `,
    [sourceName, sourceName]
  );
  const targets = new Map<string, TargetNode>();

  for (const row of rows) {
    targets.set(String(row.external_uri), {
      graphNodeId: Number(row.graph_node_id),
      canonicalLabel: String(row.canonical_label),
      externalUri: String(row.external_uri)
    });
  }

  return targets;
}

async function loadExistingAliases(connection: Connection): Promise<Map<string, ExistingAliasTarget[]>> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT alias.locale_code, alias.normalized_alias, meta.graph_node_id, node.canonical_label, 'search_meta' AS alias_source
      FROM ose_search_meta_aliases alias
      JOIN ose_search_meta meta ON meta.id = alias.search_meta_id
      JOIN ose_graph_nodes node ON node.id = meta.graph_node_id
      UNION ALL
      SELECT alias.locale_code, alias.normalized_alias, alias.graph_node_id, node.canonical_label, 'graph_alias' AS alias_source
      FROM ose_graph_aliases alias
      JOIN ose_graph_nodes node ON node.id = alias.graph_node_id
      WHERE alias.is_active = 1
    `
  );
  const aliases = new Map<string, ExistingAliasTarget[]>();

  for (const row of rows) {
    const key = buildAliasKey(String(row.locale_code), String(row.normalized_alias));
    const targets = aliases.get(key) ?? [];
    const graphNodeId = Number(row.graph_node_id);
    const source = String(row.alias_source);

    if (!targets.some((target) => target.graphNodeId === graphNodeId && target.source === source)) {
      targets.push({
        graphNodeId,
        canonicalLabel: String(row.canonical_label),
        source
      });
    }

    aliases.set(key, targets);
  }

  return aliases;
}

async function writeBuildArtifact(
  connection: Connection,
  sourceName: string,
  result: ImportEuresEscoAliasCandidatesResult
): Promise<void> {
  await connection.execute(
    `
      INSERT INTO ose_build_artifacts (
        artifact_key,
        artifact_scope,
        build_version,
        payload_json
      )
      VALUES (?, ?, ?, CAST(? AS JSON))
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        created_at = CURRENT_TIMESTAMP
    `,
    [
      'eures_esco_alias_candidates',
      sourceName,
      'latest',
      JSON.stringify({
        sourceName: result.sourceName,
        downloadDir: result.downloadDir,
        reportPath: result.reportPath,
        countries: result.countries,
        summary: result.summary,
        bySourceTag: result.bySourceTag,
        samples: result.samples
      })
    ]
  );
}

function normalizeCountries(countries: SupportedEuresCountry[] | undefined): SupportedEuresCountry[] {
  if (!countries || countries.length === 0) {
    return ['ee', 'hu', 'ro'];
  }

  return Array.from(new Set(countries));
}

function expandNationalLabels(value: string): string[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  const parts = splitOnCommasOutsideParentheses(trimmed)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('-'));

  return parts.length >= 2 ? Array.from(new Set(parts)) : [trimmed];
}

function splitOnCommasOutsideParentheses(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of value) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')' && depth > 0) {
      depth -= 1;
    }

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function isGenericOneWordAlias(aliasTokens: string[], locale: SupportedQueryLocale): boolean {
  return aliasTokens.length === 1 && (GENERIC_ONE_WORD_ALIASES.has(aliasTokens[0]) || isGenericQueryToken(aliasTokens[0], locale));
}

function scoreFromMappingRelation(relation: string): number {
  if (relation === 'skos:exactMatch') {
    return 0.95;
  }

  if (relation === 'skos:closeMatch') {
    return 0.82;
  }

  if (relation === 'skos:narrowMatch') {
    return 0.72;
  }

  if (relation === 'skos:broadMatch') {
    return 0.68;
  }

  return 0.5;
}

function scoreCandidateMode(mode: CandidateMode): number {
  return mode === 'generate' ? 3 : mode === 'review' ? 2 : 1;
}

function compareCandidates(left: EuresAliasCandidate, right: EuresAliasCandidate): number {
  const modeOrder: Record<CandidateMode, number> = { generate: 0, review: 1, exclude: 2 };

  return (
    modeOrder[left.candidateMode] - modeOrder[right.candidateMode] ||
    left.localeCode.localeCompare(right.localeCode) ||
    right.confidence - left.confidence ||
    left.normalizedAlias.localeCompare(right.normalizedAlias)
  );
}

function buildAliasKey(localeCode: string, normalizedAlias: string): string {
  return `${localeCode}::${normalizedAlias}`;
}

function detectDelimiter(input: string): string {
  const firstLine = input.split(/\r?\n/u, 1)[0] ?? '';

  if (firstLine.includes('\t')) {
    return '\t';
  }

  if (firstLine.includes(';')) {
    return ';';
  }

  return ',';
}

function toRecord(header: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};

  for (let index = 0; index < header.length; index += 1) {
    record[header[index]?.trim() ?? `column_${index}`] = row[index]?.trim() ?? '';
  }

  return record;
}
