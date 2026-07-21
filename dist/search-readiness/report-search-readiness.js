import { DEFAULT_ESCO_SOURCE_NAME } from '../audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';
const OWNED_BY = 'seed-evaluation-set';
export class SearchReadinessReporter {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options) {
        const baselineRunId = normalizeOptionalRunId('baseline-run-id', options.baselineRunId);
        const candidateRunId = normalizeOptionalRunId('candidate-run-id', options.candidateRunId);
        if (baselineRunId === undefined && candidateRunId === undefined) {
            throw new Error('Provide at least one run with --baseline-run-id=N or --candidate-run-id=N.');
        }
        const baselineScope = baselineRunId === undefined
            ? null
            : await this.loadRunScope(baselineRunId, options.sourceName, options.setKey);
        const candidateScope = candidateRunId === undefined
            ? null
            : await this.loadRunScope(candidateRunId, options.sourceName, options.setKey);
        const primaryScope = candidateScope ?? baselineScope;
        if (!primaryScope) {
            throw new Error('Unable to resolve a search run scope.');
        }
        if (baselineScope && candidateScope) {
            assertMatchingScope(baselineScope, candidateScope);
        }
        const sourceName = primaryScope.sourceName;
        const setKey = primaryScope.setKey;
        const baselineRun = baselineScope ? await this.buildRunSummary(baselineScope) : null;
        const candidateRun = candidateScope ? await this.buildRunSummary(candidateScope) : null;
        const primaryRun = candidateRun ?? baselineRun;
        if (!primaryRun) {
            throw new Error('Unable to build a readiness summary.');
        }
        const comparison = baselineRun && candidateRun ? buildComparison(baselineRun, candidateRun) : null;
        const verdict = buildVerdict(primaryRun, baselineRun, candidateRun, comparison);
        return {
            mode: baselineRun && candidateRun ? 'compare' : 'single',
            sourceName,
            setKey,
            primaryRun,
            baselineRun,
            candidateRun,
            comparison,
            verdict
        };
    }
    async loadRunScope(searchRunId, requestedSourceName, requestedSetKey) {
        const [rows] = await this.connection.query(`
        SELECT
          id,
          run_label,
          config_json,
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.max_queries')), 'null') AS SIGNED) AS max_queries
        FROM ose_search_runs
        WHERE id = ?
        LIMIT 1
      `, [searchRunId]);
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
    async buildRunSummary(scope) {
        const queries = await this.loadEvaluationQueries(scope.sourceName, scope.setKey, scope.maxQueries ?? undefined);
        if (queries.length === 0) {
            throw new Error(`Search run ${scope.searchRunId} has no matching Phase 8 evaluation queries for source_name="${scope.sourceName}" and set_key="${scope.setKey}".`);
        }
        const queryIds = queries.map((query) => query.id);
        const expectations = await this.loadExpectations(queryIds);
        const results = await this.loadSearchRunResults(scope.searchRunId, queryIds);
        const pendingReviewCountsByType = await this.loadPendingReviewCounts(scope.searchRunId);
        const expectationMap = groupBy(expectations, (row) => row.evaluation_query_id);
        const resultMap = groupBy(results, (row) => row.evaluation_query_id);
        let selectedCount = 0;
        let unresolvedCount = 0;
        let unresolvedExpectedCount = 0;
        let exactLeafHitCount = 0;
        let acceptableHitCount = 0;
        let familyOrGroupHitCount = 0;
        let missCount = 0;
        let missingExpectationCount = 0;
        const selectedStageCounts = {};
        const candidateResultCounts = {};
        const classificationsByQueryId = {};
        const categorySummariesByName = new Map();
        const evidenceQueryIds = {
            exactAlias: new Set(),
            foldedAlias: new Set(),
            denseOnly: new Set()
        };
        const rankedEvidenceQueryIds = new Set();
        let top3LeafHitCount = 0;
        let bestBroaderBranchHitCount = 0;
        let hierarchyCandidateCount = 0;
        for (const row of results) {
            const decisionStage = row.decision_stage?.trim() ?? '';
            if (decisionStage.startsWith('selected_')) {
                selectedStageCounts[decisionStage] = (selectedStageCounts[decisionStage] ?? 0) + 1;
            }
            if (decisionStage.startsWith('candidate_')) {
                candidateResultCounts[decisionStage] = (candidateResultCounts[decisionStage] ?? 0) + 1;
            }
            if (decisionStage === 'candidate_family' || decisionStage === 'candidate_group') {
                hierarchyCandidateCount += 1;
            }
            const evidencePresence = summarizeEvidencePresence(row.retrieval_sources_json);
            if (evidencePresence.exactAlias) {
                evidenceQueryIds.exactAlias.add(row.evaluation_query_id);
            }
            if (evidencePresence.foldedAlias) {
                evidenceQueryIds.foldedAlias.add(row.evaluation_query_id);
            }
            if (evidencePresence.denseOnly) {
                evidenceQueryIds.denseOnly.add(row.evaluation_query_id);
            }
        }
        for (const query of queries) {
            const queryExpectations = expectationMap.get(query.id) ?? [];
            const queryResults = resultMap.get(query.id) ?? [];
            const classification = classifyQueryReadiness(queryExpectations, queryResults);
            const rankedEvidence = summarizeRankedEvidence(queryExpectations, queryResults);
            const categorySummary = getOrCreateCategorySummary(categorySummariesByName, categoryFromNotes(query.notes));
            classificationsByQueryId[query.id] = classification;
            incrementCategorySummary(categorySummary, classification, queryExpectations.length > 0);
            if (rankedEvidence.hasRankedEvidence) {
                rankedEvidenceQueryIds.add(query.id);
            }
            if (rankedEvidence.top3LeafHit) {
                top3LeafHitCount += 1;
            }
            if (rankedEvidence.bestBroaderBranchHit) {
                bestBroaderBranchHitCount += 1;
            }
            switch (classification) {
                case 'exact_leaf_hit':
                    selectedCount += 1;
                    exactLeafHitCount += 1;
                    break;
                case 'acceptable_hit':
                    selectedCount += 1;
                    acceptableHitCount += 1;
                    break;
                case 'family_or_group_hit':
                    selectedCount += 1;
                    familyOrGroupHitCount += 1;
                    break;
                case 'miss':
                    selectedCount += 1;
                    missCount += 1;
                    break;
                case 'unresolved':
                    unresolvedCount += 1;
                    if (queryExpectations.length > 0) {
                        unresolvedExpectedCount += 1;
                    }
                    break;
                case 'missing_expectation':
                    missingExpectationCount += 1;
                    break;
            }
        }
        const pendingReviewTotal = Object.values(pendingReviewCountsByType).reduce((total, count) => total + count, 0);
        return {
            searchRunId: scope.searchRunId,
            runLabel: scope.runLabel,
            sourceName: scope.sourceName,
            setKey: scope.setKey,
            maxQueries: scope.maxQueries,
            queryCount: queries.length,
            selectedCount,
            unresolvedCount,
            unresolvedExpectedCount,
            exactLeafHitCount,
            acceptableHitCount,
            familyOrGroupHitCount,
            missCount,
            missingExpectationCount,
            selectedStageCounts,
            candidateResultCounts,
            pendingReviewCountsByType,
            pendingReviewTotal,
            evidenceQueryCounts: {
                exactAlias: evidenceQueryIds.exactAlias.size,
                foldedAlias: evidenceQueryIds.foldedAlias.size,
                denseOnly: evidenceQueryIds.denseOnly.size
            },
            rankedEvidenceCounts: {
                rankedEvidenceQueries: rankedEvidenceQueryIds.size,
                top3LeafHit: top3LeafHitCount,
                bestBroaderBranchHit: bestBroaderBranchHitCount
            },
            hierarchyCandidateCount,
            resolutionPresent: selectedCount > 0,
            classificationsByQueryId,
            categorySummaries: Array.from(categorySummariesByName.values()).sort((left, right) => left.category.localeCompare(right.category))
        };
    }
    async loadEvaluationQueries(sourceName, setKey, maxQueries) {
        const params = [OWNED_BY, setKey, sourceName];
        const limitSql = maxQueries === undefined ? '' : 'LIMIT ?';
        if (maxQueries !== undefined) {
            params.push(maxQueries);
        }
        const [rows] = await this.connection.query(`
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
      `, params);
        return rows;
    }
    async loadExpectations(queryIds) {
        const [rows] = await this.connection.query(`
        SELECT
          expectation.evaluation_query_id,
          expectation.expected_node_id,
          expectation.expectation_level
        FROM ose_evaluation_expectations expectation
        WHERE expectation.evaluation_query_id IN (${placeholders(queryIds.length)})
        ORDER BY expectation.evaluation_query_id, expectation.expectation_level, expectation.expected_node_id
      `, queryIds);
        return rows;
    }
    async loadSearchRunResults(searchRunId, queryIds) {
        const [rows] = await this.connection.query(`
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
      `, [searchRunId, ...queryIds]);
        return rows;
    }
    async loadPendingReviewCounts(searchRunId) {
        const [rows] = await this.connection.query(`
        SELECT
          review.review_type,
          COUNT(*) AS pending_count
        FROM ose_manual_review_queue review
        WHERE review.review_status = 'pending'
          AND JSON_VALID(review.payload_json)
          AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(review.payload_json, '$.search_run_id')), 'null') AS SIGNED) = ?
        GROUP BY review.review_type
        ORDER BY review.review_type
      `, [searchRunId]);
        const counts = {};
        for (const row of rows) {
            counts[row.review_type] = row.pending_count;
        }
        return counts;
    }
}
export function formatSearchReadinessReport(report, format = 'text') {
    if (format === 'json') {
        return JSON.stringify(report, null, 2);
    }
    const lines = [];
    lines.push(`Phase 14 search readiness ${report.mode === 'compare' ? 'comparison' : 'report'} complete.`);
    lines.push(`source_name=${report.sourceName}, set_key=${report.setKey}, mode=${report.mode}`);
    lines.push('');
    lines.push(formatRunSummary('Primary Run', report.primaryRun));
    if (report.baselineRun) {
        lines.push('');
        lines.push(formatRunSummary('Baseline Run', report.baselineRun));
    }
    if (report.candidateRun && report.candidateRun.searchRunId !== report.primaryRun.searchRunId) {
        lines.push('');
        lines.push(formatRunSummary('Candidate Run', report.candidateRun));
    }
    if (report.comparison) {
        lines.push('');
        lines.push('Comparison');
        lines.push(report.comparison.comparable && report.comparison.delta
            ? formatDelta(report.comparison.delta)
            : `comparison_status=not_comparable${report.comparison.reason ? ` (${report.comparison.reason})` : ''}`);
        if (report.comparison.comparable && report.comparison.categoryDeltas) {
            lines.push('category_deltas:');
            for (const delta of report.comparison.categoryDeltas) {
                lines.push(formatCategoryDelta(delta));
            }
        }
    }
    lines.push('');
    lines.push('Search Machinery DoD');
    lines.push(`can_answer_from_evidence=${report.verdict.canAnswerDod ? 'yes' : 'no'}`);
    lines.push(`readiness_status=${report.verdict.searchMachineryReady === null ? 'indeterminate' : report.verdict.searchMachineryReady ? 'ready' : 'not_ready'}`);
    lines.push(report.verdict.summary);
    if (report.verdict.remaining.length > 0) {
        lines.push('Remaining:');
        for (const item of report.verdict.remaining) {
            lines.push(`- ${item}`);
        }
    }
    lines.push('');
    lines.push('This is a read-only comparison/reporting workflow. It does not change import, graph, search-meta, retrieval, resolver, search-run, or manual-review queue behavior.');
    return lines.join('\n');
}
function formatRunSummary(label, run) {
    const lines = [];
    lines.push(label);
    lines.push(`run_id=${run.searchRunId}, run_label=${run.runLabel}, max_queries=${run.maxQueries ?? 'all'}`);
    lines.push([
        `query_count=${run.queryCount}`,
        `selected_count=${run.selectedCount}`,
        `unresolved_count=${run.unresolvedCount}`,
        `exact_leaf_hit_count=${run.exactLeafHitCount}`,
        `acceptable_hit_count=${run.acceptableHitCount}`,
        `family_or_group_hit_count=${run.familyOrGroupHitCount}`,
        `miss_count=${run.missCount}`,
        `top3_leaf_hit_count=${run.rankedEvidenceCounts.top3LeafHit}`,
        `best_broader_branch_hit_count=${run.rankedEvidenceCounts.bestBroaderBranchHit}`,
        `unresolved_expected_count=${run.unresolvedExpectedCount}`,
        `pending_review_total=${run.pendingReviewTotal}`
    ].join(', '));
    lines.push(`selected_stage_counts=${formatCounts(run.selectedStageCounts)}`);
    lines.push(`candidate_result_counts=${formatCounts(run.candidateResultCounts)}`);
    lines.push(`pending_review_counts_by_type=${formatCounts(run.pendingReviewCountsByType)}`);
    lines.push([
        `evidence_queries.exact_alias=${run.evidenceQueryCounts.exactAlias}`,
        `evidence_queries.folded_alias=${run.evidenceQueryCounts.foldedAlias}`,
        `evidence_queries.dense_only=${run.evidenceQueryCounts.denseOnly}`,
        `ranked_evidence_queries=${run.rankedEvidenceCounts.rankedEvidenceQueries}`,
        `hierarchy_candidate_count=${run.hierarchyCandidateCount}`,
        `resolution_present=${run.resolutionPresent ? 'yes' : 'no'}`
    ].join(', '));
    lines.push('category_summaries:');
    for (const summary of run.categorySummaries) {
        lines.push(formatCategorySummary(summary));
    }
    return lines.join('\n');
}
function formatDelta(delta) {
    return [
        'candidate_minus_baseline:',
        [
            `query_count=${formatSignedNumber(delta.queryCount)}`,
            `selected_count=${formatSignedNumber(delta.selectedCount)}`,
            `unresolved_count=${formatSignedNumber(delta.unresolvedCount)}`,
            `unresolved_expected_count=${formatSignedNumber(delta.unresolvedExpectedCount)}`,
            `exact_leaf_hit_count=${formatSignedNumber(delta.exactLeafHitCount)}`,
            `acceptable_hit_count=${formatSignedNumber(delta.acceptableHitCount)}`,
            `family_or_group_hit_count=${formatSignedNumber(delta.familyOrGroupHitCount)}`,
            `miss_count=${formatSignedNumber(delta.missCount)}`,
            `top3_leaf_hit_count=${formatSignedNumber(delta.top3LeafHitCount)}`,
            `best_broader_branch_hit_count=${formatSignedNumber(delta.bestBroaderBranchHitCount)}`,
            `pending_review_total=${formatSignedNumber(delta.pendingReviewTotal)}`
        ].join(', ')
    ].join(' ');
}
function buildComparison(baselineRun, candidateRun) {
    const baselineQueryIds = Object.keys(baselineRun.classificationsByQueryId)
        .map((value) => Number.parseInt(value, 10))
        .sort((left, right) => left - right);
    const candidateQueryIds = Object.keys(candidateRun.classificationsByQueryId)
        .map((value) => Number.parseInt(value, 10))
        .sort((left, right) => left - right);
    if (!sameNumberArray(baselineQueryIds, candidateQueryIds)) {
        return {
            comparable: false,
            reason: 'baseline and candidate runs do not cover the same evaluation query IDs',
            delta: null,
            categoryDeltas: null
        };
    }
    return {
        comparable: true,
        reason: null,
        delta: {
            queryCount: candidateRun.queryCount - baselineRun.queryCount,
            selectedCount: candidateRun.selectedCount - baselineRun.selectedCount,
            unresolvedCount: candidateRun.unresolvedCount - baselineRun.unresolvedCount,
            unresolvedExpectedCount: candidateRun.unresolvedExpectedCount - baselineRun.unresolvedExpectedCount,
            exactLeafHitCount: candidateRun.exactLeafHitCount - baselineRun.exactLeafHitCount,
            acceptableHitCount: candidateRun.acceptableHitCount - baselineRun.acceptableHitCount,
            familyOrGroupHitCount: candidateRun.familyOrGroupHitCount - baselineRun.familyOrGroupHitCount,
            missCount: candidateRun.missCount - baselineRun.missCount,
            top3LeafHitCount: candidateRun.rankedEvidenceCounts.top3LeafHit - baselineRun.rankedEvidenceCounts.top3LeafHit,
            bestBroaderBranchHitCount: candidateRun.rankedEvidenceCounts.bestBroaderBranchHit - baselineRun.rankedEvidenceCounts.bestBroaderBranchHit,
            pendingReviewTotal: candidateRun.pendingReviewTotal - baselineRun.pendingReviewTotal
        },
        categoryDeltas: buildCategoryDeltas(baselineRun.categorySummaries, candidateRun.categorySummaries)
    };
}
function buildCategoryDeltas(baselineSummaries, candidateSummaries) {
    const baselineByCategory = new Map(baselineSummaries.map((summary) => [summary.category, summary]));
    const candidateByCategory = new Map(candidateSummaries.map((summary) => [summary.category, summary]));
    const categoryNames = Array.from(new Set([...baselineByCategory.keys(), ...candidateByCategory.keys()])).sort((left, right) => left.localeCompare(right));
    return categoryNames.map((category) => {
        const baseline = baselineByCategory.get(category) ?? emptyCategorySummary(category);
        const candidate = candidateByCategory.get(category) ?? emptyCategorySummary(category);
        return {
            category,
            queryCount: candidate.queryCount - baseline.queryCount,
            selectedCount: candidate.selectedCount - baseline.selectedCount,
            unresolvedCount: candidate.unresolvedCount - baseline.unresolvedCount,
            unresolvedExpectedCount: candidate.unresolvedExpectedCount - baseline.unresolvedExpectedCount,
            exactLeafHitCount: candidate.exactLeafHitCount - baseline.exactLeafHitCount,
            acceptableHitCount: candidate.acceptableHitCount - baseline.acceptableHitCount,
            familyOrGroupHitCount: candidate.familyOrGroupHitCount - baseline.familyOrGroupHitCount,
            missCount: candidate.missCount - baseline.missCount,
            missingExpectationCount: candidate.missingExpectationCount - baseline.missingExpectationCount
        };
    });
}
function buildVerdict(primaryRun, baselineRun, candidateRun, comparison) {
    const remaining = [];
    const evidenceSignals = [
        primaryRun.evidenceQueryCounts.exactAlias > 0,
        primaryRun.evidenceQueryCounts.foldedAlias > 0,
        primaryRun.evidenceQueryCounts.denseOnly > 0,
        primaryRun.hierarchyCandidateCount > 0,
        primaryRun.resolutionPresent
    ];
    if (primaryRun.evidenceQueryCounts.exactAlias === 0) {
        remaining.push('No exact-alias evidence was observed in the reported run scope.');
    }
    if (primaryRun.evidenceQueryCounts.foldedAlias === 0) {
        remaining.push('No folded-alias evidence was observed in the reported run scope.');
    }
    if (primaryRun.evidenceQueryCounts.denseOnly === 0) {
        remaining.push('No dense-only evidence was observed in the reported run scope.');
    }
    if (primaryRun.hierarchyCandidateCount === 0) {
        remaining.push('No candidate_family or candidate_group rows were observed, so hierarchy expansion is not evidenced here.');
    }
    if (!primaryRun.resolutionPresent) {
        remaining.push('No selected_* resolution rows were observed in the reported run scope.');
    }
    if (!baselineRun || !candidateRun) {
        remaining.push('A baseline-vs-candidate comparison is still required before Search Machinery DoD can be answered.');
    }
    else if (!comparison?.comparable) {
        remaining.push(comparison?.reason ?? 'The two runs are not comparable.');
    }
    const evidenceSufficient = evidenceSignals.every(Boolean) && Boolean(baselineRun && candidateRun && comparison?.comparable);
    let searchMachineryReady = null;
    if (evidenceSufficient && baselineRun && candidateRun && comparison?.delta) {
        const candidateSuccessfulHits = candidateRun.exactLeafHitCount + candidateRun.acceptableHitCount + candidateRun.familyOrGroupHitCount;
        const baselineSuccessfulHits = baselineRun.exactLeafHitCount + baselineRun.acceptableHitCount + baselineRun.familyOrGroupHitCount;
        searchMachineryReady =
            candidateSuccessfulHits > baselineSuccessfulHits &&
                candidateRun.exactLeafHitCount >= baselineRun.exactLeafHitCount &&
                candidateRun.missCount <= baselineRun.missCount &&
                candidateRun.unresolvedCount <= baselineRun.unresolvedCount;
        if (!searchMachineryReady) {
            remaining.push('The candidate run does not yet show a conservative improvement profile: successful hits must increase without raising misses, unresolved queries, or exact-leaf regressions.');
        }
    }
    const canAnswerDod = evidenceSufficient;
    const summary = !canAnswerDod
        ? 'Search Machinery DoD cannot yet be answered from this evidence set. The report is bounded and conservative, but it still lacks either a comparable baseline/candidate pair or one of the required observed channels.'
        : searchMachineryReady
            ? 'Search Machinery DoD can be answered from this evidence set, and the candidate run clears the conservative readiness bar used by this report.'
            : 'Search Machinery DoD can be answered from this evidence set, but the candidate run does not yet satisfy the conservative readiness bar used by this report.';
    return {
        evidenceSufficient,
        searchMachineryReady,
        canAnswerDod,
        summary,
        remaining
    };
}
function classifyQueryReadiness(expectations, results) {
    if (expectations.length === 0) {
        return 'missing_expectation';
    }
    const selectedRow = results.find((row) => row.decision_stage?.startsWith('selected_')) ?? null;
    if (!selectedRow) {
        return 'unresolved';
    }
    const exactLeafIds = new Set(expectations.filter((row) => row.expectation_level === 'exact_leaf').map((row) => row.expected_node_id));
    const acceptableLeafIds = new Set(expectations.filter((row) => row.expectation_level === 'acceptable_leaf').map((row) => row.expected_node_id));
    const familyIds = new Set(expectations.filter((row) => row.expectation_level === 'family').map((row) => row.expected_node_id));
    const groupIds = new Set(expectations.filter((row) => row.expectation_level === 'group').map((row) => row.expected_node_id));
    if (selectedRow.decision_stage === 'selected_leaf' && exactLeafIds.has(selectedRow.graph_node_id)) {
        return 'exact_leaf_hit';
    }
    if (selectedRow.decision_stage === 'selected_leaf' && acceptableLeafIds.has(selectedRow.graph_node_id)) {
        return 'acceptable_hit';
    }
    if ((selectedRow.decision_stage === 'selected_family' && familyIds.has(selectedRow.graph_node_id)) ||
        (selectedRow.decision_stage === 'selected_group' && groupIds.has(selectedRow.graph_node_id))) {
        return 'family_or_group_hit';
    }
    return 'miss';
}
function summarizeEvidencePresence(value) {
    const retrievalSources = toRecord(value);
    const candidate = toRecord(retrievalSources.candidate);
    const branch = toRecord(retrievalSources.branch);
    const candidateChannels = toRecord(candidate.evidence_channels);
    const branchChannels = toRecord(branch.channel_scores);
    const candidateEvidenceTier = toOptionalString(candidate.evidence_tier);
    const branchEvidenceTier = toOptionalString(branch.evidence_tier);
    const exactAlias = candidateEvidenceTier === 'exact_alias' || toBoolean(candidateChannels.exact_alias) || toNumber(branchChannels.exact_alias) > 0;
    const foldedAlias = candidateEvidenceTier === 'folded_alias' || toBoolean(candidateChannels.folded_alias) || toNumber(branchChannels.folded_alias) > 0;
    const denseOnly = candidateEvidenceTier === 'dense_only' || branchEvidenceTier === 'dense_only';
    return {
        exactAlias,
        foldedAlias,
        denseOnly
    };
}
function summarizeRankedEvidence(expectations, results) {
    const rankedResults = results
        .map((row) => toRecord(toRecord(row.retrieval_sources_json).ranked_results))
        .find((value) => Object.keys(value).length > 0);
    if (!rankedResults) {
        return {
            hasRankedEvidence: false,
            top3LeafHit: false,
            bestBroaderBranchHit: false
        };
    }
    const exactLeafIds = new Set(expectations.filter((row) => row.expectation_level === 'exact_leaf').map((row) => row.expected_node_id));
    const acceptableLeafIds = new Set(expectations.filter((row) => row.expectation_level === 'acceptable_leaf').map((row) => row.expected_node_id));
    const familyIds = new Set(expectations.filter((row) => row.expectation_level === 'family').map((row) => row.expected_node_id));
    const groupIds = new Set(expectations.filter((row) => row.expectation_level === 'group').map((row) => row.expected_node_id));
    const topLeaves = Array.isArray(rankedResults.top_leaves) ? rankedResults.top_leaves : [];
    const top3LeafHit = topLeaves.slice(0, 3).some((item) => {
        const leaf = toRecord(item);
        const graphNodeId = toNumber(leaf.graph_node_id);
        return exactLeafIds.has(graphNodeId) || acceptableLeafIds.has(graphNodeId);
    });
    const bestBroaderBranch = toRecord(rankedResults.best_broader_branch);
    const bestBroaderBranchNodeId = toNumber(bestBroaderBranch.branch_node_id);
    const bestBroaderBranchKind = toOptionalString(bestBroaderBranch.branch_kind);
    const bestBroaderBranchHit = (bestBroaderBranchKind === 'family' && familyIds.has(bestBroaderBranchNodeId)) ||
        (bestBroaderBranchKind === 'group' && groupIds.has(bestBroaderBranchNodeId));
    return {
        hasRankedEvidence: true,
        top3LeafHit,
        bestBroaderBranchHit
    };
}
function categoryFromNotes(notes) {
    const parsed = toRecord(notes);
    const category = toOptionalString(parsed.category);
    return category ?? 'uncategorized';
}
function getOrCreateCategorySummary(summariesByName, category) {
    const existing = summariesByName.get(category);
    if (existing) {
        return existing;
    }
    const summary = emptyCategorySummary(category);
    summariesByName.set(category, summary);
    return summary;
}
function emptyCategorySummary(category) {
    return {
        category,
        queryCount: 0,
        selectedCount: 0,
        unresolvedCount: 0,
        unresolvedExpectedCount: 0,
        exactLeafHitCount: 0,
        acceptableHitCount: 0,
        familyOrGroupHitCount: 0,
        missCount: 0,
        missingExpectationCount: 0
    };
}
function incrementCategorySummary(summary, classification, hasExpectations) {
    summary.queryCount += 1;
    switch (classification) {
        case 'exact_leaf_hit':
            summary.selectedCount += 1;
            summary.exactLeafHitCount += 1;
            break;
        case 'acceptable_hit':
            summary.selectedCount += 1;
            summary.acceptableHitCount += 1;
            break;
        case 'family_or_group_hit':
            summary.selectedCount += 1;
            summary.familyOrGroupHitCount += 1;
            break;
        case 'miss':
            summary.selectedCount += 1;
            summary.missCount += 1;
            break;
        case 'unresolved':
            summary.unresolvedCount += 1;
            if (hasExpectations) {
                summary.unresolvedExpectedCount += 1;
            }
            break;
        case 'missing_expectation':
            summary.missingExpectationCount += 1;
            break;
    }
}
function assertMatchingScope(left, right) {
    if (left.sourceName !== right.sourceName) {
        throw new Error(`Cannot compare run ${left.searchRunId} and run ${right.searchRunId}: source_name differs (${left.sourceName} vs ${right.sourceName}).`);
    }
    if (left.setKey !== right.setKey) {
        throw new Error(`Cannot compare run ${left.searchRunId} and run ${right.searchRunId}: set_key differs (${left.setKey} vs ${right.setKey}).`);
    }
}
function groupBy(items, keySelector) {
    const grouped = new Map();
    for (const item of items) {
        const key = keySelector(item);
        const existing = grouped.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            grouped.set(key, [item]);
        }
    }
    return grouped;
}
function placeholders(count) {
    return Array.from({ length: count }, () => '?').join(', ');
}
function toRecord(value) {
    const parsed = parseJsonValue(value);
    return isPlainObject(parsed) ? parsed : {};
}
function parseJsonValue(value) {
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
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value : null;
}
function toBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return value === '1' || value.toLowerCase() === 'true';
    }
    return false;
}
function toNumber(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
function normalizeSourceName(value) {
    const normalized = value?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeSetKey(value) {
    const normalized = value?.trim();
    return normalized || defaultEvaluationSearchSetKey();
}
function normalizeOptionalRunId(flagName, value) {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return value;
}
function formatCounts(counts) {
    const entries = Object.entries(counts)
        .filter(([, value]) => value !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    if (entries.length === 0) {
        return 'none';
    }
    return entries.map(([key, value]) => `${key}:${value}`).join(', ');
}
function formatCategorySummary(summary) {
    return [
        `- ${summary.category}:`,
        `query_count=${summary.queryCount}`,
        `selected_count=${summary.selectedCount}`,
        `unresolved_count=${summary.unresolvedCount}`,
        `exact_leaf_hit_count=${summary.exactLeafHitCount}`,
        `acceptable_hit_count=${summary.acceptableHitCount}`,
        `family_or_group_hit_count=${summary.familyOrGroupHitCount}`,
        `miss_count=${summary.missCount}`,
        `unresolved_expected_count=${summary.unresolvedExpectedCount}`,
        `missing_expectation_count=${summary.missingExpectationCount}`
    ].join(' ');
}
function formatCategoryDelta(delta) {
    return [
        `- ${delta.category}:`,
        `query_count=${formatSignedNumber(delta.queryCount)}`,
        `selected_count=${formatSignedNumber(delta.selectedCount)}`,
        `unresolved_count=${formatSignedNumber(delta.unresolvedCount)}`,
        `exact_leaf_hit_count=${formatSignedNumber(delta.exactLeafHitCount)}`,
        `acceptable_hit_count=${formatSignedNumber(delta.acceptableHitCount)}`,
        `family_or_group_hit_count=${formatSignedNumber(delta.familyOrGroupHitCount)}`,
        `miss_count=${formatSignedNumber(delta.missCount)}`,
        `unresolved_expected_count=${formatSignedNumber(delta.unresolvedExpectedCount)}`,
        `missing_expectation_count=${formatSignedNumber(delta.missingExpectationCount)}`
    ].join(' ');
}
function formatSignedNumber(value) {
    if (value > 0) {
        return `+${value}`;
    }
    return String(value);
}
function sameNumberArray(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
