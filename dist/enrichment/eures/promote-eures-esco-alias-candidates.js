import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_EURES_REPORT_DIR } from './import-eures-esco-alias-candidates.js';
export const DEFAULT_EURES_ALIAS_REPORT_PATH = path.resolve(process.cwd(), DEFAULT_EURES_REPORT_DIR, 'eures-esco-alias-candidates-report.json');
export async function promoteEuresEscoAliasCandidates(connection, options = {}) {
    const reportPath = options.reportPath?.trim() || DEFAULT_EURES_ALIAS_REPORT_PATH;
    const minConfidence = options.minConfidence ?? 0.9;
    const dryRun = options.dryRun ?? false;
    const report = await readCandidateReport(reportPath);
    const reviewedExactBridgeKeys = options.includeReviewedExactBridge ? buildReviewedExactBridgeKeys(report.candidates) : new Set();
    const eligibleCandidates = report.candidates
        .filter((candidate) => isEligibleForPromotion(candidate, minConfidence, reviewedExactBridgeKeys))
        .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
    if (dryRun || eligibleCandidates.length === 0) {
        return {
            reportPath,
            minConfidence,
            dryRun,
            eligible: eligibleCandidates.length,
            inserted: 0,
            skipped: 0
        };
    }
    let inserted = 0;
    await connection.beginTransaction();
    try {
        for (const candidate of eligibleCandidates) {
            const [result] = await connection.execute(`
          INSERT IGNORE INTO ose_graph_aliases (
            graph_node_id,
            locale_code,
            alias,
            normalized_alias,
            alias_type,
            alias_class,
            source_name,
            source_record_type,
            confidence,
            is_primary,
            is_active,
            is_generic_head_only,
            needs_review,
            review_note
          )
          VALUES (?, ?, ?, ?, 'external_title', 'crosswalk', ?, ?, ?, 0, 1, 0, ?, ?)
        `, [
                candidate.graphNodeId,
                candidate.localeCode,
                candidate.alias,
                candidate.normalizedAlias,
                candidate.sourceTag,
                isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys) ? 'eures_reviewed_exact_bridge' : candidate.sourceRecordType,
                bridgeConfidence(candidate, reviewedExactBridgeKeys),
                isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys) ? 1 : 0,
                isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys)
                    ? 'reviewed exact crosswalk bridge: unique exact target among reviewed candidates'
                    : null
            ]);
            inserted += result.affectedRows;
        }
        await connection.commit();
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    return {
        reportPath,
        minConfidence,
        dryRun,
        eligible: eligibleCandidates.length,
        inserted,
        skipped: eligibleCandidates.length - inserted
    };
}
async function readCandidateReport(reportPath) {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (!Array.isArray(report.candidates)) {
        throw new Error(`Candidate report does not contain a candidates array: ${reportPath}`);
    }
    return {
        candidates: report.candidates
    };
}
function isEligibleForPromotion(candidate, minConfidence, reviewedExactBridgeKeys) {
    const generatedCandidate = candidate.candidateMode === 'generate' &&
        candidate.graphNodeId !== null &&
        candidate.confidence >= minConfidence &&
        candidate.conflictTargets.length === 0 &&
        candidate.reviewReason === null;
    return generatedCandidate || isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys);
}
function buildReviewedExactBridgeKeys(candidates) {
    const reviewedByAlias = new Map();
    for (const candidate of candidates) {
        if (candidate.candidateMode !== 'review' || candidate.graphNodeId === null || candidate.conflictTargets.length > 0) {
            continue;
        }
        const key = aliasBridgeKey(candidate);
        const rows = reviewedByAlias.get(key) ?? [];
        rows.push(candidate);
        reviewedByAlias.set(key, rows);
    }
    const safeKeys = new Set();
    for (const rows of reviewedByAlias.values()) {
        const exactRows = rows.filter((candidate) => candidate.mappingRelation === 'skos:exactMatch' && candidate.confidence >= 0.95);
        const exactTargetIds = new Set(exactRows.map((candidate) => candidate.graphNodeId));
        if (exactRows.length === 1 && exactTargetIds.size === 1) {
            safeKeys.add(candidateBridgeKey(exactRows[0]));
        }
    }
    return safeKeys;
}
function isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys) {
    return reviewedExactBridgeKeys.has(candidateBridgeKey(candidate));
}
function bridgeConfidence(candidate, reviewedExactBridgeKeys) {
    if (isReviewedExactBridgeCandidate(candidate, reviewedExactBridgeKeys)) {
        return 0.82;
    }
    return candidate.confidence;
}
function aliasBridgeKey(candidate) {
    return `${candidate.localeCode}\u0000${candidate.normalizedAlias}`;
}
function candidateBridgeKey(candidate) {
    return `${aliasBridgeKey(candidate)}\u0000${candidate.graphNodeId ?? 'no_target'}`;
}
