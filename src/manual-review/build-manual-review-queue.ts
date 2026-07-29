import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DEFAULT_ESCO_SOURCE_NAME } from '../audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';
import { normalizeSearchText } from '../utils/texts.js';

const DEFAULT_INSPECTION_PREVIEW_LIMIT = 12;
const OWNED_BY = 'seed-evaluation-set';

export type ManualReviewType = 'alias_conflict' | 'generic_head' | 'hierarchy_gap' | 'relatedness_gap' | 'cross_locale_gap';

export type BuildManualReviewQueueOptions = {
  searchRunId?: number;
  sourceName?: string;
  setKey?: string;
  limit?: number;
  dryRun?: boolean;
  includeExisting?: boolean;
};

export type ManualReviewBuildFormat = 'text' | 'json';

export type BuildManualReviewQueueResult = {
  searchRunId: number;
  sourceName: string;
  setKey: string;
  limit: number | null;
  dryRun: boolean;
  includeExisting: boolean;
  localeCount: number;
  discoveredCount: number;
  consideredCount: number;
  existingPendingCount: number;
  newCandidateCount: number;
  insertedCount: number;
  countsByType: Array<{
    reviewType: ManualReviewType;
    discovered: number;
    considered: number;
    existingPending: number;
    newCandidate: number;
    inserted: number;
  }>;
  preview: ManualReviewQueuePreviewRow[];
};

export type ManualReviewQueuePreviewRow = {
  reviewType: ManualReviewType;
  localeCode: string | null;
  subjectText: string | null;
  graphNodeId: number | null;
  graphNodeLabel: string | null;
  status: 'new' | 'existing_pending';
  existingQueueId: number | null;
  payloadJson: Record<string, unknown>;
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
  rank_ceiling: number | null;
  canonical_label: string;
  node_level: string;
};

type SearchRunResultRow = RowDataPacket & {
  evaluation_query_id: number;
  graph_node_id: number;
  canonical_label: string;
  node_level: string;
  rank_position: number;
  score: number;
  decision_stage: string | null;
  retrieval_sources_json: unknown;
  explanation_json: unknown;
};

type SearchMetaSignalRow = RowDataPacket & {
  graph_node_id: number;
  canonical_label: string;
  normalized_label: string;
  generic_risk: string;
  exact_alias_count: number;
  active_alias_count: number;
  locale_coverage_count: number;
  has_hierarchy: number;
  parent_node_id: number | null;
  family_node_id: number | null;
  group_node_id: number | null;
  english_backbone_strength: number | null;
};

type LocaleRow = RowDataPacket & {
  locale_code: string;
};

type PendingQueueLookupRow = RowDataPacket & {
  id: number;
  review_type: ManualReviewType;
  normalized_subject_text: string | null;
  graph_node_id: number | null;
  payload_json: unknown;
};

type ReviewQueueCandidate = {
  reviewType: ManualReviewType;
  localeCode: string | null;
  subjectText: string | null;
  normalizedSubjectText: string | null;
  graphNodeId: number | null;
  graphNodeLabel: string | null;
  payloadJson: Record<string, unknown>;
};

type CandidateWithStatus = ReviewQueueCandidate & {
  status: 'new' | 'existing_pending';
  existingQueueId: number | null;
};

type EvaluationReviewContext = {
  query: EvaluationQueryRow;
  expectations: EvaluationExpectationRow[];
  results: SearchRunResultRow[];
};

export class ManualReviewQueueBuilder {
  public constructor(private readonly connection: Connection) {}

