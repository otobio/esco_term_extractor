import { formatTable } from './build-manual-review-queue.js';
const DEFAULT_INSPECT_LIMIT = 25;
export class ManualReviewQueueInspector {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const status = options.status ?? 'pending';
        const limit = normalizeLimit(options.limit);
        const params = [status];
        let reviewTypeSql = '';
        if (options.reviewType) {
            reviewTypeSql = 'AND review.review_type = ?';
            params.push(options.reviewType);
        }
        params.push(limit);
        const [rows] = await this.connection.query(`
        SELECT
          review.id,
          review.review_type,
          review.review_status,
          review.locale_code,
          review.subject_text,
          review.normalized_subject_text,
          review.graph_node_id,
          node.canonical_label AS graph_node_label,
          review.reviewer_note,
          review.payload_json,
          DATE_FORMAT(review.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
          DATE_FORMAT(review.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
        FROM ose_manual_review_queue review
        LEFT JOIN ose_graph_nodes node
          ON node.id = review.graph_node_id
        WHERE review.review_status = ?
          ${reviewTypeSql}
        ORDER BY review.updated_at DESC, review.id DESC
        LIMIT ?
      `, params);
        return rows.map((row) => ({
            id: row.id,
            reviewType: row.review_type,
            reviewStatus: row.review_status,
            localeCode: row.locale_code,
            subjectText: row.subject_text,
            normalizedSubjectText: row.normalized_subject_text,
            graphNodeId: row.graph_node_id,
            graphNodeLabel: row.graph_node_label,
            reviewerNote: row.reviewer_note,
            payloadJson: toRecord(row.payload_json),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
}
export function formatManualReviewInspection(rows, format = 'text') {
    if (format === 'json') {
        return JSON.stringify(rows, null, 2);
    }
    if (rows.length === 0) {
        return 'No manual review rows matched the requested filters.';
    }
    return formatTable(rows.map((row) => ({
        id: row.id,
        reviewType: row.reviewType,
        reviewStatus: row.reviewStatus,
        localeCode: row.localeCode ?? '',
        subjectText: clipText(row.subjectText ?? '', 72),
        graphNodeId: row.graphNodeId ?? '',
        graphNodeLabel: clipText(row.graphNodeLabel ?? '', 36),
        payloadSummary: clipText(formatPayloadSummary(row.payloadJson), 72),
        createdAt: row.createdAt
    })), [
        ['id', 'id'],
        ['reviewType', 'review_type'],
        ['reviewStatus', 'status'],
        ['localeCode', 'locale'],
        ['subjectText', 'subject'],
        ['graphNodeId', 'node_id'],
        ['graphNodeLabel', 'node_label'],
        ['payloadSummary', 'payload_summary'],
        ['createdAt', 'created_at']
    ]);
}
function normalizeLimit(value) {
    if (value === undefined) {
        return DEFAULT_INSPECT_LIMIT;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--limit must be a positive integer. Received "${value}".`);
    }
    return value;
}
function toRecord(value) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return isPlainObject(parsed) ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return isPlainObject(value) ? value : {};
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function clipText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 3)}...`;
}
function formatPayloadSummary(payloadJson) {
    const parts = [];
    const issue = toOptionalString(payloadJson.issue);
    const sourceName = toOptionalString(payloadJson.source_name);
    const runId = toNumber(payloadJson.search_run_id);
    const queryId = toNumber(payloadJson.evaluation_query_id);
    const expectedLabels = toStringArray(payloadJson.expected_exact_leaf_labels);
    const selectedOutcome = toRecord(payloadJson.selected_outcome);
    const topCandidate = toRecord(payloadJson.top_candidate);
    if (issue) {
        parts.push(`issue=${issue}`);
    }
    if (sourceName) {
        parts.push(`source=${sourceName}`);
    }
    if (runId > 0) {
        parts.push(`run=${runId}`);
    }
    if (queryId > 0) {
        parts.push(`query=${queryId}`);
    }
    if (expectedLabels.length > 0) {
        parts.push(`expected="${expectedLabels[0]}"`);
    }
    if (toOptionalString(selectedOutcome.canonical_label)) {
        parts.push(`selected="${toOptionalString(selectedOutcome.canonical_label)}"`);
    }
    if (toOptionalString(topCandidate.canonical_label)) {
        parts.push(`top="${toOptionalString(topCandidate.canonical_label)}"`);
    }
    if (toOptionalString(topCandidate.candidate_evidence_tier)) {
        parts.push(`evidence=${toOptionalString(topCandidate.candidate_evidence_tier)}`);
    }
    return parts.join(' ');
}
function toOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value : null;
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
function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
}
