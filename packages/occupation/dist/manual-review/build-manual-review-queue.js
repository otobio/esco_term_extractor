import { DEFAULT_ESCO_SOURCE_NAME } from '../audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';
import { normalizeSearchText } from '../utils/texts.js';
const DEFAULT_INSPECTION_PREVIEW_LIMIT = 12;
const OWNED_BY = 'seed-evaluation-set';
export class ManualReviewQueueBuilder {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
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
        const visibleCandidates = options.includeExisting === true
            ? candidatesWithStatus
            : candidatesWithStatus.filter((candidate) => candidate.status === 'new');
        const limitedCandidates = applyLimit(visibleCandidates, options.limit);
        const newCandidates = limitedCandidates.filter((candidate) => candidate.status === 'new');
        let insertedCountsByType = new Map();
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
            }
            catch (error) {
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
    async resolveSearchRun(requestedSearchRunId, requestedSourceName, requestedSetKey) {
        const normalizedSourceName = normalizeSourceName(requestedSourceName);
        const normalizedSetKey = normalizeSetKey(requestedSetKey);
        if (requestedSearchRunId !== undefined) {
            const [rows] = await this.connection.query(`
          SELECT
            id,
            run_label,
            config_json,
            CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.max_queries')), 'null') AS SIGNED) AS max_queries
          FROM ose_search_runs
          WHERE id = ?
          LIMIT 1
        `, [requestedSearchRunId]);
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
        const [rows] = await this.connection.query(`
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
      `, [normalizedSourceName, normalizedSetKey]);
        const row = rows[0];
        if (!row) {
            throw new Error(`No persisted evaluation search run found for source_name="${normalizedSourceName}" and set_key="${normalizedSetKey}".`);
        }
        return {
            searchRunId: row.id,
            sourceName: normalizedSourceName,
            setKey: normalizedSetKey,
            maxQueries: row.max_queries
        };
    }
    async resolveLocaleCount(sourceName) {
        const [rows] = await this.connection.query(`
        SELECT DISTINCT alias.locale_code
        FROM ose_graph_aliases alias
        INNER JOIN ose_graph_nodes node
          ON node.id = alias.graph_node_id
        WHERE alias.source_name = ?
          AND alias.is_active = 1
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
        ORDER BY alias.locale_code
      `, [sourceName]);
        const localeCount = rows.map((row) => row.locale_code).filter(Boolean).length;
        if (localeCount === 0) {
            throw new Error(`No active graph alias locales found for source_name="${sourceName}".`);
        }
        return localeCount;
    }
    async loadEvaluationFailureCandidates(searchRunId, sourceName, setKey, maxQueries) {
        const queries = await this.loadEvaluationQueries(sourceName, setKey, maxQueries ?? undefined);
        if (queries.length === 0) {
            return [];
        }
        const queryIds = queries.map((query) => query.id);
        const expectations = await this.loadExpectations(queryIds);
        const results = await this.loadSearchRunResults(searchRunId, queryIds);
        const expectationMap = groupBy(expectations, (row) => row.evaluation_query_id);
        const resultMap = groupBy(results, (row) => row.evaluation_query_id);
        const candidates = [];
        for (const query of queries) {
            const context = {
                query,
                expectations: expectationMap.get(query.id) ?? [],
                results: resultMap.get(query.id) ?? []
            };
            candidates.push(...buildEvaluationCandidates(searchRunId, sourceName, setKey, context));
        }
        return candidates;
    }
    async loadEvaluationQueries(sourceName, setKey, maxQueries) {
        const limitSql = maxQueries === undefined ? '' : 'LIMIT ?';
        const params = [OWNED_BY, setKey, sourceName];
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
          expectation.expectation_level,
          expectation.rank_ceiling,
          node.canonical_label,
          node.node_level
        FROM ose_evaluation_expectations expectation
        INNER JOIN ose_graph_nodes node
          ON node.id = expectation.expected_node_id
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
      `, [searchRunId, ...queryIds]);
        return rows;
    }
    async loadSearchMetaSignalCandidates(sourceName, localeCount) {
        const [rows] = await this.connection.query(`
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
      `, [sourceName, localeCount, localeCount]);
        const candidates = [];
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
    async loadPendingLookup() {
        const [rows] = await this.connection.query(`
        SELECT
          review.id,
          review.review_type,
          review.normalized_subject_text,
          review.graph_node_id,
          review.payload_json
        FROM ose_manual_review_queue review
        WHERE review.review_status = 'pending'
      `);
        const lookup = new Map();
        for (const row of rows) {
            lookup.set(buildReviewCandidateKey({
                reviewType: row.review_type,
                normalizedSubjectText: row.normalized_subject_text,
                graphNodeId: row.graph_node_id,
                payloadJson: toRecord(row.payload_json)
            }), row.id);
        }
        return lookup;
    }
    attachPendingStatus(candidates, pendingLookup) {
        return candidates.map((candidate) => {
            const existingQueueId = pendingLookup.get(buildReviewCandidateKey(candidate)) ?? null;
            return {
                ...candidate,
                status: existingQueueId === null ? 'new' : 'existing_pending',
                existingQueueId
            };
        });
    }
    async insertCandidate(candidate, pendingLookup) {
        const candidateKey = buildReviewCandidateKey(candidate);
        if (pendingLookup.has(candidateKey)) {
            return 0;
        }
        const [result] = await this.connection.execute(`
        INSERT INTO ose_manual_review_queue (
          review_type,
          locale_code,
          subject_text,
          normalized_subject_text,
          graph_node_id,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
            candidate.reviewType,
            candidate.localeCode,
            candidate.subjectText,
            candidate.normalizedSubjectText,
            candidate.graphNodeId,
            JSON.stringify(candidate.payloadJson)
        ]);
        pendingLookup.set(candidateKey, result.insertId);
        return result.affectedRows;
    }
}
export function formatBuildManualReviewQueueResult(result, format = 'text') {
    if (format === 'json') {
        return JSON.stringify(result, null, 2);
    }
    const lines = [];
    lines.push(`Phase 13 manual review ${result.dryRun ? 'dry run' : 'build'} complete.`);
    lines.push(`search_run_id=${result.searchRunId}, source_name=${result.sourceName}, set_key=${result.setKey}`);
    lines.push(`locale_count=${result.localeCount}, discovered=${result.discoveredCount}, considered=${result.consideredCount}, existing_pending=${result.existingPendingCount}, new_candidates=${result.newCandidateCount}, inserted=${result.insertedCount}`);
    lines.push(`include_existing=${result.includeExisting ? 'yes' : 'no'}, limit=${result.limit ?? 'all'}`);
    lines.push('');
    lines.push('Counts By Type');
    lines.push(formatTable(result.countsByType, [
        ['reviewType', 'review_type'],
        ['discovered', 'discovered'],
        ['considered', 'considered'],
        ['existingPending', 'existing_pending'],
        ['newCandidate', 'new_candidates'],
        ['inserted', 'inserted']
    ]));
    lines.push('');
    lines.push('Preview');
    lines.push(result.preview.length === 0
        ? 'No review rows matched the requested scope.'
        : formatTable(result.preview.map((row) => ({
            reviewType: row.reviewType,
            localeCode: row.localeCode ?? '',
            subjectText: clipText(row.subjectText ?? '', 72),
            graphNodeId: row.graphNodeId ?? '',
            graphNodeLabel: clipText(row.graphNodeLabel ?? '', 36),
            status: row.status,
            existingQueueId: row.existingQueueId ?? '',
            payloadSummary: clipText(formatPayloadSummary(row.payloadJson), 72)
        })), [
            ['reviewType', 'review_type'],
            ['localeCode', 'locale'],
            ['subjectText', 'subject'],
            ['graphNodeId', 'node_id'],
            ['graphNodeLabel', 'node_label'],
            ['status', 'status'],
            ['existingQueueId', 'existing_id'],
            ['payloadSummary', 'payload_summary']
        ]));
    lines.push('');
    lines.push('This is workflow tooling only. It does not automatically change taxonomy, graph/search-meta data, retrieval, resolver scoring, or search-run persistence.');
    return lines.join('\n');
}
function buildEvaluationCandidates(searchRunId, sourceName, setKey, context) {
    const selectedRow = context.results.find((row) => row.decision_stage?.startsWith('selected_')) ?? null;
    const topRow = context.results[0] ?? null;
    const exactExpectations = context.expectations.filter((row) => row.expectation_level === 'exact_leaf');
    const fallbackExpectations = exactExpectations.length > 0 ? exactExpectations : context.expectations;
    const expectedNodeIds = new Set(fallbackExpectations.map((row) => row.expected_node_id));
    const selectedMatchesExpectation = selectedRow ? expectedNodeIds.has(selectedRow.graph_node_id) : false;
    const reviewCandidates = [];
    if (selectedMatchesExpectation) {
        return reviewCandidates;
    }
    const strongestRow = selectedRow ?? topRow;
    const reviewType = strongestRow && isDenseOnlyResult(strongestRow) ? 'dense_candidate' : 'relatedness_gap';
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
function summarizeRunRow(row) {
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
function isDenseOnlyResult(row) {
    const retrievalSources = toRecord(row.retrieval_sources_json);
    const candidate = toRecord(retrievalSources.candidate);
    const branch = toRecord(retrievalSources.branch);
    const candidateChannels = toRecord(candidate.evidence_channels);
    const branchChannels = toRecord(branch.channel_scores);
    if (toOptionalString(candidate.evidence_tier) === 'dense_only') {
        return true;
    }
    if (toOptionalString(branch.evidence_tier) === 'dense_only') {
        return true;
    }
    return (toBoolean(candidateChannels.dense_embedding) &&
        !toBoolean(candidateChannels.exact_alias) &&
        !toBoolean(candidateChannels.folded_alias)) || (toNumber(branchChannels.dense_embedding) > 0 &&
        toNumber(branchChannels.exact_alias) === 0 &&
        toNumber(branchChannels.folded_alias) === 0);
}
function sourceExistsSql() {
    return `
    EXISTS (
      SELECT 1
      FROM ose_graph_node_sources node_source
      WHERE node_source.graph_node_id = meta.graph_node_id
        AND node_source.source_name = ?
    )
  `;
}
function buildCountsByType(discoveredCounts, candidates, insertedCounts) {
    const types = Array.from(new Set([
        'alias_conflict',
        'generic_head',
        'hierarchy_gap',
        'cross_locale_gap',
        'relatedness_gap',
        'dense_candidate',
        ...candidates.map((candidate) => candidate.reviewType),
        ...Array.from(discoveredCounts.keys())
    ]));
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
function applyLimit(items, limit) {
    if (limit === undefined) {
        return items;
    }
    return items.slice(0, limit);
}
function dedupeCandidates(candidates) {
    const seen = new Set();
    const deduped = [];
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
function countByType(candidates) {
    const counts = new Map();
    for (const candidate of candidates) {
        counts.set(candidate.reviewType, (counts.get(candidate.reviewType) ?? 0) + 1);
    }
    return counts;
}
function groupBy(items, keySelector) {
    const grouped = new Map();
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
function toRecord(value) {
    const parsed = parseJsonValue(value);
    return isPlainObject(parsed) ? parsed : {};
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
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeSourceName(value) {
    const normalized = value?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeSetKey(value) {
    const normalized = value?.trim();
    return normalized || defaultEvaluationSearchSetKey();
}
export function formatTable(rows, columns) {
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
function stringifyTableValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    return String(value);
}
function placeholders(count) {
    return Array.from({ length: count }, () => '?').join(', ');
}
function normalizeText(value) {
    return normalizeSearchText(value);
}
function buildReviewCandidateKey(candidate) {
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
function hasLexicalConflict(results) {
    return summarizeLexicalCandidates(results).length >= 2;
}
function summarizeLexicalCandidates(results) {
    const lexicalCandidates = [];
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
    const seen = new Set();
    return lexicalCandidates.filter((row) => {
        const graphNodeId = row.graph_node_id;
        if (seen.has(graphNodeId)) {
            return false;
        }
        seen.add(graphNodeId);
        return true;
    });
}
function formatPayloadSummary(payloadJson) {
    const parts = [];
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
    }
    else if (toOptionalString(selectedOutcome.selected_decision_type)) {
        parts.push(`selected_type=${toOptionalString(selectedOutcome.selected_decision_type)}`);
    }
    if (toOptionalString(topCandidate.canonical_label)) {
        parts.push(`top="${toOptionalString(topCandidate.canonical_label)}"`);
    }
    if (toOptionalString(topCandidate.candidate_evidence_tier)) {
        parts.push(`evidence=${toOptionalString(topCandidate.candidate_evidence_tier)}`);
    }
    else if (toOptionalString(topCandidate.branch_evidence_tier)) {
        parts.push(`branch_evidence=${toOptionalString(topCandidate.branch_evidence_tier)}`);
    }
    return parts.join(' ');
}
function clipText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 3)}...`;
}
