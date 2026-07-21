import { expandTokenVariants, foldSearchText, normalizeQueryLocale, prepareFamilyScopedQueryFromPrepared, prepareQuery, tokenizeNormalizedText } from '../query/query-preparation.js';
import { occupationRoleHeadSharesEquivalentClass } from '../query/occupation-role-head-equivalence.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchExpander } from '../retrieval/occupation-candidate-branches.js';
import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_MODEL_KEY, DEFAULT_RETRIEVAL_LOCALE, OccupationCandidateRetriever } from '../retrieval/occupation-candidates.js';
import { createRetrievalEngine } from '../retrieval/retrieval-engine-factory.js';
import { FamilyDenseRetriever } from '../retrieval/family-dense-retriever.js';
import { TokenLeafClosenessRanker } from './ranking/leaf-closeness-ranker.js';
import { FamilyScopedLeafRanker } from './ranking/family-scoped-leaf-ranker.js';
import { LeafSelectionEvidenceRanker } from './ranking/leaf-selection-evidence-ranker.js';
import { CapabilityFitRanker } from './ranking/capability-fit-ranker.js';
import { FamilyProfileRetriever } from './family-profile-retriever.js';
import { BRANCH_MARGIN_POLICY, EVIDENCE_NORMALIZATION_POLICY, FAMILY_SCORING_POLICY, GENERIC_RISK_PENALTY, LEAF_SCORING_POLICY, NUMERIC_COMPARISON_POLICY, PIPELINE_DECISION_GATE } from '../scoring/scoring-policy.js';
import { hydrateRuntimeSearchMetaRecord, hydrateRuntimeSearchMetaRecords, loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import { timed } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost, requirePositiveIntegerAtMost } from '../utils/validation.js';
const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const FAMILY_SCOPED_LEAF_RANKER = new FamilyScopedLeafRanker();
const CAPABILITY_FIT_RANKER = new CapabilityFitRanker();
const LEAF_SELECTION_EVIDENCE_RANKER = new LeafSelectionEvidenceRanker();
const FAMILY_PROFILE_RETRIEVER = new FamilyProfileRetriever();
export class OccupationSearchPipeline {
    expander;
    occupationRetriever;
    constructor(expander = new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(null, createRetrievalEngine())), occupationRetriever = createRetrievalEngine().occupations) {
        this.expander = expander;
        this.occupationRetriever = occupationRetriever;
    }
    static withEngine(engine) {
        return new OccupationSearchPipeline(new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(null, engine)), engine.occupations);
    }
    static withRuntime(runtime) {
        return OccupationSearchPipeline.withEngine(runtime.retrievalEngine);
    }
    async run(options) {
        const normalizedOptions = normalizeOptions(options);
        const primaryBranchExpansion = await this.expander.run(normalizedOptions);
        const branchExpansions = [];
        if (shouldResolveIndependentOccupationSpans(primaryBranchExpansion.originalQuery, primaryBranchExpansion.querySpans)) {
            for (const span of primaryBranchExpansion.querySpans) {
                branchExpansions.push(await this.expander.run({
                    ...normalizedOptions,
                    query: span,
                    evaluationQueryId: undefined
                }));
            }
        }
        else {
            branchExpansions.push(primaryBranchExpansion);
        }
        if (branchExpansions.length > 1) {
            const spanResults = [];
            for (const [index, branchExpansion] of branchExpansions.entries()) {
                const spanOptions = {
                    ...normalizedOptions,
                    query: branchExpansion.originalQuery,
                    evaluationQueryId: undefined
                };
                const spanAttempt = await runPipelineAttempt(branchExpansion, spanOptions, this.occupationRetriever);
                const attempts = [summarizeAttempt(1, 'primary', spanAttempt, 'used', 'multi-span independent span retrieval attempt')];
                const result = toPipelineResult(spanAttempt, attempts);
                spanResults.push({
                    spanIndex: index + 1,
                    query: result.queryContext.query,
                    preparedQuery: result.preparedQuery,
                    decision: result.decision,
                    coverageStatus: result.coverageStatus,
                    rankedFamilies: result.rankedFamilies,
                    rankedLeaves: result.rankedLeaves,
                    debug: result.debug
                });
            }
            return toMultiSpanPipelineResult(primaryBranchExpansion, spanResults);
        }
        const primaryAttempt = await runPipelineAttempt(branchExpansions[0] ?? primaryBranchExpansion, normalizedOptions, this.occupationRetriever);
        const attempts = [summarizeAttempt(1, 'primary', primaryAttempt, 'used', 'primary retrieval attempt')];
        let selectedAttempt = primaryAttempt;
        if (shouldAttemptSynonymFallback(primaryAttempt.state)) {
            const fallbackOptions = await planSynonymFallbackAttempt(primaryAttempt.state, normalizedOptions);
            if (fallbackOptions) {
                const fallbackBranchExpansion = await this.expander.run(fallbackOptions);
                const fallbackAttempt = await runPipelineAttempt(fallbackBranchExpansion, normalizedOptions, this.occupationRetriever);
                attempts.push(summarizeAttempt(2, 'synonym_fallback', fallbackAttempt, 'used', 'single synonym fallback attempt'));
                selectedAttempt = chooseBetterAttempt(primaryAttempt, fallbackAttempt);
            }
            else {
                attempts.push({
                    attempt: 2,
                    kind: 'synonym_fallback',
                    query: primaryBranchExpansion.query,
                    status: 'skipped',
                    decisionType: primaryAttempt.state.decision.decisionType,
                    confidence: primaryAttempt.state.decision.confidence,
                    reason: 'fallback gate reached, but synonym fallback planner did not produce a safe alternate query'
                });
            }
        }
        return toPipelineResult(selectedAttempt, attempts);
    }
}
function shouldResolveIndependentOccupationSpans(originalQuery, querySpans) {
    return querySpans.length > 1 && hasIndependentOccupationSpanSeparator(originalQuery);
}
function hasIndependentOccupationSpanSeparator(value) {
    return /[\r\n\t;•·▪‣◦|/]+/iu.test(value);
}
async function runPipelineAttempt(branchExpansion, options, occupationRetriever) {
    const intentVocabularyArtifact = await timed(() => loadOccupationIntentVocabularyArtifactRequired(branchExpansion.sourceName), 'pipeline.intent_vocabulary.artifact_load', branchExpansion.timings);
    const preparedQuery = await prepareQuery(branchExpansion.query, branchExpansion.locale, {
        sourceName: branchExpansion.sourceName,
        intentVocabulary: intentVocabularyArtifact.artifact
    });
    const familyScopedPreparedQuery = prepareFamilyScopedQueryFromPrepared(preparedQuery);
    const roleQuery = intentRoleQuery(preparedQuery);
    const rolePreparedQuery = await prepareQuery(roleQuery, branchExpansion.locale, {
        sourceName: branchExpansion.sourceName,
        intentVocabulary: intentVocabularyArtifact.artifact
    });
    let state = {
        occupationRetriever,
        preparedQuery,
        familyScopedPreparedQuery,
        rolePreparedQuery,
        roleFamilyScopedPreparedQuery: prepareFamilyScopedQueryFromPrepared(rolePreparedQuery),
        branchExpansion,
        candidateFamilies: new Map(),
        candidateLeafs: new Map(),
        recoveredAliasesByNodeId: new Map(),
        recoveredCapabilityLabelsByNodeId: new Map(),
        familyDenseDiagnostics: [],
        timings: { ...branchExpansion.timings },
        rankedFamilies: [],
        rankedLeaves: [],
        decision: null,
        stages: [],
        topFamilyLimit: options.topFamilyLimit,
        topLeavesPerFamily: options.topLeavesPerFamily
    };
    const stages = [
        accumulateCurrentRetrievalEvidenceStage,
        retrieveFamilyProfileEvidenceStage,
        consolidateFamiliesStage,
        recoverLeavesInsideTopFamiliesStage,
        narrowLeavesWithinFamiliesStage,
        selectPipelineDecisionStage
    ];
    for (const stage of stages) {
        state = await timed(() => stage(state), `pipeline.stage.${stage.name || 'anonymous'}`, state.timings);
    }
    if (!state.decision) {
        throw new Error('Pipeline did not produce a decision.');
    }
    return {
        branchExpansion,
        state: {
            ...state,
            decision: state.decision
        }
    };
}
async function retrieveFamilyProfileEvidenceStage(state) {
    const branchExpansion = requireBranchExpansion(state);
    const familyProfileArtifact = await timed(() => loadOccupationFamilyProfileArtifactRequired(branchExpansion.sourceName), 'pipeline.family_profile.artifact_load', state.timings);
    const profileHits = await timed(() => FAMILY_PROFILE_RETRIEVER.retrieve({
        preparedQuery: state.familyScopedPreparedQuery,
        profiles: familyProfileArtifact.artifact.records,
        locale: branchExpansion.locale,
        limit: Math.max(state.topFamilyLimit * 3, 12)
    }), 'pipeline.family_profile.retrieve', state.timings);
    for (const hit of profileHits) {
        const family = getOrCreateProfileFamily(state, hit);
        family.evidence.push(familyProfileEvidence(hit));
        for (const leafId of hit.matchingLeafIds) {
            family.supportingLeafIds.add(leafId);
        }
    }
    return {
        ...state,
        stages: [...state.stages, 'retrieve_family_profile_evidence']
    };
}
function shouldAttemptSynonymFallback(state) {
    const topFamily = state.rankedFamilies[0] ?? null;
    const topLeaf = topFamily?.leaves[0] ?? null;
    if (state.decision.decisionType === 'unresolved') {
        return true;
    }
    if (state.decision.decisionType === 'family' || state.decision.decisionType === 'group') {
        return state.decision.confidence < PIPELINE_DECISION_GATE.SYNONYM_FALLBACK_FAMILY_CONFIDENCE;
    }
    return !topLeaf || topLeaf.confidence < PIPELINE_DECISION_GATE.SYNONYM_FALLBACK_LEAF_CONFIDENCE;
}
async function planSynonymFallbackAttempt(_state, _options) {
    // Deliberately no-op until synonym lookup is implemented. The pipeline loop is now ready for a
    // single bounded fallback attempt without changing the primary scoring path.
    return null;
}
function chooseBetterAttempt(primary, fallback) {
    const primaryDecision = primary.state.decision;
    const fallbackDecision = fallback.state.decision;
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
function summarizeAttempt(attempt, kind, result, status, reason) {
    return {
        attempt,
        kind,
        query: result.branchExpansion.query,
        status,
        decisionType: result.state.decision.decisionType,
        confidence: result.state.decision.confidence,
        reason
    };
}
function toPipelineResult(attempt, attempts) {
    const branchExpansion = attempt.branchExpansion;
    const state = attempt.state;
    return {
        queryContext: queryContextFromBranchExpansion(branchExpansion),
        preparedQuery: state.preparedQuery,
        decision: state.decision,
        coverageStatus: buildCoverageStatus(state.decision, state.rankedFamilies[0] ?? null, state.preparedQuery),
        spanResults: [],
        rankedFamilies: state.rankedFamilies,
        rankedLeaves: state.rankedLeaves,
        debug: {
            stages: state.stages,
            attempts,
            familyDenseHits: state.familyDenseDiagnostics,
            timings: state.timings,
            rawBranchExpansion: branchExpansion
        }
    };
}
function toMultiSpanPipelineResult(branchExpansion, spanResults) {
    const confidence = spanResults.length === 0
        ? 0
        : roundScore(spanResults.reduce((sum, span) => sum + span.decision.confidence, 0) / spanResults.length);
    const preparedQuery = emptyPreparedQuery(branchExpansion);
    const decision = {
        decisionType: 'multi_span',
        selectedNodeId: null,
        selectedLabel: null,
        confidence,
        reason: 'query preparation split the submitted title into multiple independent occupation spans'
    };
    return {
        queryContext: queryContextFromBranchExpansion(branchExpansion, {
            scannedAliasHitCount: sumSpanMetric(spanResults, (span) => span.debug.rawBranchExpansion.scannedAliasHitCount),
            scannedOpenSearchHitCount: sumSpanMetric(spanResults, (span) => span.debug.rawBranchExpansion.scannedOpenSearchHitCount),
            scannedDenseEmbeddingCount: sumSpanMetric(spanResults, (span) => span.debug.rawBranchExpansion.scannedDenseEmbeddingCount)
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
            familyDenseHits: spanResults.flatMap((span) => span.debug.familyDenseHits),
            timings: mergeSpanTimings(branchExpansion.timings, spanResults),
            rawBranchExpansion: branchExpansion
        }
    };
}
function queryContextFromBranchExpansion(branchExpansion, scannedCounts = {}) {
    return {
        originalQuery: branchExpansion.originalQuery,
        query: branchExpansion.query,
        querySpans: branchExpansion.querySpans,
        locale: branchExpansion.locale,
        querySignals: branchExpansion.querySignals,
        keptQuerySignals: branchExpansion.keptQuerySignals,
        querySignalCleaningMs: branchExpansion.querySignalCleaningMs,
        roleSpanSelection: branchExpansion.roleSpanSelection,
        sourceName: branchExpansion.sourceName,
        retrievalProfile: branchExpansion.retrievalProfile,
        modelKey: branchExpansion.modelKey,
        modelDimensions: branchExpansion.modelDimensions,
        limit: branchExpansion.limit,
        siblingLimit: branchExpansion.siblingLimit,
        evaluationQueryId: branchExpansion.evaluationQueryId,
        scannedAliasHitCount: scannedCounts.scannedAliasHitCount ?? branchExpansion.scannedAliasHitCount,
        scannedOpenSearchHitCount: scannedCounts.scannedOpenSearchHitCount ?? branchExpansion.scannedOpenSearchHitCount,
        scannedDenseEmbeddingCount: scannedCounts.scannedDenseEmbeddingCount ?? branchExpansion.scannedDenseEmbeddingCount
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
        folded: '',
        surfaceTokens: [],
        tokens: [],
        foldedTokens: [],
        usefulTokens: [],
        usefulFoldedTokens: [],
        expandedTokens: [],
        expandedFoldedTokens: [],
        genericTokens: [],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: [],
        acronymTokens: [],
        compoundSplitTokens: [],
        compoundSplitFoldedTokens: [],
        intent: {
            roleTokens: [],
            roleHeadTokens: [],
            domainTokens: [],
            seniorityTokens: [],
            credentialTokens: [],
            ambiguousTokens: [],
            unresolvedModifierTokens: [],
            confidence: 0,
            diagnostics: [],
        },
        isGenericShape: false
    };
}
function buildCoverageStatus(decision, topFamily, preparedQuery) {
    const topLeaf = topFamily?.leaves[0] ?? null;
    const closeness = topLeaf?.closeness ?? null;
    const crossLocaleBackboneSupported = topFamily?.evidenceTier === 'cross_locale_backbone' ||
        Boolean(topFamily?.evidence.some((record) => record.channel === 'cross_locale_english_backbone'));
    const crossLocaleFamilyOnly = Boolean(crossLocaleBackboneSupported && (decision.decisionType === 'family' || decision.decisionType === 'group'));
    const exactCanonicalAvailable = Boolean(decision.decisionType === 'leaf' &&
        closeness &&
        closeness.matchedLabelSource === 'canonical' &&
        (closeness.exactNormalizedLabel || closeness.exactFoldedLabel));
    const closestMatchAvailable = Boolean(topLeaf || topFamily);
    const hasUnrepresentedQueryTerms = Boolean(closeness && closeness.missingUsefulTokens.length > 0);
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
        const family = getOrCreateFamily(state, branch, branchShare, branchMarginRatio);
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
            const leaf = getOrCreateLeaf(state, branch, candidate);
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
                const crossLocaleSearchMetaRecord = searchMetaArtifact?.recordsByNodeId.get(candidate.graphNodeId) ?? null;
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
    return {
        ...state,
        stages: [...state.stages, 'accumulate_current_retrieval_evidence']
    };
}
async function consolidateFamiliesStage(state) {
    const rankedFamilies = Array.from(state.candidateFamilies.values())
        .map((family) => scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.rolePreparedQuery))
        .sort(compareFamilies)
        .slice(0, state.topFamilyLimit)
        .map((family, index) => ({
        ...family,
        rank: index + 1,
        supportingLeafCount: family.supportingLeafIds.size,
        leaves: []
    }));
    return {
        ...state,
        rankedFamilies,
        stages: [...state.stages, 'consolidate_families']
    };
}
async function recoverLeavesInsideTopFamiliesStage(state) {
    if (state.rankedFamilies.length === 0) {
        return {
            ...state,
            stages: [...state.stages, 'recover_leaves_inside_top_families']
        };
    }
    const familyIds = state.rankedFamilies
        .filter((family) => family.familyKind === 'family')
        .map((family) => family.familyNodeId);
    if (familyIds.length === 0) {
        return {
            ...state,
            stages: [...state.stages, 'recover_leaves_inside_top_families']
        };
    }
    const branchExpansion = requireBranchExpansion(state);
    const searchMetaArtifact = await timed(() => loadOccupationSearchMetaArtifactRequired(branchExpansion.sourceName), 'pipeline.family_recovery.search_meta_artifact_load', state.timings);
    const recoveredRecords = await timed(() => loadFamilyLeafRecoveryRecords(searchMetaArtifact.leafRecordsByFamilyNodeId, familyIds), 'pipeline.family_recovery.load_family_leaf_records', state.timings);
    await timed(() => hydrateRuntimeSearchMetaRecords(searchMetaArtifact, recoveredRecords), 'pipeline.family_recovery.hydrate_leaf_details', state.timings);
    const recoveredRows = await timed(() => recoveredRecords.map(toFamilyLeafRecoveryFields), 'pipeline.family_recovery.map_recovered_rows', state.timings);
    const aliasesByNodeId = await timed(() => loadLeafAliasesFromRecords(recoveredRecords, state.familyScopedPreparedQuery.locale), 'pipeline.family_recovery.load_leaf_aliases', state.timings);
    const capabilityLabelsByNodeId = await timed(() => loadLeafCapabilityLabelsFromRecords(recoveredRecords), 'pipeline.family_recovery.load_capability_labels', state.timings);
    const [lexicalHitsByNodeId, denseRetrieval] = await Promise.all([
        timed(() => retrieveLexicalFamilyHits(state, familyIds, state.occupationRetriever), 'pipeline.family_recovery.lexical_family_hits', state.timings),
        timed(() => retrieveDenseFamilyHits(state, familyIds), 'pipeline.family_recovery.dense_family_hits', state.timings)
    ]);
    const denseHitsByNodeId = denseRetrieval.hitsByNodeId;
    const familiesByKey = new Map(state.rankedFamilies.map((family) => [family.familyKey, family]));
    for (const row of recoveredRows) {
        const familyKey = `family:${row.family_node_id}`;
        const family = familiesByKey.get(familyKey);
        if (!family) {
            continue;
        }
        const existing = state.candidateLeafs.get(row.graph_node_id);
        const lexicalHit = lexicalHitsByNodeId.get(row.graph_node_id) ?? null;
        const denseHit = denseHitsByNodeId.get(row.graph_node_id) ?? null;
        if (existing) {
            if (lexicalHit) {
                existing.evidence.push(lexicalFamilyEvidence(lexicalHit));
            }
            if (denseHit) {
                existing.evidence.push(denseFamilyEvidence(denseHit));
            }
            continue;
        }
        const evidence = [
            ...(lexicalHit ? [lexicalFamilyEvidence(lexicalHit)] : []),
            ...(denseHit ? [denseFamilyEvidence(denseHit)] : [])
        ];
        if (evidence.length === 0) {
            evidence.push({
                channel: 'graph_family_recovery',
                score: family.confidence,
                sourceStage: 'family_constrained_recovery',
                details: {
                    family_node_id: row.family_node_id,
                    family_label: row.family_label
                }
            });
        }
        state.candidateLeafs.set(row.graph_node_id, {
            graphNodeId: row.graph_node_id,
            canonicalLabel: row.canonical_label,
            familyKey,
            familyKind: 'family',
            familyNodeId: row.family_node_id,
            familyLabel: row.family_label,
            genericRisk: row.generic_risk,
            hasHierarchy: row.has_hierarchy === 1,
            hasCapabilitySupport: row.has_capability_support === 1,
            evidence,
            closeness: null,
            familyScopedFit: null,
            capabilityFit: null,
            selectionEvidence: null,
            score: 0,
            confidence: 0
        });
    }
    const recoveredLeafCountsByFamilyKey = countCandidateLeavesByFamilyKey(state.candidateLeafs);
    return {
        ...state,
        recoveredAliasesByNodeId: mergeStringMap(state.recoveredAliasesByNodeId, aliasesByNodeId),
        recoveredCapabilityLabelsByNodeId: mergeStringMap(state.recoveredCapabilityLabelsByNodeId, capabilityLabelsByNodeId),
        familyDenseDiagnostics: denseRetrieval.diagnostics,
        rankedFamilies: state.rankedFamilies.map((family) => ({
            ...family,
            supportingLeafCount: recoveredLeafCountsByFamilyKey.get(family.familyKey) ?? 0
        })),
        stages: [...state.stages, 'recover_leaves_inside_top_families']
    };
}
async function retrieveDenseFamilyHits(state, familyNodeIds) {
    const branchExpansion = requireBranchExpansion(state);
    const retriever = new FamilyDenseRetriever();
    const familyScopedDenseQuery = state.roleFamilyScopedPreparedQuery.familyScopedTokens.join(' ') ||
        state.roleFamilyScopedPreparedQuery.normalized ||
        state.familyScopedPreparedQuery.familyScopedTokens.join(' ') ||
        state.familyScopedPreparedQuery.normalized;
    const hits = await retriever.retrieve({
        query: familyScopedDenseQuery,
        sourceName: branchExpansion.sourceName,
        modelKey: branchExpansion.modelKey,
        familyNodeIds,
        limit: Math.max(state.topLeavesPerFamily * familyNodeIds.length * 6, 50),
        timings: state.timings
    });
    const hitsByNodeId = new Map();
    for (const hit of hits) {
        hitsByNodeId.set(hit.graphNodeId, hit);
    }
    const diagnostics = hits.slice(0, 20).map((hit, index) => ({
        rank: index + 1,
        graphNodeId: hit.graphNodeId,
        canonicalLabel: hit.canonicalLabel,
        familyNodeId: hit.familyNodeId,
        familyLabel: hit.familyLabel,
        score: hit.score,
        dot: hit.dot
    }));
    return { hitsByNodeId, diagnostics };
}
async function retrieveLexicalFamilyHits(state, familyNodeIds, retriever) {
    const branchExpansion = requireBranchExpansion(state);
    const hitsByNodeId = new Map();
    for (const familyNodeId of familyNodeIds) {
        const hits = await retriever.retrieveWithinFamily({
            // Family-constrained leaf recovery searches role intent only; domain/context terms are support evidence elsewhere.
            query: intentRoleQuery(state.preparedQuery),
            locale: branchExpansion.locale,
            sourceName: branchExpansion.sourceName,
            familyNodeId,
            limit: Math.max(state.topLeavesPerFamily * 4, 25)
        });
        for (const hit of hits) {
            const existing = hitsByNodeId.get(hit.graphNodeId);
            if (!existing || hit.score > existing.score) {
                hitsByNodeId.set(hit.graphNodeId, hit);
            }
        }
    }
    return hitsByNodeId;
}
function lexicalFamilyEvidence(hit) {
    return {
        channel: 'opensearch_lexical',
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
function denseFamilyEvidence(hit) {
    return {
        channel: 'dense_family_constrained',
        score: hit.score,
        sourceStage: 'dense_family_constrained',
        details: {
            cosine: hit.score,
            dot: hit.dot,
            text_role: 'dense_text'
        }
    };
}
async function narrowLeavesWithinFamiliesStage(state) {
    const rankedLeaves = [];
    const candidateLeavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
    const narrowedFamilies = state.rankedFamilies.map((family) => {
        const leaves = (candidateLeavesByFamilyKey.get(family.familyKey) ?? [])
            .map((leaf) => scoreLeafCandidate(leaf, family, state))
            .sort((left, right) => compareLeavesForQuery(left, right, state.preparedQuery))
            .slice(0, state.topLeavesPerFamily)
            .map((leaf, index) => ({ ...leaf, rank: index + 1 }));
        rankedLeaves.push(...leaves);
        return {
            ...family,
            leaves
        };
    });
    const rankedFamilies = rankFamiliesForSelectionAuthority(narrowedFamilies, state.preparedQuery);
    return {
        ...state,
        rankedFamilies,
        rankedLeaves,
        stages: [...state.stages, 'narrow_leaves_within_families']
    };
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
function countCandidateLeavesByFamilyKey(candidateLeafs) {
    const counts = new Map();
    for (const leaf of candidateLeafs.values()) {
        counts.set(leaf.familyKey, (counts.get(leaf.familyKey) ?? 0) + 1);
    }
    return counts;
}
function loadFamilyLeafRecoveryRecords(leafRecordsByFamilyNodeId, familyNodeIds) {
    const records = [];
    for (const familyNodeId of familyNodeIds) {
        records.push(...(leafRecordsByFamilyNodeId.get(familyNodeId) ?? []));
    }
    return records.sort((left, right) => (left.familyNodeId ?? 0) - (right.familyNodeId ?? 0) ||
        left.canonicalLabel.localeCompare(right.canonicalLabel));
}
function toFamilyLeafRecoveryFields(record) {
    return {
        graph_node_id: record.graphNodeId,
        canonical_label: record.canonicalLabel,
        generic_risk: record.genericRisk,
        has_hierarchy: record.hasHierarchy ? 1 : 0,
        has_capability_support: record.hasCapabilitySupport ? 1 : 0,
        family_node_id: record.familyNodeId,
        family_label: record.familyLabel ?? '',
        group_node_id: record.groupNodeId,
        group_label: record.groupLabel
    };
}
function loadLeafAliasesFromRecords(records, locale) {
    const aliasesByNodeId = new Map();
    for (const record of records) {
        const aliases = aliasesByNodeId.get(record.graphNodeId) ?? [];
        for (const alias of record.aliases) {
            if (alias.localeCode !== locale && alias.localeCode !== 'en') {
                continue;
            }
            if ((alias.aliasRole ?? (alias.isPrimary ? 'locale_primary' : 'locale_supporting')) === 'family_supporting') {
                continue;
            }
            aliases.push(alias.alias, alias.normalizedAlias);
        }
        aliasesByNodeId.set(record.graphNodeId, Array.from(new Set(aliases)));
    }
    return aliasesByNodeId;
}
function loadLeafCapabilityLabelsFromRecords(records) {
    const labelsByNodeId = new Map();
    for (const record of records) {
        const labels = labelsByNodeId.get(record.graphNodeId) ?? [];
        for (const capability of record.capabilityLabels) {
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
async function selectPipelineDecisionStage(state) {
    const topFamily = state.rankedFamilies[0] ?? null;
    const topLeaf = topFamily?.leaves[0] ?? null;
    if (topLeaf &&
        isLeafSelectable(topLeaf, topFamily, state.preparedQuery, state.rankedFamilies) &&
        !hasAmbiguousAliasLeafTie(topLeaf, topFamily) &&
        !hasUnsafeSpecializedLeafTie(topLeaf, topFamily, state.preparedQuery)) {
        return {
            ...state,
            decision: {
                decisionType: 'leaf',
                selectedNodeId: topLeaf.graphNodeId,
                selectedLabel: topLeaf.canonicalLabel,
                confidence: topLeaf.confidence,
                reason: 'top leaf inside top family cleared direct evidence and confidence gates'
            },
            stages: [...state.stages, 'select_decision']
        };
    }
    if (topFamily && topFamily.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE && hasFamilyRoleGrounding(topFamily, state.preparedQuery)) {
        return {
            ...state,
            decision: {
                decisionType: topFamily.familyKind === 'group' ? 'group' : 'family',
                selectedNodeId: topFamily.familyNodeId,
                selectedLabel: topFamily.familyLabel,
                confidence: topFamily.confidence,
                reason: 'top family cleared family-first confidence gate; leaf evidence stayed below safe promotion threshold'
            },
            stages: [...state.stages, 'select_decision']
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
                reason: 'top family had prepared multi-token phrase-window evidence; leaf evidence stayed below safe promotion threshold'
            },
            stages: [...state.stages, 'select_decision']
        };
    }
    return {
        ...state,
        decision: {
            decisionType: 'unresolved',
            selectedNodeId: null,
            selectedLabel: null,
            confidence: topFamily?.confidence ?? 0,
            reason: 'no family or leaf cleared the V2 pipeline confidence gates'
        },
        stages: [...state.stages, 'select_decision']
    };
}
function getOrCreateFamily(state, branch, branchShare, branchMarginRatio) {
    const existing = state.candidateFamilies.get(branch.branchKey);
    if (existing) {
        return existing;
    }
    const family = {
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
    state.candidateFamilies.set(branch.branchKey, family);
    return family;
}
function getOrCreateProfileFamily(state, hit) {
    return getOrCreateRuntimeFamily(state, {
        familyNodeId: hit.familyNodeId,
        familyLabel: hit.familyLabel,
        groupNodeId: hit.groupNodeId,
        groupLabel: hit.groupLabel
    });
}
function getOrCreateRuntimeFamily(state, input) {
    const familyKey = `family:${input.familyNodeId}`;
    const existing = state.candidateFamilies.get(familyKey);
    if (existing) {
        return existing;
    }
    const family = {
        familyKey,
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
    state.candidateFamilies.set(familyKey, family);
    return family;
}
function getOrCreateLeaf(state, branch, candidate) {
    const existing = state.candidateLeafs.get(candidate.graphNodeId);
    if (existing) {
        return existing;
    }
    const leaf = {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        familyKey: branch.branchKey,
        familyKind: branch.branchKind,
        familyNodeId: branch.branchNodeId,
        familyLabel: branch.branchLabel,
        genericRisk: candidate.genericRisk,
        hasHierarchy: candidate.hasHierarchy,
        hasCapabilitySupport: candidate.hasCapabilitySupport,
        evidence: [],
        closeness: null,
        familyScopedFit: null,
        capabilityFit: null,
        selectionEvidence: null,
        score: 0,
        confidence: 0
    };
    state.candidateLeafs.set(candidate.graphNodeId, leaf);
    return leaf;
}
function toPipelineEvidenceRecord(channel, score, details, evidence) {
    return {
        channel: channel === 'dense_embedding' ? 'dense_global' : channel,
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
    return {
        channel: 'family_profile',
        score: hit.score,
        sourceStage: 'family_profile',
        details: {
            family_node_id: hit.familyNodeId,
            family_label: hit.familyLabel,
            group_node_id: hit.groupNodeId,
            group_label: hit.groupLabel,
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
function scoreFamilyCandidate(family, leafsById, preparedQuery, rolePreparedQuery) {
    const evidenceTier = familyEvidenceTier(family.evidence);
    const supportingLeafs = Array.from(family.supportingLeafIds)
        .map((leafId) => leafsById.get(leafId))
        .filter((leaf) => leaf !== undefined);
    const leafFitScore = maxLeafFitScore(supportingLeafs, rolePreparedQuery);
    const roleCoverage = maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery);
    const domainCoverage = maxIntentDomainEvidenceCoverage(family.evidence, preparedQuery);
    const exactAliasScore = maxEvidenceScore(family.evidence, ['exact_alias']);
    const lexicalEvidenceScore = maxEvidenceScore(family.evidence, ['folded_alias', 'ngram_alias', 'opensearch_lexical', 'capability_task', 'family_profile']);
    const semanticEvidenceScore = maxEvidenceScore(family.evidence, ['dense_global', 'dense_folded', 'dense_family_constrained']);
    const branchStrength = Math.max(family.branchShare, ratioToScore(family.branchMarginRatio, BRANCH_MARGIN_POLICY.WEAK_RATIO, BRANCH_MARGIN_POLICY.STRONG_RATIO));
    const supportBreadth = Math.min(supportingLeafs.length, FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES) /
        FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES;
    const capabilitySupport = supportingLeafs.length === 0
        ? 0
        : supportingLeafs.filter((leaf) => leaf.hasCapabilitySupport).length / supportingLeafs.length;
    const genericPenalty = averageGenericPenalty(supportingLeafs);
    const exactAliasContribution = exactAliasScore * (FAMILY_SCORING_POLICY.EXACT_ALIAS_BASE_CONTRIBUTION +
        leafFitScore * FAMILY_SCORING_POLICY.EXACT_ALIAS_LEAF_FIT_WEIGHT);
    const authorityFloor = primaryUsefulExactAliasFloor(family.evidence, preparedQuery);
    const confidence = clampScore(Math.max(authorityFloor, branchStrength * FAMILY_SCORING_POLICY.HYBRID_BRANCH_STRENGTH_WEIGHT +
        supportBreadth * FAMILY_SCORING_POLICY.HYBRID_SUPPORT_BREADTH_WEIGHT +
        exactAliasContribution +
        lexicalEvidenceScore * FAMILY_SCORING_POLICY.LEXICAL_EVIDENCE_WEIGHT +
        semanticEvidenceScore * FAMILY_SCORING_POLICY.SEMANTIC_EVIDENCE_WEIGHT +
        roleCoverage * FAMILY_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
        domainCoverage * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        capabilitySupport * FAMILY_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT +
        leafFitScore * FAMILY_SCORING_POLICY.LEAF_FIT_WEIGHT -
        genericPenalty * FAMILY_SCORING_POLICY.GENERIC_PENALTY_WEIGHT));
    return {
        ...family,
        evidenceTier,
        evidenceTierRank: familyEvidenceTierRank(evidenceTier),
        score: confidence,
        confidence
    };
}
function maxLeafFitScore(leafs, preparedQuery) {
    if (leafs.length === 0) {
        return 0;
    }
    return Math.max(...leafs.map((leaf) => LEAF_CLOSENESS_RANKER.rank({
        preparedQuery,
        canonicalLabel: leaf.canonicalLabel,
        aliases: matchedAliasLabels(leaf.evidence)
    }).score));
}
function primaryUsefulExactAliasFloor(evidence, preparedQuery) {
    if (preparedQuery.modifierTokens.length === 0) {
        return 0;
    }
    const usefulQuery = preparedQuery.usefulFoldedTokens.join(' ');
    if (!usefulQuery) {
        return 0;
    }
    const hasPrimaryUsefulExactAlias = evidence.some((record) => {
        if (record.channel !== 'exact_alias') {
            return false;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        const foldedAlias = foldedAliasDetail(record);
        return aliasRole === 'locale_primary' && foldedAlias === usefulQuery;
    });
    return hasPrimaryUsefulExactAlias ? FAMILY_SCORING_POLICY.PRIMARY_USEFUL_EXACT_ALIAS_FLOOR : 0;
}
function scoreLeafCandidate(leaf, family, state) {
    const directEvidenceScore = maxEvidenceScore(leaf.evidence, ['exact_alias', 'folded_alias', 'ngram_alias', 'opensearch_lexical', 'capability_task']);
    const globalSemanticEvidenceScore = maxEvidenceScore(leaf.evidence, ['dense_global', 'dense_folded']);
    const familyConstrainedSemanticEvidenceScore = maxEvidenceScore(leaf.evidence, ['dense_family_constrained']);
    const familySupport = family.confidence;
    const hierarchySupport = leaf.hasHierarchy ? LEAF_SCORING_POLICY.HIERARCHY_SUPPORTED : LEAF_SCORING_POLICY.HIERARCHY_UNSUPPORTED;
    const capabilitySupport = leaf.hasCapabilitySupport ? LEAF_SCORING_POLICY.CAPABILITY_SUPPORTED : LEAF_SCORING_POLICY.CAPABILITY_UNSUPPORTED;
    const aliases = Array.from(new Set([
        ...matchedAliasLabels(leaf.evidence),
        ...(state.recoveredAliasesByNodeId.get(leaf.graphNodeId) ?? [])
    ]));
    const closeness = LEAF_CLOSENESS_RANKER.rank({
        preparedQuery: state.roleFamilyScopedPreparedQuery,
        canonicalLabel: leaf.canonicalLabel,
        aliases
    });
    const familyScopedFit = FAMILY_SCOPED_LEAF_RANKER.rank({
        preparedQuery: state.roleFamilyScopedPreparedQuery,
        canonicalLabel: leaf.canonicalLabel,
        aliases,
        capabilityLabels: state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? [],
        hasSemanticEvidence: globalSemanticEvidenceScore > 0 || familyConstrainedSemanticEvidenceScore > 0
    });
    const capabilityFit = CAPABILITY_FIT_RANKER.rank({
        preparedQuery: state.roleFamilyScopedPreparedQuery,
        capabilityLabels: state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? []
    });
    const roleCoverage = roleCoverageForLabels(state.preparedQuery, [leaf.canonicalLabel, ...aliases]);
    const domainSupport = domainSupportForLabels(state.preparedQuery, [leaf.canonicalLabel, ...aliases, ...(state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? [])]);
    const selectionEvidence = LEAF_SELECTION_EVIDENCE_RANKER.rank({
        evidence: leaf.evidence,
        closeness,
        familyScopedFit,
        capabilityFit
    });
    const confidence = clampScore(directEvidenceScore * LEAF_SCORING_POLICY.DIRECT_EVIDENCE_WEIGHT +
        globalSemanticEvidenceScore * LEAF_SCORING_POLICY.GLOBAL_SEMANTIC_EVIDENCE_WEIGHT +
        familyConstrainedSemanticEvidenceScore * LEAF_SCORING_POLICY.FAMILY_CONSTRAINED_SEMANTIC_EVIDENCE_WEIGHT +
        closeness.score * LEAF_SCORING_POLICY.CLOSENESS_WEIGHT +
        roleCoverage * LEAF_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
        domainSupport * LEAF_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        familySupport * LEAF_SCORING_POLICY.FAMILY_SUPPORT_WEIGHT +
        hierarchySupport * LEAF_SCORING_POLICY.HIERARCHY_SUPPORT_WEIGHT +
        capabilitySupport * LEAF_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT -
        closeness.titleExtraTokenRatio * LEAF_SCORING_POLICY.EXTRA_TOKEN_RATIO_PENALTY_WEIGHT);
    return {
        ...leaf,
        closeness,
        familyScopedFit,
        capabilityFit,
        selectionEvidence,
        score: confidence,
        confidence
    };
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
function isLeafSelectable(leaf, family, preparedQuery, rankedFamilies) {
    if (!hasLeafRoleGrounding(leaf, preparedQuery)) {
        return false;
    }
    if (isBroadRoleQuery(preparedQuery) && !hasBroadRoleLeafAuthority(leaf, preparedQuery)) {
        return false;
    }
    if (!isLeafSelectionEvidencePromotable(leaf, family, preparedQuery, rankedFamilies)) {
        return false;
    }
    const directEvidenceScore = maxEvidenceScore(leaf.evidence, ['exact_alias', 'folded_alias', 'ngram_alias', 'opensearch_lexical', 'capability_task']);
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
function isBroadRoleQuery(preparedQuery) {
    return preparedQuery.locale === 'en' && preparedQuery.isGenericShape && preparedQuery.usefulFoldedTokens.length === 1;
}
function hasBroadRoleLeafAuthority(leaf, preparedQuery) {
    const queryTokenCount = preparedQuery.usefulFoldedTokens.length;
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
    const tier = leaf.selectionEvidence?.tier ?? 'weak';
    if (tier === 'exact_alias' &&
        hasEvidenceChannel(family.evidence, 'cross_locale_english_backbone') &&
        hasCompetingAliasEvidenceFamily(family, rankedFamilies) &&
        !hasRawQueryExactAlias(leaf, preparedQuery)) {
        return false;
    }
    if (tier === 'exact_alias' || tier === 'folded_alias' || tier === 'strong_phrase' || tier === 'alias_aligned') {
        return true;
    }
    if (tier === 'capability_aligned') {
        return (leaf.closeness?.usefulQueryCoverage ?? 0) >= 1;
    }
    return false;
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
        if (record.channel !== 'opensearch_lexical') {
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
        const sameAlias = leaf.closeness?.matchedLabelSource === 'alias' &&
            foldSearchText(leaf.closeness.matchedLabel) === topMatchedAliasFolded;
        const selectedIsClearlyMoreGeneral = canonicalTokenCount(topLeaf.canonicalLabel) < canonicalTokenCount(leaf.canonicalLabel);
        return leafExactAliasScore > 0 &&
            sameAlias &&
            topLeaf.confidence - leaf.confidence <= PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
            !selectedIsClearlyMoreGeneral;
    });
}
function hasUnsafeSpecializedLeafTie(topLeaf, family, preparedQuery) {
    if (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
        hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
        (hasRawQueryExactAlias(topLeaf, preparedQuery) && leafCanonicalCoversRoleHead(topLeaf, preparedQuery)) ||
        hasControlledAcronymLeafAuthority(topLeaf, preparedQuery)) {
        return false;
    }
    if (!leafCanonicalAddsUnrequestedSpecificity(topLeaf, preparedQuery)) {
        return false;
    }
    return family.leaves.slice(1).some((leaf) => leaf.confidence >= topLeaf.confidence - PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
        canonicalTokenCount(topLeaf.canonicalLabel) >= canonicalTokenCount(leaf.canonicalLabel));
}
function hasRawQueryExactCanonical(leaf, preparedQuery) {
    return foldSearchText(leaf.canonicalLabel) === preparedQuery.folded;
}
function hasRawQueryPrimaryExactAlias(leaf, preparedQuery) {
    return leaf.evidence.some((record) => {
        if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
            return false;
        }
        const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
        const normalizedAlias = normalizedAliasDetail(record);
        const foldedAlias = foldedAliasDetail(record);
        return aliasRole === 'locale_primary' &&
            (normalizedAlias === preparedQuery.normalized || foldedAlias === preparedQuery.folded);
    });
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
    if (preparedQuery.acronymTokens.length === 0 || preparedQuery.intent.roleHeadTokens.length === 0) {
        return false;
    }
    const labels = [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ];
    return matchedIntentTokens(preparedQuery.intent.roleHeadTokens, labels).missing.length === 0 &&
        (leaf.selectionEvidence?.tier === 'strong_phrase' ||
            leaf.selectionEvidence?.tier === 'exact_alias' ||
            leaf.selectionEvidence?.tier === 'folded_alias' ||
            leaf.evidence.some((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery)));
}
function leafCanonicalCoversRoleHead(leaf, preparedQuery) {
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel)));
    const roleHeadTokens = preparedQuery.intent.roleHeadTokens.length > 0
        ? preparedQuery.intent.roleHeadTokens
        : preparedQuery.intent.roleTokens.slice(-1);
    return roleHeadTokens.some((token) => roleHeadTokenMatchesCanonical(token, canonicalTokens, preparedQuery));
}
function roleHeadTokenMatchesCanonical(token, canonicalTokens, preparedQuery) {
    if (tokenMatchesLabelTokens(token, canonicalTokens)) {
        return true;
    }
    return occupationRoleHeadSharesEquivalentClass(token, preparedQuery.locale, canonicalTokens);
}
function leafCanonicalAddsUnrequestedSpecificity(leaf, preparedQuery) {
    const canonicalTokens = tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel));
    const allowedTokens = new Set([
        ...preparedQuery.usefulFoldedTokens,
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.roleHeadTokens,
        ...preparedQuery.intent.domainTokens
    ].map((token) => foldSearchText(token)));
    return canonicalTokens.some((token) => !tokenMatchesLabelTokens(token, allowedTokens));
}
function maxEvidenceScore(evidence, channels) {
    const channelSet = new Set(channels);
    const scores = evidence.filter((record) => channelSet.has(record.channel)).map((record) => normalizeEvidenceScore(record));
    return scores.length === 0 ? 0 : Math.max(...scores);
}
function maxLexicalEvidenceCoverage(evidence, preparedQuery) {
    const usefulQueryTokenCount = Math.max(preparedQuery.usefulFoldedTokens.length, 1);
    let maxCoverage = 0;
    for (const record of evidence) {
        if (record.channel !== 'exact_alias' &&
            record.channel !== 'folded_alias' &&
            record.channel !== 'ngram_alias' &&
            record.channel !== 'opensearch_lexical' &&
            record.channel !== 'capability_task' &&
            record.channel !== 'family_profile') {
            continue;
        }
        if (record.channel === 'exact_alias') {
            maxCoverage = Math.max(maxCoverage, 1);
            continue;
        }
        const explicitCoverage = numericDetail(record.details.max_useful_token_coverage) ??
            numericDetail(record.details.useful_token_coverage);
        if (explicitCoverage !== null) {
            maxCoverage = Math.max(maxCoverage, explicitCoverage);
            continue;
        }
        const matchedTokens = Array.isArray(record.details.matched_tokens)
            ? record.details.matched_tokens.filter((token) => typeof token === 'string' && token.trim().length > 0)
            : [];
        if (matchedTokens.length > 0) {
            maxCoverage = Math.max(maxCoverage, matchedTokens.length / usefulQueryTokenCount);
        }
    }
    return clampScore(maxCoverage);
}
function normalizeEvidenceScore(record) {
    if (record.channel === 'graph_family_recovery') {
        return 0;
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
    if (record.channel === 'opensearch_lexical') {
        return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.OPENSEARCH_LEXICAL_BOOST);
    }
    if (record.channel === 'capability_task') {
        return clampScore(record.score);
    }
    if (record.channel === 'family_profile') {
        return clampScore(record.score);
    }
    if (record.channel === 'dense_global' || record.channel === 'dense_folded') {
        return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.DENSE_GLOBAL_EVIDENCE_BOOST);
    }
    if (record.channel === 'dense_family_constrained') {
        return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.DENSE_FAMILY_CONSTRAINED_EVIDENCE_BOOST);
    }
    return clampScore(record.score);
}
function numericDetail(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
function averageGenericPenalty(leafs) {
    if (leafs.length === 0) {
        return 0;
    }
    return leafs.reduce((sum, leaf) => sum + genericRiskPenalty(leaf.genericRisk), 0) / leafs.length;
}
function genericRiskPenalty(risk) {
    if (risk === 'high') {
        return GENERIC_RISK_PENALTY.HIGH;
    }
    if (risk === 'medium') {
        return GENERIC_RISK_PENALTY.MEDIUM;
    }
    return GENERIC_RISK_PENALTY.LOW;
}
function compareFamilies(left, right) {
    return (left.evidenceTierRank - right.evidenceTierRank ||
        right.confidence - left.confidence ||
        right.branchShare - left.branchShare ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function rankFamiliesForSelectionAuthority(families, preparedQuery) {
    const authorityRankedFamilies = families
        .slice()
        .sort((left, right) => compareRecoveredFamilySelectionAuthority(left, right, preparedQuery) || left.rank - right.rank)
        .map((family, index) => applyRecoveredFamilySelectionAuthority(family, index + 1, preparedQuery));
    const broadRoleRankedFamilies = isBroadRoleQuery(preparedQuery)
        ? authorityRankedFamilies
            .slice()
            .sort((left, right) => compareBroadRoleFamilies(left, right) || left.rank - right.rank)
            .map((family, index) => ({ ...family, rank: index + 1 }))
        : authorityRankedFamilies;
    return broadRoleRankedFamilies;
}
function compareRecoveredFamilySelectionAuthority(left, right, preparedQuery) {
    const leftAuthority = recoveredFamilySelectionAuthority(left, preparedQuery);
    const rightAuthority = recoveredFamilySelectionAuthority(right, preparedQuery);
    const exactBranchShareDifference = Math.abs(leftAuthority.branchShare - rightAuthority.branchShare);
    const bothHaveExactAlias = leftAuthority.exactAliasCount > 0 && rightAuthority.exactAliasCount > 0;
    const foldedAliasAuthority = bothHaveExactAlias
        ? 0
        : (Number(rightAuthority.foldedAliasCount > 0) - Number(leftAuthority.foldedAliasCount > 0) ||
            rightAuthority.foldedAliasCount - leftAuthority.foldedAliasCount ||
            rightAuthority.exactEvidenceCount - leftAuthority.exactEvidenceCount);
    if (bothHaveExactAlias && exactBranchShareDifference > 0.2) {
        return rightAuthority.branchShare - leftAuthority.branchShare;
    }
    if (!usesRecoveredRoleAgreementOrdering(preparedQuery)) {
        return compareLegacyRecoveredFamilySelectionAuthority(left, right, leftAuthority, rightAuthority, foldedAliasAuthority);
    }
    return (rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
        rightAuthority.primaryExactAliasLeafCount - leftAuthority.primaryExactAliasLeafCount ||
        rightAuthority.exactRoleLeafCount - leftAuthority.exactRoleLeafCount ||
        rightAuthority.bestRoleTokenMatchCount - leftAuthority.bestRoleTokenMatchCount ||
        rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
        rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
        rightAuthority.capabilityRoleCoverage - leftAuthority.capabilityRoleCoverage ||
        rightAuthority.capabilityLeafCount - leftAuthority.capabilityLeafCount ||
        rightAuthority.partialRoleLeafCount - leftAuthority.partialRoleLeafCount ||
        rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
        rightAuthority.bestFamilyConstrainedDenseScore - leftAuthority.bestFamilyConstrainedDenseScore ||
        rightAuthority.bestLeafSelectionAuthority - leftAuthority.bestLeafSelectionAuthority ||
        Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
        foldedAliasAuthority ||
        rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
        rightAuthority.confidence - leftAuthority.confidence ||
        rightAuthority.branchShare - leftAuthority.branchShare ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function compareLegacyRecoveredFamilySelectionAuthority(left, right, leftAuthority, rightAuthority, foldedAliasAuthority) {
    return (rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
        Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
        foldedAliasAuthority ||
        rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
        rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
        rightAuthority.bestLeafSelectionAuthority - leftAuthority.bestLeafSelectionAuthority ||
        rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
        rightAuthority.bestFamilyConstrainedDenseScore - leftAuthority.bestFamilyConstrainedDenseScore ||
        rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
        rightAuthority.confidence - leftAuthority.confidence ||
        rightAuthority.branchShare - leftAuthority.branchShare ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function usesRecoveredRoleAgreementOrdering(preparedQuery) {
    return preparedQuery.locale === 'en' &&
        preparedQuery.acronymTokens.length === 0 &&
        exactRoleMatchThreshold(preparedQuery) >= 2;
}
function recoveredFamilySelectionAuthority(family, preparedQuery) {
    const foldedAliasAuthorityCount = foldedAliasCount(family, preparedQuery);
    const roleAgreement = familyRoleAgreementAuthority(family, preparedQuery);
    const capabilityAgreement = familyCapabilityAgreementAuthority(family);
    return {
        roleGrounded: hasFamilyRoleGrounding(family, preparedQuery) ? 1 : 0,
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
        bestLeafRoleCoverage: Math.max(...family.leaves.map((leaf) => roleCoverageForLabels(preparedQuery, [leaf.canonicalLabel, ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []), ...matchedAliasLabels(leaf.evidence)])), 0),
        bestLeafSelectionAuthority: Math.max(...family.leaves.map(leafSelectionAuthority), 0),
        bestFamilyConstrainedDenseScore: bestFamilyConstrainedDenseScore(family),
        profileRoleCoverage: maxFamilyProfileRoleCoverage(family.evidence),
        confidence: family.confidence,
        branchShare: family.branchShare
    };
}
function primaryExactAliasLeafCount(family, preparedQuery) {
    return Math.min(family.leaves.filter((leaf) => hasRawQueryPrimaryExactAlias(leaf, preparedQuery)).length, 5);
}
function applyRecoveredFamilySelectionAuthority(family, rank, preparedQuery) {
    const selectionAuthority = recoveredFamilySelectionAuthority(family, preparedQuery);
    const authorityFloor = recoveredFamilyConfidenceFloor(selectionAuthority, preparedQuery);
    const confidence = Math.max(family.confidence, authorityFloor);
    return {
        ...family,
        rank,
        selectionAuthority,
        score: confidence,
        confidence
    };
}
function recoveredFamilyConfidenceFloor(authority, preparedQuery) {
    if (!usesRecoveredRoleAgreementOrdering(preparedQuery)) {
        return 0;
    }
    if (authority.exactRoleLeafCount >= 3 && authority.capabilityLeafCount >= 2) {
        return FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_CAPABILITY_FLOOR;
    }
    if (authority.exactRoleLeafCount >= 3) {
        return FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_FLOOR;
    }
    return 0;
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
        const match = leafRoleTokenMatch(leaf, preparedQuery);
        const matchCount = match.matched.length;
        bestRoleTokenMatchCount = Math.max(bestRoleTokenMatchCount, matchCount);
        if (matchCount >= requiredMatches && usefulQueryTokensCoveredByMatch(match.matched, preparedQuery)) {
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
        capabilityRoleCoverage: Math.max(...family.leaves.map((leaf) => leaf.capabilityFit?.coverage ?? 0), 0),
        capabilityLeafCount: Math.min(family.leaves.filter((leaf) => leaf.capabilityFit?.tier === 'strong' || leaf.capabilityFit?.tier === 'partial').length, 5)
    };
}
function exactRoleMatchThreshold(preparedQuery) {
    const roleTokenCount = preparedQuery.intent.roleTokens.length;
    if (roleTokenCount === 0) {
        return 0;
    }
    return roleTokenCount >= 2 ? 2 : 1;
}
function leafRoleTokenMatch(leaf, preparedQuery) {
    return matchedIntentTokens(preparedQuery.intent.roleTokens, [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ]);
}
function usefulQueryTokensCoveredByMatch(matchedRoleTokens, preparedQuery) {
    if (preparedQuery.usefulFoldedTokens.length === 0) {
        return true;
    }
    return preparedQuery.usefulFoldedTokens.every((token) => tokenListHasEquivalent(matchedRoleTokens, token));
}
function exactAliasCount(family) {
    const familyExactCount = family.evidence.filter((record) => record.channel === 'exact_alias').length;
    const leafExactCount = family.leaves.reduce((count, leaf) => count + leaf.evidence.filter((record) => record.channel === 'exact_alias').length, 0);
    return familyExactCount + leafExactCount;
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
    return foldedRecords.filter((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery) ||
        aliasRoleMatchCount(record, preparedQuery) >= minimumRoleMatches).length;
}
function exactEvidenceCount(family, foldedAliasAuthorityCount) {
    const familyExactCount = family.evidence.filter((record) => record.channel === 'exact_alias').length;
    const leafExactCount = family.leaves.reduce((count, leaf) => count + leaf.evidence.filter((record) => record.channel === 'exact_alias').length, 0);
    return familyExactCount + leafExactCount + foldedAliasAuthorityCount;
}
function requiresSpecificAcronymAliasAuthority(preparedQuery) {
    return preparedQuery.acronymTokens.length > 0 &&
        preparedQuery.intent.roleTokens.length > Math.max(preparedQuery.intent.roleHeadTokens.length, 1);
}
function minimumSpecificAliasRoleMatches(preparedQuery) {
    return Math.min(preparedQuery.intent.roleTokens.length, Math.max(2, preparedQuery.intent.roleHeadTokens.length + 1));
}
function aliasRoleMatchCount(record, preparedQuery) {
    return matchedIntentTokens(preparedQuery.intent.roleTokens, aliasEvidenceLabels(record)).matched.length;
}
function aliasHasRawAcronymRoleAuthority(record, preparedQuery) {
    const rawAcronymTokens = preparedQuery.acronymTokens.map((token) => foldSearchText(token));
    if (rawAcronymTokens.length === 0 || preparedQuery.intent.roleHeadTokens.length === 0) {
        return false;
    }
    const requiredTokens = Array.from(new Set([
        ...rawAcronymTokens,
        ...preparedQuery.intent.roleHeadTokens
    ]));
    if (requiredTokens.length < 2) {
        return false;
    }
    return matchedIntentTokens(requiredTokens, aliasEvidenceLabels(record)).missing.length === 0;
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
function leafSelectionAuthority(leaf) {
    const tier = leaf.selectionEvidence?.tier ?? 'weak';
    if (tier === 'exact_alias') {
        return 7;
    }
    if (tier === 'folded_alias') {
        return 6;
    }
    if (tier === 'strong_phrase') {
        return 5;
    }
    if (tier === 'alias_aligned') {
        return 4;
    }
    if (tier === 'capability_aligned') {
        return 3;
    }
    if (tier === 'semantic_aligned') {
        return 2;
    }
    if (tier === 'dense_only') {
        return 1;
    }
    return 0;
}
function maxFamilyProfileRoleCoverage(evidence) {
    return Math.max(...evidence
        .filter((record) => record.channel === 'family_profile')
        .map((record) => numericDetail(record.details.role_coverage) ?? 0), 0);
}
function bestFamilyConstrainedDenseScore(family) {
    return Math.max(...family.leaves.map((leaf) => maxEvidenceScore(leaf.evidence, ['dense_family_constrained'])), 0);
}
function compareBroadRoleFamilies(left, right) {
    const leftAuthority = broadRoleFamilyAuthority(left);
    const rightAuthority = broadRoleFamilyAuthority(right);
    return (rightAuthority.profileAndSemanticSupport - leftAuthority.profileAndSemanticSupport ||
        rightAuthority.profileCoverage - leftAuthority.profileCoverage ||
        leftAuthority.bestRepresentativeTokenCount - rightAuthority.bestRepresentativeTokenCount ||
        rightAuthority.profileLeafCount - leftAuthority.profileLeafCount ||
        left.familyLabel.localeCompare(right.familyLabel));
}
function broadRoleFamilyAuthority(family) {
    const profileAuthority = profileSemanticAuthority(family);
    return {
        profileAndSemanticSupport: profileAuthority.hasProfileSemanticSupport ? 1 : 0,
        profileCoverage: profileAuthority.profileCoverage,
        bestRepresentativeTokenCount: profileAuthority.bestRepresentativeTokenCount,
        profileLeafCount: profileAuthority.profileLeafCount
    };
}
function profileSemanticAuthority(family) {
    const familyProfileEvidenceRecords = family.evidence.filter((record) => record.channel === 'family_profile');
    const bestFamilyProfile = familyProfileEvidenceRecords.reduce((best, record) => (best === null || record.score > best.score ? record : best), null);
    const hasSemanticEvidence = hasEvidenceChannel(family.evidence, 'dense_global') ||
        hasEvidenceChannel(family.evidence, 'dense_family_constrained') ||
        family.leaves.some((leaf) => hasEvidenceChannel(leaf.evidence, 'dense_global') || hasEvidenceChannel(leaf.evidence, 'dense_family_constrained'));
    const profileCoverage = numericDetail(bestFamilyProfile?.details.coverage) ?? 0;
    const profileLeafCount = numericDetail(bestFamilyProfile?.details.matching_leaf_count) ?? 0;
    const representativeTokenCounts = family.leaves
        .filter((leaf) => (leaf.closeness?.usefulQueryCoverage ?? 0) >= 1)
        .map((leaf) => canonicalTokenCount(leaf.canonicalLabel));
    return {
        hasProfileSemanticSupport: Boolean(bestFamilyProfile && hasSemanticEvidence),
        profileCoverage,
        bestRepresentativeTokenCount: representativeTokenCounts.length > 0 ? Math.min(...representativeTokenCounts) : Number.POSITIVE_INFINITY,
        profileLeafCount
    };
}
function familyEvidenceTier(evidence) {
    if (hasEvidenceChannel(evidence, 'exact_alias')) {
        return 'local_exact';
    }
    if (hasEvidenceChannel(evidence, 'cross_locale_english_backbone')) {
        return 'cross_locale_backbone';
    }
    if (hasEvidenceChannel(evidence, 'folded_alias')) {
        return 'folded_alias';
    }
    if (hasEvidenceChannel(evidence, 'ngram_alias')) {
        return 'strong_phrase';
    }
    if (hasEvidenceChannel(evidence, 'family_profile') &&
        (hasEvidenceChannel(evidence, 'dense_global') || hasEvidenceChannel(evidence, 'dense_family_constrained'))) {
        return 'family_profile_dense';
    }
    if (hasEvidenceChannel(evidence, 'family_profile')) {
        return 'family_profile';
    }
    if (hasPreparedPhraseWindowFamilyEvidence(evidence)) {
        return 'strong_phrase';
    }
    if (hasEvidenceChannel(evidence, 'dense_global') || hasEvidenceChannel(evidence, 'dense_family_constrained')) {
        return 'dense';
    }
    return 'graph_only';
}
function familyEvidenceTierRank(tier) {
    if (tier === 'local_exact') {
        return 1;
    }
    if (tier === 'cross_locale_backbone') {
        return 2;
    }
    if (tier === 'folded_alias') {
        return 3;
    }
    if (tier === 'strong_phrase') {
        return 4;
    }
    if (tier === 'family_profile_dense') {
        return 5;
    }
    if (tier === 'family_profile') {
        return 6;
    }
    if (tier === 'dense') {
        return 7;
    }
    return 8;
}
function hasEvidenceChannel(evidence, channel) {
    return evidence.some((record) => record.channel === channel);
}
function hasPreparedPhraseWindowFamilyEvidence(evidence) {
    return evidence.some((record) => {
        if (record.channel !== 'opensearch_lexical') {
            return false;
        }
        const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];
        return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
    });
}
function compareLeavesForQuery(left, right, preparedQuery) {
    return compareAcronymRoleLeafAuthority(left, right, preparedQuery) || compareLeaves(left, right);
}
function compareAcronymRoleLeafAuthority(left, right, preparedQuery) {
    if (!requiresSpecificAcronymAliasAuthority(preparedQuery)) {
        return 0;
    }
    const leftAuthority = leafRoleAuthority(left, preparedQuery);
    const rightAuthority = leafRoleAuthority(right, preparedQuery);
    return rightAuthority.roleHeadMatches - leftAuthority.roleHeadMatches ||
        rightAuthority.roleMatches - leftAuthority.roleMatches ||
        rightAuthority.rawAcronymAliasAuthority - leftAuthority.rawAcronymAliasAuthority;
}
function leafRoleAuthority(leaf, preparedQuery) {
    const labels = [
        leaf.canonicalLabel,
        ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
        ...matchedAliasLabels(leaf.evidence)
    ];
    return {
        roleHeadMatches: matchedIntentTokens(preparedQuery.intent.roleHeadTokens, labels).matched.length,
        roleMatches: matchedIntentTokens(preparedQuery.intent.roleTokens, labels).matched.length,
        rawAcronymAliasAuthority: leaf.evidence.some((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery)) ? 1 : 0
    };
}
function compareLeaves(left, right) {
    const leftSelectionTier = left.selectionEvidence?.tierRank ?? Number.POSITIVE_INFINITY;
    const rightSelectionTier = right.selectionEvidence?.tierRank ?? Number.POSITIVE_INFINITY;
    const leftExactAliasScore = maxEvidenceScore(left.evidence, ['exact_alias']);
    const rightExactAliasScore = maxEvidenceScore(right.evidence, ['exact_alias']);
    const leftClosenessScore = left.closeness?.score ?? 0;
    const rightClosenessScore = right.closeness?.score ?? 0;
    const leftFamilyScopedTier = left.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY;
    const rightFamilyScopedTier = right.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY;
    const leftCapabilityFitTier = left.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY;
    const rightCapabilityFitTier = right.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY;
    const sameMatchedLabel = Boolean(left.closeness?.matchedLabel && right.closeness?.matchedLabel) &&
        foldSearchText(left.closeness?.matchedLabel ?? '') === foldSearchText(right.closeness?.matchedLabel ?? '');
    const aliasTiePrefersShorterCanonical = leftExactAliasScore > 0 &&
        rightExactAliasScore > 0 &&
        Math.abs(leftExactAliasScore - rightExactAliasScore) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON &&
        Math.abs(leftClosenessScore - rightClosenessScore) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
        ? canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel)
        : 0;
    const sameLabelTiePrefersShorterCanonical = sameMatchedLabel &&
        Math.abs(leftClosenessScore - rightClosenessScore) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON &&
        Math.abs((left.closeness?.titleExtraTokenRatio ?? 0) - (right.closeness?.titleExtraTokenRatio ?? 0)) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
        ? canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel)
        : 0;
    return (leftSelectionTier - rightSelectionTier ||
        rightExactAliasScore - leftExactAliasScore ||
        aliasTiePrefersShorterCanonical ||
        rightClosenessScore - leftClosenessScore ||
        (left.closeness?.titleExtraTokenRatio ?? 0) - (right.closeness?.titleExtraTokenRatio ?? 0) ||
        sameLabelTiePrefersShorterCanonical ||
        leftFamilyScopedTier - rightFamilyScopedTier ||
        leftCapabilityFitTier - rightCapabilityFitTier ||
        (right.capabilityFit?.coverage ?? 0) - (left.capabilityFit?.coverage ?? 0) ||
        (right.familyScopedFit?.matchedTerms.length ?? 0) - (left.familyScopedFit?.matchedTerms.length ?? 0) ||
        (right.familyScopedFit?.matchedCapabilityTerms.length ?? 0) - (left.familyScopedFit?.matchedCapabilityTerms.length ?? 0) ||
        right.confidence - left.confidence ||
        maxEvidenceScore(right.evidence, ['folded_alias']) - maxEvidenceScore(left.evidence, ['folded_alias']) ||
        canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel) ||
        left.canonicalLabel.localeCompare(right.canonicalLabel));
}
function canonicalTokenCount(label) {
    return tokenizeNormalizedText(foldSearchText(label)).length;
}
function intentRoleQuery(preparedQuery) {
    return preparedQuery.intent.roleTokens.join(' ').trim() ||
        preparedQuery.usefulFoldedTokens.join(' ').trim() ||
        preparedQuery.normalized;
}
function hasLeafRoleGrounding(leaf, preparedQuery) {
    if (preparedQuery.intent.roleTokens.length === 0) {
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
    const roleMatch = matchedIntentTokens(preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens, labels);
    return roleMatch.matched.length > 0;
}
function hasFamilyRoleGrounding(family, preparedQuery) {
    if (preparedQuery.intent.roleTokens.length === 0) {
        return true;
    }
    if (family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
        return true;
    }
    if (maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) > 0) {
        return true;
    }
    return family.leaves.some((leaf) => hasLeafRoleGrounding(leaf, preparedQuery));
}
function maxIntentRoleHeadEvidenceCoverage(evidence, preparedQuery) {
    const roleHeadTokens = preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens;
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
        }
    }
    return clampScore(maxCoverage);
}
function maxIntentRoleEvidenceCoverage(evidence, preparedQuery) {
    const roleTokens = preparedQuery.intent.roleTokens;
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
    const roleTokens = preparedQuery.intent.roleTokens;
    if (roleTokens.length === 0) {
        return 0;
    }
    const match = matchedIntentTokens(roleTokens, labels);
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
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [];
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
    if (channel === 'exact_alias' || channel === 'folded_alias' || channel === 'ngram_alias') {
        return 'alias_lexical';
    }
    if (channel === 'opensearch_lexical' || channel === 'capability_task') {
        return 'opensearch_lexical';
    }
    if (channel === 'dense_family_constrained') {
        return 'dense_family_constrained';
    }
    if (channel === 'cross_locale_english_backbone') {
        return 'cross_locale_english_backbone';
    }
    if (channel === 'family_profile') {
        return 'family_profile';
    }
    if (channel === 'dense_folded') {
        return 'dense_folded';
    }
    return 'dense_global';
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
    return roundScore(BRANCH_MARGIN_POLICY.MIN_SCORE +
        ((ratio - weak) / (strong - weak)) * BRANCH_MARGIN_POLICY.SCORE_RANGE);
}
function normalizeOptions(options) {
    return {
        query: options.query,
        locale: options.locale?.trim() || DEFAULT_RETRIEVAL_LOCALE,
        sourceName: options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME,
        modelKey: options.modelKey?.trim() || DEFAULT_MODEL_KEY,
        limit: requirePositiveIntegerAtMost(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1000, 'limit'),
        evaluationQueryId: options.evaluationQueryId,
        siblingLimit: requireNonNegativeIntegerAtMost(options.siblingLimit ?? DEFAULT_SIBLING_LIMIT, 1000, 'sibling-limit'),
        topFamilyLimit: requirePositiveIntegerAtMost(options.topFamilyLimit ?? 3, 1000, 'top-family-limit'),
        topLeavesPerFamily: requirePositiveIntegerAtMost(options.topLeavesPerFamily ?? 5, 1000, 'top-leaves-per-family')
    };
}
function clampScore(value) {
    return roundScore(Math.max(0, Math.min(1, value)));
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