  public async run(options: BuildManualReviewQueueOptions = {}): Promise<BuildManualReviewQueueResult> {
    const resolvedRun = await this.resolveSearchRun(options.searchRunId, options.sourceName, options.setKey);
    const sourceName = resolvedRun.sourceName;
    const setKey = resolvedRun.setKey;
    const localeCount = await this.resolveLocaleCount(sourceName);
    const pendingLookup = await this.loadPendingLookup();
    const rawCandidates = [
      ...(await this.loadEvaluationFailureCandidates(resolvedRun.searchRunId, sourceName, setKey, resolvedRun.maxQueries)),
      ...(await this.loadSearchMetaSignalCandidates(sourceName, localeCount))
    ];
    const dedupedCandidates = dedupeCandidates(rawCandidates);
    const discoveredCounts = countByType(dedupedCandidates);
    const candidatesWithStatus = this.attachPendingStatus(dedupedCandidates, pendingLookup);
    const visibleCandidates =
      options.includeExisting === true ? candidatesWithStatus : candidatesWithStatus.filter((candidate) => candidate.status === 'new');
    const limitedCandidates = applyLimit(visibleCandidates, options.limit);
    const newCandidates = limitedCandidates.filter((candidate) => candidate.status === 'new');
    const insertedCountsByType = new Map<ManualReviewType, number>();

    let insertedCount = 0;

    if (options.dryRun !== true && newCandidates.length > 0) {
      await this.connection.beginTransaction();

      try {
        for (const candidate of newCandidates) {
          const inserted = await this.insertCandidate(candidate, pendingLookup);
          insertedCount += inserted;

          if (inserted > 0) {
            insertedCountsByType.set(candidate.reviewType, (insertedCountsByType.get(candidate.reviewType) ?? 0) + inserted);
          }
        }

        await this.connection.commit();
      } catch (error) {
        await this.connection.rollback();
        throw error;
      }
    }

    const countsByType = buildCountsByType(discoveredCounts, limitedCandidates, insertedCountsByType);

    return {
      searchRunId: resolvedRun.searchRunId,
      sourceName,
      setKey,
      limit: options.limit ?? null,
      dryRun: options.dryRun === true,
      includeExisting: options.includeExisting === true,
      localeCount,
      discoveredCount: dedupedCandidates.length,
      consideredCount: limitedCandidates.length,
      existingPendingCount: limitedCandidates.filter((candidate) => candidate.status === 'existing_pending').length,
      newCandidateCount: newCandidates.length,
      insertedCount,
      countsByType,
      preview: limitedCandidates.slice(0, DEFAULT_INSPECTION_PREVIEW_LIMIT).map((candidate) => ({
        reviewType: candidate.reviewType,
        localeCode: candidate.localeCode,
        subjectText: candidate.subjectText,
        graphNodeId: candidate.graphNodeId,
        graphNodeLabel: candidate.graphNodeLabel,
        status: candidate.status,
        existingQueueId: candidate.existingQueueId,
        payloadJson: candidate.payloadJson
      }))
    };
  }

  private async resolveSearchRun(
    requestedSearchRunId: number | undefined,
    requestedSourceName: string | undefined,
    requestedSetKey: string | undefined
  ): Promise<{ searchRunId: number; sourceName: string; setKey: string; maxQueries: number | null }> {
    const normalizedSourceName = normalizeSourceName(requestedSourceName);
    const normalizedSetKey = normalizeSetKey(requestedSetKey);

    if (requestedSearchRunId !== undefined) {
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
        [requestedSearchRunId]
      );

      const row = rows[0];

      if (!row) {
        throw new Error(`Search run ${requestedSearchRunId} was not found.`);
      }

      const config = toRecord(row.config_json);
      const sourceName = toOptionalString(config.source_name) ?? normalizedSourceName;
      const setKey = toOptionalString(config.set_key) ?? normalizedSetKey;

      if (requestedSourceName && sourceName !== normalizedSourceName) {
        throw new Error(`Search run ${requestedSearchRunId} belongs to source_name="${sourceName}", not "${normalizedSourceName}".`);
      }

      if (requestedSetKey && setKey !== normalizedSetKey) {
        throw new Error(`Search run ${requestedSearchRunId} belongs to set_key="${setKey}", not "${normalizedSetKey}".`);
      }

      return {
        searchRunId: row.id,
        sourceName,
        setKey,
        maxQueries: row.max_queries
      };
    }

