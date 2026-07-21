import type { Connection, RowDataPacket } from 'mysql2/promise';
import { DEFAULT_ESCO_SOURCE_NAME } from '../audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';

const OWNED_BY = 'seed-evaluation-set';

export type RankedGapAnalysisFormat = 'text' | 'json';

export type ReportRankedGapAnalysisOptions = {
  searchRunId: number;
  sourceName?: string;
  setKey?: string;
  limit?: number;
};

export type SelectedClassification =
  | 'exact_leaf_hit'
  | 'acceptable_hit'
  | 'family_or_group_hit'
  | 'miss'
  | 'unresolved'
  | 'missing_expectation';

export type GapBucket =
  | 'selected_success'
  | 'selected_miss_top1_leaf_hit'
  | 'selected_miss_top2_or_top3_leaf_hit'
  | 'selected_miss_no_top3_leaf_hit'
  | 'unresolved_top1_leaf_hit'
  | 'unresolved_top2_or_top3_leaf_hit'
  | 'unresolved_no_top3_leaf_hit'
  | 'family_or_group_with_top1_leaf_hit'
  | 'top3_miss_best_branch_hit'
  | 'missing_expectation'
  | 'no_ranked_evidence';

export type RankedLeafEvidence = {
  rank: number;
  graphNodeId: number;
  label: string | null;
  evidenceTier: string | null;
  retrievalScore: number;
  resolverScore: number;
  leafMarginRatio: number;
  branchShare: number;
  branchMarginRatio: number;
  exactAliasScore: number;
  foldedAliasScore: number;
  opensearchLexicalScore: number;
  capabilityTaskScore: number;
  denseEmbeddingScore: number;
};

export type BestBroaderBranchEvidence = {
  branchNodeId: number;
  branchKind: string | null;
  branchLabel: string | null;
  retrievalScore: number;
};

export type QueryGapAnalysis = {
  evaluationQueryId: number;
  queryText: string;
  category: string;
  classification: SelectedClassification;
  bucket: GapBucket;
  selectedGraphNodeId: number | null;
  selectedDecisionStage: string | null;
  expectedExactLeafIds: number[];
  expectedAcceptableLeafIds: number[];
  expectedFamilyIds: number[];
  expectedGroupIds: number[];
  correctLeafRank: number | null;
  top1LeafHit: boolean;
  top3LeafHit: boolean;
  bestBroaderBranchHit: boolean;
  topLeaf: RankedLeafEvidence | null;
  correctLeaf: RankedLeafEvidence | null;
  bestBroaderBranch: BestBroaderBranchEvidence | null;
};

export type RankedGapAnalysisReport = {
  searchRunId: number;
  runLabel: string;
  sourceName: string;
  setKey: string;
  maxQueries: number | null;
  queryCount: number;
  bucketCounts: Record<GapBucket, number>;
  classificationCounts: Record<SelectedClassification, number>;
  categoryBucketCounts: Record<string, Partial<Record<GapBucket, number>>>;
  promotionCandidateCounts: {
    top1LeafHitNotSelected: number;
    top2OrTop3LeafHitNotSelected: number;
    bestBranchHitWithoutTop3LeafHit: number;
  };
  promotionCandidates: QueryGapAnalysis[];
  branchOnlyCandidates: QueryGapAnalysis[];
  riskyGaps: QueryGapAnalysis[];
};

type SearchRunRow = RowDataPacket & {
  id: number;
  run_label: string;
  config_json: unknown;
  max_queries: number | null;
};

type EvaluationQueryRow = RowDataPacket & {
  id: number;
  locale_code: string;
  query_text: string;
  normalized_query: string | null;
  query_kind: string;
  notes: string | null;
};

type EvaluationExpectationRow = RowDataPacket & {
  evaluation_query_id: number;
  expected_node_id: number;
  expectation_level: 'exact_leaf' | 'acceptable_leaf' | 'family' | 'group';
};

type SearchRunResultRow = RowDataPacket & {
  evaluation_query_id: number;
  graph_node_id: number;
  rank_position: number;
  decision_stage: string | null;
  retrieval_sources_json: unknown;
};

