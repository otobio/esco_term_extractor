import { expandTokenVariants, normalizeQueryLocale, preparedQueryRoleCapabilityVerbFoldedAdditionTokens, preparedQueryRoleFamilyScopedFoldedTokens, preparedQueryRoleFolded, preparedQueryRoleFoldedTokens, preparedQueryRoleNormalized, preparedQueryRoleUsefulFoldedRecallTokens, prepareQuery } from '../query/query-preparation.js';
import { foldSearchText, foldWeakPunctuationLookupText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { prepareOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { isEnglishQuery } from '../utils/lang.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchRetriever } from '../retrieval/occupation-candidate-branches.js';
import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE, OccupationCandidateRetriever, retrievalSurfaceLocales } from '../retrieval/occupation-candidates.js';
import { createRetrievalEngine } from '../retrieval/retrieval-engine-factory.js';
import { TokenLeafClosenessRanker } from './ranking/leaf-closeness-ranker.js';
import { findCommonRolePhraseMatch } from '../query/common-role-phrase-atlas.js';
import { computeSiblingCompetitionScores, computeLeafSupportEvidence, scoreLeaf as scoreLeafAdditive, sumScoreBreakdown as sumAdditiveScoreBreakdown, compareRankedLeaves as compareAdditiveRankedLeaves, leafEvidenceAliasLabels } from '../cli/rank-family-leaves-core.js';
import { applyRecoveredFamilySelectionAuthority, compareRecoveredFamilySelectionAuthority, exactRoleMatchThreshold, rankFamilyCandidatesForRecovery } from '../cli/rank-family-core.js';
import { LeafSelectionEvidenceRanker } from './ranking/leaf-selection-evidence-ranker.js';
import { FamilyProfileRetriever } from './family-profile-retriever.js';
import { normalizeJobFunction } from './job-function-family-priors.js';
import { BRANCH_MARGIN_POLICY, EVIDENCE_NORMALIZATION_POLICY, NUMERIC_COMPARISON_POLICY, PIPELINE_DECISION_GATE } from '../scoring/scoring-policy.js';
import { hydrateRuntimeSearchMetaRecord, hydrateRuntimeSearchMetaRecords, loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import { preparedQueryRequestsAuthority, preparedQuerySupportsSpecializationKind, resolveLeafSpecializationKinds } from '../runtime/occupation-leaf-structure-rules.js';
import { findReviewedFamilySignalMatches, loadOccupationReviewedFamilySignalsArtifactRequired } from '../runtime/occupation-reviewed-family-signals.js';
import { timed } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost, requirePositiveIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';
import { readOptionalEnv } from '../config/env.js';
import { getOccupationFamilyContext } from '../api/occupation-family-taxonomy.js';
import { rankFamilyTop2V4CandidateFamilies } from '../cli/rank-family-top2-v4-core.js';
import { rankFamilyCandidatesForRecovery as rankFamilyCandidatesForRecoveryCore2, rankFamilyCandidatesForSelection as rankFamilyCandidatesForSelectionCore2 } from '../cli/rank-family-core-2.js';
import { compareFamilyStructureToQuery, familyStructureSupportScore, getFamilyStructureRule, shortlistFamilyStructureMatches } from '../runtime/occupation-family-structure-rules.js';
class PipelineDebugCollector {
    enabled;
    stages = [];
    familyCandidatePoolTrace = [];
    leafCandidatePoolTrace = [];
    familyProfileHitsByKey = new Map();
    leafFirstFamilies = [];
    familyRankComparison = [];
    familyStructure = [];
    constructor(enabled) {
        this.enabled = enabled;
    }
    collect(state, stageName) {
        if (!this.enabled) {
            return;
        }
        this.stages = [...state.stages];
        if (stageName === 'retrieveExactFamilyCanonicalEvidenceStage' || stageName === 'retrieveFamilyProfileEvidenceStage') {
            for (const family of state.candidateFamilies.values()) {
                for (const record of family.evidence) {
                    const hit = familyProfileHitFromEvidenceRecord(record);
                    if (!hit) {
                        continue;
                    }
                    this.familyProfileHitsByKey.set(familyProfileHitKey(hit), hit);
                }
            }
        }
        if (stageName === 'resolveLeafFirstStage') {
            this.leafFirstFamilies = debugBuildLeafFirstFamilyDebugEntriesFromState(state);
            if (state.rankedFamilies.length > 0) {
                this.familyStructure = debugBuildFamilyStructureEntries(state);
            }
        }
        if (stageName === 'consolidateFamiliesStage') {
            this.familyCandidatePoolTrace = debugBuildFamilyCandidatePoolTraceEntries(state);
            this.familyRankComparison = debugBuildFamilyRankComparisonEntries(state);
            this.familyStructure = debugBuildFamilyStructureEntries(state);
        }
        if (stageName === 'narrowLeavesWithinFamiliesStage') {
            this.leafCandidatePoolTrace = debugBuildLeafCandidatePoolTraceEntries(state);
        }
    }
    snapshot(attempts, timings, rawBranchExpansion) {
        return {
            stages: [...this.stages],
            attempts,
            timings,
            rawBranchExpansion: this.enabled ? rawBranchExpansion : null,
            candidatePoolTrace: [...this.familyCandidatePoolTrace, ...this.leafCandidatePoolTrace],
            familyProfileHits: Array.from(this.familyProfileHitsByKey.values()),
            leafFirstFamilies: [...this.leafFirstFamilies],
            familyRankComparison: [...this.familyRankComparison],
            familyStructure: [...this.familyStructure]
        };
    }
}
const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const LEAF_SELECTION_EVIDENCE_RANKER = new LeafSelectionEvidenceRanker();
const FAMILY_PROFILE_RETRIEVER = new FamilyProfileRetriever();
const EVIDENCE_PIPELINE_FAMILY_RANKING_STRATEGY = {
    rankForRecovery(preparedQuery, sourceName, topFamilyLimit, candidateFamilies, candidateLeafsByFamilyKey, jobFunction = null) {
        return rankFamilyCandidatesForRecovery(preparedQuery, sourceName, topFamilyLimit, candidateFamilies, candidateLeafsByFamilyKey, jobFunction);
    },
    rankForSelection(preparedQuery, families, recoverAuthority, isBroadRoleQuery, compareBroadRoleFamilies) {
        const authorityRankedFamilies = families
            .slice()
            .sort((left, right) => compareRecoveredFamilySelectionAuthority(left, right, preparedQuery, recoverAuthority) || left.rank - right.rank)
            .map((family, index) => applyRecoveredFamilySelectionAuthority(family, index + 1, preparedQuery, recoverAuthority));
        if (!isBroadRoleQuery(preparedQuery)) {
            return authorityRankedFamilies;
        }
        return authorityRankedFamilies
            .slice()
            .sort((left, right) => compareBroadRoleFamilies(left, right) || left.rank - right.rank)
            .map((family, index) => ({ ...family, rank: index + 1 }));
    }
};
export function createTop2V4PipelineFamilyRankingStrategy(artifacts) {
    return {
        rankForRecovery(preparedQuery, sourceName, topFamilyLimit, candidateFamilies, candidateLeafsByFamilyKey, jobFunction = null) {
            const top2Result = rankFamilyTop2V4CandidateFamilies({
                ...artifacts,
                query: {
                    preparedQuery,
                    rawQuery: preparedQuery.raw,
                    effectiveQuery: preparedQuery.normalized || preparedQuery.raw,
                    locale: preparedQuery.locale,
                    sourceName
                },
                limit: Math.max(topFamilyLimit, candidateFamilies.length),
                candidateFamilies
            });
            const evidenceFallbackFamilies = EVIDENCE_PIPELINE_FAMILY_RANKING_STRATEGY.rankForRecovery(preparedQuery, sourceName, candidateFamilies.length, candidateFamilies, candidateLeafsByFamilyKey, jobFunction);
            const selectedFamilyKeys = new Set();
            const rankedFamilies = [];
            for (const rankedFamily of top2Result.rankedFamilies) {
                const family = rankedFamily.candidate;
                const confidence = Math.max(0, Math.min(1, rankedFamily.hit.score));
                selectedFamilyKeys.add(family.familyKey);
                rankedFamilies.push({
                    ...family,
                    score: confidence,
                    confidence,
                    rank: rankedFamily.rank,
                    supportingLeafCount: family.supportingLeafIds.size,
                    leaves: []
                });
            }
            for (const family of evidenceFallbackFamilies) {
                if (rankedFamilies.length >= topFamilyLimit) {
                    break;
                }
                if (selectedFamilyKeys.has(family.familyKey)) {
                    continue;
                }
                selectedFamilyKeys.add(family.familyKey);
                rankedFamilies.push(family);
            }
            return rankedFamilies.slice(0, topFamilyLimit).map((family, index) => ({ ...family, rank: index + 1 }));
        },
        rankForSelection(preparedQuery, families, recoverAuthority, isBroadRoleQuery, compareBroadRoleFamilies) {
            return EVIDENCE_PIPELINE_FAMILY_RANKING_STRATEGY.rankForSelection(preparedQuery, families, recoverAuthority, isBroadRoleQuery, compareBroadRoleFamilies);
        }
    };
}
export const CORE2_PIPELINE_FAMILY_RANKING_STRATEGY = {
    rankForRecovery: rankFamilyCandidatesForRecoveryCore2,
    rankForSelection(preparedQuery, families, recoverAuthority) {
        return rankFamilyCandidatesForSelectionCore2(preparedQuery, families, recoverAuthority);
    }
};
const ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY = {
    rank(input) {
        const rolePhraseMatch = findCommonRolePhraseMatch(input.exactQueryText, input.preparedQuery.locale);
        const specializationKindsCache = new Map();
        const leafAliasesByNodeId = new Map(input.leaves.map((leaf) => [
            leaf.graphNodeId,
            Array.from(new Set([...matchedAliasLabels(leaf.evidence), ...(input.recoveredAliasesByNodeId.get(leaf.graphNodeId) ?? [])]))
        ]));
        const siblingCompetitionScores = computeSiblingCompetitionScores(input.leaves.map((leaf) => ({
            graphNodeId: leaf.graphNodeId,
            canonicalLabel: leaf.canonicalLabel
        })), input.preparedQuery, input.roleFamilyScopedFoldedTokens);
        const rankedLeaves = input.leaves.map((leaf) => {
            const aliases = Array.from(leafAliasesByNodeId.get(leaf.graphNodeId) ?? []);
            const recoveredCapabilityLabelsForLeaf = input.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? [];
            const capabilityLabels = recoveredCapabilityLabelsForLeaf.map((label) => ({
                capabilityId: 0,
                capabilityType: 'skill',
                canonicalKey: '',
                localeCode: input.preparedQuery.locale,
                label,
                normalizedLabel: '',
                hintKind: '',
                weight: null
            }));
            const closeness = LEAF_CLOSENESS_RANKER.rank({
                query: input.roleClosenessQuery,
                canonicalLabel: leaf.canonicalLabel,
                aliases
            });
            const canonicalTokens = new Set(canonicalLabelTokens(leaf.canonicalLabel));
            const matchedLabelTokens = new Set(tokenizeNormalizedText(foldSearchText(closeness.matchedLabel)));
            const familyTokens = new Set(canonicalLabelTokens(leaf.familyLabel ?? ''));
            const supportEvidence = computeLeafSupportEvidence(input.preparedQuery, leaf.canonicalLabel, aliases, capabilityLabels, input.roleFamilyScopedFoldedTokens, input.roleCapabilityVerbFoldedAdditionTokens);
            const scoreBreakdown = scoreLeafAdditive(closeness, aliases, leaf.leafStructure, input.preparedQuery, canonicalTokens, matchedLabelTokens, familyTokens, capabilityLabels, rolePhraseMatch, input.preparedQuery.locale, leaf.canonicalLabel, input.exactQueryText, leaf.graphNodeId, specializationKindsCache, input.roleFamilyScopedFoldedTokens, input.roleCapabilityVerbFoldedAdditionTokens, supportEvidence, siblingCompetitionScores.get(leaf.graphNodeId) ?? 0);
            const totalScore = sumAdditiveScoreBreakdown(scoreBreakdown);
            const canonicalUsefulTokenCoverage = input.preparedQuery.locale !== 'en'
                ? 0
                : input.preparedQuery.usefulFoldedRecallTokens.length > 0
                    ? input.preparedQuery.usefulFoldedRecallTokens.filter((token) => canonicalTokens.has(token)).length /
                        input.preparedQuery.usefulFoldedRecallTokens.length
                    : 0;
            const usefulExactLabel = leafHasUsefulExactLabel(closeness);
            const evidenceWithUsefulExact = leafEvidenceWithUsefulExact(leaf, usefulExactLabel);
            const selectionEvidence = LEAF_SELECTION_EVIDENCE_RANKER.rank({
                evidence: evidenceWithUsefulExact,
                closeness,
                usefulExactLabel,
                familyScopedFit: supportEvidence.familyScopedFit,
                capabilityFit: supportEvidence.capabilityFit
            });
            return {
                rank: 0,
                graphNodeId: leaf.graphNodeId,
                canonicalLabel: leaf.canonicalLabel,
                aliases,
                structure: leaf.leafStructure,
                closeness,
                scoreBreakdown,
                totalScore,
                canonicalUsefulTokenCoverage,
                evidenceWithUsefulExact,
                familyScopedFit: supportEvidence.familyScopedFit,
                capabilityFit: supportEvidence.capabilityFit,
                selectionEvidence
            };
        });
        rankedLeaves.sort(compareAdditiveRankedLeaves);
        // rankedLeaves.sort((left, right) => {
        //   const selectionTierDiff = left.selectionEvidence.tierRank - right.selectionEvidence.tierRank;
        //   return selectionTierDiff || compareAdditiveRankedLeaves(left, right);
        // });
        const rankedLeafByNodeId = new Map(rankedLeaves.map((leaf) => [leaf.graphNodeId, leaf]));
        // Reorder input.leaves by rankedLeaves' own position, not by re-sorting on totalScore alone --
        // a plain totalScore sort is stable, so leaves tied on score would silently fall back to
        // whatever order they arrived in, discarding every tie-break compareAdditiveRankedLeaves already
        // resolved above (canonical-label proximity, specialization genericness, etc).
        const rankIndexByNodeId = new Map(rankedLeaves.map((leaf, index) => [leaf.graphNodeId, index]));
        const orderedLeaves = [...input.leaves].sort((left, right) => (rankIndexByNodeId.get(left.graphNodeId) ?? 0) - (rankIndexByNodeId.get(right.graphNodeId) ?? 0));
        return {
            leaves: orderedLeaves.map((leaf) => {
                const rankedLeaf = rankedLeafByNodeId.get(leaf.graphNodeId) ?? null;
                const totalScore = rankedLeaf?.totalScore ?? 0;
                const normalizedConfidence = Math.max(0, Math.min(1, totalScore / 30));
                return {
                    ...leaf,
                    evidence: rankedLeaf?.evidenceWithUsefulExact ?? leaf.evidence,
                    closeness: rankedLeaf?.closeness ?? null,
                    familyScopedFit: rankedLeaf?.familyScopedFit ?? null,
                    capabilityFit: rankedLeaf?.capabilityFit ?? null,
                    selectionEvidence: rankedLeaf?.selectionEvidence ?? null,
                    score: totalScore,
                    confidence: normalizedConfidence
                };
            })
        };
    }
};
const DEFAULT_PIPELINE_LEAF_RANKING_STRATEGY = ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY;
const DEFAULT_PIPELINE_FAMILY_RANKING_STRATEGY = CORE2_PIPELINE_FAMILY_RANKING_STRATEGY;
export { ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY };
const CANONICAL_USEFUL_COVERAGE_CACHE = new WeakMap();
// canonicalLabel is a stable, immutable string per graph node -- folding/tokenizing it is a pure
// function of that string, so cache by label text once instead of re-folding/re-tokenizing the same
// leaf's canonical label on every sort comparison and every gate check across every pipeline.run() call.
const CANONICAL_LABEL_TOKEN_CACHE = new Map();
function canonicalLabelTokens(label) {
    let tokens = CANONICAL_LABEL_TOKEN_CACHE.get(label);
    if (tokens === undefined) {
        tokens = tokenizeNormalizedText(foldSearchText(label));
        CANONICAL_LABEL_TOKEN_CACHE.set(label, tokens);
    }
    return tokens;
}
export class OccupationSearchPipeline {
    candidateBranchRetriever;
    occupationRetriever;
    leafStructureArtifact;
    leafRankingStrategy;
    familyRankingStrategy;
    constructor(candidateBranchRetriever = new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(null, createRetrievalEngine())), occupationRetriever = createRetrievalEngine().occupations, leafStructureArtifact = null, leafRankingStrategy = DEFAULT_PIPELINE_LEAF_RANKING_STRATEGY, familyRankingStrategy = DEFAULT_PIPELINE_FAMILY_RANKING_STRATEGY) {
        this.candidateBranchRetriever = candidateBranchRetriever;
        this.occupationRetriever = occupationRetriever;
        this.leafStructureArtifact = leafStructureArtifact;
        this.leafRankingStrategy = leafRankingStrategy;
        this.familyRankingStrategy = familyRankingStrategy;
    }
    static withEngine(engine) {
        return new OccupationSearchPipeline(new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(null, engine)), engine.occupations, null);
    }
    static withRuntime(runtime) {
        return new OccupationSearchPipeline(new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(null, runtime.retrievalEngine)), runtime.retrievalEngine.occupations, runtime.leafStructureRuntimeEnabled ? runtime.leafStructureArtifact : null);
    }
    withLeafRankingStrategy(leafRankingStrategy) {
        return new OccupationSearchPipeline(this.candidateBranchRetriever, this.occupationRetriever, this.leafStructureArtifact, leafRankingStrategy, this.familyRankingStrategy);
    }
    withFamilyRankingStrategy(familyRankingStrategy) {
        return new OccupationSearchPipeline(this.candidateBranchRetriever, this.occupationRetriever, this.leafStructureArtifact, this.leafRankingStrategy, familyRankingStrategy);
    }
    async run(options) {
        const normalizedOptions = normalizeOptions(options);
        // Step 1: Clean the query - Peel noise terms, and Use the OOV to remove unknown terms, Perform Spelling Correction
        const cleanedQuery = await cleanOccupationQuerySurface(normalizedOptions.query, normalizedOptions.locale);
        if (!cleanedQuery) {
            throw new Error('Provide a query string for pipeline query preparation... Failed for: ' + normalizedOptions.query);
        }
        const activeOptions = { ...normalizedOptions, query: cleanedQuery };
        if (await shouldSwitchToEnglishQueryLocale(activeOptions.query, activeOptions.sourceName, activeOptions.locale)) {
            activeOptions.locale = DEFAULT_RETRIEVAL_LOCALE;
        }
        const intentVocabularyArtifact = await timed(() => loadOccupationIntentVocabularyArtifactRequired(activeOptions.sourceName), 'pipeline.intent_vocabulary.artifact_load', {});
        // Step 2: Prepare the query: Do Query Intent, Do Various query forms, Compound Split, etc
        const primaryRetrievalQuery = await prepareOccupationRetrievalQuery({
            sourceName: activeOptions.sourceName,
            locale: activeOptions.locale,
            originalQuery: activeOptions.query,
            disabledCommonRolePhraseRoleKeys: activeOptions.disabledCommonRolePhraseRoleKeys
        }, intentVocabularyArtifact.artifact);
        if (shouldResolveIndependentOccupationSpans(primaryRetrievalQuery.originalQuery, primaryRetrievalQuery.querySpans)) {
            const spanRetrievals = [];
            for (const span of primaryRetrievalQuery.querySpans) {
                const spanRetrievalQuery = await prepareOccupationRetrievalQuery({
                    sourceName: activeOptions.sourceName,
                    locale: activeOptions.locale,
                    originalQuery: span,
                    disabledCommonRolePhraseRoleKeys: activeOptions.disabledCommonRolePhraseRoleKeys
                }, intentVocabularyArtifact.artifact);
                const spanRetrievalResult = await this.candidateBranchRetriever.retrieveCandidatesWithGraphBranches({
                    sourceName: activeOptions.sourceName,
                    locale: activeOptions.locale,
                    limit: activeOptions.limit,
                    siblingLimit: activeOptions.siblingLimit,
                    evaluationQueryId: undefined,
                    debugCollector: activeOptions.debugCollector,
                    retrievalQuery: spanRetrievalQuery
                });
                spanRetrievals.push({
                    retrievalQuery: spanRetrievalQuery,
                    retrievalResult: spanRetrievalResult
                });
            }
            const spanResults = [];
            for (const [index, spanRetrieval] of spanRetrievals.entries()) {
                const retrievalResult = spanRetrieval.retrievalResult;
                const spanOptions = {
                    ...activeOptions,
                    query: retrievalResult.originalQuery,
                    evaluationQueryId: undefined
                };
                const spanAttempt = await runRankingAttempt(retrievalResult, spanRetrieval.retrievalQuery, spanOptions, this.occupationRetriever, this.leafStructureArtifact, this.leafRankingStrategy, this.familyRankingStrategy);
                const attempts = [summarizeAttempt(1, 'primary', spanAttempt, 'used', 'multi-span independent span retrieval attempt')];
                const result = toPipelineResult(spanAttempt, attempts);
                const spanDecision = summarizeMultiSpanSpanDecision(result);
                spanResults.push({
                    spanIndex: index + 1,
                    query: retrievalResult.originalQuery,
                    preparedQuery: result.preparedQuery,
                    decision: spanDecision,
                    coverageStatus: result.coverageStatus,
                    rankedFamilies: result.rankedFamilies.slice(0, 1),
                    rankedLeaves: result.rankedLeaves.slice(0, 1),
                    scannedAliasHitCount: result.queryContext.scannedAliasHitCount,
                    scannedOpenSearchHitCount: result.queryContext.scannedOpenSearchHitCount,
                    debug: result.debug
                });
            }
            const retrievalResults = spanRetrievals.map((spanRetrieval) => spanRetrieval.retrievalResult);
            return toMultiSpanPipelineResult(primaryRetrievalQuery, retrievalResults, spanResults, activeOptions.jobFunction ?? null);
        }
        // Step 3: Gather related information about the query via various logic
        const primaryRetrievalResult = await this.candidateBranchRetriever.retrieveCandidatesWithGraphBranches({
            sourceName: activeOptions.sourceName,
            locale: activeOptions.locale,
            limit: activeOptions.limit,
            siblingLimit: activeOptions.siblingLimit,
            evaluationQueryId: undefined,
            debugCollector: activeOptions.debugCollector,
            retrievalQuery: primaryRetrievalQuery
        });
        // Step 4: The complex rank the retrieved result and pick when possible
        const primaryAttempt = await runRankingAttempt(primaryRetrievalResult, primaryRetrievalQuery, activeOptions, this.occupationRetriever, this.leafStructureArtifact, this.leafRankingStrategy, this.familyRankingStrategy);
        const attempts = [summarizeAttempt(1, 'primary', primaryAttempt, 'used', 'primary retrieval attempt')];
        let selectedAttempt = primaryAttempt;
        return toPipelineResult(selectedAttempt, attempts, activeOptions.locale);
    }
}
function shouldResolveIndependentOccupationSpans(originalQuery, querySpans) {
    return querySpans.length > 1 && hasIndependentOccupationSpanSeparator(originalQuery);
}
function hasIndependentOccupationSpanSeparator(value) {
    return /[\r\n\t;•·▪‣◦|/]+/iu.test(value);
}
async function shouldSwitchToEnglishQueryLocale(query, sourceName, requestedLocale) {
    const normalizedRequestedLocale = normalizeQueryLocale(requestedLocale);
    if (normalizedRequestedLocale === DEFAULT_RETRIEVAL_LOCALE || !(await isEnglishQuery(query, sourceName))) {
        return false;
    }
    const requestedPreparedQuery = await prepareQuery(query, normalizedRequestedLocale, { sourceName });
    const englishPreparedQuery = await prepareQuery(query, DEFAULT_RETRIEVAL_LOCALE, { sourceName });
    if (requestedPreparedQuery.intent.roleTokens.length === 0) {
        return true;
    }
    return (sameFoldedTokenSet(requestedPreparedQuery.intent.roleHeadTokens, englishPreparedQuery.intent.roleHeadTokens) &&
        requestedPreparedQuery.intent.roleTokens.length <= englishPreparedQuery.intent.roleTokens.length);
}
function sameFoldedTokenSet(left, right) {
    const leftSet = new Set(left.map((token) => foldSearchText(token)));
    const rightSet = new Set(right.map((token) => foldSearchText(token)));
    return leftSet.size === rightSet.size && Array.from(leftSet).every((token) => rightSet.has(token));
}
async function runRankingAttempt(retrievalResult, retrievalQuery, options, occupationRetriever, leafStructureArtifact, leafRankingStrategy, familyRankingStrategy) {
    const preparedQuery = retrievalQuery.preparedQuery;
    const timings = { ...retrievalResult.timings };
    const familyStructureSourceQuery = retrievalQuery.roleSpanSelection.cleanedQuery.trim() || retrievalQuery.query;
    const familyStructurePreparedQuery = foldSearchText(familyStructureSourceQuery) === foldSearchText(preparedQuery.raw)
        ? preparedQuery
        : await timed(() => prepareQuery(familyStructureSourceQuery, retrievalQuery.locale, {
            sourceName: options.sourceName,
            disabledCommonRolePhraseRoleKeys: options.disabledCommonRolePhraseRoleKeys
        }), 'pipeline.family_structure_prepare', timings);
    const roleClosenessQuery = {
        locale: preparedQuery.locale,
        normalized: preparedQueryRoleNormalized(preparedQuery),
        folded: preparedQueryRoleFolded(preparedQuery),
        foldedTokens: preparedQueryRoleFoldedTokens(preparedQuery),
        usefulFoldedRecallTokens: preparedQueryRoleUsefulFoldedRecallTokens(preparedQuery),
        roleHeadTokens: preparedQuery.intent.roleHeadTokens,
        altRoleHeadTokens: preparedQuery.intent.altRoleHeadTokens,
        roleModifierTokens: preparedQuery.intent.roleModifierTokens,
        altRoleModifierTokens: preparedQuery.intent.altRoleModifierTokens
    };
    const roleFamilyScopedFoldedTokens = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery);
    const roleCapabilityVerbFoldedAdditionTokens = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery);
    const pipelineDebugCollector = new PipelineDebugCollector(options.debug);
    let state = {
        occupationRetriever,
        leafStructureArtifact,
        leafRankingStrategy,
        familyRankingStrategy,
        debugFamilyRankComparisonStrategies: options.debugFamilyRankComparisonStrategies,
        debugMode: options.debugMode,
        preparedQuery,
        familyStructurePreparedQuery,
        roleClosenessQuery,
        roleFamilyScopedFoldedTokens,
        roleCapabilityVerbFoldedAdditionTokens,
        branchExpansion: retrievalResult,
        candidateFamilies: new Map(),
        candidateLeafs: new Map(),
        recoveredAliasesByNodeId: new Map(),
        recoveredCapabilityLabelsByNodeId: new Map(),
        rankedFamilies: [],
        rankedLeaves: [],
        decision: null,
        stages: [],
        timings,
        topFamilyLimit: options.topFamilyLimit,
        topLeavesPerFamily: options.topLeavesPerFamily,
        jobFunction: options.jobFunction ?? null,
        leafSpecializationKindsCache: new Map()
    };
    const stages = options.debugMode === 'family-rank-output'
        ? [
            accumulateCurrentRetrievalEvidenceStage,
            retrieveExactFamilyCanonicalEvidenceStage,
            retrieveFamilyProfileEvidenceStage,
            applyReviewedFamilySignalStage,
            consolidateFamiliesStage
        ]
        : [
            accumulateCurrentRetrievalEvidenceStage,
            retrieveExactFamilyCanonicalEvidenceStage,
            resolveLeafFirstStage,
            retrieveFamilyProfileEvidenceStage,
            applyReviewedFamilySignalStage,
            consolidateFamiliesStage,
            recoverLeavesInsideTopFamiliesStage,
            narrowLeavesWithinFamiliesStage,
            selectPipelineDecisionStage
        ];
    for (const stage of stages) {
        state = await timed(() => stage(state), `pipeline.stage.${stage.name || 'anonymous'}`, state.timings);
        pipelineDebugCollector.collect(state, stage.name || 'anonymous');
        if (state.decision) {
            break;
        }
        if (options.debugMode === 'family-rank-output' && stage === consolidateFamiliesStage) {
            state = {
                ...state,
                decision: buildDebugFamilyRankOutputDecision(state)
            };
            break;
        }
    }
    if (!state.decision) {
        throw new Error('Pipeline did not produce a decision.');
    }
    return {
        state: {
            ...state,
            branchExpansion: retrievalResult,
            decision: state.decision
        },
        debug: pipelineDebugCollector.snapshot([], state.timings, retrievalResult)
    };
}
async function retrieveExactFamilyCanonicalEvidenceStage(state) {
    if (!isFamilyProfileRetrievalEnabled()) {
        return {
            ...state,
            stages: appendStage(state, 'skip_exact_family_canonical_evidence')
        };
    }
    const branchExpansion = requireBranchExpansion(state);
    const familyProfileArtifact = await timed(() => loadOccupationFamilyProfileArtifactRequired(branchExpansion.sourceName), 'pipeline.exact_family_canonical.artifact_load', state.timings);
    const exactHits = await timed(() => FAMILY_PROFILE_RETRIEVER.retrieveExactCanonicalFamilies({
        preparedQuery: state.preparedQuery,
        artifact: familyProfileArtifact,
        locale: branchExpansion.locale,
        rawQuery: branchExpansion.originalQuery,
        limit: 1
    }), 'pipeline.exact_family_canonical.retrieve', state.timings);
    for (const hit of exactHits) {
        const familyKey = `family:${hit.familyNodeId}`;
        let family = state.candidateFamilies.get(familyKey);
        if (!family) {
            family = buildRuntimeFamilyCandidate({
                familyNodeId: hit.familyNodeId,
                familyLabel: hit.familyLabel
            });
            state.candidateFamilies.set(familyKey, family);
        }
        addFamilyProfileEvidence(family, hit);
        for (const leafId of hit.matchingLeafIds) {
            family.supportingLeafIds.add(leafId);
        }
    }
    return {
        ...state,
        stages: appendStage(state, exactHits.length > 0 ? 'retrieve_exact_family_canonical_evidence' : 'skip_exact_family_canonical_evidence_no_match')
    };
}
async function retrieveFamilyProfileEvidenceStage(state) {
    if (!isFamilyProfileRetrievalEnabled()) {
        return {
            ...state,
            stages: appendStage(state, 'skip_family_profile_evidence')
        };
    }
    const branchExpansion = requireBranchExpansion(state);
    if (hasAuthoritativeAliasEvidence(branchExpansion)) {
        return {
            ...state,
            stages: appendStage(state, 'skip_family_profile_evidence_authoritative_alias')
        };
    }
    const familyProfileArtifact = await timed(() => loadOccupationFamilyProfileArtifactRequired(branchExpansion.sourceName), 'pipeline.family_profile.artifact_load', state.timings);
    const profileHits = await timed(() => FAMILY_PROFILE_RETRIEVER.retrieve({
        preparedQuery: state.preparedQuery,
        artifact: familyProfileArtifact,
        locale: branchExpansion.locale,
        rawQuery: branchExpansion.originalQuery,
        limit: Math.max(state.topFamilyLimit * 3, 12)
    }), 'pipeline.family_profile.retrieve', state.timings);
    for (const hit of profileHits) {
        const familyKey = `family:${hit.familyNodeId}`;
        let family = state.candidateFamilies.get(familyKey);
        if (!family) {
            family = buildRuntimeFamilyCandidate({
                familyNodeId: hit.familyNodeId,
                familyLabel: hit.familyLabel
            });
            state.candidateFamilies.set(familyKey, family);
        }
        addFamilyProfileEvidence(family, hit);
        for (const leafId of hit.matchingLeafIds) {
            family.supportingLeafIds.add(leafId);
        }
    }
    return {
        ...state,
        stages: appendStage(state, 'retrieve_family_profile_evidence')
    };
}
// Generalizes the former exact-canonical-only short circuit into leaf-first resolution: every
// candidate family's own best leaf is scored and gated identically to how selectPipelineDecisionStage
// gates topFamily's leaf today, but compared globally across ALL families instead of only the family
// that family-level evidence happened to rank first. Family is derived from whichever leaf wins, not
// decided independently -- the family-first flow below only ever runs when no leaf clears the bar.
async function resolveLeafFirstStage(state) {
    if (state.candidateLeafs.size === 0) {
        return {
            ...state,
            stages: appendStage(state, 'skip_leaf_first_resolution_no_candidates')
        };
    }
    const branchExpansion = requireBranchExpansion(state);
    const leavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const candidateFamilies = Array.from(leavesByFamilyKey.keys())
        .map((familyKey) => state.candidateFamilies.get(familyKey))
        .filter((family) => family !== undefined && getFamilyStructureRule(family.familyNodeId) !== undefined);
    const provisionalFamilies = state.familyRankingStrategy.rankForRecovery(state.familyStructurePreparedQuery, branchExpansion.sourceName, candidateFamilies.length, candidateFamilies, leavesByFamilyKey, state.jobFunction);
    const scoredFamilies = provisionalFamilies.map((provisionalFamily) => {
        const orderedLeaves = state.leafRankingStrategy
            .rank({
            preparedQuery: state.preparedQuery,
            roleClosenessQuery: state.roleClosenessQuery,
            roleFamilyScopedFoldedTokens: state.roleFamilyScopedFoldedTokens,
            roleCapabilityVerbFoldedAdditionTokens: state.roleCapabilityVerbFoldedAdditionTokens,
            exactQueryText: branchExpansion.originalQuery,
            family: provisionalFamily,
            leaves: leavesByFamilyKey.get(provisionalFamily.familyKey) ?? [],
            recoveredAliasesByNodeId: state.recoveredAliasesByNodeId,
            recoveredCapabilityLabelsByNodeId: state.recoveredCapabilityLabelsByNodeId
        })
            .leaves.map((leaf, index) => ({ ...leaf, rank: index + 1 }));
        return {
            ...provisionalFamily,
            leaves: orderedLeaves
        };
    });
    const selectableTopLeaves = scoredFamilies
        .map((family) => {
        // Try the top-ranked leaf first, but don't give up on the family the moment it fails a
        // gate (e.g. hasUnsafeSpecializedLeafTie rejecting unrequested specificity) -- a generic/
        // base sibling ranked just behind it should win instead of abstaining to family-level,
        // since showing the base leaf is exactly the outcome we want when one is available.
        const selectableLeaf = firstSelectableLeafInFamily(family, state.preparedQuery, scoredFamilies, state.leafSpecializationKindsCache, branchExpansion.originalQuery);
        return selectableLeaf ? { leaf: selectableLeaf, family } : null;
    })
        .filter((entry) => entry !== null)
        .sort((left, right) => right.leaf.confidence - left.leaf.confidence ||
        right.family.confidence - left.family.confidence ||
        left.leaf.canonicalLabel.localeCompare(right.leaf.canonicalLabel));
    // A leaf can win the cross-family textual comparison above purely on token/role overlap even
    // when its own family is meaningfully weaker than another candidate family that never got to
    // field a leaf. Guard against that by requiring the winning leaf's family to be within
    // LEAF_FIRST_FAMILY_STRENGTH_MARGIN of the strongest scored family, unless the leaf itself is a
    // genuine exact canonical/alias match for the raw query (which should still short-circuit).
    const bestFamilyConfidence = scoredFamilies.reduce((max, family) => Math.max(max, family.confidence), 0);
    const bestFamilyEvidenceTierRank = scoredFamilies.reduce((min, family) => Math.min(min, family.evidenceTierRank), Number.POSITIVE_INFINITY);
    const scoredLeaves = scoredFamilies.flatMap((family) => family.leaves);
    const bestStructuralNetSupport = scoredFamilies.reduce((max, family) => Math.max(max, familyStructureNetSupport(family)), 0);
    const familyStrengthEligibleLeaves = selectableTopLeaves.filter((entry) => familyPassesLeafFirstStructureGate(entry.family, bestStructuralNetSupport) &&
        ((hasRawQueryExactCanonicalOrExactAlias(entry.leaf, state.preparedQuery) &&
            !exactLeafRescueHasBroadSharedAliasRisk(entry.leaf, scoredLeaves, state.preparedQuery, branchExpansion.originalQuery)) ||
            (entry.family.evidenceTierRank <= bestFamilyEvidenceTierRank &&
                entry.family.confidence >= bestFamilyConfidence - PIPELINE_DECISION_GATE.LEAF_FIRST_FAMILY_STRENGTH_MARGIN)));
    const exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner = selectableTopLeaves
        .filter(({ leaf }) => {
        if (!hasLeafRoleGrounding(leaf, state.preparedQuery)) {
            return false;
        }
        if (hasRawQueryFullStringExactCanonical(leaf, state.preparedQuery, branchExpansion.originalQuery)) {
            return true;
        }
        if (!passesCategoryQueryGuards(leaf, state.preparedQuery)) {
            return false;
        }
        return (hasRawQueryCanonicalVariantPhraseMatch(leaf, state.preparedQuery) ||
            hasRawQueryExactLeafAlias(leaf, state.preparedQuery) ||
            hasKnownRolePhraseAliasInQueryRescue(leaf, state.preparedQuery, branchExpansion.roleSpanSelection));
    })
        .filter(({ leaf }) => hasRawQueryFullStringExactCanonical(leaf, state.preparedQuery, branchExpansion.originalQuery) ||
        hasRawQueryCanonicalVariantPhraseMatch(leaf, state.preparedQuery) ||
        !exactLeafRescueHasBroadSharedAliasRisk(leaf, scoredLeaves, state.preparedQuery, branchExpansion.originalQuery))
        .sort((left, right) => compareLeavesForPreparedQuery(left.leaf, right.leaf, state.preparedQuery, branchExpansion.originalQuery) ||
        Number(hasRawQueryCanonicalVariantPhraseMatch(right.leaf, state.preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left.leaf, state.preparedQuery)))[0] ?? null;
    const exactFamilyCanonicalRescue = selectExactFamilyCanonicalRescue(scoredFamilies, branchExpansion.originalQuery);
    if (exactFamilyCanonicalRescue && !exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner) {
        const rescuedFamilyIndex = scoredFamilies.findIndex((family) => family.familyKey === exactFamilyCanonicalRescue.familyKey);
        const reorderedFamilies = rescuedFamilyIndex > 0
            ? [
                scoredFamilies[rescuedFamilyIndex],
                ...scoredFamilies.slice(0, rescuedFamilyIndex),
                ...scoredFamilies.slice(rescuedFamilyIndex + 1)
            ]
            : scoredFamilies;
        const rankedFamilies = reorderedFamilies
            .map((family, index) => ({ ...family, rank: index + 1 }))
            .map((family, index) => applyRecoveredFamilySelectionAuthority(family, index + 1, state.preparedQuery, (f, q) => recoveredFamilySelectionAuthority(f, q, state.leafSpecializationKindsCache)));
        const rankedLeaves = flattenRankedLeaves(rankedFamilies);
        const selectedFamily = rankedFamilies.find((family) => family.familyKey === exactFamilyCanonicalRescue.familyKey) ?? exactFamilyCanonicalRescue;
        return {
            ...state,
            rankedFamilies,
            rankedLeaves,
            decision: {
                decisionType: selectedFamily.familyKind === 'group' ? 'group' : 'family',
                selectedNodeId: selectedFamily.familyNodeId,
                selectedLabel: selectedFamily.familyLabel,
                confidence: selectedFamily.confidence,
                reason: 'an exact family canonical match outranked partial leaf evidence during leaf-first resolution',
                explanation: buildDecisionExplanation({ ...state, rankedFamilies, rankedLeaves }, selectedFamily, selectedFamily.leaves[0] ?? null, 'an exact family canonical match outranked partial leaf evidence during leaf-first resolution')
            },
            stages: appendStage(state, 'resolve_leaf_first_exact_family_canonical')
        };
    }
    const winner = exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner ?? familyStrengthEligibleLeaves[0] ?? null;
    if (!winner) {
        return {
            ...state,
            stages: appendStage(state, 'skip_leaf_first_resolution_no_selectable_leaf')
        };
    }
    const rescuedFamilyIndex = scoredFamilies.findIndex((family) => family.familyKey === winner.family.familyKey);
    const reorderedFamilies = rescuedFamilyIndex > 0
        ? [
            scoredFamilies[rescuedFamilyIndex],
            ...scoredFamilies.slice(0, rescuedFamilyIndex),
            ...scoredFamilies.slice(rescuedFamilyIndex + 1)
        ]
        : scoredFamilies;
    const rankedFamilies = reorderedFamilies
        .map((family, index) => ({ ...family, rank: index + 1 }))
        .map((family, index) => applyRecoveredFamilySelectionAuthority(family, index + 1, state.preparedQuery, (f, q) => recoveredFamilySelectionAuthority(f, q, state.leafSpecializationKindsCache)));
    const rankedLeaves = flattenRankedLeaves(rankedFamilies);
    const winningFamily = rankedFamilies.find((family) => family.familyKey === winner.family.familyKey) ?? rankedFamilies[0] ?? null;
    return {
        ...state,
        rankedFamilies,
        rankedLeaves,
        decision: {
            decisionType: 'leaf',
            selectedNodeId: winner.leaf.graphNodeId,
            selectedLabel: winner.leaf.canonicalLabel,
            confidence: winner.leaf.confidence,
            reason: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner !== null
                ? 'a leaf cleared the exact leaf canonical-or-alias rescue gate during leaf-first global resolution'
                : 'leaf-first global resolution selected the best structurally eligible leaf across all candidate families',
            explanation: buildDecisionExplanation({ ...state, rankedFamilies, rankedLeaves }, winningFamily, winner.leaf, exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner !== null
                ? 'a leaf cleared the exact leaf canonical-or-alias rescue gate during leaf-first global resolution'
                : 'leaf-first global resolution selected the best structurally eligible leaf across all candidate families')
        },
        stages: appendStage(state, 'resolve_leaf_first')
    };
}
async function applyReviewedFamilySignalStage(state) {
    const reviewedSignalsArtifact = loadOccupationReviewedFamilySignalsArtifactRequired();
    const matches = findReviewedFamilySignalMatches(state.preparedQuery, reviewedSignalsArtifact.artifact);
    if (matches.length === 0) {
        return {
            ...state,
            stages: appendStage(state, 'skip_reviewed_family_signals')
        };
    }
    let appliedCount = 0;
    for (const match of matches) {
        const family = match.rule.action === 'support'
            ? (() => {
                const familyKey = `family:${match.rule.familyNodeId}`;
                let existingFamily = state.candidateFamilies.get(familyKey);
                if (!existingFamily) {
                    existingFamily = buildRuntimeFamilyCandidate({
                        familyNodeId: match.rule.familyNodeId,
                        familyLabel: match.rule.familyLabel
                    });
                    state.candidateFamilies.set(familyKey, existingFamily);
                }
                return existingFamily;
            })()
            : state.candidateFamilies.get(`family:${match.rule.familyNodeId}`);
        if (!family) {
            continue;
        }
        family.evidence.push(reviewedFamilySignalEvidence(match));
        appliedCount += 1;
    }
    return {
        ...state,
        stages: appendStage(state, appliedCount > 0 ? 'apply_reviewed_family_signals' : 'skip_reviewed_family_signals_no_targets')
    };
}
function hasAuthoritativeAliasEvidence(branchExpansion) {
    return branchExpansion.candidates.some((candidate) => candidate.evidence.some((evidence) => evidence.channel === 'exact_canonical' || (evidence.channel === 'exact_alias' && evidence.aliasRole === 'canonical_label')));
}
function appendStage(state, stage) {
    return [...state.stages, stage];
}
export function isFamilyProfileRetrievalEnabled() {
    const disableValue = readOptionalEnv('OSE_DISABLE_FAMILY_PROFILE_RETRIEVAL')?.toLowerCase();
    if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
        return false;
    }
    const enableValue = readOptionalEnv('OSE_ENABLE_FAMILY_PROFILE_RETRIEVAL')?.toLowerCase();
    return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}