    const [rows] = await this.connection.query<SearchRunRow[]>(
      `
        SELECT
          id,
          run_label,
          config_json,
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.max_queries')), 'null') AS SIGNED) AS max_queries
        FROM ose_search_runs
        WHERE JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.run_kind')) = 'evaluation_search_persistence'
          AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.source_name')) = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.set_key')) = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [normalizedSourceName, normalizedSetKey]
    );

    const row = rows[0];

    if (!row) {
      throw new Error(
        `No persisted evaluation search run found for source_name="${normalizedSourceName}" and set_key="${normalizedSetKey}".`
      );
    }

    return {
      searchRunId: row.id,
      sourceName: normalizedSourceName,
      setKey: normalizedSetKey,
      maxQueries: row.max_queries
    };
  }

  private async resolveLocaleCount(sourceName: string): Promise<number> {
    const [rows] = await this.connection.query<LocaleRow[]>(
      `
        SELECT DISTINCT alias.locale_code
        FROM ose_graph_aliases alias
        INNER JOIN ose_graph_nodes node
          ON node.id = alias.graph_node_id
        WHERE alias.source_name = ?
          AND alias.is_active = 1
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
        ORDER BY alias.locale_code
      `,
      [sourceName]
    );

    const localeCount = rows.map((row) => row.locale_code).filter(Boolean).length;

    if (localeCount === 0) {
      throw new Error(`No active graph alias locales found for source_name="${sourceName}".`);
    }

    return localeCount;
  }

  private async loadEvaluationFailureCandidates(
    searchRunId: number,
    sourceName: string,
    setKey: string,
    maxQueries: number | null
  ): Promise<ReviewQueueCandidate[]> {
    const queries = await this.loadEvaluationQueries(sourceName, setKey, maxQueries ?? undefined);

    if (queries.length === 0) {
      return [];
    }

    const queryIds = queries.map((query) => query.id);
    const expectations = await this.loadExpectations(queryIds);
    const results = await this.loadSearchRunResults(searchRunId, queryIds);

    const expectationMap = groupBy(expectations, (row) => row.evaluation_query_id);
    const resultMap = groupBy(results, (row) => row.evaluation_query_id);
    const candidates: ReviewQueueCandidate[] = [];

    for (const query of queries) {
      const context: EvaluationReviewContext = {
        query,
        expectations: expectationMap.get(query.id) ?? [],
        results: resultMap.get(query.id) ?? []
      };
      candidates.push(...buildEvaluationCandidates(searchRunId, sourceName, setKey, context));
    }

    return candidates;
  }

  private async loadEvaluationQueries(sourceName: string, setKey: string, maxQueries: number | undefined): Promise<EvaluationQueryRow[]> {
    const limitSql = maxQueries === undefined ? '' : 'LIMIT ?';
    const params: Array<string | number> = [OWNED_BY, setKey, sourceName];

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
          expectation.expectation_level,
          expectation.rank_ceiling,
          node.canonical_label,
          node.node_level
        FROM ose_evaluation_expectations expectation
        INNER JOIN ose_graph_nodes node
          ON node.id = expectation.expected_node_id
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
          node.canonical_label,
          node.node_level,
          result.rank_position,
          result.score,
          result.decision_stage,
          result.retrieval_sources_json,
          result.explanation_json
        FROM ose_search_run_results result
        INNER JOIN ose_graph_nodes node
          ON node.id = result.graph_node_id
        WHERE result.search_run_id = ?
          AND result.evaluation_query_id IN (${placeholders(queryIds.length)})
        ORDER BY result.evaluation_query_id, result.rank_position, result.graph_node_id
      `,
      [searchRunId, ...queryIds]
    );

