import { OccupationCandidateBranchExpander } from '../retrieval/occupation-candidate-branches.js';
import { occupationRoleHeadSharesEquivalentClass } from '../query/occupation-role-head-equivalence.js';
import { analyzeOccupationSemanticSurface, compareOccupationSemanticSurfaceAnalyses } from '../query/occupation-semantic-lexicon.js';
import { prepareQuery } from '../query/query-preparation.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
export const DEFAULT_RESOLVER_WEIGHTS = {
    exactness: 0.34,
    specificity: 0.18,
    hierarchyConsistency: 0.2,
    capabilitySupport: 0.1,
    genericRiskSuppression: 0.1,
    unrelatedBranchPenalty: 0.08
};
export class OccupationResolver {
    expander;
    constructor(expander = new OccupationCandidateBranchExpander()) {
        this.expander = expander;
    }
    async run(options) {
        if (!options.query) {
            throw new Error('OccupationResolver.run() requires a non-empty query string');
        }
        const preparedQuery = await prepareQuery(options.query, options.locale, { sourceName: options.sourceName });
        const branchExpansion = await this.expander.run(options);
        const queryIsGeneric = preparedQuery.isGenericShape;
        const stats = buildBranchStats(branchExpansion.branches);
        const semanticQueryAnalysis = await analyzeOccupationSemanticSurface(branchExpansion.query, branchExpansion.locale);
        const branchScores = await applySemanticAdjustments(branchExpansion.branches
            .map((branch) => scoreBranch(branch, stats, queryIsGeneric))
            .sort((left, right) => right.score - left.score || left.branchLabel.localeCompare(right.branchLabel)), semanticQueryAnalysis, branchExpansion.locale);
        const broaderBranchFallback = selectBroaderBranchRescue(branchScores, preparedQuery, queryIsGeneric);
        const selectedOutcome = selectOutcome(branchScores, queryIsGeneric, branchExpansion.foldedQuery, broaderBranchFallback);
        const rankedResults = buildRankedResults(branchScores, broaderBranchFallback);
        return {
            queryContext: {
                originalQuery: branchExpansion.originalQuery,
                query: branchExpansion.query,
                locale: branchExpansion.locale,
                normalizedQuery: branchExpansion.normalizedQuery,
                foldedQuery: branchExpansion.foldedQuery,
                querySignals: branchExpansion.querySignals,
                keptQuerySignals: branchExpansion.keptQuerySignals,
                querySignalCleaningMs: branchExpansion.querySignalCleaningMs,
                sourceName: branchExpansion.sourceName,
                retrievalProfile: branchExpansion.retrievalProfile,
                modelKey: branchExpansion.modelKey,
                modelDimensions: branchExpansion.modelDimensions,
                limit: branchExpansion.limit,
                siblingLimit: branchExpansion.siblingLimit,
                evaluationQueryId: branchExpansion.evaluationQueryId,
                scannedAliasHitCount: branchExpansion.scannedAliasHitCount,
                scannedOpenSearchHitCount: branchExpansion.scannedOpenSearchHitCount
            },
            selectedOutcome,
            candidateBranchesConsidered: branchScores,
            rankedResults,
            rawBranchExpansion: branchExpansion,
            scoringWeights: DEFAULT_RESOLVER_WEIGHTS
        };
    }
}
function scoreBranch(branch, stats, queryIsGeneric) {
    const branchShare = stats.branchShareByKey.get(branch.branchKey) ?? 0;
    const branchMarginRatio = stats.branchMarginByKey.get(branch.branchKey) ?? null;
    const evidenceTier = getBranchEvidenceTier(branch);
    const lexicalScore = scoreBranchEvidenceStrength(branch, evidenceTier, branchShare, branchMarginRatio);
    const hierarchyConsistencyScore = scoreBranchHierarchyConsistency(branch, branchShare, branchMarginRatio);
    const capabilitySupportScore = scoreBranchCapabilitySupport(branch);
    const genericRiskPenalty = scoreBranchGenericRiskPenalty(branch, queryIsGeneric);
    const unrelatedBranchPenalty = scoreUnrelatedBranchPenalty(branchShare, branchMarginRatio);
    const score = roundScore(lexicalScore * DEFAULT_RESOLVER_WEIGHTS.exactness +
        scoreBranchSpecificity(branch, queryIsGeneric) * DEFAULT_RESOLVER_WEIGHTS.specificity +
        hierarchyConsistencyScore * DEFAULT_RESOLVER_WEIGHTS.hierarchyConsistency +
        capabilitySupportScore * DEFAULT_RESOLVER_WEIGHTS.capabilitySupport -
        genericRiskPenalty * DEFAULT_RESOLVER_WEIGHTS.genericRiskSuppression -
        unrelatedBranchPenalty * DEFAULT_RESOLVER_WEIGHTS.unrelatedBranchPenalty);
    const candidateScores = branch.candidates
        .map((candidate) => scoreCandidate(candidate, stats, queryIsGeneric, branchShare, branchMarginRatio))
        .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel));
    return {
        branchKey: branch.branchKey,
        branchKind: branch.branchKind,
        branchNodeId: branch.branchNodeId,
        branchLabel: branch.branchLabel,
        score,
        channelScores: branch.scoreSummary.channelScores,
        evidenceTier,
        branchShare,
        branchMarginRatio,
        lexicalScore,
        hierarchyConsistencyScore,
        capabilitySupportScore,
        genericRiskPenalty,
        unrelatedBranchPenalty,
        semanticScore: 0,
        semanticSurface: null,
        candidates: candidateScores,
        facts: buildBranchFacts(branch, evidenceTier, branchShare, branchMarginRatio, queryIsGeneric)
    };
}
function scoreCandidate(candidate, stats, queryIsGeneric, branchShare, branchMarginRatio) {
    const evidenceTier = getCandidateEvidenceTier(candidate);
    const exactnessScore = getEvidenceTierScore(evidenceTier);
    const specificityScore = scoreCandidateSpecificity(candidate, queryIsGeneric);
    const leafShareWithinBranch = stats.leafShareByNodeId.get(candidate.graphNodeId) ?? 0;
    const leafMarginRatio = stats.leafMarginByNodeId.get(candidate.graphNodeId) ?? null;
    const hierarchyConsistencyScore = scoreCandidateHierarchyConsistency(candidate, branchShare, branchMarginRatio, leafShareWithinBranch, leafMarginRatio);
    const capabilitySupportScore = candidate.hasCapabilitySupport ? 1 : 0.35;
    const genericRiskPenalty = scoreCandidateGenericRiskPenalty(candidate, queryIsGeneric);
    const unrelatedBranchPenalty = scoreUnrelatedBranchPenalty(branchShare, branchMarginRatio);
    const score = roundScore(exactnessScore * DEFAULT_RESOLVER_WEIGHTS.exactness +
        specificityScore * DEFAULT_RESOLVER_WEIGHTS.specificity +
        hierarchyConsistencyScore * DEFAULT_RESOLVER_WEIGHTS.hierarchyConsistency +
        capabilitySupportScore * DEFAULT_RESOLVER_WEIGHTS.capabilitySupport -
        genericRiskPenalty * DEFAULT_RESOLVER_WEIGHTS.genericRiskSuppression -
        unrelatedBranchPenalty * DEFAULT_RESOLVER_WEIGHTS.unrelatedBranchPenalty);
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        score,
        retrievalScore: candidate.totalScore,
        channelScores: candidate.channelScores,
        evidenceTier,
        exactnessScore,
        specificityScore,
        hierarchyConsistencyScore,
        capabilitySupportScore,
        genericRiskPenalty,
        unrelatedBranchPenalty,
        semanticScore: 0,
        semanticSurface: null,
        leafShareWithinBranch,
        leafMarginRatio,
        facts: buildCandidateFacts(candidate, evidenceTier, branchShare, branchMarginRatio, queryIsGeneric)
    };
}
function selectOutcome(branchScores, queryIsGeneric, foldedQuery, broaderBranchFallback) {
    const topBranch = branchScores[0] ?? null;
    if (!topBranch) {
        return {
            decisionType: 'unresolved',
            selectedNodeId: null,
            selectedLabel: null,
            confidence: 0,
            safetyScore: 0,
            explanationFacts: ['no candidate branches were returned by retrieval']
        };
    }
    const trustedLeafOverride = selectTrustedLexicalLeaf(branchScores, queryIsGeneric, foldedQuery);
    if (trustedLeafOverride) {
        const { branch, candidate } = trustedLeafOverride;
        return {
            decisionType: 'leaf',
            selectedNodeId: candidate.graphNodeId,
            selectedLabel: candidate.canonicalLabel,
            confidence: candidate.score,
            safetyScore: candidate.score,
            explanationFacts: [
                `selected lexical leaf ${candidate.graphNodeId} from ${candidate.evidenceTier} evidence before branch fallback`,
                ...candidate.facts,
                ...branch.facts
            ]
        };
    }
    const topCandidate = topBranch.candidates[0] ?? null;
    if (topCandidate && isLeafSafe(topBranch, topCandidate, queryIsGeneric)) {
        return {
            decisionType: 'leaf',
            selectedNodeId: topCandidate.graphNodeId,
            selectedLabel: topCandidate.canonicalLabel,
            confidence: topCandidate.score,
            safetyScore: topCandidate.score,
            explanationFacts: [`selected leaf ${topCandidate.graphNodeId} from ${topCandidate.evidenceTier} evidence`, ...topCandidate.facts]
        };
    }
    const calibratedHybridLeaf = selectCalibratedHybridLeaf(branchScores, queryIsGeneric);
    if (calibratedHybridLeaf) {
        const { branch, candidate } = calibratedHybridLeaf;
        return {
            decisionType: 'leaf',
            selectedNodeId: candidate.graphNodeId,
            selectedLabel: candidate.canonicalLabel,
            confidence: candidate.score,
            safetyScore: candidate.score,
            explanationFacts: [
                `selected calibrated hybrid leaf ${candidate.graphNodeId} from ${candidate.evidenceTier} evidence`,
                `retrieval score ${candidate.retrievalScore} cleared calibrated leaf promotion gate`,
                ...candidate.facts,
                ...branch.facts
            ]
        };
    }
    const calibratedSemanticCapabilityLeaf = selectCalibratedSemanticCapabilityLeaf(branchScores, queryIsGeneric);
    if (calibratedSemanticCapabilityLeaf) {
        const { branch, candidate } = calibratedSemanticCapabilityLeaf;
        return {
            decisionType: 'leaf',
            selectedNodeId: candidate.graphNodeId,
            selectedLabel: candidate.canonicalLabel,
            confidence: candidate.score,
            safetyScore: candidate.score,
            explanationFacts: [
                `selected calibrated semantic-capability leaf ${candidate.graphNodeId}`,
                `retrieval score ${candidate.retrievalScore} cleared semantic-capability promotion gate`,
                ...candidate.facts,
                ...branch.facts
            ]
        };
    }
    if (broaderBranchFallback) {
        const decisionType = broaderBranchFallback.branchKind === 'family' ? 'family' : 'group';
        return {
            decisionType,
            selectedNodeId: broaderBranchFallback.branchNodeId,
            selectedLabel: broaderBranchFallback.branchLabel,
            confidence: broaderBranchFallback.score,
            safetyScore: broaderBranchFallback.score,
            explanationFacts: [
                `selected broader ${broaderBranchFallback.branchKind} ${broaderBranchFallback.branchNodeId} after leaf fallback failed`,
                ...broaderBranchFallback.facts
            ]
        };
    }
    if (isBranchFallbackSafe(topBranch, queryIsGeneric, foldedQuery)) {
        const decisionType = topBranch.branchKind === 'family' ? 'family' : 'group';
        return {
            decisionType,
            selectedNodeId: topBranch.branchNodeId,
            selectedLabel: topBranch.branchLabel,
            confidence: topBranch.score,
            safetyScore: topBranch.score,
            explanationFacts: [`selected safer ${topBranch.branchKind} ${topBranch.branchNodeId} instead of a leaf`, ...topBranch.facts]
        };
    }
    return {
        decisionType: 'unresolved',
        selectedNodeId: null,
        selectedLabel: null,
        confidence: topCandidate?.score ?? topBranch.score,
        safetyScore: topCandidate?.score ?? topBranch.score,
        explanationFacts: [
            'no leaf or family/group fallback crossed conservative safety gates',
            ...topBranch.facts,
            ...(topCandidate ? topCandidate.facts : [])
        ]
    };
}
function selectCalibratedHybridLeaf(branchScores, queryIsGeneric) {
    const candidates = branchScores.flatMap((branch) => branch.candidates.map((candidate) => ({
        branch,
        candidate
    })));
    return (candidates
        .filter(({ branch, candidate }) => isCalibratedHybridLeaf(branch, candidate, queryIsGeneric))
        .sort((left, right) => right.candidate.retrievalScore - left.candidate.retrievalScore ||
        right.candidate.score - left.candidate.score ||
        left.candidate.canonicalLabel.localeCompare(right.candidate.canonicalLabel))[0] ?? null);
}
function isCalibratedHybridLeaf(branch, candidate, queryIsGeneric) {
    if (candidate.evidenceTier !== 'exact_alias' && candidate.evidenceTier !== 'folded_alias') {
        return false;
    }
    if (queryIsGeneric) {
        return (candidate.evidenceTier === 'exact_alias' &&
            candidate.score >= 0.62 &&
            candidate.retrievalScore >= 12 &&
            (candidate.leafMarginRatio ?? 0) >= 3 &&
            branch.branchShare >= 0.7 &&
            (branch.branchMarginRatio ?? 0) >= 3 &&
            branch.capabilitySupportScore >= 0.75 &&
            candidate.genericRiskPenalty <= 0.6);
    }
    return (candidate.score >= 0.62 &&
        candidate.retrievalScore >= 7 &&
        (candidate.leafMarginRatio ?? 0) >= 1.5 &&
        branch.branchShare >= 0.65 &&
        (branch.branchMarginRatio ?? 0) >= 1.5 &&
        branch.capabilitySupportScore >= 0.75 &&
        candidate.genericRiskPenalty < 0.75);
}
function selectCalibratedSemanticCapabilityLeaf(branchScores, queryIsGeneric) {
    if (queryIsGeneric) {
        return null;
    }
    const candidates = branchScores.flatMap((branch) => branch.candidates.map((candidate) => ({
        branch,
        candidate
    })));
    return (candidates
        .filter(({ branch, candidate }) => isCalibratedSemanticCapabilityLeaf(branch, candidate))
        .sort((left, right) => right.candidate.retrievalScore - left.candidate.retrievalScore ||
        right.candidate.score - left.candidate.score ||
        right.branch.branchShare - left.branch.branchShare ||
        left.candidate.canonicalLabel.localeCompare(right.candidate.canonicalLabel))[0] ?? null);
}
function isCalibratedSemanticCapabilityLeaf(branch, candidate) {
    if (candidate.evidenceTier !== 'weak_signal') {
        return false;
    }
    const openSearchLexical = candidate.channelScores.lexical ?? 0;
    const capabilityTask = candidate.channelScores.capability_task ?? 0;
    if (openSearchLexical < 0.65 || capabilityTask < 0.35 || branch.capabilitySupportScore < 0.75) {
        return false;
    }
    return candidate.retrievalScore >= 3.5 && (candidate.leafMarginRatio ?? 0) >= 2.5 && branch.branchShare >= 0.35;
}
function selectTrustedLexicalLeaf(branchScores, queryIsGeneric, foldedQuery) {
    const candidates = branchScores.flatMap((branch) => branch.candidates.map((candidate) => ({
        branch,
        candidate
    })));
    return (candidates
        .filter(({ candidate }) => isTrustedLexicalLeaf(candidate, queryIsGeneric, foldedQuery))
        .sort((left, right) => evidenceTierRank(right.candidate.evidenceTier) - evidenceTierRank(left.candidate.evidenceTier) ||
        right.candidate.score - left.candidate.score ||
        right.candidate.leafShareWithinBranch - left.candidate.leafShareWithinBranch ||
        left.candidate.canonicalLabel.localeCompare(right.candidate.canonicalLabel))[0] ?? null);
}
function isTrustedLexicalLeaf(candidate, queryIsGeneric, foldedQuery) {
    if (candidate.evidenceTier !== 'exact_alias' && candidate.evidenceTier !== 'folded_alias') {
        return false;
    }
    if (queryIsGeneric && candidate.genericRiskPenalty >= 0.75) {
        return false;
    }
    const strongLeafClear = candidate.leafShareWithinBranch >= 0.75 || (candidate.leafMarginRatio ?? 0) >= 2;
    const adequateLeafClear = candidate.leafShareWithinBranch >= 0.55 && (candidate.leafMarginRatio ?? 0) >= 2;
    const canonicalLabelMatchesQuery = foldResolverText(candidate.canonicalLabel) === foldedQuery;
    if (candidate.evidenceTier === 'exact_alias') {
        if (queryIsGeneric) {
            return canonicalLabelMatchesQuery && candidate.score >= 0.54 && strongLeafClear;
        }
        return candidate.score >= 0.66 && strongLeafClear;
    }
    const highMarginLeafClear = (candidate.leafMarginRatio ?? 0) >= 2.5;
    return !queryIsGeneric && candidate.score >= 0.62 && (adequateLeafClear || highMarginLeafClear) && candidate.genericRiskPenalty < 0.75;
}
function isLeafSafe(topBranch, topCandidate, queryIsGeneric) {
    if (topCandidate.evidenceTier === 'none') {
        return false;
    }
    const branchClear = topBranch.branchShare >= 0.62 || (topBranch.branchMarginRatio ?? 0) >= 1.35;
    const leafClear = topCandidate.leafShareWithinBranch >= 0.62 || (topCandidate.leafMarginRatio ?? 0) >= 1.25;
    if (topCandidate.evidenceTier === 'exact_alias') {
        if (queryIsGeneric && topCandidate.genericRiskPenalty >= 0.75) {
            return topCandidate.score >= 0.82 && branchClear && leafClear && topBranch.branchShare >= 0.72;
        }
        return topCandidate.score >= 0.7 && branchClear && leafClear;
    }
    if (topCandidate.evidenceTier === 'folded_alias') {
        return topCandidate.score >= 0.7 && branchClear && leafClear && topCandidate.genericRiskPenalty < 0.75;
    }
    return (topCandidate.score >= 0.88 &&
        topBranch.branchShare >= 0.8 &&
        (topBranch.branchMarginRatio ?? 0) >= 2.5 &&
        topCandidate.leafShareWithinBranch >= 0.8 &&
        topCandidate.capabilitySupportScore === 1);
}
function isBranchFallbackSafe(topBranch, queryIsGeneric, foldedQuery) {
    if (topBranch.branchKind === 'node' || topBranch.evidenceTier === 'none') {
        return false;
    }
    const branchClear = topBranch.branchShare >= 0.5 || (topBranch.branchMarginRatio ?? 0) >= 1.18;
    const hasTrustedLexicalEvidence = topBranch.evidenceTier === 'exact_alias' || topBranch.evidenceTier === 'folded_alias';
    const weakSignalStrongBranch = topBranch.evidenceTier === 'weak_signal' &&
        !isBroadRoleQuery(foldedQuery) &&
        topBranch.branchShare >= (queryIsGeneric ? 0.58 : 0.76) &&
        (topBranch.branchMarginRatio ?? 0) >= (queryIsGeneric ? 2.8 : 2) &&
        topBranch.candidates.length >= (queryIsGeneric ? 3 : 1) &&
        topBranch.capabilitySupportScore >= 0.75;
    if (!branchClear) {
        return false;
    }
    if (hasTrustedLexicalEvidence) {
        return topBranch.score >= (queryIsGeneric ? 0.5 : 0.54);
    }
    return weakSignalStrongBranch && topBranch.score >= (queryIsGeneric ? 0.45 : 0.68);
}
function evidenceTierRank(evidenceTier) {
    if (evidenceTier === 'exact_alias') {
        return 2;
    }
    if (evidenceTier === 'folded_alias') {
        return 1;
    }
    return 0;
}
function isBroadRoleQuery(foldedQuery) {
    const tokens = foldedQuery.split(/\s+/u).filter(Boolean);
    return tokens.some((token) => token === 'role' || token === 'roles' || token === 'job' || token === 'jobs');
}
function foldResolverText(value) {
    return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ').normalize('NFKD').replace(/\p{M}/gu, '');
}
function buildBranchStats(branches) {
    const totalBranchScore = branches.reduce((sum, branch) => sum + branch.scoreSummary.totalCandidateScore, 0);
    const branchShareByKey = new Map();
    const branchMarginByKey = new Map();
    const leafShareByNodeId = new Map();
    const leafMarginByNodeId = new Map();
    const sortedBranchTotals = branches
        .map((item) => ({ key: item.branchKey, score: item.scoreSummary.totalCandidateScore }))
        .sort((left, right) => right.score - left.score);
    const [topBranchTotal, secondBranchTotal] = sortedBranchTotals;
    for (const branch of branches) {
        const branchTotal = branch.scoreSummary.totalCandidateScore;
        const bestOtherBranch = topBranchTotal?.key === branch.branchKey ? secondBranchTotal : topBranchTotal;
        branchShareByKey.set(branch.branchKey, totalBranchScore > 0 ? roundScore(branchTotal / totalBranchScore) : 0);
        branchMarginByKey.set(branch.branchKey, bestOtherBranch && bestOtherBranch.score > 0 ? roundScore(branchTotal / bestOtherBranch.score) : null);
        const branchCandidateTotal = branch.candidates.reduce((sum, candidate) => sum + candidate.totalScore, 0);
        const sortedCandidates = [...branch.candidates].sort((left, right) => right.totalScore - left.totalScore || left.canonicalLabel.localeCompare(right.canonicalLabel));
        const [topCandidate, secondCandidate] = sortedCandidates;
        for (const candidate of branch.candidates) {
            const bestOtherCandidate = topCandidate?.graphNodeId === candidate.graphNodeId ? secondCandidate : topCandidate;
            leafShareByNodeId.set(candidate.graphNodeId, branchCandidateTotal > 0 ? roundScore(candidate.totalScore / branchCandidateTotal) : 0);
            leafMarginByNodeId.set(candidate.graphNodeId, bestOtherCandidate && bestOtherCandidate.totalScore > 0 ? roundScore(candidate.totalScore / bestOtherCandidate.totalScore) : null);
        }
    }
    return {
        branchShareByKey,
        branchMarginByKey,
        leafShareByNodeId,
        leafMarginByNodeId
    };
}
function getBranchEvidenceTier(branch) {
    if (branch.scoreSummary.channelScores.exactAlias > 0) {
        return 'exact_alias';
    }
    if (branch.scoreSummary.channelScores.foldedAlias > 0) {
        return 'folded_alias';
    }
    if (branch.scoreSummary.channelScores.openSearchLexical > 0) {
        return 'weak_signal';
    }
    if (branch.scoreSummary.channelScores.capabilityTask > 0) {
        return 'weak_signal';
    }
    return 'none';
}
function getCandidateEvidenceTier(candidate) {
    if ((candidate.channelScores.exact_alias ?? 0) > 0) {
        return 'exact_alias';
    }
    if ((candidate.channelScores.folded_alias ?? 0) > 0) {
        return 'folded_alias';
    }
    if ((candidate.channelScores.lexical ?? 0) > 0) {
        return 'weak_signal';
    }
    if ((candidate.channelScores.capability_task ?? 0) > 0) {
        return 'weak_signal';
    }
    return 'none';
}
function getEvidenceTierScore(evidenceTier) {
    if (evidenceTier === 'exact_alias') {
        return 1;
    }
    if (evidenceTier === 'folded_alias') {
        return 0.82;
    }
    if (evidenceTier === 'weak_signal') {
        return 0.28;
    }
    return 0;
}
function scoreBranchEvidenceStrength(branch, evidenceTier, branchShare, branchMarginRatio) {
    const baseScore = getEvidenceTierScore(evidenceTier);
    if (evidenceTier !== 'weak_signal') {
        return baseScore;
    }
    const hasWeakSignalEvidence = branch.scoreSummary.channelScores.openSearchLexical > 0 || branch.scoreSummary.channelScores.capabilityTask > 0;
    if (!hasWeakSignalEvidence) {
        return baseScore;
    }
    const branchConcentration = Math.max(branchShare, ratioToScore(branchMarginRatio, 1.5, 5));
    const supportBreadth = Math.min(branch.candidates.length, 5) / 5;
    const weakSignalBranchScore = 0.28 + branchConcentration * 0.32 + supportBreadth * 0.1;
    return clampScore(Math.max(baseScore, weakSignalBranchScore));
}
function scoreCandidateSpecificity(candidate, queryIsGeneric) {
    const base = scoreGenericRiskAsSpecificity(candidate.genericRisk);
    const hierarchyBoost = candidate.hasHierarchy ? 0.08 : 0;
    const genericQueryPenalty = queryIsGeneric ? 0.15 : 0;
    return clampScore(base + hierarchyBoost - genericQueryPenalty);
}
function buildRankedResults(branchScores, bestBroaderBranch) {
    const globalTopLeaves = branchScores
        .flatMap((branch) => branch.candidates.map((candidate) => toRankedLeaf(branch, candidate, 0)))
        .sort(compareRankedLeaves);
    const branchAlignedTopLeaves = bestBroaderBranch
        ? bestBroaderBranch.candidates.map((candidate) => toRankedLeaf(bestBroaderBranch, candidate, 0)).sort(compareRankedLeaves)
        : [];
    const topLeaves = (branchAlignedTopLeaves.length > 0 ? branchAlignedTopLeaves : globalTopLeaves)
        .slice(0, 3)
        .map((leaf, index) => ({ ...leaf, rank: index + 1 }));
    return {
        topLeaves,
        bestBroaderBranch: bestBroaderBranch ? toRankedBroaderBranch(bestBroaderBranch) : null
    };
}
function selectBroaderBranchRescue(branchScores, preparedQuery, queryIsGeneric) {
    const broaderBranches = branchScores.filter((branch) => branch.branchKind === 'family' || branch.branchKind === 'group');
    if (broaderBranches.length === 0) {
        return null;
    }
    const roleHeadTokens = preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens.slice(-1);
    const candidates = broaderBranches
        .map((branch) => ({
        branch,
        roleHeadMatch: branchMatchesRoleHeadIntent(branch, preparedQuery.locale, roleHeadTokens)
    }))
        .filter(({ branch, roleHeadMatch }) => roleHeadMatch || (queryIsGeneric ? branch.score >= 0.58 : branch.score >= 0.62));
    if (candidates.length === 0) {
        return null;
    }
    return candidates.sort((left, right) => {
        if (left.roleHeadMatch !== right.roleHeadMatch) {
            return left.roleHeadMatch ? -1 : 1;
        }
        return (right.branch.score - left.branch.score ||
            right.branch.branchShare - left.branch.branchShare ||
            (right.branch.branchMarginRatio ?? 0) - (left.branch.branchMarginRatio ?? 0) ||
            left.branch.branchLabel.localeCompare(right.branch.branchLabel));
    })[0].branch;
}
function branchMatchesRoleHeadIntent(branch, locale, roleHeadTokens) {
    if (roleHeadTokens.length === 0) {
        return false;
    }
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(branch.branchLabel)).filter((token) => token.length > 0));
    for (const token of roleHeadTokens) {
        if (occupationRoleHeadSharesEquivalentClass(token, locale, canonicalTokens)) {
            return true;
        }
    }
    return false;
}
async function applySemanticAdjustments(branchScores, queryAnalysis, locale) {
    if (!queryAnalysis.supportedLocale || branchScores.length === 0) {
        return branchScores;
    }
    const candidateAnalysisCache = new Map();
    const adjusted = await Promise.all(branchScores.map(async (branch) => {
        const topCandidate = branch.candidates[0] ?? null;
        if (!topCandidate) {
            return branch;
        }
        const semanticSurface = chooseSemanticComparisonSurface(topCandidate.canonicalLabel);
        if (!semanticSurface) {
            return branch;
        }
        const candidateAnalysis = await getCandidateAnalysis(semanticSurface, locale, candidateAnalysisCache);
        const comparison = compareOccupationSemanticSurfaceAnalyses(queryAnalysis, candidateAnalysis);
        const semanticScore = semanticAdjustmentScore(comparison);
        if (semanticScore === 0) {
            return branch;
        }
        const adjustedCandidates = branch.candidates.map((candidate, index) => index === 0
            ? {
                ...candidate,
                score: roundScore(candidate.score + semanticScore),
                semanticScore,
                semanticSurface
            }
            : candidate);
        return {
            ...branch,
            score: roundScore(branch.score + semanticScore * 0.5),
            semanticScore,
            semanticSurface,
            candidates: adjustedCandidates
        };
    }));
    return adjusted.sort((left, right) => right.score - left.score || left.branchLabel.localeCompare(right.branchLabel));
}
async function getCandidateAnalysis(surface, locale, cache) {
    const key = `${locale}\0${surface}`;
    let cached = cache.get(key);
    if (!cached) {
        cached = analyzeOccupationSemanticSurface(surface, locale);
        cache.set(key, cached);
    }
    return cached;
}
function chooseSemanticComparisonSurface(surface) {
    const normalized = surface.trim();
    return normalized || null;
}
function semanticAdjustmentScore(comparison) {
    if (comparison.decision === 'help') {
        return roundScore(Math.min(0.18, comparison.score * 0.06));
    }
    if (comparison.decision === 'hurt') {
        return roundScore(Math.max(-0.18, comparison.score * 0.06));
    }
    return 0;
}
function toRankedBroaderBranch(branch) {
    return {
        branchKey: branch.branchKey,
        branchKind: branch.branchKind === 'family' ? 'family' : 'group',
        branchNodeId: branch.branchNodeId,
        branchLabel: branch.branchLabel,
        score: branch.score,
        semanticScore: branch.semanticScore,
        semanticSurface: branch.semanticSurface,
        evidenceTier: branch.evidenceTier,
        branchShare: branch.branchShare,
        branchMarginRatio: branch.branchMarginRatio,
        candidateCount: branch.candidates.length,
        channelScores: branch.channelScores,
        supportingLeaves: branch.candidates
            .map((candidate) => toRankedLeaf(branch, candidate, 0))
            .sort(compareRankedLeaves)
            .slice(0, 3)
            .map((leaf, index) => ({ ...leaf, rank: index + 1 }))
    };
}
function toRankedLeaf(branch, candidate, rank) {
    return {
        rank,
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        score: candidate.score,
        retrievalScore: candidate.retrievalScore,
        semanticScore: candidate.semanticScore,
        semanticSurface: candidate.semanticSurface,
        evidenceTier: candidate.evidenceTier,
        leafShareWithinBranch: candidate.leafShareWithinBranch,
        leafMarginRatio: candidate.leafMarginRatio,
        branchKey: branch.branchKey,
        branchKind: branch.branchKind,
        branchNodeId: branch.branchNodeId,
        branchLabel: branch.branchLabel,
        branchScore: branch.score,
        branchShare: branch.branchShare,
        branchMarginRatio: branch.branchMarginRatio,
        channelScores: candidate.channelScores
    };
}
function compareRankedLeaves(left, right) {
    return (right.retrievalScore - left.retrievalScore ||
        right.score - left.score ||
        evidenceTierRank(right.evidenceTier) - evidenceTierRank(left.evidenceTier) ||
        right.leafShareWithinBranch - left.leafShareWithinBranch ||
        left.canonicalLabel.localeCompare(right.canonicalLabel));
}
function scoreBranchSpecificity(branch, queryIsGeneric) {
    const averageSpecificity = branch.candidates.reduce((sum, candidate) => sum + scoreGenericRiskAsSpecificity(candidate.genericRisk), 0) /
        Math.max(branch.candidates.length, 1);
    return clampScore(averageSpecificity - (queryIsGeneric ? 0.12 : 0));
}
function scoreGenericRiskAsSpecificity(risk) {
    if (risk === 'low') {
        return 0.88;
    }
    if (risk === 'medium') {
        return 0.58;
    }
    if (risk === 'high') {
        return 0.25;
    }
    return 0.45;
}
function scoreCandidateHierarchyConsistency(candidate, branchShare, branchMarginRatio, leafShareWithinBranch, leafMarginRatio) {
    const branchClarity = Math.max(branchShare, ratioToScore(branchMarginRatio, 1.15, 2.25));
    const leafClarity = Math.max(leafShareWithinBranch, ratioToScore(leafMarginRatio, 1.1, 2));
    const hierarchyPresence = candidate.hasHierarchy ? 0.85 : 0.35;
    return clampScore(branchClarity * 0.35 + leafClarity * 0.4 + hierarchyPresence * 0.25);
}
function scoreBranchHierarchyConsistency(branch, branchShare, branchMarginRatio) {
    const hasHierarchy = branch.candidates.some((candidate) => candidate.hasHierarchy);
    const branchClarity = Math.max(branchShare, ratioToScore(branchMarginRatio, 1.12, 2));
    const inBranchSupport = Math.min(branch.candidates.length, 3) / 3;
    const hierarchyPresence = hasHierarchy ? 0.85 : 0.3;
    return clampScore(branchClarity * 0.55 + inBranchSupport * 0.2 + hierarchyPresence * 0.25);
}
function scoreBranchCapabilitySupport(branch) {
    const supportedCount = branch.candidates.filter((candidate) => candidate.hasCapabilitySupport).length;
    return branch.candidates.length > 0 ? roundScore(supportedCount / branch.candidates.length) : 0;
}
function scoreCandidateGenericRiskPenalty(candidate, queryIsGeneric) {
    const riskPenalty = candidate.genericRisk === 'high' ? 0.75 : candidate.genericRisk === 'medium' ? 0.35 : 0;
    return clampScore(riskPenalty + (queryIsGeneric ? 0.25 : 0));
}
function scoreBranchGenericRiskPenalty(branch, queryIsGeneric) {
    const averagePenalty = branch.candidates.reduce((sum, candidate) => sum + scoreCandidateGenericRiskPenalty(candidate, queryIsGeneric), 0) /
        Math.max(branch.candidates.length, 1);
    return clampScore(averagePenalty);
}
function scoreUnrelatedBranchPenalty(branchShare, branchMarginRatio) {
    if (branchMarginRatio === null) {
        return 0;
    }
    const competitorShare = 1 - branchShare;
    const marginPenalty = branchMarginRatio < 1.1 ? 0.7 : branchMarginRatio < 1.35 ? 0.45 : branchMarginRatio < 1.75 ? 0.2 : 0;
    return clampScore(competitorShare * 0.45 + marginPenalty);
}
function ratioToScore(ratio, weak, strong) {
    if (ratio === null) {
        return 1;
    }
    if (ratio <= weak) {
        return 0.25;
    }
    if (ratio >= strong) {
        return 1;
    }
    return roundScore(0.25 + ((ratio - weak) / (strong - weak)) * 0.75);
}
function buildBranchFacts(branch, evidenceTier, branchShare, branchMarginRatio, queryIsGeneric) {
    return [
        `branch evidence tier is ${evidenceTier}`,
        `branch holds ${formatPercent(branchShare)} of retrieved candidate score`,
        branchMarginRatio === null
            ? 'no competing branch was retrieved'
            : `branch score margin versus nearest competing branch is ${branchMarginRatio}`,
        `branch has ${branch.candidates.length} candidate(s)`,
        queryIsGeneric ? 'query shape is generic' : 'query shape is not generic'
    ];
}
function buildCandidateFacts(candidate, evidenceTier, branchShare, branchMarginRatio, queryIsGeneric) {
    return [
        `candidate evidence tier is ${evidenceTier}`,
        `generic risk is ${candidate.genericRisk ?? 'unknown'}`,
        candidate.hasHierarchy ? 'candidate has hierarchy context' : 'candidate has no hierarchy context',
        candidate.hasCapabilitySupport ? 'candidate has capability support' : 'candidate has no capability support',
        `candidate branch share is ${formatPercent(branchShare)}`,
        branchMarginRatio === null ? 'candidate branch has no retrieved competing branch' : `candidate branch margin is ${branchMarginRatio}`,
        queryIsGeneric ? 'query shape is generic' : 'query shape is not generic'
    ];
}
function clampScore(value) {
    return roundScore(Math.max(0, Math.min(1, value)));
}
function formatPercent(value) {
    return `${roundScore(value * 100)}%`;
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