type ResolvedRunScope = {
  searchRunId: number;
  runLabel: string;
  sourceName: string;
  setKey: string;
  maxQueries: number | null;
};

type ExpectationSets = {
  exactLeafIds: Set<number>;
  acceptableLeafIds: Set<number>;
  familyIds: Set<number>;
  groupIds: Set<number>;
};

export class RankedGapAnalysisReporter {
  public constructor(private readonly connection: Connection) {}

  public async run(options: ReportRankedGapAnalysisOptions): Promise<RankedGapAnalysisReport> {
    const searchRunId = normalizeRequiredRunId(options.searchRunId);
    const scope = await this.loadRunScope(searchRunId, options.sourceName, options.setKey);
    const queries = await this.loadEvaluationQueries(scope.sourceName, scope.setKey, scope.maxQueries ?? undefined);

    if (queries.length === 0) {
      throw new Error(
        `Search run ${scope.searchRunId} has no matching evaluation queries for source_name="${scope.sourceName}" and set_key="${scope.setKey}".`
      );
    }

    const queryIds = queries.map((query) => query.id);
    const expectations = await this.loadExpectations(queryIds);
    const results = await this.loadSearchRunResults(scope.searchRunId, queryIds);
    const expectationsByQueryId = groupBy(expectations, (row) => row.evaluation_query_id);
    const resultsByQueryId = groupBy(results, (row) => row.evaluation_query_id);
    const queryAnalyses = queries.map((query) =>
      analyzeQueryGap(query, expectationsByQueryId.get(query.id) ?? [], resultsByQueryId.get(query.id) ?? [])
    );
    const promotionCandidates = queryAnalyses.filter((query) =>
      query.bucket === 'selected_miss_top1_leaf_hit' ||
      query.bucket === 'selected_miss_top2_or_top3_leaf_hit' ||
      query.bucket === 'unresolved_top1_leaf_hit' ||
      query.bucket === 'unresolved_top2_or_top3_leaf_hit' ||
      query.bucket === 'family_or_group_with_top1_leaf_hit'
    );
    const branchOnlyCandidates = queryAnalyses.filter((query) => query.bucket === 'top3_miss_best_branch_hit');
    const riskyGaps = queryAnalyses.filter((query) =>
      query.bucket === 'selected_miss_no_top3_leaf_hit' ||
      query.bucket === 'unresolved_no_top3_leaf_hit' ||
      query.bucket === 'no_ranked_evidence'
    );
    const limit = normalizeLimit(options.limit);

    return {
      searchRunId: scope.searchRunId,
      runLabel: scope.runLabel,
      sourceName: scope.sourceName,
      setKey: scope.setKey,
      maxQueries: scope.maxQueries,
      queryCount: queries.length,
      bucketCounts: countBy(queryAnalyses, (query) => query.bucket),
      classificationCounts: countBy(queryAnalyses, (query) => query.classification),
      categoryBucketCounts: buildCategoryBucketCounts(queryAnalyses),
      promotionCandidateCounts: {
        top1LeafHitNotSelected: promotionCandidates.filter((query) => query.correctLeafRank === 1).length,
        top2OrTop3LeafHitNotSelected: promotionCandidates.filter((query) => query.correctLeafRank !== null && query.correctLeafRank > 1).length,
        bestBranchHitWithoutTop3LeafHit: branchOnlyCandidates.length
      },
      promotionCandidates: promotionCandidates.slice(0, limit),
      branchOnlyCandidates: branchOnlyCandidates.slice(0, limit),
      riskyGaps: riskyGaps.slice(0, limit)
    };
  }