    return rows;
  }

  private async loadSearchMetaSignalCandidates(sourceName: string, localeCount: number): Promise<ReviewQueueCandidate[]> {
    const [rows] = await this.connection.query<SearchMetaSignalRow[]>(
      `
        SELECT
          meta.graph_node_id,
          node.canonical_label,
          node.normalized_label,
          meta.generic_risk,
          meta.exact_alias_count,
          meta.active_alias_count,
          meta.locale_coverage_count,
          meta.has_hierarchy,
          meta.parent_node_id,
          meta.family_node_id,
          meta.group_node_id,
          meta.english_backbone_strength
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE ${sourceExistsSql()}
          AND (
            meta.generic_risk = 'high'
            OR meta.has_hierarchy = 0
            OR meta.parent_node_id IS NULL
            OR meta.family_node_id IS NULL
            OR meta.group_node_id IS NULL
            OR meta.locale_coverage_count < ?
          )
        ORDER BY
          CASE
            WHEN meta.generic_risk = 'high' THEN 0
            WHEN meta.locale_coverage_count < ? THEN 1
            ELSE 2
          END,
          node.canonical_label
      `,
      [sourceName, localeCount, localeCount]
    );

    const candidates: ReviewQueueCandidate[] = [];

    for (const row of rows) {
      if (row.generic_risk === 'high') {
        candidates.push({
          reviewType: 'generic_head',
          localeCode: null,
          subjectText: row.canonical_label,
          normalizedSubjectText: row.normalized_label,
          graphNodeId: row.graph_node_id,
          graphNodeLabel: row.canonical_label,
          payloadJson: {
            source_name: sourceName,
            issue: 'search_meta_high_generic_risk',
            generic_risk: row.generic_risk,
            exact_alias_count: row.exact_alias_count,
            active_alias_count: row.active_alias_count,
            english_backbone_strength: row.english_backbone_strength
          }
        });
      }

      if (row.has_hierarchy === 0 || row.parent_node_id === null || row.family_node_id === null || row.group_node_id === null) {
        candidates.push({
          reviewType: 'hierarchy_gap',
          localeCode: null,
          subjectText: row.canonical_label,
          normalizedSubjectText: row.normalized_label,
          graphNodeId: row.graph_node_id,
          graphNodeLabel: row.canonical_label,
          payloadJson: {
            source_name: sourceName,
            issue: 'search_meta_hierarchy_gap',
            has_hierarchy: row.has_hierarchy === 1,
            parent_node_id: row.parent_node_id,
            family_node_id: row.family_node_id,
            group_node_id: row.group_node_id
          }
        });
      }

      if (row.locale_coverage_count < localeCount) {
        candidates.push({
          reviewType: 'cross_locale_gap',
          localeCode: null,
          subjectText: row.canonical_label,
          normalizedSubjectText: row.normalized_label,
          graphNodeId: row.graph_node_id,
          graphNodeLabel: row.canonical_label,
          payloadJson: {
            source_name: sourceName,
            issue: 'search_meta_locale_coverage_gap',
            expected_locale_count: localeCount,
            locale_coverage_count: row.locale_coverage_count
          }
        });
      }
    }

    return candidates;
  }

  private async loadPendingLookup(): Promise<Map<string, number>> {
    const [rows] = await this.connection.query<PendingQueueLookupRow[]>(
      `
        SELECT
          review.id,
          review.review_type,
          review.normalized_subject_text,
          review.graph_node_id,
          review.payload_json
        FROM ose_manual_review_queue review
        WHERE review.review_status = 'pending'
      `
    );

    const lookup = new Map<string, number>();

    for (const row of rows) {
      lookup.set(
        buildReviewCandidateKey({
          reviewType: row.review_type,
          normalizedSubjectText: row.normalized_subject_text,
          graphNodeId: row.graph_node_id,
          payloadJson: toRecord(row.payload_json)
        }),
        row.id
      );
    }

    return lookup;
  }

  private attachPendingStatus(candidates: ReviewQueueCandidate[], pendingLookup: Map<string, number>): CandidateWithStatus[] {
    return candidates.map((candidate) => {
      const existingQueueId = pendingLookup.get(buildReviewCandidateKey(candidate)) ?? null;

      return {
        ...candidate,
        status: existingQueueId === null ? 'new' : 'existing_pending',
        existingQueueId
      };
    });
  }

  private async insertCandidate(candidate: ReviewQueueCandidate, pendingLookup: Map<string, number>): Promise<number> {
    const candidateKey = buildReviewCandidateKey(candidate);

    if (pendingLookup.has(candidateKey)) {
      return 0;
    }

    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_manual_review_queue (
          review_type,
          locale_code,
          subject_text,
          normalized_subject_text,
          graph_node_id,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        candidate.reviewType,
        candidate.localeCode,
        candidate.subjectText,
        candidate.normalizedSubjectText,
        candidate.graphNodeId,
        JSON.stringify(candidate.payloadJson)
      ]
    );

    pendingLookup.set(candidateKey, result.insertId);
    return result.affectedRows;
  }
}

