import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_EURES_REPORT_DIR } from '../eures/import-eures-esco-alias-candidates.js';
import { DEFAULT_ONET_REPORT_DIR } from '../onet/import-onet-esco-alias-candidates.js';
import { isGenericQueryToken, tokenizeNormalizedText } from '../../query/query-preparation.js';
export const DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR = 'artifacts/enrichment/review';
export const DEFAULT_ONET_ALIAS_REPORT_PATH = path.resolve(process.cwd(), DEFAULT_ONET_REPORT_DIR, 'onet-esco-alias-candidates-report.json');
export const DEFAULT_EURES_ALIAS_REPORT_PATH = path.resolve(process.cwd(), DEFAULT_EURES_REPORT_DIR, 'eures-esco-alias-candidates-report.json');
const DEFAULT_AUTOMATED_DECISIONS_PATH = path.resolve(process.cwd(), DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR, 'automated-review-decisions.csv');
const DEFAULT_MANUAL_QUEUE_PATH = path.resolve(process.cwd(), DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR, 'manual-review-queue.csv');
const FAMILY_BRIDGE_MIN_TARGETS = 5;
const FAMILY_BRIDGE_DOMINANCE_MULTIPLIER = 3;
const FAMILY_SUPPORT_MIN_TARGETS = 2;
const FAMILY_SUPPORT_MIN_TARGET_SHARE = 0.7;
const TWO_FAMILY_SUPPORT_MIN_TARGET_SHARE = 0.7;
const DOMINANT_LEAF_MIN_TARGETS = 3;
const DOMINANT_LEAF_DOMINANCE_MULTIPLIER = 2;
const FAMILY_LEXICAL_LEAF_MIN_ALIAS_COVERAGE = 0.7;
const UNIQUE_LEAF_MIN_CONFIDENCE = 0.9;
const MAX_LIST_VALUES = 12;
const REVIEW_GENERIC_ROLE_TOKENS = new Set([
    'analyst',
    'assembler',
    'assistant',
    'associate',
    'clerk',
    'consultant',
    'coordinator',
    'developer',
    'engineer',
    'installer',
    'manager',
    'officer',
    'operator',
    'representative',
    'scientist',
    'specialist',
    'supervisor',
    'technician',
    'worker'
]);
const SINGLE_FAMILY_SUPPORT_SKIP_ALIASES = new Set([
    'a&p instructor',
    'c-swhc',
    'ccrn',
    'e & i technician',
    'leot',
    'licsw',
    'lisw',
    'ocns',
    'r&d engineer'
]);
export async function buildAutomatedAliasReview(connection, options = {}) {
    const includeOnet = options.includeOnet ?? true;
    const includeEures = options.includeEures ?? true;
    const decisionsPath = options.decisionsPath?.trim() || DEFAULT_AUTOMATED_DECISIONS_PATH;
    const manualQueuePath = options.manualQueuePath?.trim() || DEFAULT_MANUAL_QUEUE_PATH;
    const candidates = [
        ...(includeOnet ? await loadOnetCandidates(options.onetReportPath?.trim() || DEFAULT_ONET_ALIAS_REPORT_PATH) : []),
        ...(includeEures ? await loadEuresCandidates(options.euresReportPath?.trim() || DEFAULT_EURES_ALIAS_REPORT_PATH) : [])
    ];
    const graph = await loadGraph(connection);
    const groups = groupCandidates(candidates);
    const automatedRows = [];
    const manualRows = [];
    for (const group of groups) {
        const automatedDecision = decideGroup(group, graph);
        if (automatedDecision.decision === 'defer') {
            manualRows.push(automatedDecision);
        }
        else {
            automatedRows.push(automatedDecision);
        }
    }
    await mkdir(path.dirname(decisionsPath), { recursive: true });
    await mkdir(path.dirname(manualQueuePath), { recursive: true });
    await writeFile(decisionsPath, toCsv(automatedRows), 'utf8');
    await writeFile(manualQueuePath, toCsv(manualRows), 'utf8');
    return {
        decisionsPath,
        manualQueuePath,
        groupsReviewed: groups.length,
        automatedDecisions: automatedRows.length,
        manualQueueItems: manualRows.length,
        byRuleId: countRowsByRule(automatedRows)
    };
}
async function loadOnetCandidates(reportPath) {
    if (!existsSync(reportPath)) {
        return [];
    }
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const candidates = Array.isArray(report.candidates) ? report.candidates : [];
    return candidates.map((candidate) => ({
        sourceSystem: 'onet',
        candidateMode: candidate.candidateMode,
        reviewReason: candidate.reviewReason,
        alias: candidate.alias,
        normalizedAlias: candidate.normalizedAlias,
        localeCode: candidate.localeCode,
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        confidence: candidate.confidence,
        sourceTag: candidate.sourceTag,
        sourceRecordType: candidate.sourceFileRole,
        sourceTitle: candidate.onetTitle,
        mappingRelation: null,
        conflictTargetCount: candidate.conflictTargets.length
    }));
}
async function loadEuresCandidates(reportPath) {
    if (!existsSync(reportPath)) {
        return [];
    }
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const candidates = Array.isArray(report.candidates) ? report.candidates : [];
    return candidates.map((candidate) => ({
        sourceSystem: 'eures',
        candidateMode: candidate.candidateMode,
        reviewReason: candidate.reviewReason,
        alias: candidate.alias,
        normalizedAlias: candidate.normalizedAlias,
        localeCode: candidate.localeCode,
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        confidence: candidate.confidence,
        sourceTag: candidate.sourceTag,
        sourceRecordType: candidate.sourceRecordType,
        sourceTitle: candidate.nationalPrefLabel,
        mappingRelation: candidate.mappingRelation,
        conflictTargetCount: candidate.conflictTargets.length
    }));
}
async function loadGraph(connection) {
    const [nodeRows] = await connection.query(`
      SELECT id, canonical_label, node_level
      FROM ose_graph_nodes
      WHERE bucket = 'occupation'
        AND status = 'active'
    `);
    const [relationshipRows] = await connection.query(`
      SELECT parent_node_id, child_node_id
      FROM ose_graph_relationships
      WHERE relationship_type = 'broader'
        AND is_active = 1
    `);
    const nodeById = new Map(nodeRows.map((row) => [row.id, row]));
    const parentByChild = new Map(relationshipRows.map((row) => [row.child_node_id, row.parent_node_id]));
    const familyByNodeId = new Map();
    for (const node of nodeRows) {
        const familyNode = findFamilyNode(node.id, nodeById, parentByChild);
        if (familyNode) {
            familyByNodeId.set(node.id, {
                familyNodeId: familyNode.id,
                familyLabel: familyNode.canonical_label
            });
        }
    }
    return familyByNodeId;
}
function groupCandidates(candidates) {
    const groupsByKey = new Map();
    for (const candidate of candidates) {
        if (!candidate.normalizedAlias) {
            continue;
        }
        const key = `${candidate.sourceSystem}\u0000${candidate.localeCode}\u0000${candidate.normalizedAlias}`;
        const group = groupsByKey.get(key) ?? {
            sourceSystem: candidate.sourceSystem,
            localeCode: candidate.localeCode,
            normalizedAlias: candidate.normalizedAlias,
            rows: []
        };
        group.rows.push(candidate);
        groupsByKey.set(key, group);
    }
    return Array.from(groupsByKey.values()).sort((left, right) => left.sourceSystem.localeCompare(right.sourceSystem) ||
        left.localeCode.localeCompare(right.localeCode) ||
        left.normalizedAlias.localeCompare(right.normalizedAlias));
}
function decideGroup(group, familyByNodeId) {
    const rows = group.rows;
    const reviewRows = rows.filter((row) => row.candidateMode === 'review');
    const excludeRows = rows.filter((row) => row.candidateMode === 'exclude');
    const usableReviewRows = reviewRows.filter((row) => row.graphNodeId !== null && row.conflictTargetCount === 0);
    const queryTokens = tokenizeNormalizedText(group.normalizedAlias).filter((token) => token.length > 1);
    const usefulTokenCount = queryTokens.length;
    if (group.sourceSystem === 'onet' && queryTokens.length === 1 && rows.length >= 10) {
        return buildCsvRow(group, {
            decision: 'reject',
            ruleId: 'reject_onet_single_token_high_fanout',
            targetNodeId: null,
            targetLabel: '',
            evidenceSummary: `Single-token O*NET alias appears against ${rows.length} candidate targets; treating as too ambiguous for alias enrichment.`
        }, familyByNodeId);
    }
    if (reviewRows.length === 0 && excludeRows.length > 0 && excludeRows.every((row) => isAlreadyCoveredReason(row.reviewReason))) {
        return buildCsvRow(group, {
            decision: 'reject',
            ruleId: 'reject_already_covered',
            targetNodeId: null,
            targetLabel: '',
            evidenceSummary: 'All candidate rows are already covered by canonical label or existing alias.'
        }, familyByNodeId);
    }
    if (usableReviewRows.length > 0) {
        const targetIds = distinctNumbers(usableReviewRows.map((row) => row.graphNodeId));
        if (targetIds.length === 1 && usefulTokenCount >= 2 && usableReviewRows.every(isHighAuthorityReviewRow)) {
            const target = usableReviewRows.find((row) => row.graphNodeId === targetIds[0]);
            return buildCsvRow(group, {
                decision: 'promote_leaf',
                ruleId: 'review_unique_leaf',
                targetNodeId: targetIds[0],
                targetLabel: target?.canonicalLabel ?? '',
                evidenceSummary: `Reviewed rows have one unique high-authority target leaf across ${usableReviewRows.length} candidate rows.`
            }, familyByNodeId);
        }
    }
    if (group.sourceSystem === 'eures') {
        const exactRows = usableReviewRows.filter((row) => row.mappingRelation === 'skos:exactMatch' && row.confidence >= 0.95);
        const exactTargetIds = distinctNumbers(exactRows.map((row) => row.graphNodeId));
        if (exactRows.length === 1 && exactTargetIds.length === 1 && usefulTokenCount >= 2) {
            return buildCsvRow(group, {
                decision: 'promote_leaf',
                ruleId: 'eures_review_exact_unique_leaf',
                targetNodeId: exactTargetIds[0],
                targetLabel: exactRows[0]?.canonicalLabel ?? '',
                evidenceSummary: 'Reviewed EURES rows contain exactly one high-confidence skos:exactMatch target.'
            }, familyByNodeId);
        }
        const singleFamily = resolveSingleReviewFamily(reviewRows, familyByNodeId);
        if (singleFamily) {
            return buildCsvRow(group, {
                decision: 'promote_family',
                ruleId: 'eures_review_single_family_support',
                targetNodeId: singleFamily.familyNodeId,
                targetLabel: singleFamily.familyLabel,
                evidenceSummary: `All ${singleFamily.targetCount} graph-backed reviewed EURES rows resolve to one family; alias is safe as family-supporting evidence only.`
            }, familyByNodeId);
        }
        const twoFamilyDominance = resolveReviewFamilyDominance(reviewRows, familyByNodeId);
        if (twoFamilyDominance &&
            twoFamilyDominance.familyCount === 2 &&
            twoFamilyDominance.topCount / twoFamilyDominance.targetCount >= TWO_FAMILY_SUPPORT_MIN_TARGET_SHARE) {
            return buildCsvRow(group, {
                decision: 'promote_family',
                ruleId: 'eures_review_two_family_dominant_support',
                targetNodeId: twoFamilyDominance.familyNodeId,
                targetLabel: twoFamilyDominance.familyLabel,
                evidenceSummary: `${twoFamilyDominance.topCount}/${twoFamilyDominance.targetCount} graph-backed reviewed EURES rows resolve to this family across two families; alias is safe as family-supporting evidence only.`
            }, familyByNodeId);
        }
    }
    const dominantFamily = resolveDominantFamily(usableReviewRows, familyByNodeId);
    if (dominantFamily &&
        usefulTokenCount >= 2 &&
        dominantFamily.topCount >= FAMILY_BRIDGE_MIN_TARGETS &&
        (dominantFamily.secondCount === 0 || dominantFamily.topCount >= dominantFamily.secondCount * FAMILY_BRIDGE_DOMINANCE_MULTIPLIER)) {
        const lexicalLeaf = resolveLexicalLeafWithinFamily(group.normalizedAlias, usableReviewRows, dominantFamily.familyNodeId, familyByNodeId);
        if (lexicalLeaf) {
            return buildCsvRow(group, {
                decision: 'promote_leaf',
                ruleId: 'review_dominant_family_lexical_leaf',
                targetNodeId: lexicalLeaf.graphNodeId,
                targetLabel: lexicalLeaf.canonicalLabel,
                evidenceSummary: `${dominantFamily.topCount} reviewed targets resolve to the dominant family; leaf "${lexicalLeaf.canonicalLabel}" covers ${lexicalLeaf.matchedAliasTokenCount}/${lexicalLeaf.aliasTokenCount} alias tokens (${lexicalLeaf.aliasCoverage.toFixed(2)}), with no tied lexical leaf.`
            }, familyByNodeId);
        }
        const dominantLeaf = resolveDominantLeafWithinFamily(usableReviewRows, dominantFamily.familyNodeId, familyByNodeId);
        if (dominantLeaf &&
            dominantLeaf.topCount >= DOMINANT_LEAF_MIN_TARGETS &&
            (dominantLeaf.secondCount === 0 || dominantLeaf.topCount >= dominantLeaf.secondCount * DOMINANT_LEAF_DOMINANCE_MULTIPLIER) &&
            hasMeaningfulLeafTokenOverlap(group.normalizedAlias, dominantLeaf.canonicalLabel) &&
            targetAddsNoUnseenSpecificToken(group.normalizedAlias, dominantLeaf.canonicalLabel)) {
            return buildCsvRow(group, {
                decision: 'promote_leaf',
                ruleId: 'review_dominant_leaf_within_family',
                targetNodeId: dominantLeaf.graphNodeId,
                targetLabel: dominantLeaf.canonicalLabel,
                evidenceSummary: `${dominantFamily.topCount} reviewed targets resolve to the dominant family; leaf "${dominantLeaf.canonicalLabel}" appears ${dominantLeaf.topCount} times inside that family, second leaf count is ${dominantLeaf.secondCount}.`
            }, familyByNodeId);
        }
        return buildCsvRow(group, {
            decision: 'promote_family',
            ruleId: 'review_dominant_family',
            targetNodeId: dominantFamily.familyNodeId,
            targetLabel: dominantFamily.familyLabel,
            evidenceSummary: `${dominantFamily.topCount} reviewed targets resolve to this family; second family count is ${dominantFamily.secondCount}.`
        }, familyByNodeId);
    }
    if (group.sourceSystem === 'onet' &&
        dominantFamily &&
        usefulTokenCount >= 2 &&
        hasMultiTargetReviewReason(reviewRows) &&
        dominantFamily.topCount >= FAMILY_SUPPORT_MIN_TARGETS &&
        dominantFamily.topCount / Math.max(usableReviewRows.length, 1) >= FAMILY_SUPPORT_MIN_TARGET_SHARE) {
        return buildCsvRow(group, {
            decision: 'promote_family',
            ruleId: 'review_multi_target_family_support',
            targetNodeId: dominantFamily.familyNodeId,
            targetLabel: dominantFamily.familyLabel,
            evidenceSummary: `${dominantFamily.topCount}/${usableReviewRows.length} reviewed O*NET multi-target rows resolve to this family; alias is safe as family-supporting evidence only.`
        }, familyByNodeId);
    }
    if (group.sourceSystem === 'onet' &&
        hasMultiTargetReviewReason(reviewRows)) {
        const singleFamily = resolveSingleReviewFamily(reviewRows, familyByNodeId);
        if (singleFamily && !SINGLE_FAMILY_SUPPORT_SKIP_ALIASES.has(group.normalizedAlias)) {
            return buildCsvRow(group, {
                decision: 'promote_family',
                ruleId: 'review_single_family_support',
                targetNodeId: singleFamily.familyNodeId,
                targetLabel: singleFamily.familyLabel,
                evidenceSummary: `All ${singleFamily.targetCount} graph-backed reviewed O*NET multi-target rows resolve to one family; alias is safe as family-supporting evidence only.`
            }, familyByNodeId);
        }
        const twoFamilyDominance = resolveReviewFamilyDominance(reviewRows, familyByNodeId);
        if (twoFamilyDominance &&
            twoFamilyDominance.familyCount === 2 &&
            twoFamilyDominance.topCount / twoFamilyDominance.targetCount >= TWO_FAMILY_SUPPORT_MIN_TARGET_SHARE) {
            return buildCsvRow(group, {
                decision: 'promote_family',
                ruleId: 'review_two_family_dominant_support',
                targetNodeId: twoFamilyDominance.familyNodeId,
                targetLabel: twoFamilyDominance.familyLabel,
                evidenceSummary: `${twoFamilyDominance.topCount}/${twoFamilyDominance.targetCount} graph-backed reviewed O*NET multi-target rows resolve to this family across two families; alias is safe as family-supporting evidence only.`
            }, familyByNodeId);
        }
    }
    if (rows.every((row) => row.candidateMode === 'exclude')) {
        return buildCsvRow(group, {
            decision: 'reject',
            ruleId: 'reject_excluded_noise',
            targetNodeId: null,
            targetLabel: '',
            evidenceSummary: 'All candidate rows are excluded by importer safety rules.'
        }, familyByNodeId);
    }
    if (hasRowsWithoutFamily(rows, familyByNodeId)) {
        return buildCsvRow(group, {
            decision: 'reject',
            ruleId: 'reject_no_family_evidence',
            targetNodeId: null,
            targetLabel: '',
            evidenceSummary: 'Reviewed rows have no resolvable ESCO family evidence; rejecting for now until vector-assisted rescue is available.'
        }, familyByNodeId);
    }
    return buildCsvRow(group, {
        decision: 'defer',
        ruleId: 'manual_review_required',
        targetNodeId: null,
        targetLabel: '',
        evidenceSummary: 'No deterministic automated review rule selected a safe target.'
    }, familyByNodeId);
}
function buildCsvRow(group, decision, familyByNodeId) {
    const aliases = uniqueStrings(group.rows.map((row) => row.alias));
    const targets = uniqueStrings(group.rows.map((row) => (row.graphNodeId ? `${row.graphNodeId}:${row.canonicalLabel ?? ''}` : null)));
    const families = uniqueStrings(group.rows
        .map((row) => (row.graphNodeId ? familyByNodeId.get(row.graphNodeId) ?? null : null))
        .map((family) => (family ? `${family.familyNodeId}:${family.familyLabel}` : null)));
    const sourceTitles = uniqueStrings(group.rows.map((row) => row.sourceTitle));
    const reviewReasons = uniqueStrings(group.rows.map((row) => row.reviewReason));
    const maxConfidence = Math.max(...group.rows.map((row) => row.confidence));
    return {
        source_system: group.sourceSystem,
        locale_code: group.localeCode,
        normalized_alias: group.normalizedAlias,
        alias: aliases[0] ?? group.normalizedAlias,
        decision: decision.decision,
        target_node_id: decision.targetNodeId?.toString() ?? '',
        target_label: decision.targetLabel,
        rule_id: decision.ruleId,
        evidence_summary: decision.evidenceSummary,
        candidate_count: group.rows.length.toString(),
        candidate_targets: summarizeList(targets),
        candidate_families: summarizeList(families),
        source_titles: summarizeList(sourceTitles),
        review_reasons: summarizeList(reviewReasons),
        max_confidence: maxConfidence.toFixed(4)
    };
}
function resolveDominantFamily(rows, familyByNodeId) {
    const counts = new Map();
    for (const row of rows) {
        if (!row.graphNodeId) {
            continue;
        }
        const family = familyByNodeId.get(row.graphNodeId);
        if (!family) {
            continue;
        }
        const current = counts.get(family.familyNodeId) ?? { family, count: 0 };
        current.count += 1;
        counts.set(family.familyNodeId, current);
    }
    const sorted = Array.from(counts.values()).sort((left, right) => right.count - left.count || left.family.familyNodeId - right.family.familyNodeId);
    const top = sorted[0];
    if (!top) {
        return null;
    }
    return {
        ...top.family,
        topCount: top.count,
        secondCount: sorted[1]?.count ?? 0
    };
}
function resolveSingleReviewFamily(rows, familyByNodeId) {
    const dominance = resolveReviewFamilyDominance(rows, familyByNodeId);
    if (!dominance || dominance.familyCount !== 1) {
        return null;
    }
    return {
        familyNodeId: dominance.familyNodeId,
        familyLabel: dominance.familyLabel,
        targetCount: dominance.targetCount
    };
}
function resolveReviewFamilyDominance(rows, familyByNodeId) {
    const counts = new Map();
    let targetCount = 0;
    for (const row of rows) {
        if (!row.graphNodeId) {
            continue;
        }
        const family = familyByNodeId.get(row.graphNodeId);
        if (!family) {
            continue;
        }
        targetCount += 1;
        const current = counts.get(family.familyNodeId) ?? { family, count: 0 };
        current.count += 1;
        counts.set(family.familyNodeId, current);
    }
    const sorted = Array.from(counts.values()).sort((left, right) => right.count - left.count || left.family.familyNodeId - right.family.familyNodeId);
    const top = sorted[0];
    if (!top) {
        return null;
    }
    return {
        ...top.family,
        topCount: top.count,
        targetCount,
        familyCount: sorted.length
    };
}
function resolveDominantLeafWithinFamily(rows, familyNodeId, familyByNodeId) {
    const counts = new Map();
    for (const row of rows) {
        if (!row.graphNodeId || !row.canonicalLabel) {
            continue;
        }
        const family = familyByNodeId.get(row.graphNodeId);
        if (!family || family.familyNodeId !== familyNodeId) {
            continue;
        }
        const current = counts.get(row.graphNodeId) ?? {
            graphNodeId: row.graphNodeId,
            canonicalLabel: row.canonicalLabel,
            count: 0
        };
        current.count += 1;
        counts.set(row.graphNodeId, current);
    }
    const sorted = Array.from(counts.values()).sort((left, right) => right.count - left.count || left.graphNodeId - right.graphNodeId);
    const top = sorted[0];
    if (!top) {
        return null;
    }
    return {
        graphNodeId: top.graphNodeId,
        canonicalLabel: top.canonicalLabel,
        topCount: top.count,
        secondCount: sorted[1]?.count ?? 0
    };
}
function resolveLexicalLeafWithinFamily(normalizedAlias, rows, familyNodeId, familyByNodeId) {
    const aliasTokens = Array.from(new Set(tokenizeNormalizedText(normalizedAlias).filter(isReviewLexicalToken)));
    if (aliasTokens.length < 2) {
        return null;
    }
    const candidatesByLeaf = new Map();
    for (const row of rows) {
        if (!row.graphNodeId || !row.canonicalLabel) {
            continue;
        }
        const family = familyByNodeId.get(row.graphNodeId);
        if (!family || family.familyNodeId !== familyNodeId) {
            continue;
        }
        candidatesByLeaf.set(row.graphNodeId, {
            graphNodeId: row.graphNodeId,
            canonicalLabel: row.canonicalLabel,
            canonicalTokens: new Set(tokenizeNormalizedText(row.canonicalLabel).filter(isReviewLexicalToken))
        });
    }
    const scored = Array.from(candidatesByLeaf.values())
        .map((candidate) => {
        const matchedAliasTokenCount = aliasTokens.filter((token) => candidate.canonicalTokens.has(token)).length;
        const aliasCoverage = matchedAliasTokenCount / aliasTokens.length;
        return {
            graphNodeId: candidate.graphNodeId,
            canonicalLabel: candidate.canonicalLabel,
            aliasTokenCount: aliasTokens.length,
            matchedAliasTokenCount,
            aliasCoverage
        };
    })
        .filter((candidate) => candidate.aliasCoverage >= FAMILY_LEXICAL_LEAF_MIN_ALIAS_COVERAGE &&
        hasCompatibleRoleToken(normalizedAlias, candidate.canonicalLabel) &&
        hasMeaningfulLeafTokenOverlap(normalizedAlias, candidate.canonicalLabel) &&
        targetAddsNoUnseenSpecificToken(normalizedAlias, candidate.canonicalLabel))
        .sort((left, right) => right.aliasCoverage - left.aliasCoverage ||
        right.matchedAliasTokenCount - left.matchedAliasTokenCount ||
        left.canonicalLabel.length - right.canonicalLabel.length ||
        left.graphNodeId - right.graphNodeId);
    const top = scored[0];
    if (!top) {
        return null;
    }
    const tiedTopCount = scored.filter((candidate) => candidate.aliasCoverage === top.aliasCoverage &&
        candidate.matchedAliasTokenCount === top.matchedAliasTokenCount).length;
    return tiedTopCount === 1 ? top : null;
}
function findFamilyNode(graphNodeId, nodeById, parentByChild) {
    const seen = new Set([graphNodeId]);
    let currentNodeId = graphNodeId;
    while (parentByChild.has(currentNodeId)) {
        const parentNodeId = parentByChild.get(currentNodeId);
        if (parentNodeId === undefined || seen.has(parentNodeId)) {
            return null;
        }
        const parentNode = nodeById.get(parentNodeId);
        if (!parentNode) {
            return null;
        }
        if (parentNode.node_level === 'family') {
            return parentNode;
        }
        seen.add(parentNodeId);
        currentNodeId = parentNodeId;
    }
    return null;
}
function isAlreadyCoveredReason(reason) {
    return reason === 'already_existing_alias_for_target' || reason === 'already_canonical_label';
}
function isHighAuthorityReviewRow(row) {
    if (row.reviewReason?.includes('weak_mapping_relation')) {
        return false;
    }
    if (row.sourceSystem === 'eures') {
        return row.mappingRelation === 'skos:exactMatch' && row.confidence >= UNIQUE_LEAF_MIN_CONFIDENCE;
    }
    return row.confidence >= UNIQUE_LEAF_MIN_CONFIDENCE;
}
function hasMultiTargetReviewReason(rows) {
    return rows.some((row) => row.reviewReason?.includes('onet_code_maps_to_multiple_esco_targets'));
}
function hasRowsWithoutFamily(rows, familyByNodeId) {
    if (rows.length === 0) {
        return false;
    }
    return rows.every((row) => !row.graphNodeId || !familyByNodeId.has(row.graphNodeId));
}
function hasMeaningfulLeafTokenOverlap(normalizedAlias, canonicalLabel) {
    const aliasTokens = new Set(tokenizeNormalizedText(normalizedAlias).filter(isMeaningfulReviewToken));
    const canonicalTokens = tokenizeNormalizedText(canonicalLabel).filter(isMeaningfulReviewToken);
    return canonicalTokens.some((token) => aliasTokens.has(token));
}
function targetAddsNoUnseenSpecificToken(normalizedAlias, canonicalLabel) {
    const aliasTokens = new Set(tokenizeNormalizedText(normalizedAlias).filter(isMeaningfulReviewToken));
    const canonicalTokens = tokenizeNormalizedText(canonicalLabel).filter(isMeaningfulReviewToken);
    return canonicalTokens.every((token) => aliasTokens.has(token));
}
function hasCompatibleRoleToken(normalizedAlias, canonicalLabel) {
    const aliasRoleTokens = tokenizeNormalizedText(normalizedAlias).filter((token) => REVIEW_GENERIC_ROLE_TOKENS.has(token));
    const canonicalRoleTokens = tokenizeNormalizedText(canonicalLabel).filter((token) => REVIEW_GENERIC_ROLE_TOKENS.has(token));
    if (aliasRoleTokens.length === 0 || canonicalRoleTokens.length === 0) {
        return true;
    }
    return canonicalRoleTokens.some((token) => aliasRoleTokens.includes(token));
}
function isMeaningfulReviewToken(token) {
    return token.length > 2 && !isGenericQueryToken(token, 'en') && !REVIEW_GENERIC_ROLE_TOKENS.has(token);
}
function isReviewLexicalToken(token) {
    return token.length > 2 && !isGenericQueryToken(token, 'en');
}
function distinctNumbers(values) {
    return Array.from(new Set(values.filter((value) => value !== null))).sort((left, right) => left - right);
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
function summarizeList(values) {
    const visibleValues = values.slice(0, MAX_LIST_VALUES);
    const suffix = values.length > MAX_LIST_VALUES ? ` ... +${values.length - MAX_LIST_VALUES}` : '';
    return `${visibleValues.join(' | ')}${suffix}`;
}
function countRowsByRule(rows) {
    const counts = {};
    for (const row of rows) {
        counts[row.rule_id] = (counts[row.rule_id] ?? 0) + 1;
    }
    return counts;
}
function toCsv(rows) {
    const headers = [
        'source_system',
        'locale_code',
        'normalized_alias',
        'alias',
        'decision',
        'target_node_id',
        'target_label',
        'rule_id',
        'evidence_summary',
        'candidate_count',
        'candidate_targets',
        'candidate_families',
        'source_titles',
        'review_reasons',
        'max_confidence'
    ];
    return [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))
    ].join('\n') + '\n';
}
function escapeCsv(value) {
    if (!/[",\n\r]/u.test(value)) {
        return value;
    }
    return `"${value.replaceAll('"', '""')}"`;
}