  private async loadRunScope(
    searchRunId: number,
    requestedSourceName: string | undefined,
    requestedSetKey: string | undefined
  ): Promise<ResolvedRunScope> {
    const [rows] = await this.connection.query<SearchRunRow[]>(
      `
        SELECT
          id,
          run_label,
          config_json,
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.max_queries')), 'null') AS SIGNED) AS max_queries
        FROM ose_search_runs
        WHERE id = ?
        LIMIT 1
      `,
      [searchRunId]
    );
    const row = rows[0];

    if (!row) {
      throw new Error(`Search run ${searchRunId} was not found.`);
    }

    const config = toRecord(row.config_json);
    const normalizedRequestedSourceName = requestedSourceName?.trim() || null;
    const normalizedRequestedSetKey = requestedSetKey?.trim() || null;
    const sourceName = toOptionalString(config.source_name) ?? normalizedRequestedSourceName ?? normalizeSourceName(undefined);
    const setKey = toOptionalString(config.set_key) ?? normalizedRequestedSetKey ?? normalizeSetKey(undefined);

    if (normalizedRequestedSourceName && sourceName !== normalizedRequestedSourceName) {
      throw new Error(`Search run ${searchRunId} belongs to source_name="${sourceName}", not "${normalizedRequestedSourceName}".`);
    }

    if (normalizedRequestedSetKey && setKey !== normalizedRequestedSetKey) {
      throw new Error(`Search run ${searchRunId} belongs to set_key="${setKey}", not "${normalizedRequestedSetKey}".`);
    }

    return {
      searchRunId: row.id,
      runLabel: row.run_label,
      sourceName,
      setKey,
      maxQueries: row.max_queries
    };
  }

  private async loadEvaluationQueries(
    sourceName: string,
    setKey: string,
    maxQueries: number | undefined
  ): Promise<EvaluationQueryRow[]> {
    const params: Array<string | number> = [OWNED_BY, setKey, sourceName];
    const limitSql = maxQueries === undefined ? '' : 'LIMIT ?';

    if (maxQueries !== undefined) {
      params.push(maxQueries);
    }

    const [rows] = await this.connection.query<EvaluationQueryRow[]>(
      `
        SELECT
          query.id,
          query.locale_code,
          query.query_text,
          query.normalized_query,
          query.query_kind,
          query.notes
        FROM ose_evaluation_queries query
        WHERE query.notes IS NOT NULL
          AND JSON_VALID(query.notes)
          AND JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.phase8_owned_by')) = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.phase8_set_key')) = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.source_name')) = ?
        ORDER BY query.id
        ${limitSql}
      `,
      params
    );

    return rows;
  }

  private async loadExpectations(queryIds: number[]): Promise<EvaluationExpectationRow[]> {
    const [rows] = await this.connection.query<EvaluationExpectationRow[]>(
      `
        SELECT
          expectation.evaluation_query_id,
          expectation.expected_node_id,
          expectation.expectation_level
        FROM ose_evaluation_expectations expectation
        WHERE expectation.evaluation_query_id IN (${placeholders(queryIds.length)})
        ORDER BY expectation.evaluation_query_id, expectation.expectation_level, expectation.expected_node_id
      `,
      queryIds
    );

    return rows;
  }

  private async loadSearchRunResults(searchRunId: number, queryIds: number[]): Promise<SearchRunResultRow[]> {
    const [rows] = await this.connection.query<SearchRunResultRow[]>(
      `
        SELECT
          result.evaluation_query_id,
          result.graph_node_id,
          result.rank_position,
          result.decision_stage,
          result.retrieval_sources_json
        FROM ose_search_run_results result
        WHERE result.search_run_id = ?
          AND result.evaluation_query_id IN (${placeholders(queryIds.length)})
        ORDER BY result.evaluation_query_id, result.rank_position, result.graph_node_id
      `,
      [searchRunId, ...queryIds]
    );

    return rows;
  }
}