export function formatBuildManualReviewQueueResult(result: BuildManualReviewQueueResult, format: ManualReviewBuildFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Phase 13 manual review ${result.dryRun ? 'dry run' : 'build'} complete.`);
  lines.push(`search_run_id=${result.searchRunId}, source_name=${result.sourceName}, set_key=${result.setKey}`);
  lines.push(
    `locale_count=${result.localeCount}, discovered=${result.discoveredCount}, considered=${result.consideredCount}, existing_pending=${result.existingPendingCount}, new_candidates=${result.newCandidateCount}, inserted=${result.insertedCount}`
  );
  lines.push(`include_existing=${result.includeExisting ? 'yes' : 'no'}, limit=${result.limit ?? 'all'}`);
  lines.push('');
  lines.push('Counts By Type');
  lines.push(
    formatTable(result.countsByType, [
      ['reviewType', 'review_type'],
      ['discovered', 'discovered'],
      ['considered', 'considered'],
      ['existingPending', 'existing_pending'],
      ['newCandidate', 'new_candidates'],
      ['inserted', 'inserted']
    ])
  );
  lines.push('');
  lines.push('Preview');
  lines.push(
    result.preview.length === 0
      ? 'No review rows matched the requested scope.'
      : formatTable(
          result.preview.map((row) => ({
            reviewType: row.reviewType,
            localeCode: row.localeCode ?? '',
            subjectText: clipText(row.subjectText ?? '', 72),
            graphNodeId: row.graphNodeId ?? '',
            graphNodeLabel: clipText(row.graphNodeLabel ?? '', 36),
            status: row.status,
            existingQueueId: row.existingQueueId ?? '',
            payloadSummary: clipText(formatPayloadSummary(row.payloadJson), 72)
          })),
          [
            ['reviewType', 'review_type'],
            ['localeCode', 'locale'],
            ['subjectText', 'subject'],
            ['graphNodeId', 'node_id'],
            ['graphNodeLabel', 'node_label'],
            ['status', 'status'],
            ['existingQueueId', 'existing_id'],
            ['payloadSummary', 'payload_summary']
          ]
        )
  );
  lines.push('');
  lines.push(
    'This is workflow tooling only. It does not automatically change taxonomy, graph/search-meta data, retrieval, resolver scoring, or search-run persistence.'
  );

  return lines.join('\n');
}

function buildEvaluationCandidates(
  searchRunId: number,
  sourceName: string,
  setKey: string,
  context: EvaluationReviewContext
): ReviewQueueCandidate[] {
  const selectedRow = context.results.find((row) => row.decision_stage?.startsWith('selected_')) ?? null;
  const topRow = context.results[0] ?? null;
  const exactExpectations = context.expectations.filter((row) => row.expectation_level === 'exact_leaf');
  const fallbackExpectations = exactExpectations.length > 0 ? exactExpectations : context.expectations;
  const expectedNodeIds = new Set(fallbackExpectations.map((row) => row.expected_node_id));
  const selectedMatchesExpectation = selectedRow ? expectedNodeIds.has(selectedRow.graph_node_id) : false;
  const reviewCandidates: ReviewQueueCandidate[] = [];

  if (selectedMatchesExpectation) {
    return reviewCandidates;
  }

  const reviewType = 'relatedness_gap';
  const selectedOutcome = selectedRow ? summarizeRunRow(selectedRow) : null;
  const topCandidate = topRow ? summarizeRunRow(topRow) : null;
  const notes = parseJsonValue(context.query.notes);
  const lexicalConflict = hasLexicalConflict(context.results);

  reviewCandidates.push({
    reviewType,
    localeCode: context.query.locale_code,
    subjectText: context.query.query_text,
    normalizedSubjectText: context.query.normalized_query ?? normalizeText(context.query.query_text),
    graphNodeId: selectedRow?.graph_node_id ?? null,
    graphNodeLabel: selectedRow?.canonical_label ?? null,
    payloadJson: {
      source_name: sourceName,
      set_key: setKey,
      search_run_id: searchRunId,
      evaluation_query_id: context.query.id,
      issue: selectedRow ? 'evaluation_selected_mismatch' : 'evaluation_unresolved_query',
      query_kind: context.query.query_kind,
      query_text: context.query.query_text,
      expected_exact_leaf_labels: exactExpectations.map((row) => row.canonical_label),
      expected_exact_leaf_ids: exactExpectations.map((row) => row.expected_node_id),
      fallback_expectations: fallbackExpectations.map((row) => ({
        expected_node_id: row.expected_node_id,
        expectation_level: row.expectation_level,
        canonical_label: row.canonical_label,
        rank_ceiling: row.rank_ceiling
      })),
      selected_outcome: selectedOutcome,
      top_candidate: topCandidate,
      result_count: context.results.length,
      notes_context: isPlainObject(notes)
        ? {
            case_key: toOptionalString(notes.case_key),
            category: toOptionalString(notes.category),
            description: toOptionalString(notes.description)
          }
        : null
    }
  });

  if (lexicalConflict) {
    reviewCandidates.push({
      reviewType: 'alias_conflict',
      localeCode: context.query.locale_code,
      subjectText: context.query.query_text,
      normalizedSubjectText: context.query.normalized_query ?? normalizeText(context.query.query_text),
      graphNodeId: null,
      graphNodeLabel: null,
      payloadJson: {
        source_name: sourceName,
        set_key: setKey,
        search_run_id: searchRunId,
        evaluation_query_id: context.query.id,
        issue: 'evaluation_lexical_alias_conflict',
        query_kind: context.query.query_kind,
        query_text: context.query.query_text,
        selected_outcome: selectedOutcome,
        top_candidate: topCandidate,
        lexical_candidates: summarizeLexicalCandidates(context.results)
      }
    });
  }

  return reviewCandidates;
}

function summarizeRunRow(row: SearchRunResultRow): Record<string, unknown> {
  const retrievalSources = toRecord(row.retrieval_sources_json);
  const explanation = toRecord(row.explanation_json);

  return {
    graph_node_id: row.graph_node_id,
    canonical_label: row.canonical_label,
    node_level: row.node_level,
    rank_position: row.rank_position,
    score: row.score,
    decision_stage: row.decision_stage,
    retrieval_role: toOptionalString(retrievalSources.role),
    candidate_evidence_tier: toOptionalString(toRecord(retrievalSources.candidate).evidence_tier),
    branch_evidence_tier: toOptionalString(toRecord(retrievalSources.branch).evidence_tier),
    selected_decision_type: toOptionalString(explanation.decision_type)
  };
}

function sourceExistsSql(): string {
  return `
    EXISTS (
      SELECT 1
      FROM ose_graph_node_sources node_source
      WHERE node_source.graph_node_id = meta.graph_node_id
        AND node_source.source_name = ?
    )
  `;
}

function buildCountsByType(
  discoveredCounts: Map<ManualReviewType, number>,
  candidates: CandidateWithStatus[],
  insertedCounts: Map<ManualReviewType, number>
): BuildManualReviewQueueResult['countsByType'] {
  const types = Array.from(
    new Set<ManualReviewType>([
      'alias_conflict',
      'generic_head',
      'hierarchy_gap',
      'cross_locale_gap',
      'relatedness_gap',
      ...candidates.map((candidate) => candidate.reviewType),
      ...Array.from(discoveredCounts.keys())
    ])
  );

  return types
    .map((reviewType) => {
      const matching = candidates.filter((candidate) => candidate.reviewType === reviewType);

      return {
        reviewType,
        discovered: discoveredCounts.get(reviewType) ?? 0,
        considered: matching.length,
        existingPending: matching.filter((candidate) => candidate.status === 'existing_pending').length,
        newCandidate: matching.filter((candidate) => candidate.status === 'new').length,
        inserted: insertedCounts.get(reviewType) ?? 0
      };
    })
    .filter((row) => row.discovered > 0 || row.considered > 0);
}

function applyLimit<T>(items: T[], limit: number | undefined): T[] {
  if (limit === undefined) {
    return items;
  }

  return items.slice(0, limit);
}

function dedupeCandidates(candidates: ReviewQueueCandidate[]): ReviewQueueCandidate[] {
  const seen = new Set<string>();
  const deduped: ReviewQueueCandidate[] = [];

  for (const candidate of candidates) {
    const key = buildReviewCandidateKey(candidate);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function countByType(candidates: ReviewQueueCandidate[]): Map<ManualReviewType, number> {
  const counts = new Map<ManualReviewType, number>();

  for (const candidate of candidates) {
    counts.set(candidate.reviewType, (counts.get(candidate.reviewType) ?? 0) + 1);
  }

  return counts;
}

function groupBy<T, K>(items: T[], keySelector: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  for (const item of items) {
    const key = keySelector(item);
    const existing = grouped.get(key);

    if (existing) {
      existing.push(item);
      continue;
    }

    grouped.set(key, [item]);
  }

  return grouped;
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

function toRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return isPlainObject(parsed) ? parsed : {};
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSourceName(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeSetKey(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || defaultEvaluationSearchSetKey();
}

export function formatTable<T extends Record<string, unknown>>(rows: T[], columns: Array<[keyof T, string]>): string {
  if (rows.length === 0) {
    return '';
  }

  const values = rows.map((row) => columns.map(([key]) => stringifyTableValue(row[key])));
  const widths = columns.map(([, label], index) => {
    const cellWidths = values.map((row) => row[index].length);
    return Math.max(label.length, ...cellWidths);
  });
  const header = columns.map(([, label], index) => label.padEnd(widths[index])).join(' | ');
  const separator = widths.map((width) => '-'.repeat(width)).join('-|-');
  const body = values.map((row) => row.map((value, index) => value.padEnd(widths[index])).join(' | '));

  return [header, separator, ...body].join('\n');
}

function stringifyTableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return String(value);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function normalizeText(value: string): string {
  return normalizeSearchText(value);
}

function buildReviewCandidateKey(candidate: {
  reviewType: ManualReviewType;
  normalizedSubjectText: string | null;
  graphNodeId: number | null;
  payloadJson: Record<string, unknown>;
}): string {
  const issue = toOptionalString(candidate.payloadJson.issue) ?? 'unknown_issue';
  const setKey = toOptionalString(candidate.payloadJson.set_key) ?? '';
  const searchRunId = toOptionalString(candidate.payloadJson.search_run_id) ?? String(toNumber(candidate.payloadJson.search_run_id) || '');

  if (candidate.graphNodeId !== null) {
    return [candidate.reviewType, `graph:${candidate.graphNodeId}`, `issue:${issue}`, `set:${setKey}`, `run:${searchRunId}`].join('|');
  }

  return [
    candidate.reviewType,
    `subject:${candidate.normalizedSubjectText ?? ''}`,
    `issue:${issue}`,
    `set:${setKey}`,
    `run:${searchRunId}`
  ].join('|');
}

function hasLexicalConflict(results: SearchRunResultRow[]): boolean {
  return summarizeLexicalCandidates(results).length >= 2;
}

function summarizeLexicalCandidates(results: SearchRunResultRow[]): Array<Record<string, unknown>> {
  type LexicalCandidateSummary = {
    graph_node_id: number;
    canonical_label: string;
    decision_stage: string | null;
    evidence_tier: string;
    rank_position: number;
    score: number;
  };

  const lexicalCandidates: LexicalCandidateSummary[] = [];

  for (const row of results) {
    const summary = summarizeRunRow(row);
    const evidenceTier = toOptionalString(summary.candidate_evidence_tier) ?? toOptionalString(summary.branch_evidence_tier);

    if (evidenceTier !== 'exact_alias' && evidenceTier !== 'folded_alias') {
      continue;
    }

    lexicalCandidates.push({
      graph_node_id: row.graph_node_id,
      canonical_label: row.canonical_label,
      decision_stage: row.decision_stage,
      evidence_tier: evidenceTier,
      rank_position: row.rank_position,
      score: row.score
    });
  }
  const seen = new Set<number>();

  return lexicalCandidates.filter((row) => {
    const graphNodeId = row.graph_node_id;

    if (seen.has(graphNodeId)) {
      return false;
    }

    seen.add(graphNodeId);
    return true;
  });
}

function formatPayloadSummary(payloadJson: Record<string, unknown>): string {
  const parts: string[] = [];
  const issue = toOptionalString(payloadJson.issue);
  const runId = toNumber(payloadJson.search_run_id);
  const queryId = toNumber(payloadJson.evaluation_query_id);
  const selectedOutcome = toRecord(payloadJson.selected_outcome);
  const topCandidate = toRecord(payloadJson.top_candidate);

  if (issue) {
    parts.push(`issue=${issue}`);
  }

  if (runId > 0) {
    parts.push(`run=${runId}`);
  }

  if (queryId > 0) {
    parts.push(`query=${queryId}`);
  }

  if (toOptionalString(selectedOutcome.canonical_label)) {
    parts.push(`selected="${toOptionalString(selectedOutcome.canonical_label)}"`);
  } else if (toOptionalString(selectedOutcome.selected_decision_type)) {
    parts.push(`selected_type=${toOptionalString(selectedOutcome.selected_decision_type)}`);
  }

  if (toOptionalString(topCandidate.canonical_label)) {
    parts.push(`top="${toOptionalString(topCandidate.canonical_label)}"`);
  }

  if (toOptionalString(topCandidate.candidate_evidence_tier)) {
    parts.push(`evidence=${toOptionalString(topCandidate.candidate_evidence_tier)}`);
  } else if (toOptionalString(topCandidate.branch_evidence_tier)) {
    parts.push(`branch_evidence=${toOptionalString(topCandidate.branch_evidence_tier)}`);
  }

  return parts.join(' ');
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
