import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_MODEL_KEY, DEFAULT_RETRIEVAL_PROFILE, LEGACY_LEXICAL_BACKEND_LABEL, OccupationCandidateRetriever } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchExpander } from '../retrieval/occupation-candidate-branches.js';
import { OccupationResolver } from '../resolution/occupation-resolver.js';
const DEFAULT_SET_KEY = 'phase8-core-v1';
const DEFAULT_RESOLVER_VERSION = 'phase11-conservative-v1';
const DEFAULT_RUN_CODE_VERSION = 'phase12-search-run-v1';
const OWNED_BY = 'seed-evaluation-set';
export class EvaluationSearchRunPersister {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        const setKey = normalizeSetKey(options.setKey);
        const modelKey = normalizeModelKey(options.modelKey);
        const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
        const legacyLexicalBackend = LEGACY_LEXICAL_BACKEND_LABEL;
        const limit = normalizeLimit(options.limit);
        const siblingLimit = normalizeSiblingLimit(options.siblingLimit);
        const runLabel = normalizeRunLabel(options.runLabel);
        const maxQueries = normalizeMaxQueries(options.maxQueries);
        const evaluationQueries = await this.loadEvaluationQueries(sourceName, setKey, maxQueries);
        const querySummaries = [];
        const resolver = new OccupationResolver(new OccupationCandidateBranchExpander(new OccupationCandidateRetriever(this.connection)));
        for (const query of evaluationQueries) {
            const resolverResult = await resolver.run({
                query: query.query_text,
                locale: query.locale_code,
                sourceName,
                modelKey,
                limit,
                siblingLimit,
                evaluationQueryId: query.id
            });
            querySummaries.push({
                queryId: query.id,
                queryText: query.query_text,
                localeCode: query.locale_code,
                resolverResult,
                rows: buildResultRows(resolverResult, query.id, sourceName, modelKey, limit, siblingLimit)
            });
        }
        const selectedCount = querySummaries.filter((summary) => summary.resolverResult.selectedOutcome.decisionType !== 'unresolved').length;
        const unresolvedCount = querySummaries.length - selectedCount;
        const insertedResultCount = querySummaries.reduce((total, summary) => total + summary.rows.length, 0);
        if (options.dryRun === true) {
            return {
                runLabel,
                sourceName,
                setKey,
                modelKey,
                retrievalProfile,
                limit,
                siblingLimit,
                maxQueries,
                dryRun: true,
                matchingQueryCount: evaluationQueries.length,
                processedQueryCount: querySummaries.length,
                selectedCount,
                unresolvedCount,
                insertedResultCount,
                searchRunId: null
            };
        }
        await this.connection.beginTransaction();
        try {
            const configJson = buildRunConfigJson(sourceName, setKey, modelKey, retrievalProfile, legacyLexicalBackend, limit, siblingLimit, maxQueries);
            const notes = buildRunNotes(options.notes, sourceName, setKey, modelKey, retrievalProfile, limit, siblingLimit, querySummaries);
            const searchRunId = await this.insertSearchRun(runLabel, configJson, notes);
            for (const summary of querySummaries) {
                await this.insertQueryRows(searchRunId, summary.rows, summary.queryId);
            }
            await this.connection.commit();
            return {
                runLabel,
                sourceName,
                setKey,
                modelKey,
                retrievalProfile,
                limit,
                siblingLimit,
                maxQueries,
                dryRun: false,
                matchingQueryCount: evaluationQueries.length,
                processedQueryCount: querySummaries.length,
                selectedCount,
                unresolvedCount,
                insertedResultCount,
                searchRunId
            };
        }
        catch (error) {
            await this.connection.rollback();
            throw error;
        }
    }
    async loadEvaluationQueries(sourceName, setKey, maxQueries) {
        const sql = `
      SELECT
        id,
        locale_code,
        query_text,
        query_kind,
        notes
      FROM ose_evaluation_queries query
      WHERE ${ownedNotesWhereSql()}
      ORDER BY id
      ${maxQueries === null ? '' : 'LIMIT ?'}
    `;
        const params = [...ownedNotesParams(sourceName, setKey)];
        if (maxQueries !== null) {
            params.push(maxQueries);
        }
        const [rows] = await this.connection.query(sql, params);
        return rows;
    }
    async insertSearchRun(runLabel, configJson, notes) {
        const [result] = await this.connection.execute(`
        INSERT INTO ose_search_runs (
          run_label,
          code_version,
          config_json,
          notes
        )
        VALUES (?, ?, ?, ?)
      `, [runLabel, DEFAULT_RUN_CODE_VERSION, JSON.stringify(configJson), clipText(notes, 65535)]);
        return result.insertId;
    }
    async insertQueryRows(searchRunId, rows, evaluationQueryId) {
        if (rows.length === 0) {
            return;
        }
        for (const row of rows) {
            await this.connection.execute(`
          INSERT INTO ose_search_run_results (
            search_run_id,
            evaluation_query_id,
            graph_node_id,
            rank_position,
            score,
            retrieval_sources_json,
            decision_stage,
            explanation_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
                searchRunId,
                evaluationQueryId,
                row.graphNodeId,
                row.rankPosition,
                row.score,
                JSON.stringify(row.retrievalSourcesJson),
                row.decisionStage,
                JSON.stringify(row.explanationJson)
            ]);
        }
    }
}
function buildResultRows(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit) {
    const rowsByNodeId = new Map();
    const selectedRow = buildSelectedRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit);
    if (selectedRow) {
        rowsByNodeId.set(selectedRow.graphNodeId, selectedRow);
    }
    for (const branch of resolverResult.candidateBranchesConsidered) {
        if (branch.branchKind === 'family' || branch.branchKind === 'group') {
            const branchRow = buildBranchRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit, branch);
            mergeResultRow(rowsByNodeId, branchRow);
        }
        for (const candidate of branch.candidates) {
            const candidateRow = buildCandidateRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit, branch, candidate);
            mergeResultRow(rowsByNodeId, candidateRow);
        }
    }
    return Array.from(rowsByNodeId.values())
        .sort(comparePersistedRows)
        .map((row, index) => ({ ...row, rankPosition: index + 1 }));
}
function buildSelectedRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit) {
    const outcome = resolverResult.selectedOutcome;
    if (outcome.selectedNodeId === null || outcome.decisionType === 'unresolved') {
        return null;
    }
    const decisionStage = `selected_${outcome.decisionType}`;
    const branch = resolverResult.candidateBranchesConsidered.find((candidateBranch) => candidateBranch.branchNodeId === outcome.selectedNodeId || candidateBranch.candidates.some((candidate) => candidate.graphNodeId === outcome.selectedNodeId));
    const branchSummary = branch ? summarizeBranch(branch) : null;
    const selectedCandidate = branch?.candidates.find((candidate) => candidate.graphNodeId === outcome.selectedNodeId) ?? null;
    return {
        graphNodeId: outcome.selectedNodeId,
        rankPosition: 0,
        score: outcome.safetyScore,
        decisionStage,
        priority: 4,
        retrievalSourcesJson: {
            role: 'selected_outcome',
            decision_type: outcome.decisionType,
            selected_node_id: outcome.selectedNodeId,
            selected_label: outcome.selectedLabel,
            branch: branchSummary,
            candidate: selectedCandidate ? summarizeCandidate(selectedCandidate) : null,
            ranked_results: summarizeRankedResults(resolverResult),
            query_context: summarizeQueryContext(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit)
        },
        explanationJson: {
            decision_type: outcome.decisionType,
            selected_outcome: {
                node_id: outcome.selectedNodeId,
                label: outcome.selectedLabel,
                confidence: outcome.confidence,
                safety_score: outcome.safetyScore
            },
            rank_summary: {
                branch: branchSummary,
                candidate: selectedCandidate ? summarizeCandidate(selectedCandidate) : null,
                ranked_results: summarizeRankedResults(resolverResult)
            },
            facts: outcome.explanationFacts
        }
    };
}
function buildBranchRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit, branch) {
    return {
        graphNodeId: branch.branchNodeId,
        rankPosition: 0,
        score: branch.score,
        decisionStage: `candidate_${branch.branchKind}`,
        priority: 2,
        retrievalSourcesJson: {
            role: 'candidate_branch',
            branch: summarizeBranch(branch),
            ranked_results: summarizeRankedResults(resolverResult),
            query_context: summarizeQueryContext(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit)
        },
        explanationJson: {
            decision_type: resolverResult.selectedOutcome.decisionType,
            selected_outcome: summarizeSelectedOutcome(resolverResult),
            confidence: resolverResult.selectedOutcome.confidence,
            safety_score: resolverResult.selectedOutcome.safetyScore,
            rank_summary: {
                branch: summarizeBranch(branch),
                branch_score: branch.score,
                ranked_results: summarizeRankedResults(resolverResult)
            },
            facts: branch.facts
        }
    };
}
function buildCandidateRow(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit, branch, candidate) {
    return {
        graphNodeId: candidate.graphNodeId,
        rankPosition: 0,
        score: candidate.score,
        decisionStage: 'candidate_leaf',
        priority: 1,
        retrievalSourcesJson: {
            role: 'candidate_leaf',
            branch: summarizeBranch(branch),
            candidate: summarizeCandidate(candidate),
            ranked_results: summarizeRankedResults(resolverResult),
            query_context: summarizeQueryContext(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit)
        },
        explanationJson: {
            decision_type: resolverResult.selectedOutcome.decisionType,
            selected_outcome: summarizeSelectedOutcome(resolverResult),
            confidence: resolverResult.selectedOutcome.confidence,
            safety_score: resolverResult.selectedOutcome.safetyScore,
            rank_summary: {
                branch: summarizeBranch(branch),
                candidate: summarizeCandidate(candidate),
                ranked_results: summarizeRankedResults(resolverResult)
            },
            facts: candidate.facts
        }
    };
}
function mergeResultRow(rowsByNodeId, incoming) {
    const existing = rowsByNodeId.get(incoming.graphNodeId);
    if (!existing) {
        rowsByNodeId.set(incoming.graphNodeId, incoming);
        return;
    }
    const existingPriority = existing.priority;
    const incomingPriority = incoming.priority;
    const mergedRetrieval = mergeJsonObjects(existing.retrievalSourcesJson, incoming.retrievalSourcesJson);
    const mergedExplanation = mergeJsonObjects(existing.explanationJson, incoming.explanationJson);
    if (incomingPriority > existingPriority || (incomingPriority === existingPriority && incoming.score > existing.score)) {
        rowsByNodeId.set(incoming.graphNodeId, {
            ...incoming,
            retrievalSourcesJson: mergedRetrieval,
            explanationJson: mergedExplanation,
            score: Math.max(existing.score, incoming.score),
            priority: Math.max(existingPriority, incomingPriority),
            rankPosition: 0
        });
        return;
    }
    rowsByNodeId.set(incoming.graphNodeId, {
        ...existing,
        retrievalSourcesJson: mergedRetrieval,
        explanationJson: mergedExplanation,
        score: Math.max(existing.score, incoming.score),
        priority: Math.max(existingPriority, incomingPriority),
        rankPosition: 0
    });
}
function mergeJsonObjects(left, right) {
    const merged = { ...left };
    for (const [key, value] of Object.entries(right)) {
        if (!(key in merged)) {
            merged[key] = value;
            continue;
        }
        const existing = merged[key];
        if (Array.isArray(existing) && Array.isArray(value)) {
            merged[key] = [...existing, ...value];
            continue;
        }
        if (isPlainObject(existing) && isPlainObject(value)) {
            merged[key] = mergeJsonObjects(existing, value);
            continue;
        }
        if (existing === null || existing === undefined) {
            merged[key] = value;
        }
    }
    return merged;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function comparePersistedRows(left, right) {
    return (right.priority - left.priority ||
        right.score - left.score ||
        left.decisionStage.localeCompare(right.decisionStage) ||
        left.graphNodeId - right.graphNodeId);
}
function summarizeQueryContext(resolverResult, evaluationQueryId, sourceName, modelKey, limit, siblingLimit) {
    return {
        evaluation_query_id: evaluationQueryId,
        query: resolverResult.queryContext.query,
        locale: resolverResult.queryContext.locale,
        normalized_query: resolverResult.queryContext.normalizedQuery,
        folded_query: resolverResult.queryContext.foldedQuery,
        source_name: sourceName,
        retrieval_profile: resolverResult.queryContext.retrievalProfile,
        model_key: modelKey,
        model_dimensions: resolverResult.queryContext.modelDimensions,
        limit,
        sibling_limit: siblingLimit,
        scanned_alias_hit_count: resolverResult.queryContext.scannedAliasHitCount,
        scanned_opensearch_hit_count: resolverResult.queryContext.scannedOpenSearchHitCount
    };
}
function summarizeSelectedOutcome(resolverResult) {
    return {
        decision_type: resolverResult.selectedOutcome.decisionType,
        node_id: resolverResult.selectedOutcome.selectedNodeId,
        label: resolverResult.selectedOutcome.selectedLabel,
        confidence: resolverResult.selectedOutcome.confidence,
        safety_score: resolverResult.selectedOutcome.safetyScore
    };
}
function summarizeBranch(branch) {
    return {
        branch_key: branch.branchKey,
        branch_kind: branch.branchKind,
        branch_node_id: branch.branchNodeId,
        branch_label: branch.branchLabel,
        score: branch.score,
        evidence_tier: branch.evidenceTier,
        branch_share: branch.branchShare,
        branch_margin_ratio: branch.branchMarginRatio,
        lexical_score: branch.lexicalScore,
        hierarchy_consistency_score: branch.hierarchyConsistencyScore,
        capability_support_score: branch.capabilitySupportScore,
        generic_risk_penalty: branch.genericRiskPenalty,
        unrelated_branch_penalty: branch.unrelatedBranchPenalty,
        candidate_count: branch.candidates.length,
        channel_scores: {
            exact_alias: branch.channelScores.exactAlias,
            folded_alias: branch.channelScores.foldedAlias,
            opensearch_lexical: branch.channelScores.openSearchLexical,
            capability_task: branch.channelScores.capabilityTask
        },
        facts: branch.facts
    };
}
function summarizeCandidate(candidate) {
    return {
        graph_node_id: candidate.graphNodeId,
        canonical_label: candidate.canonicalLabel,
        score: candidate.score,
        retrieval_score: candidate.retrievalScore,
        evidence_tier: candidate.evidenceTier,
        exactness_score: candidate.exactnessScore,
        specificity_score: candidate.specificityScore,
        hierarchy_consistency_score: candidate.hierarchyConsistencyScore,
        capability_support_score: candidate.capabilitySupportScore,
        generic_risk_penalty: candidate.genericRiskPenalty,
        unrelated_branch_penalty: candidate.unrelatedBranchPenalty,
        leaf_share_within_branch: candidate.leafShareWithinBranch,
        leaf_margin_ratio: candidate.leafMarginRatio,
        evidence_channels: {
            exact_alias: (candidate.channelScores.exact_alias ?? 0) > 0,
            folded_alias: (candidate.channelScores.folded_alias ?? 0) > 0,
            opensearch_lexical: (candidate.channelScores.opensearch_lexical ?? 0) > 0,
            capability_task: (candidate.channelScores.capability_task ?? 0) > 0
        },
        facts: candidate.facts
    };
}
function summarizeRankedResults(resolverResult) {
    return {
        top_leaves: resolverResult.rankedResults.topLeaves.map((leaf) => ({
            rank: leaf.rank,
            graph_node_id: leaf.graphNodeId,
            canonical_label: leaf.canonicalLabel,
            resolver_score: leaf.score,
            retrieval_score: leaf.retrievalScore,
            evidence_tier: leaf.evidenceTier,
            leaf_share_within_branch: leaf.leafShareWithinBranch,
            leaf_margin_ratio: leaf.leafMarginRatio,
            branch_key: leaf.branchKey,
            branch_kind: leaf.branchKind,
            branch_node_id: leaf.branchNodeId,
            branch_label: leaf.branchLabel,
            branch_score: leaf.branchScore,
            branch_share: leaf.branchShare,
            branch_margin_ratio: leaf.branchMarginRatio,
            channel_scores: {
                exact_alias: leaf.channelScores.exact_alias ?? 0,
                folded_alias: leaf.channelScores.folded_alias ?? 0,
                opensearch_lexical: leaf.channelScores.opensearch_lexical ?? 0,
                capability_task: leaf.channelScores.capability_task ?? 0
            }
        })),
        best_broader_branch: resolverResult.rankedResults.bestBroaderBranch
            ? {
                branch_key: resolverResult.rankedResults.bestBroaderBranch.branchKey,
                branch_kind: resolverResult.rankedResults.bestBroaderBranch.branchKind,
                branch_node_id: resolverResult.rankedResults.bestBroaderBranch.branchNodeId,
                branch_label: resolverResult.rankedResults.bestBroaderBranch.branchLabel,
                score: resolverResult.rankedResults.bestBroaderBranch.score,
                evidence_tier: resolverResult.rankedResults.bestBroaderBranch.evidenceTier,
                branch_share: resolverResult.rankedResults.bestBroaderBranch.branchShare,
                branch_margin_ratio: resolverResult.rankedResults.bestBroaderBranch.branchMarginRatio,
                candidate_count: resolverResult.rankedResults.bestBroaderBranch.candidateCount,
                channel_scores: {
                    exact_alias: resolverResult.rankedResults.bestBroaderBranch.channelScores.exactAlias,
                    folded_alias: resolverResult.rankedResults.bestBroaderBranch.channelScores.foldedAlias,
                    opensearch_lexical: resolverResult.rankedResults.bestBroaderBranch.channelScores.openSearchLexical,
                    capability_task: resolverResult.rankedResults.bestBroaderBranch.channelScores.capabilityTask
                },
                supporting_leaves: resolverResult.rankedResults.bestBroaderBranch.supportingLeaves.map((leaf) => ({
                    rank: leaf.rank,
                    graph_node_id: leaf.graphNodeId,
                    canonical_label: leaf.canonicalLabel,
                    resolver_score: leaf.score,
                    retrieval_score: leaf.retrievalScore,
                    evidence_tier: leaf.evidenceTier,
                    leaf_share_within_branch: leaf.leafShareWithinBranch,
                    leaf_margin_ratio: leaf.leafMarginRatio,
                    channel_scores: {
                        exact_alias: leaf.channelScores.exact_alias ?? 0,
                        folded_alias: leaf.channelScores.folded_alias ?? 0,
                        opensearch_lexical: leaf.channelScores.opensearch_lexical ?? 0,
                        capability_task: leaf.channelScores.capability_task ?? 0
                    }
                }))
            }
            : null
    };
}
function buildRunConfigJson(sourceName, setKey, modelKey, retrievalProfile, legacyLexicalBackend, limit, siblingLimit, maxQueries) {
    return {
        phase: 12,
        run_kind: 'evaluation_search_persistence',
        source_name: sourceName,
        set_key: setKey,
        model_key: modelKey,
        retrieval_profile: retrievalProfile,
        legacy_lexical_backend: legacyLexicalBackend,
        limit,
        sibling_limit: siblingLimit,
        max_queries: maxQueries,
        resolver_version: DEFAULT_RESOLVER_VERSION,
        resolver_description: 'Conservative Phase 11 resolver; leaf and family/group fallback stay gated, and noisy unresolved cases are preserved.',
        query_scope: {
            owned_by: OWNED_BY,
            notes_marker: {
                phase8_set_key: setKey,
                source_name: sourceName
            }
        },
        persistence: {
            search_run_code_version: DEFAULT_RUN_CODE_VERSION,
            selected_stage_examples: ['selected_leaf', 'selected_family', 'selected_group'],
            candidate_stage_examples: ['candidate_leaf', 'candidate_family', 'candidate_group']
        }
    };
}
function buildRunNotes(userNotes, sourceName, setKey, modelKey, retrievalProfile, limit, siblingLimit, querySummaries) {
    const selectedCount = querySummaries.filter((summary) => summary.resolverResult.selectedOutcome.decisionType !== 'unresolved').length;
    const unresolvedCount = querySummaries.length - selectedCount;
    const parts = [
        `Phase 12 search run persistence for source_name=${sourceName}, set_key=${setKey}, model_key=${modelKey}, retrieval_profile=${retrievalProfile}, limit=${limit}, sibling_limit=${siblingLimit}.`,
        `Processed ${querySummaries.length} evaluation queries; selected=${selectedCount}; unresolved=${unresolvedCount}; result_rows=${querySummaries.reduce((total, summary) => total + summary.rows.length, 0)}.`
    ];
    if (userNotes && userNotes.trim()) {
        parts.push(`User notes: ${userNotes.trim()}`);
    }
    return parts.join(' ');
}
function ownedNotesWhereSql() {
    return [
        'query.notes IS NOT NULL',
        'JSON_VALID(query.notes)',
        "JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.phase8_owned_by')) = ?",
        "JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.phase8_set_key')) = ?",
        "JSON_UNQUOTE(JSON_EXTRACT(query.notes, '$.source_name')) = ?"
    ].join(' AND ');
}
function ownedNotesParams(sourceName, setKey) {
    return [OWNED_BY, setKey, sourceName];
}
function normalizeSourceName(sourceName) {
    const normalized = sourceName?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeSetKey(setKey) {
    const normalized = setKey?.trim();
    return normalized || DEFAULT_SET_KEY;
}
export function defaultEvaluationSearchSetKey() {
    return DEFAULT_SET_KEY;
}
function normalizeModelKey(modelKey) {
    const normalized = modelKey?.trim();
    return normalized || DEFAULT_MODEL_KEY;
}
function normalizeLimit(limit) {
    const resolved = limit ?? DEFAULT_CANDIDATE_LIMIT;
    if (!Number.isInteger(resolved) || resolved <= 0) {
        throw new Error(`Limit must be a positive integer. Received "${resolved}".`);
    }
    return resolved;
}
function normalizeSiblingLimit(limit) {
    const resolved = limit ?? DEFAULT_SIBLING_LIMIT;
    if (!Number.isInteger(resolved) || resolved < 0) {
        throw new Error(`Sibling limit must be a non-negative integer. Received "${resolved}".`);
    }
    return resolved;
}
function normalizeMaxQueries(limit) {
    if (limit === undefined) {
        return null;
    }
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`Max queries must be a positive integer when provided. Received "${limit}".`);
    }
    return limit;
}
function normalizeRunLabel(runLabel) {
    const requested = runLabel?.trim();
    if (requested) {
        return clipText(requested, 255);
    }
    return `phase12-search-run-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}
function clipText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return value.slice(0, maxLength);
}