export function formatRankedGapAnalysisReport(
  report: RankedGapAnalysisReport,
  format: RankedGapAnalysisFormat = 'text'
): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push('Ranked gap analysis complete.');
  lines.push(
    `run_id=${report.searchRunId}, run_label=${report.runLabel}, source_name=${report.sourceName}, set_key=${report.setKey}, query_count=${report.queryCount}`
  );
  lines.push(`classification_counts=${formatCounts(report.classificationCounts)}`);
  lines.push(`bucket_counts=${formatCounts(report.bucketCounts)}`);
  lines.push(
    [
      `promotion_candidates.top1_leaf_hit_not_selected=${report.promotionCandidateCounts.top1LeafHitNotSelected}`,
      `promotion_candidates.top2_or_top3_leaf_hit_not_selected=${report.promotionCandidateCounts.top2OrTop3LeafHitNotSelected}`,
      `promotion_candidates.best_branch_hit_without_top3_leaf_hit=${report.promotionCandidateCounts.bestBranchHitWithoutTop3LeafHit}`
    ].join(', ')
  );
  lines.push('');
  lines.push('Category Buckets');

  for (const [category, counts] of Object.entries(report.categoryBucketCounts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- ${category}: ${formatCounts(counts)}`);
  }

  lines.push('');
  lines.push('Clean Promotion Candidates');
  appendQueryList(lines, report.promotionCandidates);

  lines.push('');
  lines.push('Branch-Only Candidates');
  appendQueryList(lines, report.branchOnlyCandidates);

  lines.push('');
  lines.push('Risky Gaps');
  appendQueryList(lines, report.riskyGaps);

  lines.push('');
  lines.push('This is a read-only diagnostic report. It does not change retrieval, resolver, evaluation, or review behavior.');

  return lines.join('\n');
}

function analyzeQueryGap(
  query: EvaluationQueryRow,
  expectations: EvaluationExpectationRow[],
  results: SearchRunResultRow[]
): QueryGapAnalysis {
  const expectationSets = buildExpectationSets(expectations);
  const selectedRow = results.find((row) => row.decision_stage?.startsWith('selected_')) ?? null;
  const classification = classifySelectedOutcome(expectationSets, expectations.length, selectedRow);
  const rankedResults = findRankedResults(results);
  const topLeaves = extractTopLeaves(rankedResults);
  const bestBroaderBranch = extractBestBroaderBranch(rankedResults);
  const correctLeaf = findCorrectLeaf(topLeaves, expectationSets);
  const correctLeafRank = correctLeaf?.rank ?? null;
  const top1LeafHit = correctLeafRank === 1;
  const top3LeafHit = correctLeafRank !== null && correctLeafRank <= 3;
  const bestBroaderBranchHit = isBestBroaderBranchHit(bestBroaderBranch, expectationSets);
  const bucket = classifyBucket(classification, top1LeafHit, top3LeafHit, bestBroaderBranchHit, topLeaves.length > 0);

  return {
    evaluationQueryId: query.id,
    queryText: query.query_text,
    category: categoryFromNotes(query.notes),
    classification,
    bucket,
    selectedGraphNodeId: selectedRow?.graph_node_id ?? null,
    selectedDecisionStage: selectedRow?.decision_stage ?? null,
    expectedExactLeafIds: Array.from(expectationSets.exactLeafIds).sort((left, right) => left - right),
    expectedAcceptableLeafIds: Array.from(expectationSets.acceptableLeafIds).sort((left, right) => left - right),
    expectedFamilyIds: Array.from(expectationSets.familyIds).sort((left, right) => left - right),
    expectedGroupIds: Array.from(expectationSets.groupIds).sort((left, right) => left - right),
    correctLeafRank,
    top1LeafHit,
    top3LeafHit,
    bestBroaderBranchHit,
    topLeaf: topLeaves[0] ?? null,
    correctLeaf,
    bestBroaderBranch
  };
}

function classifySelectedOutcome(
  expectations: ExpectationSets,
  expectationCount: number,
  selectedRow: SearchRunResultRow | null
): SelectedClassification {
  if (expectationCount === 0) {
    return 'missing_expectation';
  }

  if (!selectedRow) {
    return 'unresolved';
  }

  if (selectedRow.decision_stage === 'selected_leaf' && expectations.exactLeafIds.has(selectedRow.graph_node_id)) {
    return 'exact_leaf_hit';
  }

  if (selectedRow.decision_stage === 'selected_leaf' && expectations.acceptableLeafIds.has(selectedRow.graph_node_id)) {
    return 'acceptable_hit';
  }

  if (
    (selectedRow.decision_stage === 'selected_family' && expectations.familyIds.has(selectedRow.graph_node_id)) ||
    (selectedRow.decision_stage === 'selected_group' && expectations.groupIds.has(selectedRow.graph_node_id))
  ) {
    return 'family_or_group_hit';
  }

  return 'miss';
}

function classifyBucket(
  classification: SelectedClassification,
  top1LeafHit: boolean,
  top3LeafHit: boolean,
  bestBroaderBranchHit: boolean,
  hasRankedEvidence: boolean
): GapBucket {
  if (classification === 'missing_expectation') {
    return 'missing_expectation';
  }

  if (!hasRankedEvidence) {
    return 'no_ranked_evidence';
  }

  if (classification === 'exact_leaf_hit' || classification === 'acceptable_hit') {
    return 'selected_success';
  }

  if (classification === 'family_or_group_hit') {
    return top1LeafHit ? 'family_or_group_with_top1_leaf_hit' : 'selected_success';
  }

  if (classification === 'miss') {
    if (top1LeafHit) {
      return 'selected_miss_top1_leaf_hit';
    }

    if (top3LeafHit) {
      return 'selected_miss_top2_or_top3_leaf_hit';
    }

    return bestBroaderBranchHit ? 'top3_miss_best_branch_hit' : 'selected_miss_no_top3_leaf_hit';
  }

  if (top1LeafHit) {
    return 'unresolved_top1_leaf_hit';
  }

  if (top3LeafHit) {
    return 'unresolved_top2_or_top3_leaf_hit';
  }

  return bestBroaderBranchHit ? 'top3_miss_best_branch_hit' : 'unresolved_no_top3_leaf_hit';
}

function buildExpectationSets(expectations: EvaluationExpectationRow[]): ExpectationSets {
  return {
    exactLeafIds: new Set(expectations.filter((row) => row.expectation_level === 'exact_leaf').map((row) => row.expected_node_id)),
    acceptableLeafIds: new Set(expectations.filter((row) => row.expectation_level === 'acceptable_leaf').map((row) => row.expected_node_id)),
    familyIds: new Set(expectations.filter((row) => row.expectation_level === 'family').map((row) => row.expected_node_id)),
    groupIds: new Set(expectations.filter((row) => row.expectation_level === 'group').map((row) => row.expected_node_id))
  };
}

function findRankedResults(results: SearchRunResultRow[]): Record<string, unknown> {
  for (const result of results) {
    const rankedResults = toRecord(toRecord(result.retrieval_sources_json).ranked_results);

    if (Object.keys(rankedResults).length > 0) {
      return rankedResults;
    }
  }

  return {};
}

function extractTopLeaves(rankedResults: Record<string, unknown>): RankedLeafEvidence[] {
  const rawTopLeaves = Array.isArray(rankedResults.top_leaves) ? rankedResults.top_leaves : [];

  return rawTopLeaves.map((item, index) => {
    const leaf = toRecord(item);
    const channelScores = toRecord(leaf.channel_scores);

    return {
      rank: index + 1,
      graphNodeId: toNumber(leaf.graph_node_id),
      label: toOptionalString(leaf.label),
      evidenceTier: toOptionalString(leaf.evidence_tier),
      retrievalScore: toNumber(leaf.retrieval_score),
      resolverScore: toNumber(leaf.resolver_score),
      leafMarginRatio: toNumber(leaf.leaf_margin_ratio),
      branchShare: toNumber(leaf.branch_share),
      branchMarginRatio: toNumber(leaf.branch_margin_ratio),
      exactAliasScore: toNumber(channelScores.exact_alias),
      foldedAliasScore: toNumber(channelScores.folded_alias),
      opensearchLexicalScore: toNumber(channelScores.opensearch_lexical),
      capabilityTaskScore: toNumber(channelScores.capability_task),
      denseEmbeddingScore: toNumber(channelScores.dense_embedding)
    };
  });
}

function extractBestBroaderBranch(rankedResults: Record<string, unknown>): BestBroaderBranchEvidence | null {
  const branch = toRecord(rankedResults.best_broader_branch);
  const branchNodeId = toNumber(branch.branch_node_id);

  if (branchNodeId <= 0) {
    return null;
  }

  return {
    branchNodeId,
    branchKind: toOptionalString(branch.branch_kind),
    branchLabel: toOptionalString(branch.branch_label),
    retrievalScore: toNumber(branch.retrieval_score)
  };
}

function findCorrectLeaf(
  leaves: RankedLeafEvidence[],
  expectations: ExpectationSets
): RankedLeafEvidence | null {
  return leaves.find((leaf) => expectations.exactLeafIds.has(leaf.graphNodeId) || expectations.acceptableLeafIds.has(leaf.graphNodeId)) ?? null;
}

function isBestBroaderBranchHit(
  branch: BestBroaderBranchEvidence | null,
  expectations: ExpectationSets
): boolean {
  if (!branch) {
    return false;
  }

  return (
    (branch.branchKind === 'family' && expectations.familyIds.has(branch.branchNodeId)) ||
    (branch.branchKind === 'group' && expectations.groupIds.has(branch.branchNodeId))
  );
}

function buildCategoryBucketCounts(queries: QueryGapAnalysis[]): Record<string, Partial<Record<GapBucket, number>>> {
  const counts: Record<string, Partial<Record<GapBucket, number>>> = {};

  for (const query of queries) {
    const categoryCounts = counts[query.category] ?? {};
    categoryCounts[query.bucket] = (categoryCounts[query.bucket] ?? 0) + 1;
    counts[query.category] = categoryCounts;
  }

  return counts;
}

function appendQueryList(lines: string[], queries: QueryGapAnalysis[]): void {
  if (queries.length === 0) {
    lines.push('- none');
    return;
  }

  for (const query of queries) {
    lines.push(formatQueryGap(query));
  }
}

function formatQueryGap(query: QueryGapAnalysis): string {
  const topLeaf = query.topLeaf;
  const correctLeaf = query.correctLeaf;
  const branch = query.bestBroaderBranch;
  const parts = [
    `- query_id=${query.evaluationQueryId}`,
    `category=${query.category}`,
    `bucket=${query.bucket}`,
    `classification=${query.classification}`,
    `correct_leaf_rank=${query.correctLeafRank ?? 'none'}`,
    `selected=${query.selectedDecisionStage ?? 'none'}:${query.selectedGraphNodeId ?? 'none'}`,
    `top_leaf=${topLeaf ? `${topLeaf.graphNodeId}:${topLeaf.evidenceTier ?? 'unknown'}` : 'none'}`,
    `correct_leaf=${correctLeaf ? `${correctLeaf.graphNodeId}:${correctLeaf.evidenceTier ?? 'unknown'}` : 'none'}`,
    `branch_hit=${query.bestBroaderBranchHit ? 'yes' : 'no'}`,
    `best_branch=${branch ? `${branch.branchKind ?? 'unknown'}:${branch.branchNodeId}` : 'none'}`,
    `query="${clipForLine(query.queryText)}"`
  ];

  if (correctLeaf) {
    parts.push(
      `correct_scores=retrieval:${formatNumber(correctLeaf.retrievalScore)},resolver:${formatNumber(correctLeaf.resolverScore)},leaf_margin:${formatNumber(correctLeaf.leafMarginRatio)},branch_share:${formatNumber(correctLeaf.branchShare)},branch_margin:${formatNumber(correctLeaf.branchMarginRatio)},os:${formatNumber(correctLeaf.opensearchLexicalScore)},cap:${formatNumber(correctLeaf.capabilityTaskScore)},dense:${formatNumber(correctLeaf.denseEmbeddingScore)},exact:${formatNumber(correctLeaf.exactAliasScore)},folded:${formatNumber(correctLeaf.foldedAliasScore)}`
    );
  }

  return parts.join(' ');
}

function categoryFromNotes(notes: string | null): string {
  const parsed = toRecord(notes);
  const category = toOptionalString(parsed.category);

  return category ?? 'uncategorized';
}

function groupBy<T, K>(items: T[], keySelector: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  for (const item of items) {
    const key = keySelector(item);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  return grouped;
}

function countBy<T, K extends string>(items: T[], keySelector: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;

  for (const item of items) {
    const key = keySelector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function toRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return isPlainObject(parsed) ? parsed : {};
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeRequiredRunId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--search-run-id must be a positive integer. Received "${value}".`);
  }

  return value;
}

function normalizeSourceName(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeSetKey(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || defaultEvaluationSearchSetKey();
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 20;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--limit must be a positive integer. Received "${value}".`);
  }

  return value;
}

function formatCounts<K extends string>(counts: Partial<Record<K, number>>): string {
  const entries = Object.entries(counts)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  if (entries.length === 0) {
    return 'none';
  }

  return entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function clipForLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}
