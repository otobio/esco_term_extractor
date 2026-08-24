import { OccupationCandidateRetriever } from './occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { mergeTimings, timed } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';
export const DEFAULT_SIBLING_LIMIT = 5;
export class OccupationCandidateBranchRetriever {
    retriever;
    constructor(retriever = new OccupationCandidateRetriever()) {
        this.retriever = retriever;
    }
    async run(options) {
        return this.retrieveCandidatesWithGraphBranches(options);
    }
    async retrieveCandidatesWithGraphBranches(options) {
        const timings = {};
        const siblingLimit = options.siblingLimit;
        const sourceName = options.sourceName;
        const limit = options.limit;
        const retrieval = await timed(() => this.retriever.run(options), 'branch.candidate_retrieval_total', timings);
        const graphNodeIds = retrieval.candidates.map((candidate) => candidate.graphNodeId);
        if (graphNodeIds.length === 0) {
            return {
                ...copyRetrievalHeader(options, retrieval, sourceName, limit, siblingLimit),
                timings: mergeTimings(retrieval.timings, timings),
                candidates: [],
                branches: []
            };
        }
        const runtimeMeta = await timed(() => loadOccupationSearchMetaArtifactRequired(sourceName), 'branch.search_meta_artifact_load', timings);
        const searchMetaByNodeId = new Map();
        const ancestorsBySearchMetaId = new Map();
        const siblingsBySearchMetaId = new Map();
        for (const graphNodeId of graphNodeIds) {
            const record = runtimeMeta.getCoreRecord(graphNodeId);
            if (!record) {
                continue;
            }
            searchMetaByNodeId.set(graphNodeId, record);
            ancestorsBySearchMetaId.set(record.searchMetaId, record.ancestors);
            siblingsBySearchMetaId.set(record.searchMetaId, record.siblings.slice(0, siblingLimit));
        }
        const candidates = await timed(() => retrieval.candidates.map((candidate) => {
            const searchMeta = searchMetaByNodeId.get(candidate.graphNodeId) ?? null;
            const branch = buildBranchIdentity(candidate.graphNodeId, candidate.canonicalLabel, searchMeta, candidate.evidence);
            const evidenceFamily = evidenceFamilyIdentity(candidate.evidence);
            return {
                graphNodeId: candidate.graphNodeId,
                canonicalLabel: searchMeta?.canonicalLabel ?? candidate.canonicalLabel,
                totalScore: candidate.totalScore,
                channelScores: candidate.channelScores,
                evidence: candidate.evidence,
                genericRisk: searchMeta?.genericRisk ?? null,
                hasHierarchy: searchMeta?.hasHierarchy ?? false,
                hasCapabilitySupport: searchMeta?.hasCapabilitySupport ?? false,
                familyNodeId: searchMeta?.familyNodeId ?? evidenceFamily?.familyNodeId ?? null,
                familyLabel: searchMeta?.familyLabel ?? evidenceFamily?.familyLabel ?? null,
                groupNodeId: searchMeta?.groupNodeId ?? null,
                groupLabel: searchMeta?.groupLabel ?? null,
                parentNodeId: searchMeta?.parentNodeId ?? null,
                parentLabel: searchMeta?.parentLabel ?? null,
                ancestors: searchMeta ? (ancestorsBySearchMetaId.get(searchMeta.searchMetaId) ?? []) : [],
                siblings: searchMeta ? (siblingsBySearchMetaId.get(searchMeta.searchMetaId) ?? []) : [],
                ...branch
            };
        }), 'branch.expand_candidates', timings);
        const branches = await timed(() => buildBranches(candidates), 'branch.build_branches', timings);
        return {
            ...copyRetrievalHeader(options, retrieval, sourceName, limit, siblingLimit),
            timings: mergeTimings(retrieval.timings, timings),
            candidates,
            branches
        };
    }
}
function copyRetrievalHeader(options, retrieval, sourceName, limit, siblingLimit) {
    const retrievalQuery = options.retrievalQuery;
    return {
        originalQuery: retrievalQuery.originalQuery,
        query: retrievalQuery.query,
        querySpans: retrievalQuery.querySpans,
        locale: retrievalQuery.locale,
        retrievalLocales: retrieval.retrievalLocales,
        keptQuerySignals: retrievalQuery.keptQuerySignals,
        roleSpanSelection: retrievalQuery.roleSpanSelection,
        sourceName,
        retrievalProfile: retrieval.retrievalProfile,
        limit,
        siblingLimit,
        evaluationQueryId: options.evaluationQueryId ?? null,
        scannedAliasHitCount: retrieval.scannedAliasHitCount,
        scannedOpenSearchHitCount: retrieval.scannedOpenSearchHitCount,
        timings: retrieval.timings
    };
}
function buildBranchIdentity(graphNodeId, canonicalLabel, searchMeta, evidence) {
    if (searchMeta?.familyNodeId && searchMeta.familyLabel) {
        return {
            branchKey: `family:${searchMeta.familyNodeId}`,
            branchKind: 'family',
            branchNodeId: searchMeta.familyNodeId,
            branchLabel: searchMeta.familyLabel
        };
    }
    if (searchMeta?.groupNodeId && searchMeta.groupLabel) {
        return {
            branchKey: `group:${searchMeta.groupNodeId}`,
            branchKind: 'group',
            branchNodeId: searchMeta.groupNodeId,
            branchLabel: searchMeta.groupLabel
        };
    }
    const evidenceFamily = evidenceFamilyIdentity(evidence);
    if (evidenceFamily && evidenceFamily.familyNodeId === graphNodeId) {
        return {
            branchKey: `family:${evidenceFamily.familyNodeId}`,
            branchKind: 'family',
            branchNodeId: evidenceFamily.familyNodeId,
            branchLabel: evidenceFamily.familyLabel
        };
    }
    return {
        branchKey: `node:${graphNodeId}`,
        branchKind: 'node',
        branchNodeId: graphNodeId,
        branchLabel: searchMeta?.canonicalLabel ?? canonicalLabel
    };
}
function evidenceFamilyIdentity(evidence) {
    for (const record of evidence) {
        const familyNodeId = typeof record.details?.family_node_id === 'number' ? record.details.family_node_id : null;
        const familyLabel = typeof record.details?.family_label === 'string' ? record.details.family_label.trim() : '';
        if (familyNodeId && familyLabel) {
            return {
                familyNodeId,
                familyLabel
            };
        }
    }
    return null;
}
function buildBranches(candidates) {
    const candidatesByBranch = new Map();
    for (const candidate of candidates) {
        const branchCandidates = candidatesByBranch.get(candidate.branchKey) ?? [];
        branchCandidates.push(candidate);
        candidatesByBranch.set(candidate.branchKey, branchCandidates);
    }
    return Array.from(candidatesByBranch.values())
        .map((branchCandidates) => {
        const sortedCandidates = [...branchCandidates].sort(compareCandidates);
        const firstCandidate = sortedCandidates[0];
        return {
            branchKey: firstCandidate.branchKey,
            branchKind: firstCandidate.branchKind,
            branchNodeId: firstCandidate.branchNodeId,
            branchLabel: firstCandidate.branchLabel,
            scoreSummary: buildBranchScoreSummary(sortedCandidates),
            candidates: sortedCandidates
        };
    })
        .sort(compareBranches);
}
function buildBranchScoreSummary(candidates) {
    return {
        candidateCount: candidates.length,
        maxCandidateScore: roundScore(maxOf(candidates, (candidate) => candidate.totalScore, -Infinity)),
        totalCandidateScore: roundScore(candidates.reduce((sum, candidate) => sum + candidate.totalScore, 0)),
        channelScores: {
            exactAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.exact_alias ?? 0, -Infinity)),
            foldedAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.folded_alias ?? 0, -Infinity)),
            ngramAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.ngram_alias ?? 0, -Infinity)),
            openSearchLexical: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.lexical ?? 0, -Infinity)),
            capabilityTask: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.capability_task ?? 0, -Infinity))
        }
    };
}
function compareBranches(left, right) {
    return (right.scoreSummary.maxCandidateScore - left.scoreSummary.maxCandidateScore ||
        right.scoreSummary.totalCandidateScore - left.scoreSummary.totalCandidateScore ||
        right.scoreSummary.candidateCount - left.scoreSummary.candidateCount ||
        left.branchLabel.localeCompare(right.branchLabel));
}
function compareCandidates(left, right) {
    return (right.totalScore - left.totalScore ||
        (right.channelScores.exact_alias ?? 0) - (left.channelScores.exact_alias ?? 0) ||
        (right.channelScores.folded_alias ?? 0) - (left.channelScores.folded_alias ?? 0) ||
        (right.channelScores.lexical ?? 0) - (left.channelScores.lexical ?? 0) ||
        (right.channelScores.capability_task ?? 0) - (left.channelScores.capability_task ?? 0) ||
        left.canonicalLabel.localeCompare(right.canonicalLabel));
}
function normalizeSiblingLimit(limit) {
    return requireNonNegativeIntegerAtMost(limit ?? DEFAULT_SIBLING_LIMIT, 100, 'Sibling limit');
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
