import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { assessCandidatesThroughFilterFunnel, rankPromotableLeaves, selectUniqueExactCanonicalLeaf, selectUniqueExactAliasLeaf } from './candidates.js';
import { CLASSIFIER_RECALL_LIMITS } from './constants.js';
import { createClassifierDebugTrace, createNoopClassifierTrace } from './debug.js';
import { selectDecision } from './decision.js';
import { assessFamilyStructureCompatibility, getFamilyStructureRules, prepareFamilyStructureQuery } from './family-structure/family-structure.js';
import { selectUniqueExactCanonicalFamily, validateFamilies } from './families.js';
import { loadOrUseRuntime, normalizeInput, prepareClassifierSurface, selectClassifierLocale, splitIndependentSpans, buildQueryStructuralProfile } from './preparation.js';
import { buildCoreResult, coreUnresolved, toDebugResult, toRuntimeResult } from './result.js';
import { buildRetrievalRequest, findExactCanonicalFamilies, findExactCanonicalLeaves, findExactAliasLeaves, hydrateCandidateCores, mergeCandidateEvidence, retrieveRecallCandidates } from './retrieval.js';
import { inferRoleHeadsFromStructuralContext, isRankRoleHead } from './role-head-groups.js';
import { SPECIALIZATION_DATA_DIMENSIONS } from './specialization/specialization-gate.js';
import { translateTitleForClassifier } from './translation.js';
export async function classifyOccupationCore(input) {
    return executeClassifierPipeline(input, createNoopClassifierTrace());
}
export async function classifyOccupationTitle(input) {
    return toRuntimeResult(await classifyOccupationCore(input));
}
export async function classifyOccupationTitleDebug(input) {
    const trace = createClassifierDebugTrace();
    const core = await executeClassifierPipeline(input, trace);
    return toDebugResult(core, trace.trace());
}
async function executeClassifierPipeline(input, trace) {
    const normalizedOptions = await trace.call(normalizeInput, [input], 'normalizeInput');
    if (!normalizedOptions.query) {
        return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' }], 'buildCoreResult');
    }
    const cleanedTitle = await trace.call(cleanOccupationQuerySurface, [normalizedOptions.query, normalizedOptions.locale], 'cleanOccupationQuerySurface');
    if (!cleanedTitle) {
        return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' }], 'buildCoreResult');
    }
    const locale = await trace.call(selectClassifierLocale, [cleanedTitle, normalizedOptions.locale, normalizedOptions.sourceName], 'selectClassifierLocale');
    const options = { ...normalizedOptions, query: cleanedTitle, locale };
    const runtime = await trace.call(loadOrUseRuntime, [options], 'loadOrUseRuntime');
    const cleaned = {
        rawTitle: normalizedOptions.query,
        cleanedTitle,
        locale: options.locale
    };
    const spans = await trace.call(splitIndependentSpans, [cleaned, options.locale], 'splitIndependentSpans');
    if (spans.length > 1) {
        const spanResults = await Promise.all(spans.map(async (span) => ({
            query: span.text,
            result: await classifyOccupationCore({
                query: span.text,
                locale: options.locale,
                runtime
            })
        })));
        return trace.call(buildCoreResult, [
            {
                candidateLedger: new Map(),
                rankedLeaves: [],
                familyAssessments: [],
                decision: {
                    type: 'multi_span',
                    reason: 'multi_span',
                    confidence: 1
                },
                spans: spanResults
            }
        ], 'buildCoreResult');
    }
    const span = spans[0];
    if (!span) {
        return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' }], 'buildCoreResult');
    }
    const queryProfile = await trace.call(buildQueryStructuralProfile, [cleanedTitle, options.locale], 'buildQueryStructuralProfile');
    const leafStructureArtifact = await trace.call((loadedRuntime) => loadedRuntime.leafStructureArtifact, [runtime], 'loadOccupationLeafStructureArtifact');
    const comparisonQuery = await trace.call(translateTitleForClassifier, [span.text, options.locale, queryProfile.profile.role_head], 'translateTitleForClassifier');
    if (comparisonQuery.resolvedRoleHeadTokens.length > 0 &&
        !comparisonQuery.resolvedRoleHeadTokens.some((roleHead) => !isRankRoleHead(roleHead, 'pure'))) {
        queryProfile.profile.role_head = Array.from(new Set([...queryProfile.profile.role_head, ...comparisonQuery.resolvedRoleHeadTokens]));
    }
    if (options.locale !== 'en' && comparisonQuery.englishTokens.length > 0) {
        mergeTranslatedStructuralConcepts(queryProfile, buildQueryStructuralProfile(comparisonQuery.englishTokens.join(' '), 'en'));
    }
    const inferredRoleHeads = inferRoleHeadsFromStructuralContext({
        authority: queryProfile.authority,
        roleHeads: queryProfile.profile.role_head,
        conceptIdsByDimension: queryConceptIdsByDimension(queryProfile.profile.concepts),
        familyRules: getFamilyStructureRules()
    }).map((inferred) => inferred.roleHead);
    if (inferredRoleHeads.length > 0) {
        queryProfile.profile.role_head = Array.from(new Set([...queryProfile.profile.role_head, ...inferredRoleHeads]));
        comparisonQuery.resolvedRoleHeadTokens = Array.from(new Set([...comparisonQuery.resolvedRoleHeadTokens, ...inferredRoleHeads]));
    }
    const surface = await trace.call(prepareClassifierSurface, [span], 'prepareClassifierSurface');
    const retrievalRequest = await trace.call(buildRetrievalRequest, [options.sourceName, options.locale, surface, comparisonQuery, queryProfile], 'buildRetrievalRequest');
    const exactCanonicalFamilies = await trace.call(findExactCanonicalFamilies, [runtime, retrievalRequest], 'findExactCanonicalFamilies');
    const exactFamilyDecision = await trace.call(selectUniqueExactCanonicalFamily, [exactCanonicalFamilies], 'selectUniqueExactCanonicalFamily');
    if (exactFamilyDecision) {
        return trace.call(buildCoreResult, [
            {
                candidateLedger: new Map(),
                rankedLeaves: [],
                familyAssessments: [],
                decision: exactFamilyDecision.decision,
                selectedFamily: exactFamilyDecision.selectedFamily,
                cleaned,
                comparisonQuery
            }
        ], 'buildCoreResult');
    }
    const exactCanonicalLeaves = await trace.call(findExactCanonicalLeaves, [runtime, retrievalRequest], 'findExactCanonicalLeaves');
    const exactLeafDecision = await trace.call(selectUniqueExactCanonicalLeaf, [exactCanonicalLeaves, runtime, retrievalRequest, queryProfile, comparisonQuery], 'selectUniqueExactCanonicalLeaf');
    if (exactLeafDecision &&
        exactLeafDecision.selectedLeaf.familyNodeId !== null &&
        assessFamilyStructureCompatibility(exactLeafDecision.selectedLeaf.familyNodeId, prepareFamilyStructureQuery(queryProfile)).decision !==
            'reject') {
        return trace.call(buildCoreResult, [
            {
                candidateLedger: new Map(),
                rankedLeaves: [],
                familyAssessments: [],
                decision: exactLeafDecision.decision,
                selectedLeaf: exactLeafDecision.selectedLeaf,
                cleaned,
                comparisonQuery
            }
        ], 'buildCoreResult');
    }
    const { candidates: exactAliasLeaves, aliasResult } = await trace.call(findExactAliasLeaves, [runtime, retrievalRequest, CLASSIFIER_RECALL_LIMITS.primary], 'findExactAliasLeaves');
    const exactAliasLeafDecision = await trace.call(selectUniqueExactAliasLeaf, [exactAliasLeaves, aliasResult, runtime, retrievalRequest, comparisonQuery], 'selectUniqueExactAliasLeaf');
    if (exactAliasLeafDecision) {
        return trace.call(buildCoreResult, [
            {
                candidateLedger: new Map(),
                rankedLeaves: [],
                familyAssessments: [],
                decision: exactAliasLeafDecision.decision,
                selectedLeaf: exactAliasLeafDecision.selectedLeaf,
                cleaned,
                comparisonQuery
            }
        ], 'buildCoreResult');
    }
    const rawRecall = await trace.call(retrieveRecallCandidates, [
        runtime,
        retrievalRequest,
        {
            exactCanonicalLeaves,
            exactAliasLeaves,
            aliasResult
        },
        CLASSIFIER_RECALL_LIMITS
    ], 'retrieveRecallCandidates');
    const mergedRecall = await trace.call(mergeCandidateEvidence, [rawRecall], 'mergeCandidateEvidence');
    const hydratedCoreCandidates = await trace.call(hydrateCandidateCores, [runtime, mergedRecall], 'hydrateCandidateCores');
    const candidateLedger = await trace.call(assessCandidatesThroughFilterFunnel, [hydratedCoreCandidates, comparisonQuery, leafStructureArtifact, queryProfile, options.locale], 'assessCandidatesThroughFilterFunnel');
    const families = await trace.call(validateFamilies, [runtime, candidateLedger, exactCanonicalFamilies, comparisonQuery, queryProfile], 'validateFamilies');
    const rankedLeaves = await trace.call(rankPromotableLeaves, [candidateLedger, families], 'rankPromotableLeaves');
    const outcome = await trace.call(selectDecision, [rankedLeaves, families, candidateLedger, comparisonQuery], 'selectDecision');
    return trace.call(buildCoreResult, [
        {
            cleaned,
            comparisonQuery,
            candidateLedger,
            rankedLeaves,
            familyAssessments: families,
            decision: outcome.decision,
            selectedLeaf: outcome.selectedLeaf,
            selectedFamily: outcome.selectedFamily
        }
    ], 'buildCoreResult');
}
function mergeTranslatedStructuralConcepts(queryProfile, translatedProfile) {
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        queryProfile.profile[dimension] = unique([...queryProfile.profile[dimension], ...translatedProfile.profile[dimension]]);
        queryProfile.profile.available[dimension] = unique([
            ...queryProfile.profile.available[dimension],
            ...translatedProfile.profile.available[dimension]
        ]);
        queryProfile.profile.concept[dimension] = unique([
            ...queryProfile.profile.concept[dimension],
            ...translatedProfile.profile.concept[dimension]
        ]);
        queryProfile.profile.literal[dimension] = unique([
            ...queryProfile.profile.literal[dimension],
            ...translatedProfile.profile.literal[dimension]
        ]);
    }
    for (const concept of translatedProfile.profile.concepts) {
        if (!queryProfile.profile.concepts.some((existing) => existing.dimension === concept.dimension && existing.conceptId === concept.conceptId)) {
            queryProfile.profile.concepts.push(concept);
        }
    }
}
function unique(values) {
    return [...new Set(values)];
}
function queryConceptIdsByDimension(concepts) {
    const conceptIdsByDimension = new Map();
    for (const concept of concepts) {
        const conceptIds = conceptIdsByDimension.get(concept.dimension) ?? [];
        if (!conceptIds.includes(concept.conceptId)) {
            conceptIds.push(concept.conceptId);
            conceptIdsByDimension.set(concept.dimension, conceptIds);
        }
    }
    return conceptIdsByDimension;
}
