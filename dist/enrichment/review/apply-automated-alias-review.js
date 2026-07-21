import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR } from './build-automated-alias-review.js';
export const DEFAULT_AUTOMATED_ALIAS_DECISIONS_PATH = `${DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR}/automated-review-decisions.csv`;
const APPROVED_FAMILY_RULE_IDS = new Set([
    'review_dominant_family',
    'review_multi_target_family_support',
    'review_single_family_support',
    'review_two_family_dominant_support',
    'eures_review_single_family_support',
    'eures_review_two_family_dominant_support'
]);
const FAMILY_ALIAS_CONFIDENCE = 0.7;
export async function applyAutomatedAliasReview(connection, options = {}) {
    const decisionsPath = options.decisionsPath?.trim() || DEFAULT_AUTOMATED_ALIAS_DECISIONS_PATH;
    const dryRun = options.dryRun ?? false;
    const rows = await readDecisionRows(decisionsPath);
    const eligibleRows = rows
        .filter(isApprovedFamilyDecision)
        .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
    const byRuleId = countRowsByRule(eligibleRows);
    if (dryRun || eligibleRows.length === 0) {
        return {
            decisionsPath,
            dryRun,
            eligible: eligibleRows.length,
            inserted: 0,
            skipped: 0,
            byRuleId
        };
    }
    let inserted = 0;
    await connection.beginTransaction();
    try {
        for (const row of eligibleRows) {
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
          VALUES (?, ?, ?, ?, 'external_title', 'crosswalk', ?, ?, ?, 0, 1, 0, 1, ?)
        `, [
                Number(row.target_node_id),
                row.locale_code,
                row.alias,
                row.normalized_alias,
                `${row.source_system}_automated_review`,
                row.rule_id,
                FAMILY_ALIAS_CONFIDENCE,
                truncateReviewNote(row.evidence_summary)
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
        decisionsPath,
        dryRun,
        eligible: eligibleRows.length,
        inserted,
        skipped: eligibleRows.length - inserted,
        byRuleId
    };
}
async function readDecisionRows(decisionsPath) {
    const csv = await readFile(decisionsPath, 'utf8');
    return parse(csv, {
        columns: true,
        skip_empty_lines: true
    });
}
function isApprovedFamilyDecision(row) {
    return (row.decision === 'promote_family' &&
        APPROVED_FAMILY_RULE_IDS.has(row.rule_id) &&
        row.target_node_id.trim() !== '' &&
        row.locale_code.trim() !== '' &&
        row.alias.trim() !== '' &&
        row.normalized_alias.trim() !== '');
}
function countRowsByRule(rows) {
    const counts = {};
    for (const row of rows) {
        counts[row.rule_id] = (counts[row.rule_id] ?? 0) + 1;
    }
    return counts;
}
function truncateReviewNote(note) {
    return note.length > 500 ? note.slice(0, 497) + '...' : note;
}
