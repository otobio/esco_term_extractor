import { performance } from 'node:perf_hooks';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { withConnection } from '../db/mysql.js';
import { prepareOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import {
  buildAliasNgramIndexFromRows,
  retrieveAliasNgramHits,
  type AliasNgramIndex,
  type AliasNgramSourceRow
} from '../retrieval/alias-ngram-retriever.js';

type CliOptions = {
  sourceName: string;
  locale?: string;
  queryKind?: string;
  limit: number;
  maxQueries?: number;
  queryMode: 'role' | 'effective';
};

type EvaluationQuery = {
  id: number;
  locale: string;
  queryText: string;
  queryKind: string;
  expectations: EvaluationExpectation[];
};

type EvaluationExpectation = {
  nodeId: number;
  label: string;
  nodeLevel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  expectationLevel: string;
  rankCeiling: number | null;
};

type EvaluationQueryRow = RowDataPacket & {
  id: number;
  locale_code: string;
  query_text: string;
  query_kind: string;
  expected_node_id: number | null;
  expectation_level: string | null;
  rank_ceiling: number | null;
  expected_label: string | null;
  expected_node_level: string | null;
  expected_family_node_id: number | null;
  expected_family_label: string | null;
};

type AliasRow = RowDataPacket & {
  graph_node_id: number;
  canonical_label: string;
  family_node_id: number | null;
  family_label: string | null;
  alias: string;
  normalized_alias: string;
  alias_role: string;
  weight: string | number | null;
};

type Mode = 'conservative' | 'high_recall';

type ModeSummary = {
  mode: Mode;
  aliasCount: number;
  indexLoadMs: number;
  evaluated: number;
  exactTop1: number;
  exactTop5: number;
  contextTop1: number;
  contextTop5: number;
  noExpectation: number;
  byQueryKind: Map<string, QueryKindSummary>;
  misses: QueryComparison[];
};

type QueryKindSummary = {
  queryKind: string;
  evaluated: number;
  exactTop1: number;
  exactTop5: number;
  contextTop1: number;
  contextTop5: number;
};

type QueryComparison = {
  id: number;
  locale: string;
  query: string;
  effectiveQuery: string;
  scoringQuery: string;
  expected: string[];
  topHits: Array<{
    rank: number;
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    familyLabel: string | null;
    alias: string;
    aliasRole: string;
    score: number;
  }>;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await withConnection(async (connection) => {
    const queries = await loadEvaluationQueries(connection, options);
    const ancestorIdsByNodeId = await loadAncestorIdsByNodeId(connection);
    const locales = Array.from(new Set(queries.map((query) => query.locale))).sort();
    const summaries: ModeSummary[] = [];

    for (const mode of ['conservative', 'high_recall'] as const) {
      const indexesByLocale = new Map<string, AliasNgramIndex>();
      let aliasCount = 0;
      let indexLoadMs = 0;

      for (const locale of locales) {
        const started = performance.now();
        const rows = await loadAliasRows(connection, options.sourceName, locale, mode === 'high_recall');
        const index = buildAliasNgramIndexFromRows({
          sourceName: options.sourceName,
          locale,
          includeFamilySupportingAliases: mode === 'high_recall',
          rows
        });
        indexLoadMs += performance.now() - started;
        aliasCount += index.aliasCount;
        indexesByLocale.set(locale, index);
      }

      summaries.push(await evaluateMode(mode, options, queries, indexesByLocale, ancestorIdsByNodeId, aliasCount, indexLoadMs));
    }

    return {
      sourceName: options.sourceName,
      queryMode: options.queryMode,
      queryKind: options.queryKind ?? 'all',
      limit: options.limit,
      queryCount: queries.length,
      summaries
    };
  });

  console.log(formatResult(result));
}

async function evaluateMode(
  mode: Mode,
  options: CliOptions,
  queries: EvaluationQuery[],
  indexesByLocale: Map<string, AliasNgramIndex>,
  ancestorIdsByNodeId: Map<number, Set<number>>,
  aliasCount: number,
  indexLoadMs: number
): Promise<ModeSummary> {
  const summary: ModeSummary = {
    mode,
    aliasCount,
    indexLoadMs: roundMs(indexLoadMs),
    evaluated: 0,
    exactTop1: 0,
    exactTop5: 0,
    contextTop1: 0,
    contextTop5: 0,
    noExpectation: 0,
    byQueryKind: new Map(),
    misses: []
  };

  for (const query of queries) {
    if (query.expectations.length === 0) {
      summary.noExpectation += 1;
      continue;
    }

    const index = indexesByLocale.get(query.locale);

    if (!index) {
      continue;
    }

    const prepared = await prepareOccupationRetrievalQuery({
      sourceName: options.sourceName,
      locale: query.locale,
      originalQuery: query.queryText
    });
    const scoringQuery = scoringQueryForMode(options.queryMode, prepared.preparedQuery);
    const scoringPrepared =
      scoringQuery === prepared.preparedQuery.raw
        ? prepared.preparedQuery
        : await prepareOccupationRetrievalQuery({
            sourceName: options.sourceName,
            locale: query.locale,
            originalQuery: scoringQuery
          }).then((result) => result.preparedQuery);
    const hits = retrieveAliasNgramHits(index, scoringPrepared, { limit: options.limit });
    const exactRanks = query.expectations
      .map((expectation) => rankOfExpectedNode(hits, expectation))
      .filter((rank): rank is number => rank !== null);
    const contextRanks = query.expectations
      .map((expectation) => rankOfExpectedContext(hits, expectation, ancestorIdsByNodeId))
      .filter((rank): rank is number => rank !== null);
    const exactBestRank = Math.min(...exactRanks, Number.POSITIVE_INFINITY);
    const contextBestRank = Math.min(...contextRanks, Number.POSITIVE_INFINITY);
    const kindSummary = getQueryKindSummary(summary, query.queryKind);

    summary.evaluated += 1;
    kindSummary.evaluated += 1;

    if (exactBestRank === 1) {
      summary.exactTop1 += 1;
      kindSummary.exactTop1 += 1;
    }

    if (exactBestRank <= 5) {
      summary.exactTop5 += 1;
      kindSummary.exactTop5 += 1;
    }

    if (contextBestRank === 1) {
      summary.contextTop1 += 1;
      kindSummary.contextTop1 += 1;
    }

    if (contextBestRank <= 5) {
      summary.contextTop5 += 1;
      kindSummary.contextTop5 += 1;
    }

    if (contextBestRank > 5 && summary.misses.length < 30) {
      summary.misses.push({
        id: query.id,
        locale: query.locale,
        query: query.queryText,
        effectiveQuery: prepared.query,
        scoringQuery,
        expected: query.expectations.map((expectation) => `${expectation.label} (${expectation.expectationLevel})`),
        topHits: hits.slice(0, 5).map((hit, index) => ({
          rank: index + 1,
          graphNodeId: hit.graphNodeId,
          canonicalLabel: hit.canonicalLabel,
          familyNodeId: hit.familyNodeId,
          familyLabel: hit.familyLabel,
          alias: hit.alias,
          aliasRole: hit.aliasRole,
          score: hit.score
        }))
      });
    }
  }

  return summary;
}

function getQueryKindSummary(summary: ModeSummary, queryKind: string): QueryKindSummary {
  const existing = summary.byQueryKind.get(queryKind);

  if (existing) {
    return existing;
  }

  const created: QueryKindSummary = {
    queryKind,
    evaluated: 0,
    exactTop1: 0,
    exactTop5: 0,
    contextTop1: 0,
    contextTop5: 0
  };
  summary.byQueryKind.set(queryKind, created);
  return created;
}

function rankOfExpectedNode(hits: ReturnType<typeof retrieveAliasNgramHits>, expectation: EvaluationExpectation): number | null {
  const index = hits.findIndex((hit) => hit.graphNodeId === expectation.nodeId);
  return index === -1 ? null : index + 1;
}

function rankOfExpectedContext(
  hits: ReturnType<typeof retrieveAliasNgramHits>,
  expectation: EvaluationExpectation,
  ancestorIdsByNodeId: Map<number, Set<number>>
): number | null {
  const expectedContextNodeId = expectation.nodeLevel === 'occupation' ? expectation.familyNodeId : expectation.nodeId;

  if (!expectedContextNodeId) {
    return rankOfExpectedNode(hits, expectation);
  }

  const index = hits.findIndex(
    (hit) =>
      hit.graphNodeId === expectedContextNodeId ||
      hit.familyNodeId === expectedContextNodeId ||
      (ancestorIdsByNodeId.get(hit.graphNodeId)?.has(expectedContextNodeId) ?? false) ||
      (hit.familyNodeId !== null && (ancestorIdsByNodeId.get(hit.familyNodeId)?.has(expectedContextNodeId) ?? false))
  );
  return index === -1 ? rankOfExpectedNode(hits, expectation) : index + 1;
}

async function loadAncestorIdsByNodeId(connection: Connection): Promise<Map<number, Set<number>>> {
  const [rows] = await connection.query<Array<RowDataPacket & { graph_node_id: number; ancestor_node_id: number }>>(
    `
      SELECT
        meta.graph_node_id,
        ancestor.ancestor_node_id
      FROM ose_search_meta_ancestors ancestor
      INNER JOIN ose_search_meta meta
        ON meta.id = ancestor.search_meta_id
    `
  );
  const ancestorsByNode = new Map<number, Set<number>>();

  for (const row of rows) {
    const nodeId = Number(row.graph_node_id);
    const ancestors = ancestorsByNode.get(nodeId) ?? new Set<number>([nodeId]);
    ancestors.add(Number(row.ancestor_node_id));
    ancestorsByNode.set(nodeId, ancestors);
  }

  return ancestorsByNode;
}

async function loadEvaluationQueries(connection: Connection, options: CliOptions): Promise<EvaluationQuery[]> {
  const filters: string[] = [];
  const limitSql = options.maxQueries ? 'LIMIT ?' : '';
  const params: Array<string | number> = [];

  if (options.locale) {
    filters.push('query.locale_code = ?');
    params.push(options.locale);
  }

  if (options.queryKind) {
    filters.push('query.query_kind = ?');
    params.push(options.queryKind);
  }

  if (options.maxQueries) {
    params.push(options.maxQueries);
  }

  const [rows] = await connection.query<EvaluationQueryRow[]>(
    `
      SELECT
        query.id,
        query.locale_code,
        query.query_text,
        query.query_kind,
        expectation.expected_node_id,
        expectation.expectation_level,
        expectation.rank_ceiling,
        expected_node.canonical_label AS expected_label,
        expected_node.node_level AS expected_node_level,
        expected_meta.family_node_id AS expected_family_node_id,
        expected_family.canonical_label AS expected_family_label
      FROM ose_evaluation_queries query
      LEFT JOIN ose_evaluation_expectations expectation
        ON expectation.evaluation_query_id = query.id
      LEFT JOIN ose_graph_nodes expected_node
        ON expected_node.id = expectation.expected_node_id
      LEFT JOIN ose_search_meta expected_meta
        ON expected_meta.graph_node_id = expectation.expected_node_id
      LEFT JOIN ose_graph_nodes expected_family
        ON expected_family.id = expected_meta.family_node_id
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY query.id, expectation.id
      ${limitSql}
    `,
    params
  );
  const byId = new Map<number, EvaluationQuery>();

  for (const row of rows) {
    const query = byId.get(row.id) ?? {
      id: Number(row.id),
      locale: String(row.locale_code),
      queryText: String(row.query_text),
      queryKind: String(row.query_kind),
      expectations: []
    };

    if (row.expected_node_id !== null && row.expected_label && row.expected_node_level && row.expectation_level) {
      query.expectations.push({
        nodeId: Number(row.expected_node_id),
        label: row.expected_label,
        nodeLevel: row.expected_node_level,
        familyNodeId: row.expected_family_node_id === null ? null : Number(row.expected_family_node_id),
        familyLabel: row.expected_family_label,
        expectationLevel: row.expectation_level,
        rankCeiling: row.rank_ceiling === null ? null : Number(row.rank_ceiling)
      });
    }

    byId.set(query.id, query);
  }

  return Array.from(byId.values());
}

async function loadAliasRows(
  connection: Connection,
  sourceName: string,
  locale: string,
  includeFamilySupportingAliases: boolean
): Promise<AliasNgramSourceRow[]> {
  const [rows] = await connection.query<AliasRow[]>(
    `
      (
        SELECT
          meta.graph_node_id,
          node.canonical_label,
          meta.family_node_id,
          family.canonical_label AS family_label,
          alias.alias,
          alias.normalized_alias,
          alias.alias_role,
          alias.weight
        FROM ose_search_meta_aliases alias
        INNER JOIN ose_search_meta meta
          ON meta.id = alias.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        LEFT JOIN ose_graph_nodes family
          ON family.id = meta.family_node_id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND alias.locale_code = ?
          AND alias.alias_role IN ('locale_primary', 'locale_supporting', 'reviewed_crosswalk')
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = meta.graph_node_id
              AND node_source.source_name = ?
          )
      )
      UNION ALL
      (
        SELECT
          meta.family_node_id AS graph_node_id,
          family.canonical_label,
          meta.family_node_id,
          family.canonical_label AS family_label,
          MIN(alias.alias) AS alias,
          alias.normalized_alias,
          alias.alias_role,
          MAX(alias.weight) AS weight
        FROM ose_search_meta_aliases alias
        INNER JOIN ose_search_meta meta
          ON meta.id = alias.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        INNER JOIN ose_graph_nodes family
          ON family.id = meta.family_node_id
        WHERE ? = 1
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND alias.locale_code = ?
          AND alias.alias_role = 'family_supporting'
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = meta.graph_node_id
              AND node_source.source_name = ?
          )
        GROUP BY
          meta.family_node_id,
          family.canonical_label,
          alias.normalized_alias,
          alias.alias_role
      )
    `,
    [locale, sourceName, includeFamilySupportingAliases ? 1 : 0, locale, sourceName]
  );

  return rows.map((row) => ({
    graphNodeId: Number(row.graph_node_id),
    canonicalLabel: String(row.canonical_label),
    familyNodeId: row.family_node_id === null ? null : Number(row.family_node_id),
    familyLabel: row.family_label === null ? null : String(row.family_label),
    alias: String(row.alias),
    normalizedAlias: String(row.normalized_alias),
    aliasRole: String(row.alias_role),
    aliasWeight: row.weight === null ? null : Number(row.weight)
  }));
}

function scoringQueryForMode(
  queryMode: 'role' | 'effective',
  preparedQuery: { raw: string; normalized: string; usefulFoldedRecallTokens: string[]; intent: { roleTokens: string[] } }
): string {
  if (queryMode === 'effective') {
    return preparedQuery.raw;
  }

  return (
    preparedQuery.intent.roleTokens.join(' ').trim() ||
    preparedQuery.usefulFoldedRecallTokens.join(' ').trim() ||
    preparedQuery.normalized
  );
}

function formatResult(result: {
  sourceName: string;
  queryMode: string;
  queryKind: string;
  limit: number;
  queryCount: number;
  summaries: ModeSummary[];
}): string {
  const lines = [
    `Alias ngram evaluation comparison source=${result.sourceName} query_mode=${result.queryMode} query_kind=${result.queryKind} limit=${result.limit} queries=${result.queryCount}`
  ];

  for (const summary of result.summaries) {
    lines.push('');
    lines.push(
      `${summary.mode}: aliases=${summary.aliasCount} index_load=${summary.indexLoadMs}ms evaluated=${summary.evaluated} no_expectation=${summary.noExpectation}`
    );
    lines.push(`  exact_top1=${pct(summary.exactTop1, summary.evaluated)} (${summary.exactTop1}/${summary.evaluated})`);
    lines.push(`  exact_top5=${pct(summary.exactTop5, summary.evaluated)} (${summary.exactTop5}/${summary.evaluated})`);
    lines.push(`  context_top1=${pct(summary.contextTop1, summary.evaluated)} (${summary.contextTop1}/${summary.evaluated})`);
    lines.push(`  context_top5=${pct(summary.contextTop5, summary.evaluated)} (${summary.contextTop5}/${summary.evaluated})`);

    for (const kindSummary of Array.from(summary.byQueryKind.values()).sort((left, right) =>
      left.queryKind.localeCompare(right.queryKind)
    )) {
      lines.push(
        `  ${kindSummary.queryKind}: exact_top5=${pct(kindSummary.exactTop5, kindSummary.evaluated)} (${kindSummary.exactTop5}/${kindSummary.evaluated}) context_top5=${pct(kindSummary.contextTop5, kindSummary.evaluated)} (${kindSummary.contextTop5}/${kindSummary.evaluated})`
      );
    }

    if (summary.misses.length > 0) {
      lines.push('  first_context_top5_misses:');

      for (const miss of summary.misses.slice(0, 10)) {
        lines.push(`    #${miss.id} ${miss.locale} "${miss.query}" scoring="${miss.scoringQuery}" expected=${miss.expected.join(' | ')}`);
        lines.push(`      top=${miss.topHits.map((hit) => `${hit.rank}:${hit.canonicalLabel} via "${hit.alias}"`).join(' ; ') || 'none'}`);
      }
    }
  }

  return lines.join('\n');
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    limit: 10,
    queryMode: 'role'
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--query-kind=')) {
      options.queryKind = arg.slice('--query-kind='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg.startsWith('--max-queries=')) {
      options.maxQueries = parsePositiveInteger(arg.slice('--max-queries='.length), '--max-queries');
      continue;
    }

    if (arg.startsWith('--query-mode=')) {
      options.queryMode = parseQueryMode(arg.slice('--query-mode='.length));
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

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseQueryMode(value: string): 'role' | 'effective' {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'role' || normalized === 'effective') {
    return normalized;
  }

  throw new Error(`Unsupported query mode "${value}". Use role or effective.`);
}

function pct(value: number, total: number): string {
  if (total === 0) {
    return '0.0%';
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/compare-alias-ngram-evaluation.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      '[--query-kind=title|description|keyword|mixed]',
      '[--limit=10]',
      '[--max-queries=N]',
      '[--query-mode=role|effective]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error('Alias ngram evaluation comparison failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