function chooseBetterAttempt(primary, fallback) {
    const primaryDecision = primary.state.decision;
    const fallbackDecision = fallback.state.decision;
    if (primaryDecision.decisionType === 'unresolved' && fallbackDecision.decisionType === 'unresolved') {
        return compareAttemptCoverage(primary, fallback) > 0 ? fallback : primary;
    }
    if (fallbackDecision.decisionType === 'unresolved') {
        return primary;
    }
    if (primaryDecision.decisionType === 'unresolved') {
        return fallback;
    }
    if (fallbackDecision.confidence >= primaryDecision.confidence + PIPELINE_DECISION_GATE.FALLBACK_REPLACEMENT_MARGIN) {
        return fallback;
    }
    return primary;
}
function compareAttemptCoverage(left, right) {
    const leftCoverage = buildCoverageStatus(left.state.decision, left.state.rankedFamilies[0] ?? null, left.state.preparedQuery);
    const rightCoverage = buildCoverageStatus(right.state.decision, right.state.rankedFamilies[0] ?? null, right.state.preparedQuery);
    return (leftCoverage.signals.missingUsefulTokens.length - rightCoverage.signals.missingUsefulTokens.length ||
        leftCoverage.signals.missingRoleTokens.length - rightCoverage.signals.missingRoleTokens.length ||
        right.state.decision.confidence - left.state.decision.confidence ||
        (right.state.rankedFamilies[0]?.confidence ?? 0) - (left.state.rankedFamilies[0]?.confidence ?? 0));
}
function summarizeAttempt(attempt, kind, result, status, reason) {
    const branchExpansion = result.state.branchExpansion;
    return {
        attempt,
        kind,
        query: branchExpansion.query,
        status,
        decisionType: result.state.decision.decisionType,
        confidence: result.state.decision.confidence,
        reason
    };
}
function buildDebugFamilyRankOutputDecision(state) {
    const topFamily = state.rankedFamilies[0] ?? null;
    return {
        decisionType: 'unresolved',
        selectedNodeId: null,
        selectedLabel: null,
        confidence: topFamily?.confidence ?? 0,
        reason: 'debug_family_rank_output stopped after family consolidation before leaf recovery',
        explanation: {
            query: state.preparedQuery.raw,
            normalizedQuery: state.preparedQuery.normalized,
            roleTokens: state.preparedQuery.intent.roleTokens,
            roleHeadTokens: state.preparedQuery.intent.roleHeadTokens,
            genericTokens: state.preparedQuery.genericTokens,
            candidateFamily: topFamily
                ? {
                    label: topFamily.familyLabel,
                    evidenceTier: topFamily.evidenceTier,
                    confidence: topFamily.confidence
                }
                : null,
            candidateLeaf: null,
            rejectedCompetitors: [],
            finalDecisionGate: 'debug-only family ranking comparison; leaf recovery and final selection were not run'
        }
    };
}
function toPipelineResult(attempt, attempts, localeOverride) {
    const state = attempt.state;
    const branchExpansion = state.branchExpansion;
    return {
        queryContext: queryContextFromBranchExpansion(branchExpansion, {
            jobFunction: state.jobFunction,
            locale: localeOverride
        }),
        preparedQuery: state.preparedQuery,
        decision: state.decision,
        coverageStatus: buildCoverageStatus(state.decision, state.rankedFamilies[0] ?? null, state.preparedQuery),
        spanResults: [],
        rankedFamilies: state.rankedFamilies,
        rankedLeaves: state.rankedLeaves,
        debug: {
            ...attempt.debug,
            attempts,
            timings: state.timings,
            rawBranchExpansion: attempt.debug.rawBranchExpansion
        }
    };
}
function toMultiSpanPipelineResult(primaryRetrievalQuery, retrievalResults, spanResults, jobFunction) {
    const branchExpansion = {
        ...retrievalResults[0],
        originalQuery: primaryRetrievalQuery.originalQuery,
        query: primaryRetrievalQuery.query,
        querySpans: primaryRetrievalQuery.querySpans,
        keptQuerySignals: primaryRetrievalQuery.keptQuerySignals,
        roleSpanSelection: primaryRetrievalQuery.roleSpanSelection
    };
    const confidence = spanResults.length === 0 ? 0 : roundScore(spanResults.reduce((sum, span) => sum + span.decision.confidence, 0) / spanResults.length);
    const preparedQuery = emptyPreparedQuery(branchExpansion);
    const decision = {
        decisionType: 'multi_span',
        selectedNodeId: null,
        selectedLabel: null,
        confidence,
        reason: 'query preparation split the submitted title into multiple independent occupation spans',
        explanation: {
            query: primaryRetrievalQuery.originalQuery,
            normalizedQuery: preparedQuery.normalized,
            roleTokens: [],
            roleHeadTokens: [],
            genericTokens: [],
            candidateFamily: null,
            candidateLeaf: null,
            rejectedCompetitors: [],
            finalDecisionGate: 'multi-span queries resolve each span independently; see spanResults for per-span explanations'
        }
    };
    const mergedRetrievalTimings = mergeMultiSpanRetrievalTimings(retrievalResults);
    return {
        queryContext: queryContextFromBranchExpansion(branchExpansion, {
            scannedAliasHitCount: sumSpanMetric(spanResults, (span) => span.scannedAliasHitCount),
            scannedOpenSearchHitCount: sumSpanMetric(spanResults, (span) => span.scannedOpenSearchHitCount),
            jobFunction
        }),
        preparedQuery,
        decision,
        coverageStatus: multiSpanCoverageStatus(spanResults),
        spanResults,
        rankedFamilies: [],
        rankedLeaves: [],
        debug: {
            stages: ['query_signal_split', 'resolve_independent_spans'],
            attempts: spanResults.map((span) => ({
                attempt: span.spanIndex,
                kind: 'primary',
                query: span.query,
                status: 'used',
                decisionType: span.decision.decisionType,
                confidence: span.decision.confidence,
                reason: 'independent occupation span'
            })),
            timings: mergeSpanTimings(mergedRetrievalTimings, spanResults),
            rawBranchExpansion: spanResults.some((span) => span.debug.rawBranchExpansion !== null) ? branchExpansion : null,
            candidatePoolTrace: spanResults.flatMap((span) => span.debug.candidatePoolTrace),
            familyProfileHits: spanResults.flatMap((span) => span.debug.familyProfileHits),
            leafFirstFamilies: spanResults.flatMap((span) => span.debug.leafFirstFamilies),
            familyRankComparison: spanResults.flatMap((span) => span.debug.familyRankComparison),
            familyStructure: spanResults.flatMap((span) => span.debug.familyStructure)
        }
    };
}
function summarizeMultiSpanSpanDecision(result) {
    if (result.decision.decisionType !== 'leaf' || result.rankedFamilies.length === 0) {
        return result.decision;
    }
    if (result.coverageStatus.status === 'exact_canonical_match') {
        return result.decision;
    }
    const topFamily = result.rankedFamilies[0];
    if (!topFamily) {
        return result.decision;
    }
    return {
        ...result.decision,
        decisionType: 'family',
        selectedNodeId: topFamily.familyNodeId,
        selectedLabel: topFamily.familyLabel,
        confidence: topFamily.confidence,
        reason: 'multi-span span summary prefers the safer family result when the top leaf remains a closest-available match'
    };
}
function mergeMultiSpanRetrievalTimings(retrievalResults) {
    const timings = {};
    for (const [index, retrievalResult] of retrievalResults.entries()) {
        const prefix = `span_${index + 1}.retrieval`;
        for (const [key, elapsedMs] of Object.entries(retrievalResult.timings)) {
            timings[`${prefix}.${key}`] = elapsedMs;
        }
    }
    return timings;
}
function queryContextFromBranchExpansion(branchExpansion, scannedCounts = {}) {
    return {
        originalQuery: branchExpansion.originalQuery,
        query: branchExpansion.query,
        querySpans: branchExpansion.querySpans,
        locale: scannedCounts.locale ?? branchExpansion.locale,
        keptQuerySignals: branchExpansion.keptQuerySignals,
        roleSpanSelection: branchExpansion.roleSpanSelection,
        sourceName: branchExpansion.sourceName,
        limit: branchExpansion.limit,
        siblingLimit: branchExpansion.siblingLimit,
        evaluationQueryId: branchExpansion.evaluationQueryId,
        scannedAliasHitCount: scannedCounts.scannedAliasHitCount ?? branchExpansion.scannedAliasHitCount,
        scannedOpenSearchHitCount: scannedCounts.scannedOpenSearchHitCount ?? branchExpansion.scannedOpenSearchHitCount,
        jobFunction: scannedCounts.jobFunction ?? null
    };
}
function multiSpanCoverageStatus(spanResults) {
    const resolvedSpanCount = spanResults.filter((span) => span.decision.decisionType !== 'unresolved').length;
    return {
        exactCanonicalAvailable: false,
        closestMatchAvailable: resolvedSpanCount > 0,
        likelyDictionaryGap: false,
        crossLocaleBackboneSupported: spanResults.some((span) => span.coverageStatus.crossLocaleBackboneSupported),
        crossLocaleFamilyOnly: false,
        status: 'multi_span',
        summary: `${resolvedSpanCount}/${spanResults.length} occupation spans produced a family or leaf result.`,
        signals: emptyCoverageSignals()
    };
}
function emptyCoverageSignals() {
    return {
        topLeafCanonicalTerm: null,
        topFamilyCanonicalTerm: null,
        topFamilyEvidenceTier: null,
        matchedLabel: null,
        matchedLabelSource: null,
        matchedUsefulTokens: [],
        missingUsefulTokens: [],
        roleTokens: [],
        roleHeadTokens: [],
        domainTokens: [],
        matchedRoleTokens: [],
        missingRoleTokens: [],
        matchedDomainTokens: [],
        intentConfidence: 0
    };
}
function sumSpanMetric(spanResults, read) {
    return spanResults.reduce((sum, span) => sum + read(span), 0);
}
function mergeSpanTimings(primaryTimings, spanResults) {
    const timings = { ...primaryTimings };
    for (const span of spanResults) {
        for (const [key, elapsedMs] of Object.entries(span.debug.timings)) {
            timings[`span_${span.spanIndex}.${key}`] = elapsedMs;
        }
    }
    return timings;
}
function emptyPreparedQuery(branchExpansion) {
    return {
        raw: branchExpansion.query,
        locale: normalizeQueryLocale(branchExpansion.locale),
        normalized: '',
        surfaceTokens: [],
        tokens: [],
        usefulRecallTokens: [],
        usefulVariantTokens: [],
        folded: '',
        foldedTokens: [],
        usefulFoldedRecallTokens: [],
        genericTokens: [],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: [],
        acronymTokens: [],
        compoundExpandedTokens: [],
        usefulFoldedVariantTokens: [],
        compoundExpandedFoldedTokens: [],
        capabilityVerbFoldedAdditionTokens: [],
        intent: {
            roleTokens: [],
            roleHeadTokens: [],
            altRoleHeadTokens: [],
            roleModifierTokens: [],
            altRoleModifierTokens: [],
            genericRoleHeadTokens: [],
            authoritativeRoleHeadTokens: [],
            occupationClassPreference: {
                preferredFamilyGroups: [],
                disfavoredFamilyGroups: []
            },
            roleHeadRequiresContext: false,
            roleHeadHasContext: false,
            venueTokens: [],
            domainTokens: [],
            seniorityTokens: [],
            credentialTokens: [],
            ambiguousTokens: [],
            unresolvedModifierTokens: [],
            confidence: 0,
            diagnostics: []
        },
        isGenericShape: false
    };
}
function buildCoverageStatus(decision, topFamily, preparedQuery) {
    const topLeaf = topFamily?.leaves[0] ?? null;
    const closeness = topLeaf?.closeness ?? null;
    const signals = coverageSignals(topLeaf, topFamily, preparedQuery);
    const crossLocaleBackboneSupported = topFamily?.evidenceTier === 'cross_locale_backbone' ||
        Boolean(topFamily?.evidence.some((record) => record.channel === 'cross_locale_english_backbone'));
    const crossLocaleFamilyOnly = Boolean(crossLocaleBackboneSupported && (decision.decisionType === 'family' || decision.decisionType === 'group'));
    const exactCanonicalAvailable = Boolean(decision.decisionType === 'leaf' &&
        topLeaf &&
        (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
            (closeness?.matchedLabelSource === 'canonical' && (closeness.exactNormalizedLabel || closeness.exactFoldedLabel))));
    const closestMatchAvailable = Boolean(topLeaf || topFamily);
    const hasUnrepresentedQueryTerms = Boolean(closeness && (closeness.missingUsefulTokens.length > 0 || signals.missingRoleTokens.length > 0));
    const likelyDictionaryGap = Boolean(closestMatchAvailable &&
        !exactCanonicalAvailable &&
        hasUnrepresentedQueryTerms &&
        (decision.decisionType === 'family' || decision.decisionType === 'group' || decision.decisionType === 'unresolved'));
    if (!closestMatchAvailable) {
        return coverageStatus(topLeaf, topFamily, {
            status: 'insufficient_evidence',
            summary: 'No reliable family or leaf candidate was found.'
        }, preparedQuery);
    }
    if (exactCanonicalAvailable) {
        return coverageStatus(topLeaf, topFamily, {
            status: 'exact_canonical_match',
            exactCanonicalAvailable: true,
            crossLocaleBackboneSupported,
            summary: 'The query matched an available canonical occupation leaf exactly.'
        }, preparedQuery);
    }
    if (crossLocaleFamilyOnly) {
        return coverageStatus(topLeaf, topFamily, {
            status: 'cross_locale_family_only',
            crossLocaleBackboneSupported,
            crossLocaleFamilyOnly: true,
            summary: 'English backbone support helped select the broader family, but local leaf evidence is not strong enough to select one leaf.'
        }, preparedQuery);
    }
    if (likelyDictionaryGap) {
        return coverageStatus(topLeaf, topFamily, {
            status: crossLocaleBackboneSupported ? 'locale_gap' : 'likely_dictionary_gap',
            likelyDictionaryGap: true,
            crossLocaleBackboneSupported,
            summary: crossLocaleBackboneSupported
                ? 'English backbone support found a broader match, but local leaf coverage is incomplete.'
                : 'A broader/closest match is available, but the top leaf does not represent all useful query terms.'
        }, preparedQuery);
    }
    if (crossLocaleBackboneSupported) {
        return coverageStatus(topLeaf, topFamily, {
            status: 'english_backbone_supported',
            crossLocaleBackboneSupported,
            summary: 'The result is supported by local evidence plus English backbone evidence from the same occupation graph.'
        }, preparedQuery);
    }
    return coverageStatus(topLeaf, topFamily, {
        status: 'closest_available_match',
        crossLocaleBackboneSupported,
        summary: 'The result is the closest available canonical match found in the current occupation graph.'
    }, preparedQuery);
}
function coverageStatus(topLeaf, topFamily, overrides, preparedQuery) {
    return {
        exactCanonicalAvailable: false,
        closestMatchAvailable: Boolean(topLeaf || topFamily),
        likelyDictionaryGap: false,
        crossLocaleBackboneSupported: false,
        crossLocaleFamilyOnly: false,
        ...overrides,
        signals: coverageSignals(topLeaf, topFamily, preparedQuery)
    };
}
function coverageSignals(topLeaf, topFamily, preparedQuery) {
    const labelCorpus = [
        topLeaf?.canonicalLabel ?? '',
        topLeaf?.closeness?.matchedLabel ?? '',
        ...(topLeaf ? matchedAliasLabels(topLeaf.evidence) : []),
        topFamily?.familyLabel ?? ''
    ];
    const roleMatch = matchedIntentTokens(preparedQuery.intent.roleTokens, labelCorpus);
    const domainMatch = matchedIntentTokens(preparedQuery.intent.domainTokens, labelCorpus);
    return {
        topLeafCanonicalTerm: topLeaf?.canonicalLabel ?? null,
        topFamilyCanonicalTerm: topFamily?.familyLabel ?? null,
        topFamilyEvidenceTier: topFamily?.evidenceTier ?? null,
        matchedLabel: topLeaf?.closeness?.matchedLabel ?? null,
        matchedLabelSource: topLeaf?.closeness?.matchedLabelSource ?? null,
        matchedUsefulTokens: topLeaf?.closeness?.matchedUsefulTokens ?? [],
        missingUsefulTokens: topLeaf?.closeness?.missingUsefulTokens ?? [],
        roleTokens: preparedQuery.intent.roleTokens,
        roleHeadTokens: preparedQuery.intent.roleHeadTokens,
        domainTokens: preparedQuery.intent.domainTokens,
        matchedRoleTokens: roleMatch.matched,
        missingRoleTokens: roleMatch.missing,
        matchedDomainTokens: domainMatch.matched,
        intentConfidence: preparedQuery.intent.confidence
    };
}
async function accumulateCurrentRetrievalEvidenceStage(state) {
    const branchExpansion = requireBranchExpansion(state);
    const searchMetaArtifact = branchExpansion.locale === 'en'
        ? null
        : await timed(() => loadOccupationSearchMetaArtifactRequired(branchExpansion.sourceName), 'pipeline.cross_locale.search_meta_artifact_load', state.timings);
    const totalBranchScore = branchExpansion.branches.reduce((total, branch) => total + branch.scoreSummary.totalCandidateScore, 0);
    const sortedBranches = [...branchExpansion.branches].sort((left, right) => right.scoreSummary.totalCandidateScore - left.scoreSummary.totalCandidateScore);
    const [topBranch, secondBranch] = sortedBranches;
    for (const branch of branchExpansion.branches) {
        const bestOtherBranch = (topBranch?.branchKey === branch.branchKey ? secondBranch : topBranch) ?? null;
        const branchShare = totalBranchScore > 0 ? roundScore(branch.scoreSummary.totalCandidateScore / totalBranchScore) : 0;
        const branchMarginRatio = bestOtherBranch && bestOtherBranch.scoreSummary.totalCandidateScore > 0
            ? roundScore(branch.scoreSummary.totalCandidateScore / bestOtherBranch.scoreSummary.totalCandidateScore)
            : null;
        let family = state.candidateFamilies.get(branch.branchKey);
        if (!family) {
            family = buildBranchFamilyCandidate(branch, branchShare, branchMarginRatio);
            state.candidateFamilies.set(branch.branchKey, family);
        }
        family.evidence.push({
            channel: 'graph_support',
            score: branchShare,
            sourceStage: 'graph_branch',
            details: {
                branch_margin_ratio: branchMarginRatio,
                candidate_count: branch.candidates.length,
                total_candidate_score: branch.scoreSummary.totalCandidateScore
            }
        });
        for (const candidate of branch.candidates) {
            let leaf = state.candidateLeafs.get(candidate.graphNodeId);
            if (!leaf) {
                leaf = buildLeafCandidate(state, branch, candidate);
                state.candidateLeafs.set(candidate.graphNodeId, leaf);
            }
            family.supportingLeafIds.add(candidate.graphNodeId);
            for (const evidence of candidate.evidence) {
                const record = toPipelineEvidenceRecord(evidence.channel, evidence.score, evidence.details ?? {}, evidence);
                leaf.evidence.push(record);
                family.evidence.push({
                    ...record,
                    details: {
                        ...record.details,
                        graph_node_id: candidate.graphNodeId,
                        canonical_label: candidate.canonicalLabel
                    }
                });
                const crossLocaleSearchMetaRecord = searchMetaArtifact?.getCoreRecord(candidate.graphNodeId) ?? null;
                const hydratedCrossLocaleSearchMetaRecord = searchMetaArtifact && crossLocaleSearchMetaRecord
                    ? await hydrateRuntimeSearchMetaRecord(searchMetaArtifact, crossLocaleSearchMetaRecord)
                    : null;
                const crossLocaleEvidence = buildCrossLocaleEnglishBackboneEvidence(record, candidate.graphNodeId, candidate.canonicalLabel, hydratedCrossLocaleSearchMetaRecord);
                if (crossLocaleEvidence) {
                    family.evidence.push(crossLocaleEvidence);
                }
            }
        }
    }
    enrichWithLeafFit(Array.from(state.candidateLeafs.values()), state.roleClosenessQuery);
    return {
        ...state,
        stages: appendStage(state, 'accumulate_current_retrieval_evidence')
    };
}
async function consolidateFamiliesStage(state) {
    const sourceName = requireBranchExpansion(state).sourceName;
    const candidateFamilies = structurallyAugmentedFamilyCandidates(state);
    const rankedFamilies = state.familyRankingStrategy.rankForRecovery(state.familyStructurePreparedQuery, sourceName, state.topFamilyLimit, candidateFamilies, groupCandidateLeavesByFamilyKey(state.candidateLeafs), state.jobFunction);
    return {
        ...state,
        rankedFamilies,
        stages: appendStage(state, 'consolidate_families')
    };
}
function structurallyAugmentedFamilyCandidates(state) {
    const families = Array.from(state.candidateFamilies.values()).filter((family) => getFamilyStructureRule(family.familyNodeId) !== undefined);
    const existingFamilyKeys = new Set(families.map((family) => family.familyKey));
    const structuralCandidates = shortlistFamilyStructureMatches(familyStructureQueryTokens(state.familyStructurePreparedQuery), state.familyStructurePreparedQuery.locale, {
        limit: 4
    }).candidates;
    for (const candidate of structuralCandidates) {
        if (candidate.structuralScore < 15) {
            continue;
        }
        const hasRoleGrounding = candidate.supportDimensions.includes('role_heads') || candidate.supportDimensions.includes('activities');
        const hasContextGrounding = candidate.supportDimensions.includes('knowledge_domains') ||
            candidate.supportDimensions.includes('work_objects') ||
            candidate.supportDimensions.includes('settings') ||
            candidate.supportDimensions.includes('population_or_channel');
        if (!hasRoleGrounding || !hasContextGrounding) {
            continue;
        }
        const familyKey = `family:${candidate.comparison.familyNodeId}`;
        if (existingFamilyKeys.has(familyKey)) {
            continue;
        }
        families.push({
            familyKey,
            familyKind: 'family',
            familyNodeId: candidate.comparison.familyNodeId,
            familyLabel: candidate.comparison.familyLabel,
            evidence: [
                {
                    channel: 'family_structure',
                    score: Math.min(1, candidate.structuralScore / 25),
                    sourceStage: 'family_structure_shortlist',
                    details: {
                        structural_score: candidate.structuralScore,
                        support_dimensions: candidate.supportDimensions,
                        soft_contradiction_dimensions: candidate.softContradictionDimensions,
                        aligned_dimensions: candidate.comparison.alignedDimensions,
                        contradicted_dimensions: candidate.comparison.contradictedDimensions
                    }
                }
            ],
            supportingLeafIds: new Set(),
            branchShare: 0,
            branchMarginRatio: null,
            evidenceTier: null,
            evidenceTierRank: Number.POSITIVE_INFINITY,
            score: 0,
            confidence: 0
        });
        existingFamilyKeys.add(familyKey);
    }
    return families;
}
async function recoverLeavesInsideTopFamiliesStage(state) {
    if (state.rankedFamilies.length === 0) {
        return {
            ...state,
            stages: appendStage(state, 'recover_leaves_inside_top_families')
        };
    }
    const familyIds = state.rankedFamilies.filter((family) => family.familyKind === 'family').map((family) => family.familyNodeId);
    if (familyIds.length === 0) {
        return {
            ...state,
            stages: appendStage(state, 'recover_leaves_inside_top_families')
        };
    }
    const branchExpansion = requireBranchExpansion(state);
    const searchMetaArtifact = await timed(() => loadOccupationSearchMetaArtifactRequired(branchExpansion.sourceName), 'pipeline.family_recovery.search_meta_artifact_load', state.timings);
    const recoveredRecords = await timed(() => searchMetaArtifact.getLeafCoreRecordsForFamilies(familyIds), 'pipeline.family_recovery.load_family_leaf_records', state.timings);
    const hydratedRecoveredRecords = await timed(() => hydrateRuntimeSearchMetaRecords(searchMetaArtifact, recoveredRecords), 'pipeline.family_recovery.hydrate_leaf_details', state.timings);
    const aliasesByNodeId = await timed(() => loadLeafAliasesFromRecords(hydratedRecoveredRecords, state.preparedQuery.locale), 'pipeline.family_recovery.load_leaf_aliases', state.timings);
    const capabilityLabelsByNodeId = await timed(() => loadLeafCapabilityLabelsFromRecords(hydratedRecoveredRecords, state.preparedQuery.locale), 'pipeline.family_recovery.load_capability_labels', state.timings);
    const lexicalHitsByNodeId = await timed(() => retrieveLexicalFamilyHits(state, familyIds, state.occupationRetriever), 'pipeline.family_recovery.lexical_family_hits', state.timings);
    const familiesByKey = new Map(state.rankedFamilies.map((family) => [family.familyKey, family]));
    const newlyRecoveredLeafs = [];
    for (const record of recoveredRecords) {
        if (record.familyNodeId === null || record.familyLabel === null) {
            continue;
        }
        const familyKey = `family:${record.familyNodeId}`;
        const family = familiesByKey.get(familyKey);
        if (!family) {
            continue;
        }
        const existing = state.candidateLeafs.get(record.graphNodeId);
        const lexicalHit = lexicalHitsByNodeId.get(record.graphNodeId) ?? null;
        if (existing) {
            if (lexicalHit) {
                existing.evidence.push(lexicalFamilyEvidence(lexicalHit));
            }
            continue;
        }
        const evidence = [...(lexicalHit ? [lexicalFamilyEvidence(lexicalHit)] : [])];
        if (evidence.length === 0) {
            evidence.push({
                channel: 'graph_family_recovery',
                score: family.confidence,
                sourceStage: 'family_constrained_recovery',
                details: {
                    family_node_id: record.familyNodeId,
                    family_label: record.familyLabel
                }
            });
        }
        const recoveredLeaf = {
            graphNodeId: record.graphNodeId,
            canonicalLabel: record.canonicalLabel,
            familyKey,
            familyKind: 'family',
            familyNodeId: record.familyNodeId,
            familyLabel: record.familyLabel,
            genericRisk: record.genericRisk,
            hasHierarchy: record.hasHierarchy,
            hasCapabilitySupport: record.hasCapabilitySupport,
            leafFitScore: null,
            leafStructure: stateLeafStructure(state, record.graphNodeId),
            evidence,
            closeness: null,
            familyScopedFit: null,
            capabilityFit: null,
            selectionEvidence: null,
            score: 0,
            confidence: 0
        };
        state.candidateLeafs.set(record.graphNodeId, recoveredLeaf);
        newlyRecoveredLeafs.push(recoveredLeaf);
    }
    enrichWithLeafFit(newlyRecoveredLeafs, state.roleClosenessQuery);
    const recoveredLeafCountsByFamilyKey = countCandidateLeavesByFamilyKey(state.candidateLeafs);
    return {
        ...state,
        recoveredAliasesByNodeId: mergeStringMap(state.recoveredAliasesByNodeId, aliasesByNodeId),
        recoveredCapabilityLabelsByNodeId: mergeStringMap(state.recoveredCapabilityLabelsByNodeId, capabilityLabelsByNodeId),
        rankedFamilies: state.rankedFamilies.map((family) => ({
            ...family,
            supportingLeafCount: recoveredLeafCountsByFamilyKey.get(family.familyKey) ?? 0
        })),
        stages: appendStage(state, 'recover_leaves_inside_top_families')
    };
}
async function retrieveLexicalFamilyHits(state, familyNodeIds, retriever) {
    const branchExpansion = requireBranchExpansion(state);
    const hitsByNodeId = new Map();
    const surfaceLocales = retrievalSurfaceLocales(branchExpansion.locale);
    // Family-constrained leaf recovery searches role intent only; domain/context terms are support evidence elsewhere.
    const roleQuery = intentRoleQuery(state.preparedQuery);
    for (const surfaceLocale of surfaceLocales) {
        // Same (roleQuery, surfaceLocale, sourceName) is reused for every family below, so prepare once per surface.
        const preparedQuery = await prepareQuery(roleQuery, surfaceLocale, { sourceName: branchExpansion.sourceName });
        const familyHits = await Promise.all(familyNodeIds.map((familyNodeId) => retriever.retrieveWithinFamily({
            locale: surfaceLocale,
            preparedQuery,
            sourceName: branchExpansion.sourceName,
            familyNodeId,
            limit: Math.max(state.topLeavesPerFamily * 4, 25)
        })));
        for (const hits of familyHits) {
            for (const hit of hits) {
                const existing = hitsByNodeId.get(hit.graphNodeId);
                if (!existing || hit.score > existing.score) {
                    hitsByNodeId.set(hit.graphNodeId, hit);
                }
            }
        }
    }
    return hitsByNodeId;
}
function lexicalFamilyEvidence(hit) {
    return {
        channel: 'lexical',
        score: hit.score,
        sourceStage: 'lexical_family_constrained',
        details: {
            raw_score: hit.rawScore,
            normalized_raw_score: hit.normalizedRawScore,
            lexical_signal_score: hit.lexicalSignalScore,
            matched_queries: hit.matchedQueries,
            matched_fields: hit.matchedFields,
            matched_tokens: hit.matchedTokens,
            phrase_match: hit.phraseMatch,
            field_signals: hit.fieldSignals,
            max_useful_token_coverage: hit.maxUsefulTokenCoverage,
            query_token_count: hit.queryTokenCount,
            useful_query_token_count: hit.usefulQueryTokenCount
        }
    };
}
async function narrowLeavesWithinFamiliesStage(state) {
    const branchExpansion = requireBranchExpansion(state);
    const candidateLeavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const leafPoolTraceEntries = [];
    const narrowedFamilies = state.rankedFamilies.map((family) => {
        const orderedLeaves = state.leafRankingStrategy.rank({
            preparedQuery: state.preparedQuery,
            roleClosenessQuery: state.roleClosenessQuery,
            roleFamilyScopedFoldedTokens: state.roleFamilyScopedFoldedTokens,
            roleCapabilityVerbFoldedAdditionTokens: state.roleCapabilityVerbFoldedAdditionTokens,
            exactQueryText: branchExpansion.originalQuery,
            family,
            leaves: candidateLeavesByFamilyKey.get(family.familyKey) ?? [],
            recoveredAliasesByNodeId: state.recoveredAliasesByNodeId,
            recoveredCapabilityLabelsByNodeId: state.recoveredCapabilityLabelsByNodeId
        }).leaves;
        const leaves = orderedLeaves.slice(0, state.topLeavesPerFamily).map((leaf, index) => ({ ...leaf, rank: index + 1 }));
        orderedLeaves.forEach((leaf, index) => {
            leafPoolTraceEntries.push({
                poolKind: 'leaf',
                identifier: leaf.graphNodeId,
                label: leaf.canonicalLabel,
                familyKey: family.familyKey,
                rankBeforeTruncation: index + 1,
                survived: index < state.topLeavesPerFamily,
                discardReason: index < state.topLeavesPerFamily ? null : 'below_top_leaves_per_family_limit'
            });
        });
        return {
            ...family,
            leaves
        };
    });
    const authorityRankedFamilies = state.familyRankingStrategy.rankForSelection(state.familyStructurePreparedQuery, narrowedFamilies, (family, query) => recoveredFamilySelectionAuthority(family, query, state.leafSpecializationKindsCache), isBroadRoleQuery, compareBroadRoleFamilies);
    const rankedFamilies = promoteExactLeafRescueFamily(authorityRankedFamilies, flattenRankedLeaves(authorityRankedFamilies), state.preparedQuery, branchExpansion.originalQuery);
    const rankedLeaves = flattenRankedLeaves(rankedFamilies);
    return {
        ...state,
        rankedFamilies,
        rankedLeaves,
        stages: appendStage(state, 'narrow_leaves_within_families')
    };
}
function flattenRankedLeaves(families) {
    return families.flatMap((family) => family.leaves.map((leaf) => ({ ...leaf })));
}
function groupCandidateLeavesByFamilyKey(candidateLeafs) {
    const grouped = new Map();
    for (const leaf of candidateLeafs.values()) {
        const leaves = grouped.get(leaf.familyKey);
        if (leaves) {
            leaves.push(leaf);
            continue;
        }
        grouped.set(leaf.familyKey, [leaf]);
    }
    return grouped;
}
function debugBuildLeafFirstFamilyDebugEntriesFromState(state) {
    if (state.candidateLeafs.size === 0) {
        return [];
    }
    const branchExpansion = requireBranchExpansion(state);
    const leavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const candidateFamilies = Array.from(leavesByFamilyKey.keys())
        .map((familyKey) => state.candidateFamilies.get(familyKey))
        .filter((family) => family !== undefined && getFamilyStructureRule(family.familyNodeId) !== undefined);
    const provisionalFamilies = state.familyRankingStrategy
        .rankForRecovery(state.preparedQuery, branchExpansion.sourceName, candidateFamilies.length, candidateFamilies, leavesByFamilyKey, state.jobFunction)
        .map((family, index) => ({
        ...family,
        rank: index + 1,
        supportingLeafCount: family.supportingLeafCount,
        leaves: state.leafRankingStrategy
            .rank({
            preparedQuery: state.preparedQuery,
            roleClosenessQuery: state.roleClosenessQuery,
            roleFamilyScopedFoldedTokens: state.roleFamilyScopedFoldedTokens,
            roleCapabilityVerbFoldedAdditionTokens: state.roleCapabilityVerbFoldedAdditionTokens,
            exactQueryText: branchExpansion.originalQuery,
            family: {
                ...family,
                rank: index + 1,
                supportingLeafCount: family.supportingLeafCount,
                leaves: []
            },
            leaves: leavesByFamilyKey.get(family.familyKey) ?? [],
            recoveredAliasesByNodeId: state.recoveredAliasesByNodeId,
            recoveredCapabilityLabelsByNodeId: state.recoveredCapabilityLabelsByNodeId
        })
            .leaves.map((leaf, leafIndex) => ({ ...leaf, rank: leafIndex + 1 }))
    }));
    return provisionalFamilies.map((family) => {
        const selectableLeaf = firstSelectableLeafInFamily(family, state.preparedQuery, provisionalFamilies, state.leafSpecializationKindsCache, branchExpansion.originalQuery);
        return {
            rank: family.rank,
            familyKey: family.familyKey,
            familyLabel: family.familyLabel,
            familyNodeId: family.familyNodeId,
            confidence: family.confidence,
            supportingLeafCount: family.supportingLeafCount,
            topLeafLabel: family.leaves[0]?.canonicalLabel ?? null,
            topLeafConfidence: family.leaves[0]?.confidence ?? null,
            selectableLeafLabel: selectableLeaf?.canonicalLabel ?? null,
            selectableLeafConfidence: selectableLeaf?.confidence ?? null
        };
    });
}
function debugBuildFamilyCandidatePoolTraceEntries(state) {
    const sourceName = requireBranchExpansion(state).sourceName;
    const scoredFamilies = state.familyRankingStrategy.rankForRecovery(state.familyStructurePreparedQuery, sourceName, state.candidateFamilies.size, Array.from(state.candidateFamilies.values()), groupCandidateLeavesByFamilyKey(state.candidateLeafs), state.jobFunction);
    const selectedFamilyKeys = new Set(state.rankedFamilies.map((family) => family.familyKey));
    return scoredFamilies.map((family, index) => ({
        poolKind: 'family',
        identifier: family.familyNodeId,
        label: family.familyLabel,
        rankBeforeTruncation: index + 1,
        survived: selectedFamilyKeys.has(family.familyKey),
        discardReason: selectedFamilyKeys.has(family.familyKey) ? null : 'below_top_family_limit'
    }));
}
function debugBuildFamilyRankComparisonEntries(state) {
    if (!state.debugFamilyRankComparisonStrategies || state.debugFamilyRankComparisonStrategies.length === 0) {
        return [];
    }
    const sourceName = requireBranchExpansion(state).sourceName;
    const candidateFamilies = Array.from(state.candidateFamilies.values());
    const candidateLeafsByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const selectedFamilyKeys = new Set(state.rankedFamilies.map((family) => family.familyKey));
    const toEntry = (strategy, family) => ({
        strategy,
        familyKey: family.familyKey,
        familyNodeId: family.familyNodeId,
        familyLabel: family.familyLabel,
        rank: family.rank,
        confidence: family.confidence,
        survived: selectedFamilyKeys.has(family.familyKey)
    });
    const evidenceFamilies = EVIDENCE_PIPELINE_FAMILY_RANKING_STRATEGY.rankForRecovery(state.familyStructurePreparedQuery, sourceName, state.topFamilyLimit, candidateFamilies, candidateLeafsByFamilyKey, state.jobFunction);
    const entries = evidenceFamilies.map((family) => toEntry('evidence', family));
    for (const { name, strategy } of state.debugFamilyRankComparisonStrategies) {
        const comparisonFamilies = strategy.rankForRecovery(state.familyStructurePreparedQuery, sourceName, state.topFamilyLimit, candidateFamilies, candidateLeafsByFamilyKey, state.jobFunction);
        entries.push(...comparisonFamilies.map((family) => toEntry(name, family)));
    }
    return entries;
}
function debugBuildFamilyStructureEntries(state) {
    return state.rankedFamilies.flatMap((family) => {
        if (!getFamilyStructureRule(family.familyNodeId)) {
            return [];
        }
        const comparison = compareFamilyStructureToQuery(family.familyNodeId, familyStructureQueryTokens(state.familyStructurePreparedQuery), state.familyStructurePreparedQuery.locale);
        const rankingScore = familyRankingScore(family);
        return {
            familyKey: family.familyKey,
            familyNodeId: family.familyNodeId,
            familyLabel: family.familyLabel,
            rank: family.rank,
            structuralSupport: rankingScore?.structuralSupport ?? 0,
            structuralContradiction: rankingScore?.structuralContradiction ?? 0,
            structuralRejected: rankingScore?.structuralRejected ?? comparison.hardRejected,
            rawStructuralScore: familyStructureSupportScore(comparison),
            alignedDimensions: [...comparison.alignedDimensions],
            contradictedDimensions: [...comparison.contradictedDimensions],
            rejectionReasons: [...comparison.reasons]
        };
    });
}
function familyPassesLeafFirstStructureGate(family, bestStructuralNetSupport) {
    const rankingScore = familyRankingScore(family);
    if (!rankingScore) {
        return true;
    }
    if (rankingScore.structuralRejected) {
        return false;
    }
    if (bestStructuralNetSupport <= 0) {
        return true;
    }
    return familyStructureNetSupport(family) >= bestStructuralNetSupport - LEAF_FIRST_STRUCTURE_SUPPORT_MARGIN;
}
function familyStructureNetSupport(family) {
    const rankingScore = familyRankingScore(family);
    if (!rankingScore || rankingScore.structuralRejected) {
        return 0;
    }
    return Math.max(0, rankingScore.structuralSupport - rankingScore.structuralContradiction);
}
function familyRankingScore(family) {
    return 'rankingScore' in family && family.rankingScore ? family.rankingScore : null;
}
function familyStructureQueryTokens(preparedQuery) {
    const genericRoleHeads = new Set(preparedQuery.intent.genericRoleHeadTokens.map((token) => foldSearchText(token)));
    const authoritativeRoleHeads = new Set(preparedQuery.intent.authoritativeRoleHeadTokens.map((token) => foldSearchText(token)));
    const tokens = [
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.domainTokens,
        ...preparedQuery.intent.venueTokens,
        ...preparedQuery.intent.authoritativeRoleHeadTokens,
        ...preparedQuery.usefulFoldedRecallTokens
    ];
    for (let index = 0; index < preparedQuery.foldedTokens.length; index += 1) {
        for (const size of [2, 3]) {
            const phrase = preparedQuery.foldedTokens.slice(index, index + size).join(' ');
            if (phrase.length > 0 && phrase.includes(' ')) {
                tokens.push(phrase);
            }
        }
    }
    return Array.from(new Set(tokens)).filter((token) => {
        const foldedToken = foldSearchText(token);
        return token.length > 0 && (!genericRoleHeads.has(foldedToken) || authoritativeRoleHeads.has(foldedToken));
    });
}
const LEAF_FIRST_STRUCTURE_SUPPORT_MARGIN = 0.03;
function debugBuildLeafCandidatePoolTraceEntries(state) {
    const branchExpansion = requireBranchExpansion(state);
    const candidateLeavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const entries = [];
    for (const family of state.rankedFamilies) {
        const orderedLeaves = state.leafRankingStrategy.rank({
            preparedQuery: state.preparedQuery,
            roleClosenessQuery: state.roleClosenessQuery,
            roleFamilyScopedFoldedTokens: state.roleFamilyScopedFoldedTokens,
            roleCapabilityVerbFoldedAdditionTokens: state.roleCapabilityVerbFoldedAdditionTokens,
            exactQueryText: branchExpansion.originalQuery,
            family,
            leaves: candidateLeavesByFamilyKey.get(family.familyKey) ?? [],
            recoveredAliasesByNodeId: state.recoveredAliasesByNodeId,
            recoveredCapabilityLabelsByNodeId: state.recoveredCapabilityLabelsByNodeId
        }).leaves;
        orderedLeaves.forEach((leaf, index) => {
            entries.push({
                poolKind: 'leaf',
                identifier: leaf.graphNodeId,
                label: leaf.canonicalLabel,
                familyKey: family.familyKey,
                rankBeforeTruncation: index + 1,
                survived: index < state.topLeavesPerFamily,
                discardReason: index < state.topLeavesPerFamily ? null : 'below_top_leaves_per_family_limit'
            });
        });
    }
    return entries;
}
function countCandidateLeavesByFamilyKey(candidateLeafs) {
    const counts = new Map();
    for (const leaf of candidateLeafs.values()) {
        counts.set(leaf.familyKey, (counts.get(leaf.familyKey) ?? 0) + 1);
    }
    return counts;
}
function familyProfileHitFromEvidenceRecord(record) {
    if (record.channel !== 'family_profile' && record.channel !== 'exact_family_canonical' && record.channel !== 'useful_exact') {
        return null;
    }
    const familyNodeId = numericDetail(record.details.family_node_id);
    const familyLabel = stringDetail(record.details.family_label);
    if (familyNodeId === null || !familyLabel) {
        return null;
    }
    return {
        familyNodeId,
        familyLabel,
        groupNodeId: numericDetail(record.details.group_node_id),
        groupLabel: stringDetail(record.details.group_label),
        exactFamilyLabelPhrase: record.channel === 'exact_family_canonical',
        usefulFamilyLabelPhrase: record.channel === 'useful_exact',
        score: typeof record.score === 'number' ? record.score : 0,
        coverage: numericDetail(record.details.coverage) ?? 0,
        roleCoverage: numericDetail(record.details.role_coverage) ?? 0,
        domainCoverage: numericDetail(record.details.domain_coverage) ?? 0,
        matchedTerms: stringArrayDetail(record.details.matched_terms),
        missingTerms: stringArrayDetail(record.details.missing_terms),
        matchedRoleTerms: stringArrayDetail(record.details.matched_role_terms),
        missingRoleTerms: stringArrayDetail(record.details.missing_role_terms),
        matchedDomainTerms: stringArrayDetail(record.details.matched_domain_terms),
        matchedSources: stringArrayDetail(record.details.matched_sources),
        matchingLeafIds: numberArrayDetail(record.details.matching_leaf_ids),
        matchingLeafCount: numericDetail(record.details.matching_leaf_count) ?? 0,
        profileLeafCount: numericDetail(record.details.profile_leaf_count) ?? 0
    };
}
function familyProfileHitKey(hit) {
    return [
        hit.familyNodeId,
        hit.exactFamilyLabelPhrase ? 'exact' : hit.usefulFamilyLabelPhrase ? 'useful' : 'profile',
        hit.matchedTerms.join(','),
        hit.matchedSources.join(',')
    ].join('|');
}
// includeEnglishFallback: true here -- this is the pipeline side of the currently-unresolved
// disagreement documented on leafEvidenceAliasLabels in rank-family-leaves-core.ts. cliRankLeaf
// calls the same shared function with false.
function loadLeafAliasesFromRecords(records, locale) {
    const aliasesByNodeId = new Map();
    for (const record of records) {
        const existingAliases = aliasesByNodeId.get(record.graphNodeId) ?? [];
        const recordAliases = leafEvidenceAliasLabels(record.aliases, locale, true);
        aliasesByNodeId.set(record.graphNodeId, Array.from(new Set([...existingAliases, ...recordAliases])));
    }
    return aliasesByNodeId;
}
function loadLeafCapabilityLabelsFromRecords(records, locale) {
    const labelsByNodeId = new Map();
    for (const record of records) {
        const labels = labelsByNodeId.get(record.graphNodeId) ?? [];
        for (const capability of record.capabilityLabels) {
            if (capability.localeCode !== locale && capability.localeCode !== 'en') {
                continue;
            }
            labels.push(capability.label, capability.normalizedLabel);
        }
        labelsByNodeId.set(record.graphNodeId, Array.from(new Set(labels)));
    }
    return labelsByNodeId;
}
function mergeStringMap(left, right) {
    const merged = new Map(left);
    for (const [key, values] of right.entries()) {
        merged.set(key, Array.from(new Set([...(merged.get(key) ?? []), ...values])));
    }
    return merged;
}
// Decision policy (resolution.md #17): exact canonical/alias leaf evidence short-circuits first
// (inside isLeafSelectable and the exact-leaf rescue), then an eligible leaf with strong role-aligned
// evidence that clears the standard confidence gates, then a strongly role-grounded family, else
// unresolved. The question each branch answers is "is this leaf/family sufficiently justified?", not
// "is it the highest-scoring option?" — a leaf/family that only wins on raw score without clearing its
// gate falls through to a weaker decisionType rather than being promoted anyway.
async function selectPipelineDecisionStage(state) {
    const branchExpansion = requireBranchExpansion(state);
    const topFamily = state.rankedFamilies[0] ?? null;
    const topLeaf = topFamily?.leaves[0] ?? null;
    const exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback = selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(state.rankedFamilies, state.rankedLeaves, state.preparedQuery, branchExpansion.originalQuery);
    if (exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback) {
        const rescuedFamily = state.rankedFamilies.find((family) => family.familyKey === exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.familyKey) ?? topFamily;
        return {
            ...state,
            decision: {
                decisionType: 'leaf',
                selectedNodeId: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.graphNodeId,
                selectedLabel: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.canonicalLabel,
                confidence: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.confidence,
                reason: 'a leaf cleared the exact leaf canonical-or-alias rescue gate',
                explanation: buildDecisionExplanation(state, rescuedFamily, exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback, 'a leaf cleared the exact leaf canonical-or-alias rescue gate')
            },
            stages: appendStage(state, 'select_decision')
        };
    }
    const exactFamilyCanonicalRescue = selectExactFamilyCanonicalRescue(state.rankedFamilies, branchExpansion.originalQuery);
    if (exactFamilyCanonicalRescue) {
        return {
            ...state,
            decision: {
                decisionType: exactFamilyCanonicalRescue.familyKind === 'group' ? 'group' : 'family',
                selectedNodeId: exactFamilyCanonicalRescue.familyNodeId,
                selectedLabel: exactFamilyCanonicalRescue.familyLabel,
                confidence: exactFamilyCanonicalRescue.confidence,
                reason: 'a family cleared the narrow exact family canonical rescue gate',
                explanation: buildDecisionExplanation(state, exactFamilyCanonicalRescue, exactFamilyCanonicalRescue.leaves[0] ?? null, 'a family cleared the narrow exact family canonical rescue gate')
            },
            stages: appendStage(state, 'select_decision')
        };
    }
    const topSelectableLeaf = topFamily
        ? firstSelectableLeafInFamily(topFamily, state.preparedQuery, state.rankedFamilies, state.leafSpecializationKindsCache, branchExpansion.originalQuery)
        : null;
    if (topSelectableLeaf && topFamily) {
        return {
            ...state,
            decision: {
                decisionType: 'leaf',
                selectedNodeId: topSelectableLeaf.graphNodeId,
                selectedLabel: topSelectableLeaf.canonicalLabel,
                confidence: topSelectableLeaf.confidence,
                reason: 'top leaf inside top family cleared direct evidence and confidence gates',
                explanation: buildDecisionExplanation(state, topFamily, topSelectableLeaf, 'top leaf inside top family cleared direct evidence and confidence gates')
            },
            stages: appendStage(state, 'select_decision')
        };
    }
    if (topFamily &&
        topFamily.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE &&
        (hasFamilyRoleGrounding(topFamily, state.preparedQuery) ||
            structuralFamilyAuthority(topFamily.familyNodeId, state.familyStructurePreparedQuery) >= 0.7)) {
        return {
            ...state,
            decision: {
                decisionType: topFamily.familyKind === 'group' ? 'group' : 'family',
                selectedNodeId: topFamily.familyNodeId,
                selectedLabel: topFamily.familyLabel,
                confidence: topFamily.confidence,
                reason: 'top family cleared family-first confidence gate; leaf evidence stayed below safe promotion threshold',
                explanation: buildDecisionExplanation(state, topFamily, topLeaf, 'top family cleared family-first confidence gate; leaf evidence stayed below safe promotion threshold')
            },
            stages: appendStage(state, 'select_decision')
        };
    }
    if (topFamily && topLeaf && hasFamilyRoleGrounding(topFamily, state.preparedQuery) && hasPreparedPhraseWindowAnchor(topLeaf)) {
        return {
            ...state,
            decision: {
                decisionType: topFamily.familyKind === 'group' ? 'group' : 'family',
                selectedNodeId: topFamily.familyNodeId,
                selectedLabel: topFamily.familyLabel,
                confidence: topFamily.confidence,
                reason: 'top family had prepared multi-token phrase-window evidence; leaf evidence stayed below safe promotion threshold',
                explanation: buildDecisionExplanation(state, topFamily, topLeaf, 'top family had prepared multi-token phrase-window evidence; leaf evidence stayed below safe promotion threshold')
            },
            stages: appendStage(state, 'select_decision')
        };
    }
    return {
        ...state,
        decision: {
            decisionType: 'unresolved',
            selectedNodeId: null,
            selectedLabel: null,
            confidence: topFamily?.confidence ?? 0,
            reason: 'no family or leaf cleared the V2 pipeline confidence gates',
            explanation: buildDecisionExplanation(state, topFamily, topLeaf, 'no family or leaf cleared the V2 pipeline confidence gates')
        },
        stages: appendStage(state, 'select_decision')
    };
}
// Builds the resolution.md #21 explanation trace entirely from state earlier stages already
// computed — no new scoring or lookups, just surfacing what already decided the outcome.
function buildDecisionExplanation(state, selectedFamily, selectedLeaf, finalDecisionGate) {
    const preparedQuery = state.preparedQuery;
    const rejectedCompetitors = [];
    for (const family of state.rankedFamilies) {
        if (family === selectedFamily) {
            continue;
        }
        rejectedCompetitors.push({
            label: family.familyLabel,
            kind: 'family',
            reason: `rank ${family.rank}, confidence ${family.confidence.toFixed(2)}, evidence tier ${family.evidenceTier ?? 'none'}`
        });
    }
    for (const leaf of state.rankedLeaves) {
        if (leaf === selectedLeaf) {
            continue;
        }
        rejectedCompetitors.push({
            label: leaf.canonicalLabel,
            kind: 'leaf',
            reason: `rank ${leaf.rank}, confidence ${leaf.confidence.toFixed(2)}, role compatibility ${roleCompatibility(leaf, preparedQuery)}, specialization support ${leafSpecializationSupport(leaf, preparedQuery)}`
        });
    }
    return {
        query: preparedQuery.raw,
        normalizedQuery: preparedQuery.normalized,
        roleTokens: preparedQuery.intent.roleTokens,
        roleHeadTokens: authoritativeIntentRoleHeadTokens(preparedQuery),
        genericTokens: preparedQuery.genericTokens,
        candidateFamily: selectedFamily
            ? { label: selectedFamily.familyLabel, evidenceTier: selectedFamily.evidenceTier, confidence: selectedFamily.confidence }
            : null,
        candidateLeaf: selectedLeaf
            ? {
                label: selectedLeaf.canonicalLabel,
                evidenceTier: selectedLeaf.selectionEvidence?.tier ?? null,
                confidence: selectedLeaf.confidence,
                roleCompatibility: roleCompatibility(selectedLeaf, preparedQuery),
                specializationSupport: leafSpecializationSupport(selectedLeaf, preparedQuery)
            }
            : null,
        rejectedCompetitors,
        finalDecisionGate
    };
}
// Authority level: exact leaf evidence on the leaf itself, with priority given to raw full-string
// canonical/plural/alias matches and fallback to other exact canonical/alias authority, all gated by
// role grounding (resolution.md #8). Alias authority here must still be a whole-alias equality on
// the prepared query surface, and it excludes broad `family_supporting` aliases while still allowing
// leaf-side alias roles such as `locale_primary`/`locale_supporting`/backbone-style leaf aliases.
// This is the strongest leaf evidence class the pipeline recognizes, so it is allowed to reorder the
// already-ranked families ahead of normal ranking.
function selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(rankedFamilies, rankedLeaves, preparedQuery, exactQueryText) {
    const topFamily = rankedFamilies[0] ?? null;
    const exactLeafCanonicalOrAliasFullStringCandidate = rankedLeaves
        .filter((leaf) => {
        if (!hasLeafRoleGrounding(leaf, preparedQuery)) {
            return false;
        }
        if (hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText)) {
            return true;
        }
        if (!passesCategoryQueryGuards(leaf, preparedQuery)) {
            return false;
        }
        return hasRawQueryCanonicalVariantPhraseMatch(leaf, preparedQuery) || hasRawQueryExactLeafAlias(leaf, preparedQuery);
    })
        .filter((leaf) => hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText) ||
        hasRawQueryCanonicalVariantPhraseMatch(leaf, preparedQuery) ||
        !exactLeafRescueHasBroadSharedAliasRisk(leaf, rankedLeaves, preparedQuery, exactQueryText))
        .sort((left, right) => compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText) ||
        Number(hasRawQueryCanonicalVariantPhraseMatch(right, preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left, preparedQuery)))[0] ?? null;
    const exactLeafAuthorityCandidate = exactLeafCanonicalOrAliasFullStringCandidate ??
        rankedLeaves
            .filter((leaf) => {
            if (!hasLeafRoleGrounding(leaf, preparedQuery)) {
                return false;
            }
            if (hasRawQueryExactCanonical(leaf, preparedQuery)) {
                return true;
            }
            if (!passesCategoryQueryGuards(leaf, preparedQuery)) {
                return false;
            }
            return hasRawQueryExactLeafAlias(leaf, preparedQuery);
        })
            .filter((leaf) => hasRawQueryExactCanonical(leaf, preparedQuery) ||
            !exactLeafRescueHasBroadSharedAliasRisk(leaf, rankedLeaves, preparedQuery, exactQueryText))
            .sort((left, right) => Number(hasRawQueryCanonicalVariantPhraseMatch(right, preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left, preparedQuery)) ||
            compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText))[0] ??
        null;
    if (!exactLeafAuthorityCandidate) {
        return null;
    }
    if (!topFamily || exactLeafAuthorityCandidate.familyKey !== topFamily.familyKey) {
        return exactLeafAuthorityCandidate;
    }
    return topFamily.leaves.some((leaf) => leaf.graphNodeId === exactLeafAuthorityCandidate.graphNodeId) ? exactLeafAuthorityCandidate : null;
}
function selectExactFamilyCanonicalRescue(rankedFamilies, exactQueryText) {
    const foldedExactQuery = foldSearchText(exactQueryText);
    const weakPunctuationExactQuery = foldWeakPunctuationLookupText(exactQueryText);
    const exactStringFamily = rankedFamilies.find((family) => family.evidence.some((record) => record.channel === 'exact_family_canonical') &&
        (foldSearchText(family.familyLabel) === foldedExactQuery ||
            foldWeakPunctuationLookupText(family.familyLabel) === weakPunctuationExactQuery)) ?? null;
    if (exactStringFamily) {
        return exactStringFamily;
    }
    return rankedFamilies.find((family) => family.evidence.some((record) => record.channel === 'exact_family_canonical')) ?? null;
}
function policyControlledIsLeafFullySelectable(leaf, family, preparedQuery, rankedFamilies, specializationKindsCache, exactQueryText = preparedQuery.raw) {
    return (passesLeafSelectionBasePolicy(leaf, family, preparedQuery, rankedFamilies) &&
        !hasAmbiguousAliasLeafTie(leaf, family) &&
        !hasUnsafeSpecializedLeafTie(leaf, family, preparedQuery, specializationKindsCache, exactQueryText) &&
        !hasInsufficientLeafSeparation(leaf, family, preparedQuery));
}
export function firstSelectableLeafInFamily(family, preparedQuery, rankedFamilies, specializationKindsCache, exactQueryText = preparedQuery.raw) {
    return (family.leaves.find((leaf) => policyControlledIsLeafFullySelectable(leaf, family, preparedQuery, rankedFamilies, specializationKindsCache, exactQueryText)) ?? null);
}
function buildBranchFamilyCandidate(branch, branchShare, branchMarginRatio) {
    return {
        familyKey: branch.branchKey,
        familyKind: branch.branchKind,
        familyNodeId: branch.branchNodeId,
        familyLabel: branch.branchLabel,
        evidence: [],
        supportingLeafIds: new Set(),
        branchShare,
        branchMarginRatio,
        evidenceTier: null,
        evidenceTierRank: Number.POSITIVE_INFINITY,
        score: 0,
        confidence: 0
    };
}
function addFamilyProfileEvidence(family, hit) {
    const evidence = familyProfileEvidence(hit);
    const alreadyAdded = family.evidence.some((record) => record.channel === evidence.channel && record.details.family_node_id === evidence.details.family_node_id);
    if (!alreadyAdded) {
        family.evidence.push(evidence);
    }
}
function buildRuntimeFamilyCandidate(input) {
    return {
        familyKey: `family:${input.familyNodeId}`,
        familyKind: 'family',
        familyNodeId: input.familyNodeId,
        familyLabel: input.familyLabel,
        evidence: [],
        supportingLeafIds: new Set(),
        branchShare: 0,
        branchMarginRatio: null,
        evidenceTier: null,
        evidenceTierRank: Number.POSITIVE_INFINITY,
        score: 0,
        confidence: 0
    };
}
function buildLeafCandidate(state, branch, candidate) {
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        familyKey: branch.branchKey,
        familyKind: branch.branchKind,
        familyNodeId: branch.branchNodeId,
        familyLabel: branch.branchLabel,
        genericRisk: candidate.genericRisk,
        hasHierarchy: candidate.hasHierarchy,
        hasCapabilitySupport: candidate.hasCapabilitySupport,
        leafFitScore: null,
        leafStructure: stateLeafStructure(state, candidate.graphNodeId),
        evidence: [],
        closeness: null,
        familyScopedFit: null,
        capabilityFit: null,
        selectionEvidence: null,
        score: 0,
        confidence: 0
    };
}
function stateLeafStructure(state, graphNodeId) {
    return state.leafStructureArtifact?.getRecord(graphNodeId) ?? null;
}
function toPipelineEvidenceRecord(channel, score, details, evidence) {
    return {
        channel,
        score,
        sourceStage: stageForChannel(channel),
        details: {
            ...details,
            ...(evidence?.alias ? { alias: evidence.alias } : {}),
            ...(evidence?.normalizedAlias ? { normalized_alias: evidence.normalizedAlias } : {}),
            ...(evidence?.foldedAlias ? { folded_alias: evidence.foldedAlias } : {}),
            ...(evidence?.aliasRole ? { alias_role: evidence.aliasRole } : {}),
            ...(evidence?.aliasWeight !== undefined ? { alias_weight: evidence.aliasWeight } : {})
        }
    };
}
function buildCrossLocaleEnglishBackboneEvidence(evidence, graphNodeId, canonicalLabel, record) {
    if (evidence.channel !== 'exact_alias' || !record) {
        return null;
    }
    const englishTerms = englishBackboneTerms(record);
    if (englishTerms.length === 0) {
        return null;
    }
    return {
        channel: 'cross_locale_english_backbone',
        score: evidence.score,
        sourceStage: 'cross_locale_english_backbone',
        details: {
            graph_node_id: graphNodeId,
            canonical_label: canonicalLabel,
            local_alias: evidence.details.alias,
            normalized_local_alias: evidence.details.normalized_alias,
            alias_role: evidence.details.alias_role,
            english_terms: englishTerms
        }
    };
}
function familyProfileEvidence(hit) {
    const channel = familyProfileEvidenceChannel(hit);
    return {
        channel,
        score: hit.score,
        sourceStage: 'family_profile',
        details: {
            family_node_id: hit.familyNodeId,
            family_label: hit.familyLabel,
            group_node_id: hit.groupNodeId,
            group_label: hit.groupLabel,
            exact_family_label_phrase: hit.exactFamilyLabelPhrase,
            coverage: hit.coverage,
            role_coverage: hit.roleCoverage,
            domain_coverage: hit.domainCoverage,
            matched_terms: hit.matchedTerms,
            missing_terms: hit.missingTerms,
            matched_role_terms: hit.matchedRoleTerms,
            missing_role_terms: hit.missingRoleTerms,
            matched_domain_terms: hit.matchedDomainTerms,
            matched_sources: hit.matchedSources,
            matching_leaf_count: hit.matchingLeafCount,
            profile_leaf_count: hit.profileLeafCount,
            matching_leaf_ids: hit.matchingLeafIds.slice(0, 20)
        }
    };
}
function familyProfileEvidenceChannel(hit) {
    if (hit.exactFamilyLabelPhrase) {
        return 'exact_family_canonical';
    }
    if (hit.usefulFamilyLabelPhrase) {
        return 'useful_exact';
    }
    return 'family_profile';
}
function reviewedFamilySignalEvidence(match) {
    return {
        channel: match.rule.action === 'support' ? 'reviewed_family_signal' : 'reviewed_family_penalty',
        score: match.rule.score,
        sourceStage: 'reviewed_family_signals',
        details: {
            rule_id: match.rule.id,
            action: match.rule.action,
            family_node_id: match.rule.familyNodeId,
            family_label: match.rule.familyLabel,
            matched_role_terms: match.matchedRoleHeads,
            matched_tokens: match.matchedQueryTerms,
            matched_query_terms: match.matchedQueryTerms,
            missing_all_terms: match.missingAllTerms,
            role_coverage: match.rule.roleHeadsAny && match.rule.roleHeadsAny.length > 0 ? 1 : 0,
            notes: match.rule.notes ?? null
        }
    };
}
function englishBackboneTerms(record) {
    const terms = new Set();
    terms.add(record.canonicalLabel);
    for (const alias of record.aliases) {
        if (alias.localeCode !== 'en') {
            continue;
        }
        terms.add(alias.alias);
        terms.add(alias.normalizedAlias);
    }
    return Array.from(terms)
        .map((term) => term.trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 12);
}
// Single canonical place leafFitScore is computed. Every leaf must pass through here exactly once,
// at the point its evidence (aliases) is finalized -- see the two call sites in
// accumulateCurrentRetrievalEvidenceStage and recoverLeavesInsideTopFamiliesStage.
function enrichWithLeafFit(leafs, roleClosenessQuery) {
    for (const leaf of leafs) {
        leaf.leafFitScore = LEAF_CLOSENESS_RANKER.rank({
            query: roleClosenessQuery,
            canonicalLabel: leaf.canonicalLabel,
            aliases: matchedAliasLabels(leaf.evidence)
        }).score;
    }
}
function leafEvidenceWithUsefulExact(leaf, usefulExactLabel) {
    if (leaf.evidence.some((record) => record.channel === 'useful_exact')) {
        return leaf.evidence;
    }
    if (!usefulExactLabel) {
        return leaf.evidence;
    }
    return [
        ...leaf.evidence,
        {
            channel: 'useful_exact',
            score: 1,
            sourceStage: 'leaf_closeness',
            details: {}
        }
    ];
}
function leafHasUsefulExactLabel(closeness) {
    if (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) {
        return false;
    }
    if (closeness.usefulQueryCoverage < 1 || closeness.missingUsefulTokens.length > 0) {
        return false;
    }
    return closeness.extraTitleTokens.length > 0 && closeness.extraGenericModifierCount === closeness.extraTitleTokens.length;
}
function matchedAliasLabels(evidence) {
    const aliases = new Set();
    for (const record of evidence) {
        if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
            continue;
        }
        const alias = typeof record.details.alias === 'string' ? record.details.alias.trim() : '';
        const normalizedAlias = typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias.trim() : '';
        const matchedTokens = Array.isArray(record.details.matched_tokens)
            ? record.details.matched_tokens.filter((token) => typeof token === 'string' && token.trim().length > 0)
            : [];
        if (alias) {
            aliases.add(alias);
        }
        if (normalizedAlias) {
            aliases.add(normalizedAlias);
        }
        if (matchedTokens.length > 0) {
            aliases.add(matchedTokens.join(' '));
        }
    }
    return Array.from(aliases);
}
function passesLeafSelectionBasePolicy(leaf, family, preparedQuery, rankedFamilies) {
    if (!isLeafPromotableByRoleCompatibility(leaf, preparedQuery)) {
        return false;
    }
    if (leafSpecializationSupport(leaf, preparedQuery) === 'unsupported') {
        return false;
    }
    if (!hasLeafRoleGrounding(leaf, preparedQuery)) {
        return false;
    }
    if (!passesCategoryQueryGuards(leaf, preparedQuery)) {
        return false;
    }
    if (!isLeafSelectionEvidencePromotable(leaf, family, preparedQuery, rankedFamilies)) {
        return false;
    }
    const directEvidenceScore = maxEvidenceScore(leaf.evidence, [
        'exact_canonical',
        'exact_alias',
        'useful_exact',
        'folded_alias',
        'ngram_alias',
        'lexical',
        'capability_task'
    ]);
    if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
        return true;
    }
    const closeness = leaf.closeness;
    const clearsStandardGate = leaf.confidence >= PIPELINE_DECISION_GATE.LEAF_STANDARD_CONFIDENCE &&
        directEvidenceScore >= PIPELINE_DECISION_GATE.LEAF_STANDARD_DIRECT_EVIDENCE &&
        family.confidence >= PIPELINE_DECISION_GATE.LEAF_STANDARD_FAMILY_CONFIDENCE;
    const clearsExactUsefulTokenGate = Boolean(closeness &&
        leaf.confidence >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_CONFIDENCE &&
        directEvidenceScore >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_DIRECT_EVIDENCE &&
        family.confidence >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_FAMILY_CONFIDENCE &&
        closeness.usefulQueryCoverage >= 1 &&
        closeness.titleExtraTokenRatio <= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_MAX_EXTRA_TOKEN_RATIO);
    const clearsControlledAcronymExpansionGate = Boolean(closeness &&
        preparedQuery.acronymTokens.length > 0 &&
        family.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE &&
        leaf.confidence >= family.confidence &&
        directEvidenceScore > 0 &&
        closeness.usefulQueryCoverage >= 1 &&
        closeness.missingUsefulTokens.length === 0);
    return clearsStandardGate || clearsExactUsefulTokenGate || clearsControlledAcronymExpansionGate;
}
// Shared by isLeafSelectable and
// selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback so they
// can't drift.
function passesCategoryQueryGuards(leaf, preparedQuery) {
    if (isBroadRoleQuery(preparedQuery) && !hasBroadRoleLeafAuthority(leaf, preparedQuery)) {
        return false;
    }
    if (isCollectiveOccupationalQuery(preparedQuery) && !hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
        return false;
    }
    return true;
}
// English-only for now (deliberately not extended to ro/hu/et without verified examples in those
// locales, per the "don't over-engineer untested translations" guidance) -- <domain> + one of these
// nouns names a CATEGORY of occupations rather than a single occupation (e.g. "security personnel",
// "sales personnel", "kitchen staff", "media workers"), regardless of the query's useful-token count.
const COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE = {
    en: new Set(['personnel', 'staff', 'workers', 'professionals', 'employees', 'team'])
};
function isCollectiveOccupationalQuery(preparedQuery) {
    const collectiveNouns = COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE[preparedQuery.locale];
    if (!collectiveNouns || preparedQuery.foldedTokens.length < 2) {
        return false;
    }
    const lastToken = preparedQuery.foldedTokens[preparedQuery.foldedTokens.length - 1];
    return collectiveNouns.has(lastToken);
}
function isBroadRoleQuery(preparedQuery) {
    if (!preparedQuery.isGenericShape) {
        return false;
    }
    if (preparedQuery.usefulFoldedRecallTokens.length === 1) {
        return true;
    }
    // A bare single-generic-head query (e.g. "technician", "assistant") has its only token classified
    // as generic, so it never becomes a "useful" folded token above -- without this branch the broad-role
    // guard would never activate for exactly the case it exists to protect (resolution.md #16), letting
    // the pipeline manufacture a specific leaf out of a single generic word.
    return preparedQuery.usefulFoldedRecallTokens.length === 0 && preparedQuery.genericTokens.length === 1;
}
function hasBroadRoleLeafAuthority(leaf, preparedQuery) {
    const queryTokenCount = preparedQuery.usefulFoldedRecallTokens.length;
    if (queryTokenCount === 0) {
        return false;
    }
    if (canonicalTokenCount(leaf.canonicalLabel) <= queryTokenCount) {
        return true;
    }
    const closeness = leaf.closeness;
    return Boolean(closeness &&
        closeness.matchedLabelSource === 'alias' &&
        (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) &&
        tokenizeNormalizedText(foldSearchText(closeness.matchedLabel)).length <= queryTokenCount);
}
function isLeafSelectionEvidencePromotable(leaf, family, preparedQuery, rankedFamilies) {
    if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
        return true;
    }
    if (!isLeafPromotableByRoleCompatibility(leaf, preparedQuery)) {
        return false;
    }
    if (leafSpecializationSupport(leaf, preparedQuery) === 'unsupported') {
        return false;
    }
    const tier = leaf.selectionEvidence?.tier ?? 'weak';
    if (tier === 'exact_alias' &&
        hasEvidenceChannel(family.evidence, 'cross_locale_english_backbone') &&
        hasCompetingAliasEvidenceFamily(family, rankedFamilies) &&
        !hasRawQueryExactAlias(leaf, preparedQuery)) {
        return false;
    }
    switch (tier) {
        case 'exact_alias':
        case 'useful_exact':
        case 'folded_alias':
        case 'strong_phrase':
        case 'alias_aligned':
            return !hasUnsafeStructuralLeafPromotion(leaf, preparedQuery);
        case 'capability_aligned':
            return (leaf.closeness?.usefulQueryCoverage ?? 0) >= 1;
        case 'exact_canonical':
            return true;
        case 'weak':
            return false;
    }
}
function hasCompetingAliasEvidenceFamily(family, rankedFamilies) {
    return rankedFamilies.some((candidate) => candidate.familyKey !== family.familyKey &&
        (hasEvidenceChannel(candidate.evidence, 'exact_alias') || hasEvidenceChannel(candidate.evidence, 'folded_alias')));
}
function hasRawQueryExactAlias(leaf, preparedQuery) {
    return leaf.evidence.some((record) => {
        if (record.channel !== 'exact_alias') {
            return false;
        }
        const normalizedAlias = normalizedAliasDetail(record);
        const foldedAlias = foldedAliasDetail(record);
        return normalizedAlias === preparedQuery.normalized || foldedAlias === preparedQuery.folded;
    });
}
function hasPreparedPhraseWindowAnchor(leaf) {
    return leaf.evidence.some((record) => {
        if (record.channel !== 'lexical') {
            return false;
        }
        const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];
        return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
    });
}
function isPreparedPhraseWindowQuery(value) {
    const match = value.match(/^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(\d+)_idx_\d+$/u);
    if (!match) {
        return false;
    }
    return Number.parseInt(match[1] ?? '0', 10) >= 2;
}
function hasAmbiguousAliasLeafTie(topLeaf, family) {
    const topExactAliasScore = maxEvidenceScore(topLeaf.evidence, ['exact_alias']);
    const topMatchedAlias = topLeaf.closeness?.matchedLabelSource === 'alias' ? topLeaf.closeness.matchedLabel : '';
    const topMatchedAliasFolded = topMatchedAlias ? foldSearchText(topMatchedAlias) : '';
    if (topExactAliasScore <= 0 || !topMatchedAlias) {
        return false;
    }
    return family.leaves.slice(1).some((leaf) => {
        const leafExactAliasScore = maxEvidenceScore(leaf.evidence, ['exact_alias']);
        const sameAlias = leaf.closeness?.matchedLabelSource === 'alias' && foldSearchText(leaf.closeness.matchedLabel) === topMatchedAliasFolded;
        const selectedIsClearlyMoreGeneral = canonicalTokenCount(topLeaf.canonicalLabel) < canonicalTokenCount(leaf.canonicalLabel);
        return (leafExactAliasScore > 0 &&
            sameAlias &&
            topLeaf.confidence - leaf.confidence <= PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
            !selectedIsClearlyMoreGeneral);
    });
}
function exactLeafRescueHasBroadSharedAliasRisk(topLeaf, rankedLeaves, preparedQuery, exactQueryText) {
    const topAliasKey = exactLeafRescueComparableAliasKey(topLeaf, preparedQuery);
    if (!topAliasKey) {
        return false;
    }
    return rankedLeaves.some((leaf) => {
        if (leaf.graphNodeId === topLeaf.graphNodeId) {
            return false;
        }
        if (exactLeafRescueComparableAliasKey(leaf, preparedQuery) !== topAliasKey) {
            return false;
        }
        if (hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText)) {
            return false;
        }
        const selectedIsClearlyMoreGeneral = canonicalTokenCount(topLeaf.canonicalLabel) < canonicalTokenCount(leaf.canonicalLabel);
        return leaf.confidence >= topLeaf.confidence - PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN && !selectedIsClearlyMoreGeneral;
    });
}
function exactLeafRescueComparableAliasKey(leaf, preparedQuery) {
    const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
    const rawFolded = foldSearchText(rawNormalized);
    for (const record of leaf.evidence) {
        if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
            continue;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        if (aliasRole === 'family_supporting') {
            continue;
        }
        const normalizedAlias = normalizedAliasDetail(record);
        const foldedAlias = foldedAliasDetail(record);
        if (normalizedAlias === preparedQuery.normalized ||
            normalizedAlias === rawNormalized ||
            foldedAlias === preparedQuery.folded ||
            foldedAlias === rawFolded) {
            return foldedAlias || foldSearchText(normalizedAlias);
        }
    }
    return '';
}
// General counterpart to hasAmbiguousAliasLeafTie/hasUnsafeSpecializedLeafTie: those two only catch
// specific tie *shapes* (same alias, or specialized-vs-generic). A broad/collective query like
// "Security Personnel" can have several role-grounded leaves within LEAF_SEPARATION_MARGIN of each
// other (e.g. "security consultant" .753 vs "security guard" .714) without matching either shape, so
// it slips through and gets promoted to a specific leaf the query never actually distinguished.
// "Credible alternative" is deliberately narrow (role-compatible, specialization-supported, role-
// grounded) so noisy/unrelated retrieval hits with a low score can't force an artificial abstention.
function hasInsufficientLeafSeparation(topLeaf, family, preparedQuery) {
    if (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
        hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
        hasRawQueryExactLeafAlias(topLeaf, preparedQuery) ||
        (hasRawQueryExactAlias(topLeaf, preparedQuery) && leafCanonicalCoversRoleHead(topLeaf, preparedQuery)) ||
        hasControlledAcronymLeafAuthority(topLeaf, preparedQuery)) {
        return false;
    }
    const bestCredibleAlternativeConfidence = family.leaves.slice(1).reduce((max, leaf) => {
        const isCredible = isLeafPromotableByRoleCompatibility(leaf, preparedQuery) &&
            leafSpecializationSupport(leaf, preparedQuery) !== 'unsupported' &&
            hasLeafRoleGrounding(leaf, preparedQuery);
        return isCredible ? Math.max(max, leaf.confidence) : max;
    }, Number.NEGATIVE_INFINITY);
    if (bestCredibleAlternativeConfidence === Number.NEGATIVE_INFINITY) {
        return false;
    }
    return topLeaf.confidence - bestCredibleAlternativeConfidence < PIPELINE_DECISION_GATE.LEAF_SEPARATION_MARGIN;
}
function hasUnsafeSpecializedLeafTie(topLeaf, family, preparedQuery, specializationKindsCache, exactQueryText = preparedQuery.raw) {
    if (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
        hasRawQueryFullStringExactCanonical(topLeaf, preparedQuery, exactQueryText) ||
        hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
        hasRawQueryExactLeafAlias(topLeaf, preparedQuery) ||
        (hasRawQueryExactAlias(topLeaf, preparedQuery) && leafCanonicalCoversRoleHead(topLeaf, preparedQuery)) ||
        hasControlledAcronymLeafAuthority(topLeaf, preparedQuery)) {
        return false;
    }
    if (!leafCanonicalAddsUnrequestedSpecificity(topLeaf, preparedQuery)) {
        return false;
    }
    return family.leaves
        .slice(1)
        .some((leaf) => leaf.confidence >= topLeaf.confidence - PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
        leafStructuralPreferenceScore(leaf, preparedQuery, specializationKindsCache) >=
            leafStructuralPreferenceScore(topLeaf, preparedQuery, specializationKindsCache));
}
function hasRawQueryExactCanonical(leaf, preparedQuery) {
    const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
    const rawFolded = foldSearchText(rawNormalized);
    return (leaf.evidence.some((record) => record.channel === 'exact_canonical') ||
        foldSearchText(leaf.canonicalLabel) === preparedQuery.folded ||
        foldSearchText(leaf.canonicalLabel) === rawFolded);
}
function hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText = preparedQuery.raw) {
    return (foldSearchText(leaf.canonicalLabel) === foldSearchText(exactQueryText) ||
        foldWeakPunctuationLookupText(leaf.canonicalLabel) === foldWeakPunctuationLookupText(exactQueryText));
}
function isRawExactMatch(leaf, preparedQuery) {
    return hasRawQueryExactCanonical(leaf, preparedQuery) || hasRawQueryPrimaryExactAlias(leaf, preparedQuery);
}
function hasRawQueryExactCanonicalOrExactAlias(leaf, preparedQuery) {
    return hasRawQueryExactCanonical(leaf, preparedQuery) || hasRawQueryPrimaryExactAlias(leaf, preparedQuery, ['exact_alias']);
}
function hasRawQueryCanonicalVariantPhraseMatch(leaf, preparedQuery) {
    const queryTokens = preparedQuery.usefulFoldedRecallTokens;
    const canonicalTokens = tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel));
    if (queryTokens.length === 0 || canonicalTokens.length === 0 || queryTokens.length !== canonicalTokens.length) {
        return false;
    }
    return queryTokens.every((queryToken, index) => tokenMatchesLocaleVariant(queryToken, new Set([canonicalTokens[index] ?? '']), normalizeQueryLocale(preparedQuery.locale)));
}
function hasRawQueryExactLeafAlias(leaf, preparedQuery) {
    // Full-string leaf-alias authority only: exact/folded alias evidence must equal the entire
    // prepared query surface after normalization/folding. `family_supporting` is intentionally
    // excluded because it is broad family-side support, not leaf authority.
    const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
    const rawFolded = foldSearchText(rawNormalized);
    return leaf.evidence.some((record) => {
        if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
            return false;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        if (aliasRole === 'family_supporting') {
            return false;
        }
        const normalizedAlias = normalizedAliasDetail(record);
        if (normalizedAlias) {
            return (normalizedAlias === preparedQuery.normalized ||
                normalizedAlias === rawNormalized ||
                (record.channel === 'exact_alias' && foldedAliasMatchesPreparedQueryVariant(normalizedAlias, preparedQuery)));
        }
        const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';
        return (foldedAlias === preparedQuery.folded ||
            foldedAlias === rawFolded ||
            (record.channel === 'exact_alias' && foldedAliasMatchesPreparedQueryVariant(foldedAlias, preparedQuery)));
    });
}
function hasKnownRolePhraseAliasInQueryRescue(leaf, preparedQuery, roleSpanSelection) {
    const selectedSpan = roleSpanSelection?.selectedSpan;
    if (!selectedSpan || selectedSpan.longestPhraseLength < 2 || preparedQuery.intent.roleTokens.length < 2) {
        return false;
    }
    const exactEmbeddedPhraseCandidates = (roleSpanSelection?.candidates ?? []).filter((candidate) => candidate.exactPhraseKnown &&
        candidate.tokenCount >= 2 &&
        candidate.tokenCount >= selectedSpan.longestPhraseLength &&
        candidate.tokenCount < selectedSpan.tokenCount);
    if (exactEmbeddedPhraseCandidates.length === 0) {
        return false;
    }
    return leaf.evidence.some((record) => {
        if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
            return false;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        if (aliasRole === 'family_supporting') {
            return false;
        }
        const matchType = typeof record.details.match_type === 'string' ? record.details.match_type : '';
        if (matchType !== 'alias_in_query') {
            return false;
        }
        const matchedTokens = stringArrayDetail(record.details.matched_tokens);
        const aliasTokenCount = numericDetail(record.details.alias_token_count);
        const queryTokenCount = numericDetail(record.details.query_token_count);
        if (matchedTokens.length < 2) {
            return false;
        }
        if (aliasTokenCount !== null && matchedTokens.length < aliasTokenCount) {
            return false;
        }
        if (queryTokenCount !== null && queryTokenCount <= matchedTokens.length) {
            return false;
        }
        const matchedFoldedPhrase = foldSearchText(matchedTokens.join(' '));
        if (!exactEmbeddedPhraseCandidates.some((candidate) => candidate.foldedText === matchedFoldedPhrase)) {
            return false;
        }
        const roleMatch = matchedIntentTokens(preparedQuery.intent.roleTokens, [matchedTokens.join(' ')]);
        return roleMatch.missing.length === 0;
    });
}
function hasRawQueryPrimaryExactAlias(leaf, preparedQuery, channels = ['exact_alias', 'folded_alias']) {
    const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
    const rawFolded = foldSearchText(rawNormalized);
    const channelSet = new Set(channels);
    return leaf.evidence.some((record) => {
        if (!channelSet.has(record.channel)) {
            return false;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        if (aliasRole !== 'locale_primary') {
            return false;
        }
        const normalizedAlias = normalizedAliasDetail(record);
        const foldedAlias = foldedAliasDetail(record);
        return (normalizedAlias === preparedQuery.normalized ||
            normalizedAlias === rawNormalized ||
            foldedAlias === preparedQuery.folded ||
            foldedAlias === rawFolded ||
            (record.channel === 'exact_alias' &&
                (foldedAliasMatchesPreparedQueryVariant(normalizedAlias, preparedQuery) ||
                    foldedAliasMatchesPreparedQueryVariant(foldedAlias, preparedQuery))));
    });
}
function foldedAliasMatchesPreparedQueryVariant(alias, preparedQuery) {
    const aliasTokens = tokenizeNormalizedText(foldSearchText(alias));
    if (aliasTokens.length === 0 || aliasTokens.length !== preparedQuery.foldedTokens.length) {
        return false;
    }
    const locale = normalizeQueryLocale(preparedQuery.locale);
    return preparedQuery.foldedTokens.every((queryToken, index) => tokenMatchesLocaleVariant(queryToken, new Set([aliasTokens[index] ?? '']), locale));
}
function normalizedAliasDetail(record) {
    return typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias : '';
}
function foldedAliasDetail(record) {
    const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';
    if (foldedAlias) {
        return foldedAlias;
    }
    const normalizedAlias = normalizedAliasDetail(record);
    return normalizedAlias ? foldSearchText(normalizedAlias) : '';
}
function hasControlledAcronymLeafAuthority(leaf, preparedQuery) {
    const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    if (preparedQuery.acronymTokens.length === 0 || roleHeadTokens.length === 0) {
        return false;
    }
    const labels = [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ];
    return (matchedIntentTokens(roleHeadTokens, labels).missing.length === 0 &&
        (leaf.selectionEvidence?.tier === 'strong_phrase' ||
            leaf.selectionEvidence?.tier === 'exact_alias' ||
            leaf.selectionEvidence?.tier === 'folded_alias' ||
            leaf.evidence.some((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery))));
}
function leafCanonicalCoversRoleHead(leaf, preparedQuery) {
    const canonicalTokens = new Set(canonicalLabelTokens(leaf.canonicalLabel));
    const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    if (roleHeadTokens.some((token) => tokenMatchesLabelTokens(token, canonicalTokens))) {
        return true;
    }
    // altRoleHeadTokens is resolved once at intent-build time (query-intent.ts) from the curated
    // role-head equivalence classes, so this checks a plain token set instead of calling the
    // equivalence artifact itself -- see OccupationQueryIntent.altRoleHeadTokens. canonicalLabel is
    // always English, which is exactly what altRoleHeadTokens is expressed in.
    return preparedQuery.intent.altRoleHeadTokens.some((term) => canonicalTokens.has(term));
}
function leafCanonicalAddsUnrequestedSpecificity(leaf, preparedQuery) {
    const canonicalTokens = canonicalLabelTokens(leaf.canonicalLabel);
    const allowedTokens = new Set([
        ...preparedQuery.usefulFoldedRecallTokens,
        ...preparedQuery.intent.roleTokens,
        ...authoritativeIntentRoleHeadTokens(preparedQuery),
        ...preparedQuery.intent.domainTokens
    ].map((token) => foldSearchText(token)));
    return canonicalTokens.some((token) => !tokenMatchesLabelTokens(token, allowedTokens));
}
function maxEvidenceScore(evidence, channels) {
    const channelSet = new Set(channels);
    const matchingEvidence = evidence.filter((record) => channelSet.has(record.channel));
    return maxOf(matchingEvidence, (record) => normalizeEvidenceScore(record));
}
function normalizeEvidenceScore(record) {
    if (record.channel === 'graph_family_recovery') {
        return 0;
    }
    if (record.channel === 'exact_canonical') {
        return clampScore(record.score);
    }
    if (record.channel === 'exact_alias') {
        return clampScore(record.score);
    }
    if (record.channel === 'folded_alias') {
        return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.FOLDED_ALIAS_DISCOUNT);
    }
    if (record.channel === 'ngram_alias') {
        return clampScore(record.score);
    }
    if (record.channel === 'lexical') {
        return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.OPENSEARCH_LEXICAL_BOOST);
    }
    if (record.channel === 'capability_task') {
        return clampScore(record.score);
    }
    if (record.channel === 'family_profile') {
        return clampScore(record.score);
    }
    return clampScore(record.score);
}
function numericDetail(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
// Reorders families to put the exact-leaf rescue's family first (resolution.md #8). Safe because
// the rescue itself only fires on raw exact canonical/plural/alias full-string leaf evidence, the
// same authority level normal ranking would already prefer if it weren't scoped per-family.
function promoteExactLeafRescueFamily(rankedFamilies, rankedLeaves, preparedQuery, exactQueryText) {
    const exactLeafRescue = selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(rankedFamilies, rankedLeaves, preparedQuery, exactQueryText);
    if (!exactLeafRescue) {
        return rankedFamilies;
    }
    const rescuedFamilyIndex = rankedFamilies.findIndex((family) => family.familyKey === exactLeafRescue.familyKey);
    if (rescuedFamilyIndex <= 0) {
        return rankedFamilies;
    }
    const rescuedFamily = rankedFamilies[rescuedFamilyIndex];
    const reorderedFamilies = [
        rescuedFamily,
        ...rankedFamilies.slice(0, rescuedFamilyIndex),
        ...rankedFamilies.slice(rescuedFamilyIndex + 1)
    ];
    return reorderedFamilies.map((family, index) => ({
        ...family,
        rank: index + 1
    }));
}
export function recoveredFamilySelectionAuthority(family, preparedQuery, specializationKindsCache) {
    const foldedAliasAuthorityCount = foldedAliasCount(family, preparedQuery);
    const roleAgreement = familyRoleAgreementAuthority(family, preparedQuery);
    const capabilityAgreement = familyCapabilityAgreementAuthority(family);
    const familyStructureAuthority = structuralFamilyAuthority(family.familyNodeId, preparedQuery);
    return {
        roleGrounded: hasFamilyRoleGrounding(family, preparedQuery) ? 1 : 0,
        familyStructureAuthority,
        groupAgreement: familyGroupAgreementScore(family.familyNodeId, preparedQuery),
        groupMismatch: familyGroupMismatchPenalty(family.familyNodeId, preparedQuery),
        jobFunctionPrior: maxEvidenceScore(family.evidence, ['job_function_family_prior']),
        genericHeadPrior: maxEvidenceScore(family.evidence, ['generic_head_family_prior']),
        reviewedSignal: maxEvidenceScore(family.evidence, ['reviewed_family_signal']),
        exactFamilyCanonical: exactFamilyCanonicalCount(family),
        usefulExact: maxEvidenceScore(family.evidence, ['useful_exact']),
        primaryExactAliasLeafCount: primaryExactAliasLeafCount(family, preparedQuery),
        exactRoleLeafCount: roleAgreement.exactRoleLeafCount,
        partialRoleLeafCount: roleAgreement.partialRoleLeafCount,
        bestRoleTokenMatchCount: roleAgreement.bestRoleTokenMatchCount,
        capabilityRoleCoverage: capabilityAgreement.capabilityRoleCoverage,
        capabilityLeafCount: capabilityAgreement.capabilityLeafCount,
        exactAliasCount: exactAliasCount(family),
        foldedAliasCount: foldedAliasAuthorityCount,
        exactEvidenceCount: exactEvidenceCount(family, foldedAliasAuthorityCount),
        roleHeadCoverage: maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery),
        roleCoverage: maxFullRoleTokenEvidenceCoverage(family.evidence, preparedQuery),
        bestLeafRoleCoverage: Math.max(...family.leaves.map((leaf) => roleCoverageForLabels(preparedQuery, [
            leaf.canonicalLabel,
            ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
            ...matchedAliasLabels(leaf.evidence)
        ])), 0),
        bestLeafStructuralPreference: maxOf(family.leaves.filter(hasGenuineLeafEvidence), (leaf) => leafStructuralPreferenceScore(leaf, preparedQuery, specializationKindsCache)),
        structuralAlignment: maxOf(family.leaves.filter(hasGenuineLeafEvidence), (leaf) => leafStructuralAlignmentScore(leaf, preparedQuery, specializationKindsCache)),
        familySpecializationMismatch: familySpecializationMismatchPenalty(family.familyNodeId, preparedQuery),
        supportedSpecializationLeafCount: Math.min(family.leaves.filter((leaf) => leafHasSupportedStructuralSpecialization(leaf, preparedQuery, specializationKindsCache)).length, 5),
        profileFamilyLabelCoverage: maxFamilyProfileFamilyLabelCoverage(family.evidence),
        profileRoleCoverage: maxFamilyProfileRoleCoverage(family.evidence),
        confidence: family.confidence,
        branchShare: family.branchShare
    };
}
function primaryExactAliasLeafCount(family, preparedQuery) {
    return Math.min(family.leaves.filter((leaf) => hasRawQueryPrimaryExactAlias(leaf, preparedQuery)).length, 5);
}
function familyRoleAgreementAuthority(family, preparedQuery) {
    const requiredMatches = exactRoleMatchThreshold(preparedQuery);
    let exactRoleLeafCount = 0;
    let partialRoleLeafCount = 0;
    let bestRoleTokenMatchCount = 0;
    if (requiredMatches === 0) {
        return {
            exactRoleLeafCount,
            partialRoleLeafCount,
            bestRoleTokenMatchCount
        };
    }
    for (const leaf of family.leaves) {
        const matchedRoleTokens = leafRoleTokenMatch(leaf, preparedQuery);
        const matchCount = matchedRoleTokens.length;
        bestRoleTokenMatchCount = Math.max(bestRoleTokenMatchCount, matchCount);
        if (matchCount >= requiredMatches && usefulQueryTokensCoveredByMatch(matchedRoleTokens, preparedQuery)) {
            exactRoleLeafCount += 1;
            continue;
        }
        if (matchCount > 0) {
            partialRoleLeafCount += 1;
        }
    }
    return {
        exactRoleLeafCount: Math.min(exactRoleLeafCount, 5),
        partialRoleLeafCount: Math.min(partialRoleLeafCount, 5),
        bestRoleTokenMatchCount
    };
}
function familyCapabilityAgreementAuthority(family) {
    return {
        capabilityRoleCoverage: maxOf(family.leaves, (leaf) => leaf.capabilityFit?.coverage ?? 0),
        capabilityLeafCount: Math.min(family.leaves.filter((leaf) => leaf.capabilityFit?.tier === 'strong' || leaf.capabilityFit?.tier === 'partial').length, 5)
    };
}
function familyGroupAgreementScore(familyNodeId, preparedQuery) {
    const family = getOccupationFamilyContext(familyNodeId);
    const preferredGroups = preparedQuery.intent.occupationClassPreference.preferredFamilyGroups;
    if (!family || preferredGroups.length === 0) {
        return 0;
    }
    return preferredGroups.includes(family.group) ? 1 : 0;
}
function familyGroupMismatchPenalty(familyNodeId, preparedQuery) {
    const family = getOccupationFamilyContext(familyNodeId);
    const disfavoredGroups = preparedQuery.intent.occupationClassPreference.disfavoredFamilyGroups;
    if (!family || disfavoredGroups.length === 0) {
        return 0;
    }
    return disfavoredGroups.includes(family.group) ? 1 : 0;
}
function familySpecializationMismatchPenalty(familyNodeId, preparedQuery) {
    const family = getOccupationFamilyContext(familyNodeId);
    const specializationTerms = family?.specializationTerms;
    if (!specializationTerms || specializationTerms.length === 0) {
        return 0;
    }
    const queryTokens = new Set([...preparedQuery.usefulFoldedRecallTokens, ...preparedQuery.capabilityVerbFoldedAdditionTokens]);
    const queryMentionsSpecialization = specializationTerms.some((term) => queryTokens.has(term));
    return queryMentionsSpecialization ? 0 : 1;
}
function leafRoleTokenMatch(leaf, preparedQuery) {
    return matchedIntentTokens(preparedQuery.intent.roleTokens, [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ]).matched;
}
function usefulQueryTokensCoveredByMatch(matchedRoleTokens, preparedQuery) {
    if (preparedQuery.usefulFoldedRecallTokens.length === 0) {
        return true;
    }
    return preparedQuery.usefulFoldedRecallTokens.every((token) => tokenListHasEquivalent(matchedRoleTokens, token));
}
function exactAliasCount(family) {
    const familyExactCount = family.evidence.filter((record) => record.channel === 'exact_alias' || record.channel === 'exact_canonical').length;
    const leafExactCount = family.leaves.reduce((count, leaf) => count + leaf.evidence.filter((record) => record.channel === 'exact_alias' || record.channel === 'exact_canonical').length, 0);
    return familyExactCount + leafExactCount;
}
function exactFamilyCanonicalCount(family) {
    return family.evidence.filter((record) => record.channel === 'exact_family_canonical').length;
}
function foldedAliasCount(family, preparedQuery) {
    const foldedRecords = [
        ...family.evidence.filter((record) => record.channel === 'folded_alias'),
        ...family.leaves.flatMap((leaf) => leaf.evidence.filter((record) => record.channel === 'folded_alias'))
    ];
    if (!requiresSpecificAcronymAliasAuthority(preparedQuery)) {
        return foldedRecords.length;
    }
    const minimumRoleMatches = minimumSpecificAliasRoleMatches(preparedQuery);
    return foldedRecords.filter((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery) || aliasRoleMatchCount(record, preparedQuery) >= minimumRoleMatches).length;
}
function exactEvidenceCount(family, foldedAliasAuthorityCount) {
    const familyExactCount = family.evidence.filter((record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias').length;
    const leafExactCount = family.leaves.reduce((count, leaf) => count + leaf.evidence.filter((record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias').length, 0);
    return familyExactCount + leafExactCount + foldedAliasAuthorityCount;
}
function requiresSpecificAcronymAliasAuthority(preparedQuery) {
    const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    return preparedQuery.acronymTokens.length > 0 && preparedQuery.intent.roleTokens.length > Math.max(roleHeadTokens.length, 1);
}
function minimumSpecificAliasRoleMatches(preparedQuery) {
    return Math.min(preparedQuery.intent.roleTokens.length, Math.max(2, authoritativeIntentRoleHeadTokens(preparedQuery).length + 1));
}
function aliasRoleMatchCount(record, preparedQuery) {
    return matchedIntentTokens(preparedQuery.intent.roleTokens, aliasEvidenceLabels(record)).matched.length;
}
function aliasHasRawAcronymRoleAuthority(record, preparedQuery) {
    const rawAcronymTokens = preparedQuery.acronymTokens.map((token) => foldSearchText(token));
    const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    if (rawAcronymTokens.length === 0 || roleHeadTokens.length === 0) {
        return false;
    }
    const requiredTokens = Array.from(new Set([...rawAcronymTokens, ...roleHeadTokens]));
    if (requiredTokens.length < 2) {
        return false;
    }
    return matchedIntentTokens(requiredTokens, aliasEvidenceLabels(record)).missing.length === 0;
}
function authoritativeIntentRoleHeadTokens(preparedQuery) {
    if (preparedQuery.intent.authoritativeRoleHeadTokens.length > 0) {
        return preparedQuery.intent.authoritativeRoleHeadTokens;
    }
    if (preparedQuery.intent.roleHeadRequiresContext && !preparedQuery.intent.roleHeadHasContext) {
        return [];
    }
    return preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens;
}
function aliasEvidenceLabels(record) {
    const matchedTokenLabel = stringArrayDetail(record.details.matched_tokens)
        .map((token) => token.trim())
        .filter(Boolean)
        .join(' ');
    return [
        typeof record.details.alias === 'string' ? record.details.alias : '',
        typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias : '',
        typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '',
        matchedTokenLabel
    ].filter(Boolean);
}
function maxFamilyProfileRoleCoverage(evidence) {
    return Math.max(...evidence
        .filter((record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact')
        .map((record) => numericDetail(record.details.role_coverage) ?? 0), 0);
}
function maxFamilyProfileFamilyLabelCoverage(evidence) {
    return Math.max(...evidence
        .filter((record) => (record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact') &&
        stringArrayDetail(record.details.matched_sources).includes('family_label'))
        .map((record) => numericDetail(record.details.role_coverage) ?? 0), 0);
}
function compareBroadRoleFamilies(left, right) {
    const leftAuthority = broadRoleFamilyAuthority(left);
    const rightAuthority = broadRoleFamilyAuthority(right);
    return (rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
        left.evidenceTierRank - right.evidenceTierRank ||
        rightAuthority.profileAndSemanticSupport - leftAuthority.profileAndSemanticSupport ||
        rightAuthority.profileCoverage - leftAuthority.profileCoverage ||
        leftAuthority.bestRepresentativeTokenCount - rightAuthority.bestRepresentativeTokenCount ||
        rightAuthority.profileLeafCount - leftAuthority.profileLeafCount ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function broadRoleFamilyAuthority(family) {
    const profileAuthority = profileSemanticAuthority(family);
    return {
        jobFunctionPrior: maxEvidenceScore(family.evidence, ['job_function_family_prior']),
        profileAndSemanticSupport: profileAuthority.hasProfileSemanticSupport ? 1 : 0,
        profileCoverage: profileAuthority.profileCoverage,
        bestRepresentativeTokenCount: profileAuthority.bestRepresentativeTokenCount,
        profileLeafCount: profileAuthority.profileLeafCount
    };
}
function profileSemanticAuthority(family) {
    const familyProfileEvidenceRecords = family.evidence.filter((record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact');
    const bestFamilyProfile = familyProfileEvidenceRecords.reduce((best, record) => (best === null || record.score > best.score ? record : best), null);
    const profileCoverage = numericDetail(bestFamilyProfile?.details.coverage) ?? 0;
    const profileLeafCount = numericDetail(bestFamilyProfile?.details.matching_leaf_count) ?? 0;
    const representativeTokenCounts = family.leaves
        .filter((leaf) => (leaf.closeness?.usefulQueryCoverage ?? 0) >= 1)
        .map((leaf) => canonicalTokenCount(leaf.canonicalLabel));
    return {
        hasProfileSemanticSupport: Boolean(bestFamilyProfile),
        profileCoverage,
        bestRepresentativeTokenCount: representativeTokenCounts.length > 0 ? Math.min(...representativeTokenCounts) : Number.POSITIVE_INFINITY,
        profileLeafCount
    };
}
function hasEvidenceChannel(evidence, channel) {
    return evidence.some((record) => record.channel === channel);
}
// Filters to leaves that can actually be promoted before ranking rather than ranking everyone and
// gating the winner afterward (resolution.md #12). Deferred leaves still stay visible in diagnostics
// and family recovery, but they no longer crowd promotable leaves out of the top slots.
function compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText) {
    const exactCanonicalAuthority = Number(hasRawQueryFullStringExactCanonical(right, preparedQuery, exactQueryText)) -
        Number(hasRawQueryFullStringExactCanonical(left, preparedQuery, exactQueryText));
    if (exactCanonicalAuthority !== 0) {
        return exactCanonicalAuthority;
    }
    const fullRoleCoverageDiff = canonicalUsefulCoverage(right, preparedQuery) - canonicalUsefulCoverage(left, preparedQuery);
    if (preparedQuery.intent.roleTokens.length >= 2 &&
        preparedQuery.intent.domainTokens.length === 0 &&
        preparedQuery.intent.venueTokens.length === 0 &&
        fullRoleCoverageDiff !== 0) {
        return fullRoleCoverageDiff;
    }
    return compareLeaves(left, right, preparedQuery) || left.canonicalLabel.localeCompare(right.canonicalLabel);
}
const ROLE_COMPATIBILITY_RANK = {
    unknown: 0,
    compatible: 0,
    weakly_compatible: 1,
    incompatible: 2
};
function roleCompatibilityRank(compatibility) {
    return ROLE_COMPATIBILITY_RANK[compatibility];
}
const LEAF_SPECIALIZATION_SUPPORT_RANK = {
    supported: 0,
    neutral: 1,
    unsupported: 2
};
function leafSpecializationSupportRank(support) {
    return LEAF_SPECIALIZATION_SUPPORT_RANK[support];
}
function closenessScoreDiffAndTitleRatio(left, right) {
    return {
        closenessScoreDiff: (right.closeness?.score ?? 0) - (left.closeness?.score ?? 0),
        titleExtraTokenRatioDiff: (left.closeness?.titleExtraTokenRatio ?? 0) - (right.closeness?.titleExtraTokenRatio ?? 0)
    };
}
function shorterCanonicalTieBreak(left, right, closenessScoreDiff, tiedOn) {
    return tiedOn && Math.abs(closenessScoreDiff) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
        ? canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel)
        : 0;
}
function compareLeaves(left, right, preparedQuery) {
    const leftSelectionTier = left.selectionEvidence?.tierRank ?? Number.POSITIVE_INFINITY;
    const rightSelectionTier = right.selectionEvidence?.tierRank ?? Number.POSITIVE_INFINITY;
    if (leftSelectionTier !== rightSelectionTier) {
        return leftSelectionTier - rightSelectionTier;
    }
    const exactCanonicalDiff = maxEvidenceScore(right.evidence, ['exact_canonical']) - maxEvidenceScore(left.evidence, ['exact_canonical']);
    if (exactCanonicalDiff !== 0) {
        return exactCanonicalDiff;
    }
    const leftExactAliasScore = maxEvidenceScore(left.evidence, ['exact_alias']);
    const rightExactAliasScore = maxEvidenceScore(right.evidence, ['exact_alias']);
    const exactAliasDiff = rightExactAliasScore - leftExactAliasScore;
    if (exactAliasDiff !== 0) {
        return exactAliasDiff;
    }
    const { closenessScoreDiff, titleExtraTokenRatioDiff } = closenessScoreDiffAndTitleRatio(left, right);
    const aliasTiePrefersShorterCanonical = shorterCanonicalTieBreak(left, right, closenessScoreDiff, leftExactAliasScore > 0 && rightExactAliasScore > 0);
    if (aliasTiePrefersShorterCanonical !== 0) {
        return aliasTiePrefersShorterCanonical;
    }
    const roleCompatibilityDiff = roleCompatibilityRank(roleCompatibility(left, preparedQuery)) - roleCompatibilityRank(roleCompatibility(right, preparedQuery));
    if (roleCompatibilityDiff !== 0) {
        return roleCompatibilityDiff;
    }
    const specializationSupportDiff = leafSpecializationSupportRank(leafSpecializationSupport(left, preparedQuery)) -
        leafSpecializationSupportRank(leafSpecializationSupport(right, preparedQuery));
    if (specializationSupportDiff !== 0) {
        return specializationSupportDiff;
    }
    const structuralPreferenceDiff = leafStructuralPreferenceScore(right, preparedQuery) - leafStructuralPreferenceScore(left, preparedQuery);
    if (structuralPreferenceDiff !== 0) {
        return structuralPreferenceDiff;
    }
    if (closenessScoreDiff !== 0) {
        return closenessScoreDiff;
    }
    if (titleExtraTokenRatioDiff !== 0) {
        return titleExtraTokenRatioDiff;
    }
    const sameMatchedLabel = Boolean(left.closeness?.matchedLabel && right.closeness?.matchedLabel) &&
        foldSearchText(left.closeness?.matchedLabel ?? '') === foldSearchText(right.closeness?.matchedLabel ?? '');
    const sameLabelTiePrefersShorterCanonical = sameMatchedLabel && Math.abs(titleExtraTokenRatioDiff) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
        ? shorterCanonicalTieBreak(left, right, closenessScoreDiff, true)
        : 0;
    if (sameLabelTiePrefersShorterCanonical !== 0) {
        return sameLabelTiePrefersShorterCanonical;
    }
    const familyScopedTierDiff = (left.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY) - (right.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY);
    if (familyScopedTierDiff !== 0) {
        return familyScopedTierDiff;
    }
    const capabilityFitTierDiff = (left.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY) - (right.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY);
    if (capabilityFitTierDiff !== 0) {
        return capabilityFitTierDiff;
    }
    const capabilityCoverageDiff = (right.capabilityFit?.coverage ?? 0) - (left.capabilityFit?.coverage ?? 0);
    if (capabilityCoverageDiff !== 0) {
        return capabilityCoverageDiff;
    }
    const matchedTermsDiff = (right.familyScopedFit?.matchedTerms.length ?? 0) - (left.familyScopedFit?.matchedTerms.length ?? 0);
    if (matchedTermsDiff !== 0) {
        return matchedTermsDiff;
    }
    const matchedCapabilityTermsDiff = (right.familyScopedFit?.matchedCapabilityTerms.length ?? 0) - (left.familyScopedFit?.matchedCapabilityTerms.length ?? 0);
    if (matchedCapabilityTermsDiff !== 0) {
        return matchedCapabilityTermsDiff;
    }
    const confidenceDiff = right.confidence - left.confidence;
    if (confidenceDiff !== 0) {
        return confidenceDiff;
    }
    const foldedAliasDiff = maxEvidenceScore(right.evidence, ['folded_alias']) - maxEvidenceScore(left.evidence, ['folded_alias']);
    if (foldedAliasDiff !== 0) {
        return foldedAliasDiff;
    }
    return canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel);
}
// specializationKindsCache defaults to a fresh, unshared Map for the few callers (the leaf-ordering
// comparator chain below) that don't have a per-pipeline-run cache in scope -- those already run
// comparisons ad hoc, so an unshared cache is no worse than before this cache existed. Callers that
// do have the shared PipelineState cache (family selection authority, leaf-selection safety net)
// must pass it explicitly so the derivation is actually shared.
function leafStructuralPreferenceScore(leaf, preparedQuery, specializationKindsCache = new Map()) {
    const structure = leaf.leafStructure;
    const usefulCoverage = canonicalUsefulCoverage(leaf, preparedQuery);
    let score = 0;
    if (isRawExactMatch(leaf, preparedQuery)) {
        score += 6;
    }
    score += Math.round(usefulCoverage * 4);
    if (usefulCoverage === 0 && !hasRawQueryExactAlias(leaf, preparedQuery)) {
        score -= 4;
    }
    if (leafCanonicalCoversRoleHead(leaf, preparedQuery)) {
        score += 3;
    }
    else if (isSingleHeadOrBroadRoleQuery(preparedQuery)) {
        score -= 3;
    }
    if (isAliasOnlyStructuralAuthorityLeaf(leaf, preparedQuery)) {
        score -= 4;
    }
    // Fallback specialization signal for when leafStructure.specializationKinds is empty/unclassified
    // for every tied candidate (so the block below never fires): penalize title tokens the query didn't
    // ask for and that aren't generic role descriptors (e.g. "bicycle"/"marine" vs "vehicle"/"technician"),
    // so a base/generic leaf is preferred over an unrelated specialization when the query's own
    // specialization isn't present among the candidates.
    const closeness = leaf.closeness;
    if (closeness) {
        const unsupportedSpecificModifierCount = closeness.extraTitleTokens.length - closeness.extraGenericModifiers.length;
        score -= unsupportedSpecificModifierCount;
    }
    if (!structure) {
        return score;
    }
    if (structure.baseRoleKind === 'generic_base_role') {
        score += 3;
    }
    if (structure.headPreservingSpecialization && leafCanonicalCoversRoleHead(leaf, preparedQuery)) {
        score += 1;
    }
    if (structure.authorityKind !== 'none' && !preparedQueryRequestsAuthority(preparedQuery, structure.authorityKind)) {
        score -= 4;
    }
    const specializationKinds = resolveLeafSpecializationKinds(specializationKindsCache, leaf.graphNodeId, structure, leaf.canonicalLabel);
    for (const kind of specializationKinds) {
        score += preparedQuerySupportsSpecializationKind(preparedQuery, kind) ? 2 : -2;
    }
    return score;
}
// Closeness among structurally-compatible candidates (resolution.md last-mile selection): rewards
// leaves whose authority/specialization kinds actually agree with what the query expressed, and
// rewards plain leaves that carry no authority/specialization kind at all as the safe default when
// the query gives no such signal either way. Kept separate from leafStructuralPreferenceScore, which
// mixes in coverage/canonical-match terms that are unrelated to structural closeness.
function leafStructuralAlignmentScore(leaf, preparedQuery, specializationKindsCache) {
    const structure = leaf.leafStructure;
    if (!structure || isFamilyNodePseudoLeaf(leaf)) {
        return 0;
    }
    if (structure.authorityKind !== 'none') {
        return preparedQueryRequestsAuthority(preparedQuery, structure.authorityKind) ? 1 : -2;
    }
    const specializationKinds = resolveLeafSpecializationKinds(specializationKindsCache, leaf.graphNodeId, structure, leaf.canonicalLabel);
    if (specializationKinds.length === 0) {
        return 1;
    }
    let score = 0;
    for (const kind of specializationKinds) {
        score += preparedQuerySupportsSpecializationKind(preparedQuery, kind) ? 1 : -1;
    }
    return score;
}
function isSingleHeadOrBroadRoleQuery(preparedQuery) {
    return preparedQuery.usefulFoldedRecallTokens.length <= 1 || isBroadRoleQuery(preparedQuery);
}
function leafHasSupportedStructuralSpecialization(leaf, preparedQuery, specializationKindsCache) {
    const structure = leaf.leafStructure;
    if (!structure) {
        return false;
    }
    const specializationKinds = resolveLeafSpecializationKinds(specializationKindsCache, leaf.graphNodeId, structure, leaf.canonicalLabel);
    return specializationKinds.some((kind) => preparedQuerySupportsSpecializationKind(preparedQuery, kind));
}
function isAliasOnlyStructuralAuthorityLeaf(leaf, preparedQuery) {
    if (isRawExactMatch(leaf, preparedQuery)) {
        return false;
    }
    const exactOrFoldedAliasAuthority = leaf.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias') &&
        leaf.closeness?.matchedLabelSource === 'alias';
    if (!exactOrFoldedAliasAuthority) {
        return false;
    }
    return canonicalUsefulCoverage(leaf, preparedQuery) < 1;
}
function hasUnsafeStructuralLeafPromotion(leaf, preparedQuery) {
    const structure = leaf.leafStructure;
    if (!structure) {
        return false;
    }
    if (isAliasOnlyStructuralAuthorityLeaf(leaf, preparedQuery) && !isRawExactMatch(leaf, preparedQuery)) {
        return true;
    }
    if (structure.authorityKind !== 'none' && !preparedQueryRequestsAuthority(preparedQuery, structure.authorityKind)) {
        return !isRawExactMatch(leaf, preparedQuery);
    }
    return false;
}
function canonicalUsefulCoverage(leaf, preparedQuery) {
    const cachedByLeaf = CANONICAL_USEFUL_COVERAGE_CACHE.get(preparedQuery);
    if (cachedByLeaf?.has(leaf)) {
        return cachedByLeaf.get(leaf) ?? 0;
    }
    const canonicalTokens = new Set(canonicalLabelTokens(leaf.canonicalLabel));
    const usefulFoldedRecallTokens = preparedQuery.usefulFoldedRecallTokens;
    if (usefulFoldedRecallTokens.length === 0) {
        return 0;
    }
    const matchedCount = usefulFoldedRecallTokens.filter((token) => tokenMatchesLabelTokens(token, canonicalTokens)).length;
    const coverage = matchedCount / usefulFoldedRecallTokens.length;
    if (cachedByLeaf) {
        cachedByLeaf.set(leaf, coverage);
    }
    else {
        CANONICAL_USEFUL_COVERAGE_CACHE.set(preparedQuery, new Map([[leaf, coverage]]));
    }
    return coverage;
}
function canonicalTokenCount(label) {
    return canonicalLabelTokens(label).length;
}
function intentRoleQuery(preparedQuery) {
    return (preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedRecallTokens.join(' ').trim() || preparedQuery.normalized);
}
function hasLeafRoleGrounding(leaf, preparedQuery) {
    if (preparedQuery.intent.roleTokens.length === 0) {
        return true;
    }
    if (hasRawQueryExactCanonical(leaf, preparedQuery)) {
        return true;
    }
    if (hasRawQueryExactAlias(leaf, preparedQuery)) {
        return true;
    }
    const labels = [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ];
    const roleTokens = groundingRoleTokens(preparedQuery);
    const roleMatch = matchedIntentTokens(roleTokens, labels);
    return hasSufficientRoleMatchCount(preparedQuery, roleMatch.matched.length);
}
function hasFamilyRoleGrounding(family, preparedQuery) {
    if (preparedQuery.intent.roleTokens.length === 0) {
        return true;
    }
    if (family.evidence.some((record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
        return true;
    }
    if (maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery)) {
        return true;
    }
    if (maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery)) {
        return true;
    }
    return family.leaves.some((leaf) => hasLeafRoleGrounding(leaf, preparedQuery));
}
function structuralFamilyAuthority(familyNodeId, preparedQuery) {
    const comparison = compareFamilyStructureToQuery(familyNodeId, familyStructureQueryTokens(preparedQuery), preparedQuery.locale);
    if (comparison.hardRejected) {
        return 0;
    }
    const rawScore = familyStructureSupportScore(comparison);
    const aligned = new Set(comparison.alignedDimensions);
    const hasRole = aligned.has('role_heads');
    const hasIndependentSupport = aligned.has('occupation_level') ||
        aligned.has('activities') ||
        aligned.has('work_objects') ||
        aligned.has('knowledge_domains') ||
        aligned.has('settings') ||
        aligned.has('transport_mode') ||
        aligned.has('authority_band');
    if (!hasRole || !hasIndependentSupport || rawScore < 18) {
        return 0;
    }
    return Math.min(rawScore, 25) / 25;
}
function isFamilyNodePseudoLeaf(leaf) {
    return leaf.familyKind === 'family' && leaf.graphNodeId === leaf.familyNodeId;
}
// A leaf recovered purely as a family sweep-in (only `graph_family_recovery` evidence, normalized to
// 0 everywhere else in this file) carries no signal that the query actually relates to it -- e.g. an
// unrelated "coachbuilder"/"greaser" leaf pulled in just because it belongs to the winning family. Such
// leaves must not count toward family-level structural tie-break signals (leafStructuralAlignmentScore,
// leafStructuralPreferenceScore), or a family wins the tie-break merely for happening to contain some
// untagged, query-irrelevant leaf rather than for genuinely matching the query.
function hasGenuineLeafEvidence(leaf) {
    return leaf.evidence.some((record) => record.channel !== 'graph_family_recovery');
}
function hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery) {
    return isRawExactMatch(leaf, preparedQuery);
}
function isLeafPromotableByRoleCompatibility(leaf, preparedQuery) {
    if (isFamilyNodePseudoLeaf(leaf)) {
        return false;
    }
    if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
        return true;
    }
    return roleCompatibility(leaf, preparedQuery) === 'compatible';
}
function leafSpecializationSupport(leaf, preparedQuery) {
    if (isFamilyNodePseudoLeaf(leaf)) {
        return 'unsupported';
    }
    if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
        return 'supported';
    }
    const structure = leaf.leafStructure;
    if (!structure) {
        return 'neutral';
    }
    if (structure.authorityKind !== 'none' && !preparedQueryRequestsAuthority(preparedQuery, structure.authorityKind)) {
        return 'unsupported';
    }
    if (structure.authorityKind !== 'none') {
        return 'supported';
    }
    if (structure.specializationKinds.some((kind) => preparedQuerySupportsSpecializationKind(preparedQuery, kind))) {
        return 'supported';
    }
    return 'neutral';
}
function roleCompatibility(leaf, preparedQuery) {
    if (isFamilyNodePseudoLeaf(leaf)) {
        return 'incompatible';
    }
    if (preparedQuery.intent.roleTokens.length === 0) {
        return 'unknown';
    }
    if (hasUnsafeStructuralLeafPromotion(leaf, preparedQuery)) {
        return 'incompatible';
    }
    if (isRawExactMatch(leaf, preparedQuery)) {
        return 'compatible';
    }
    if (maxIntentRoleHeadEvidenceCoverage(leaf.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery)) {
        return 'compatible';
    }
    if (hasLeafRoleGrounding(leaf, preparedQuery)) {
        return 'weakly_compatible';
    }
    return 'incompatible';
}
function maxIntentRoleHeadEvidenceCoverage(evidence, preparedQuery) {
    const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    const altRoleHeadTokens = preparedQuery.intent.altRoleHeadTokens;
    if (roleHeadTokens.length === 0) {
        return 0;
    }
    let maxCoverage = 0;
    for (const record of evidence) {
        const matchedRoleTerms = stringArrayDetail(record.details.matched_role_terms);
        const matchedRoleHeadTerms = roleHeadTokens.filter((token) => tokenListHasEquivalent(matchedRoleTerms, token));
        if (matchedRoleHeadTerms.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedRoleHeadTerms.length / roleHeadTokens.length);
            continue;
        }
        const matchedTokens = stringArrayDetail(record.details.matched_tokens);
        const matchedHeads = roleHeadTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));
        if (matchedHeads.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedHeads.length / roleHeadTokens.length);
            continue;
        }
        // roleHeadTokens/matchedRoleTerms above are in the query's own locale -- a curated cross-locale
        // synonym (e.g. ro "consilier" matched against an English canonical/alias term) would otherwise
        // count as zero coverage here. altRoleHeadTokens is the safe English equivalent resolved once at
        // intent-build time (query-intent.ts); treat any hit against it as full coverage for this record.
        if (tokensOverlap(altRoleHeadTokens, matchedRoleTerms) || tokensOverlap(altRoleHeadTokens, matchedTokens)) {
            maxCoverage = Math.max(maxCoverage, 1);
        }
    }
    return clampScore(maxCoverage);
}
function tokensOverlap(altTerms, candidateTerms) {
    if (altTerms.length === 0 || candidateTerms.length === 0) {
        return false;
    }
    const foldedCandidates = new Set(candidateTerms.map((term) => foldSearchText(term)));
    return altTerms.some((term) => foldedCandidates.has(term));
}
function maxIntentRoleEvidenceCoverage(evidence, preparedQuery) {
    const roleTokens = groundingRoleTokens(preparedQuery);
    if (roleTokens.length === 0) {
        return 0;
    }
    let maxCoverage = 0;
    for (const record of evidence) {
        const explicitCoverage = numericDetail(record.details.role_coverage);
        if (explicitCoverage !== null) {
            maxCoverage = Math.max(maxCoverage, explicitCoverage);
            continue;
        }
        const matchedRoleTerms = stringArrayDetail(record.details.matched_role_terms);
        if (matchedRoleTerms.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedRoleTerms.length / roleTokens.length);
            continue;
        }
        const matchedTokens = stringArrayDetail(record.details.matched_tokens);
        const matchedRoleTokens = roleTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));
        if (matchedRoleTokens.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedRoleTokens.length / roleTokens.length);
        }
    }
    return clampScore(maxCoverage);
}
// Unlike maxIntentRoleEvidenceCoverage, this checks coverage of the query's FULL role-token set (not
// just groundingRoleTokens, which can collapse to a single authoritative head token and hide whether a
// family's evidence also covers the query's other role tokens) across ALL evidence channels, including
// lexical — so a family whose strongest support is full-phrase lexical evidence isn't scored as if it
// had no role-token coverage just because that evidence isn't attached to a specific leaf yet.
function maxFullRoleTokenEvidenceCoverage(evidence, preparedQuery) {
    // `intent.roleTokens` classification is order-sensitive (see occupation-candidates.ts
    // retrieveAliasNgramMatches for the same issue) and can drop the single most discriminating query
    // token entirely, understating how well a family's evidence actually covers the query. Union with
    // `usefulFoldedRecallTokens`, which stays stable across reorderings, so a family that matches the dropped
    // token isn't denied credit for it while a family that never matched it isn't unfairly boosted either.
    const roleTokens = [...new Set([...preparedQuery.intent.roleTokens, ...preparedQuery.usefulFoldedRecallTokens])];
    if (roleTokens.length === 0) {
        return 0;
    }
    let maxCoverage = 0;
    for (const record of evidence) {
        const matchedTokens = stringArrayDetail(record.details.matched_tokens);
        const matchedRoleTokens = roleTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));
        if (matchedRoleTokens.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedRoleTokens.length / roleTokens.length);
        }
    }
    return clampScore(maxCoverage);
}
function maxIntentDomainEvidenceCoverage(evidence, preparedQuery) {
    const domainTokens = preparedQuery.intent.domainTokens;
    if (domainTokens.length === 0) {
        return 0;
    }
    let maxCoverage = 0;
    for (const record of evidence) {
        const explicitCoverage = numericDetail(record.details.domain_coverage);
        if (explicitCoverage !== null) {
            maxCoverage = Math.max(maxCoverage, explicitCoverage);
            continue;
        }
        const matchedDomainTerms = stringArrayDetail(record.details.matched_domain_terms);
        if (matchedDomainTerms.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedDomainTerms.length / domainTokens.length);
        }
    }
    return clampScore(maxCoverage);
}
function roleCoverageForLabels(preparedQuery, labels) {
    const roleTokens = groundingRoleTokens(preparedQuery);
    if (roleTokens.length === 0) {
        return 0;
    }
    const match = matchedIntentTokens(roleTokens, labels);
    if (!hasSufficientRoleMatchCount(preparedQuery, match.matched.length)) {
        return 0;
    }
    return clampScore(match.matched.length / roleTokens.length);
}
function domainSupportForLabels(preparedQuery, labels) {
    const domainTokens = preparedQuery.intent.domainTokens;
    if (domainTokens.length === 0) {
        return 0;
    }
    const match = matchedIntentTokens(domainTokens, labels);
    return clampScore(match.matched.length / domainTokens.length);
}
function matchedIntentTokens(tokens, labels) {
    const labelTokens = new Set(labels.flatMap((label) => tokenizeNormalizedText(foldSearchText(label))));
    const matched = tokens.filter((token) => tokenMatchesLabelTokens(token, labelTokens));
    return {
        matched: Array.from(new Set(matched)).sort(),
        missing: tokens.filter((token) => !matched.includes(token))
    };
}
function groundingRoleTokens(preparedQuery) {
    const minimumMatches = minimumRequiredRoleMatches(preparedQuery);
    if (minimumMatches > 1) {
        return preparedQuery.intent.roleTokens;
    }
    const authoritativeHeads = authoritativeIntentRoleHeadTokens(preparedQuery);
    return authoritativeHeads.length > 0 ? authoritativeHeads : preparedQuery.intent.roleTokens;
}
function minimumRequiredRoleMatches(preparedQuery) {
    if (preparedQuery.intent.roleTokens.length === 0) {
        return 0;
    }
    if (preparedQuery.intent.roleHeadRequiresContext &&
        preparedQuery.intent.roleHeadHasContext &&
        preparedQuery.intent.roleTokens.length > authoritativeIntentRoleHeadTokens(preparedQuery).length) {
        return Math.min(2, preparedQuery.intent.roleTokens.length);
    }
    return 1;
}
function minimumRoleCoverageRatio(preparedQuery) {
    const roleTokens = groundingRoleTokens(preparedQuery);
    if (roleTokens.length === 0) {
        return 0;
    }
    return minimumRequiredRoleMatches(preparedQuery) / roleTokens.length;
}
function hasSufficientRoleMatchCount(preparedQuery, matchedCount) {
    return matchedCount >= minimumRequiredRoleMatches(preparedQuery);
}
function tokenMatchesLabelTokens(token, labelTokens) {
    const foldedToken = foldSearchText(token);
    if (labelTokens.has(foldedToken)) {
        return true;
    }
    return expandTokenVariants([foldedToken], 'en').some((variant) => labelTokens.has(foldSearchText(variant)));
}
function tokenListHasEquivalent(values, token) {
    const valueTokens = new Set(values.map((value) => foldSearchText(value)));
    return tokenMatchesLabelTokens(token, valueTokens);
}
function stringArrayDetail(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
}
function numberArrayDetail(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'number' && Number.isFinite(item)) : [];
}
function stringDetail(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
function requireBranchExpansion(state) {
    if (!state.branchExpansion) {
        throw new Error('Pipeline branch expansion is missing.');
    }
    return state.branchExpansion;
}
function stageForChannel(channel) {
    if (channel === 'graph_family_recovery') {
        return 'family_constrained_recovery';
    }
    if (channel === 'exact_canonical' ||
        channel === 'exact_alias' ||
        channel === 'useful_exact' ||
        channel === 'folded_alias' ||
        channel === 'ngram_alias') {
        return 'alias_lexical';
    }
    if (channel === 'lexical' || channel === 'capability_task') {
        return 'lexical_retrieval';
    }
    if (channel === 'cross_locale_english_backbone') {
        return 'cross_locale_english_backbone';
    }
    if (channel === 'exact_family_canonical') {
        return 'family_profile';
    }
    if (channel === 'job_function_family_prior') {
        return 'job_function_context';
    }
    if (channel === 'generic_head_family_prior') {
        return 'generic_head_context';
    }
    if (channel === 'family_profile') {
        return 'family_profile';
    }
    return 'retrieval';
}
function ratioToScore(ratio, weak, strong) {
    if (ratio === null) {
        return 1;
    }
    if (ratio <= weak) {
        return BRANCH_MARGIN_POLICY.MIN_SCORE;
    }
    if (ratio >= strong) {
        return 1;
    }
    return roundScore(BRANCH_MARGIN_POLICY.MIN_SCORE + ((ratio - weak) / (strong - weak)) * BRANCH_MARGIN_POLICY.SCORE_RANGE);
}
function normalizeOptions(options) {
    const debugMode = options.debug === 'family-rank-output' ? 'family-rank-output' : options.debug === true ? 'full' : null;
    const debug = debugMode !== null;
    const requestedTopFamilyLimit = requirePositiveIntegerAtMost(options.topFamilyLimit ?? 10, 1000, 'top-family-limit');
    const requestedTopLeavesPerFamily = requirePositiveIntegerAtMost(options.topLeavesPerFamily ?? 3, 1000, 'top-leaves-per-family');
    const jobFunction = normalizeJobFunction(options.jobFunction);
    return {
        query: options.query?.trim() ?? '',
        locale: options.locale?.trim() || DEFAULT_RETRIEVAL_LOCALE,
        sourceName: options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME,
        limit: requirePositiveIntegerAtMost(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1000, 'limit'),
        evaluationQueryId: options.evaluationQueryId,
        siblingLimit: requireNonNegativeIntegerAtMost(options.siblingLimit ?? DEFAULT_SIBLING_LIMIT, 1000, 'sibling-limit'),
        topFamilyLimit: debug ? requestedTopFamilyLimit : Math.min(requestedTopFamilyLimit, 3),
        topLeavesPerFamily: debug ? requestedTopLeavesPerFamily : Math.min(requestedTopLeavesPerFamily, 3),
        disabledCommonRolePhraseRoleKeys: options.disabledCommonRolePhraseRoleKeys,
        debugCollector: options.debugCollector ?? null,
        debugMode,
        debugFamilyRankComparisonStrategies: options.debugFamilyRankComparisonStrategies ?? null,
        ...(jobFunction ? { jobFunction } : {}),
        debug
    };
}
function clampScore(value) {
    return roundScore(Math.max(0, Math.min(1, value)));
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
