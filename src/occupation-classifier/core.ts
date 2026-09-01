import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import {
  assessCandidatesThroughFilterFunnel,
  rankPromotableLeaves,
  selectUniqueExactCanonicalLeaf,
  selectUniqueExactAliasLeaf
} from './candidates.js';
import { CLASSIFIER_RECALL_LIMITS } from './constants.js';
import { type ClassifierTrace, createClassifierDebugTrace, createNoopClassifierTrace } from './debug.js';
import { selectDecision } from './decision.js';
import { selectUniqueExactCanonicalFamily, validateFamilies } from './families.js';
import {
  loadOrUseRuntime,
  normalizeInput,
  prepareClassifierSurface,
  selectClassifierLocale,
  splitIndependentSpans,
  buildQueryStructuralProfile
} from './preparation.js';
import { buildCoreResult, coreUnresolved, toDebugResult, toRuntimeResult } from './result.js';
import {
  buildRetrievalRequest,
  findExactCanonicalFamilies,
  findExactCanonicalLeaves,
  findExactAliasLeaves,
  hydrateCandidateCores,
  mergeCandidateEvidence,
  retrieveRecallCandidates
} from './retrieval.js';
import { isRankRoleHead } from './role-head-groups.js';
import { translateTitleForClassifier } from './translation.js';
import type { CoreResult, DebugResult, RuntimeResult, SimpleClassificationInput } from './types.js';

export async function classifyOccupationCore(input: SimpleClassificationInput): Promise<CoreResult> {
  return executeClassifierPipeline(input, createNoopClassifierTrace());
}

export async function classifyOccupationTitle(input: SimpleClassificationInput): Promise<RuntimeResult> {
  return toRuntimeResult(await classifyOccupationCore(input));
}

export async function classifyOccupationTitleDebug(input: SimpleClassificationInput): Promise<DebugResult> {
  const trace = createClassifierDebugTrace();
  const core = await executeClassifierPipeline(input, trace);

  return toDebugResult(core, trace.trace());
}

async function executeClassifierPipeline(input: SimpleClassificationInput, trace: ClassifierTrace): Promise<CoreResult> {
  const normalizedOptions = await trace.call(normalizeInput, [input], 'normalizeInput');

  if (!normalizedOptions.query) {
    return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' as const }], 'buildCoreResult');
  }

  const cleanedTitle = await trace.call(
    cleanOccupationQuerySurface,
    [normalizedOptions.query, normalizedOptions.locale],
    'cleanOccupationQuerySurface'
  );

  if (!cleanedTitle) {
    return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' as const }], 'buildCoreResult');
  }

  const locale = await trace.call(
    selectClassifierLocale,
    [cleanedTitle, normalizedOptions.locale, normalizedOptions.sourceName],
    'selectClassifierLocale'
  );

  const options = { ...normalizedOptions, query: cleanedTitle, locale };
  const runtime = await trace.call(loadOrUseRuntime, [options], 'loadOrUseRuntime');
  const cleaned = {
    rawTitle: normalizedOptions.query,
    cleanedTitle,
    locale: options.locale
  };

  const spans = await trace.call(splitIndependentSpans, [cleaned, options.locale], 'splitIndependentSpans');

  if (spans.length > 1) {
    const spanResults = await Promise.all(
      spans.map(async (span) => ({
        query: span.text,
        result: await classifyOccupationCore({
          query: span.text,
          locale: options.locale,
          runtime
        })
      }))
    );

    return trace.call(
      buildCoreResult,
      [
        {
          candidateLedger: new Map(),
          rankedLeaves: [],
          familyAssessments: [],
          decision: {
            type: 'multi_span' as const,
            reason: 'multi_span' as const,
            confidence: 1
          },
          spans: spanResults
        }
      ],
      'buildCoreResult'
    );
  }

  const span = spans[0];

  if (!span) {
    return trace.call(({ reason }) => coreUnresolved(reason), [{ reason: 'empty_after_cleaning' as const }], 'buildCoreResult');
  }

  const queryProfile = await trace.call(buildQueryStructuralProfile, [cleanedTitle, options.locale], 'buildQueryStructuralProfile');

  const leafStructureArtifact = await trace.call(
    (loadedRuntime) => loadedRuntime.leafStructureArtifact,
    [runtime],
    'loadOccupationLeafStructureArtifact'
  );
  const comparisonQuery = await trace.call(
    translateTitleForClassifier,
    [span.text, options.locale, queryProfile.profile.role_head],
    'translateTitleForClassifier'
  );

  // Merge role-heads from everywhere
  if (comparisonQuery.resolvedRoleHeadTokens.length > 0) {
    queryProfile.profile.role_head = Array.from(new Set([...queryProfile.profile.role_head, ...comparisonQuery.resolvedRoleHeadTokens]));
  } else if (locale !== 'en' && comparisonQuery.englishTokens) {
    //const englishQueryProfile = await trace.call(buildQueryStructuralProfile, [comparisonQuery.englishTokens.join(' ')], 'buildQueryStructuralProfile');
    //console.log(englishQueryProfile.profile.role_head);
  }

  const surface = await trace.call(prepareClassifierSurface, [span], 'prepareClassifierSurface');
  const retrievalRequest = await trace.call(
    buildRetrievalRequest,
    [options.sourceName, options.locale, surface, comparisonQuery, queryProfile],
    'buildRetrievalRequest'
  );

  const exactCanonicalLeaves = await trace.call(findExactCanonicalLeaves, [runtime, retrievalRequest], 'findExactCanonicalLeaves');
  const exactLeafDecision = await trace.call(
    selectUniqueExactCanonicalLeaf,
    [exactCanonicalLeaves, runtime, retrievalRequest],
    'selectUniqueExactCanonicalLeaf'
  );
  if (exactLeafDecision) {
    return trace.call(
      buildCoreResult,
      [
        {
          candidateLedger: new Map(),
          rankedLeaves: [],
          familyAssessments: [],
          decision: exactLeafDecision.decision,
          selectedLeaf: exactLeafDecision.selectedLeaf,
          cleaned,
          comparisonQuery
        }
      ],
      'buildCoreResult'
    );
  }

  const { candidates: exactAliasLeaves, aliasResult } = await trace.call(
    findExactAliasLeaves,
    [runtime, retrievalRequest, CLASSIFIER_RECALL_LIMITS.primary],
    'findExactAliasLeaves'
  );
  const exactAliasLeafDecision = await trace.call(
    selectUniqueExactAliasLeaf,
    [exactAliasLeaves, aliasResult, runtime, retrievalRequest, comparisonQuery],
    'selectUniqueExactAliasLeaf'
  );

  if (exactAliasLeafDecision) {
    return trace.call(
      buildCoreResult,
      [
        {
          candidateLedger: new Map(),
          rankedLeaves: [],
          familyAssessments: [],
          decision: exactAliasLeafDecision.decision,
          selectedLeaf: exactAliasLeafDecision.selectedLeaf,
          cleaned,
          comparisonQuery
        }
      ],
      'buildCoreResult'
    );
  }

  const exactCanonicalFamilies = await trace.call(findExactCanonicalFamilies, [runtime, retrievalRequest], 'findExactCanonicalFamilies');
  const exactFamilyDecision = await trace.call(
    selectUniqueExactCanonicalFamily,
    [exactCanonicalFamilies],
    'selectUniqueExactCanonicalFamily'
  );
  if (exactFamilyDecision) {
    return trace.call(
      buildCoreResult,
      [
        {
          candidateLedger: new Map(),
          rankedLeaves: [],
          familyAssessments: [],
          decision: exactFamilyDecision.decision,
          selectedFamily: exactFamilyDecision.selectedFamily,
          cleaned,
          comparisonQuery
        }
      ],
      'buildCoreResult'
    );
  }

  const rawRecall = await trace.call(
    retrieveRecallCandidates,
    [
      runtime,
      retrievalRequest,
      {
        exactCanonicalLeaves,
        exactAliasLeaves,
        aliasResult
      },
      CLASSIFIER_RECALL_LIMITS
    ],
    'retrieveRecallCandidates'
  );
  const mergedRecall = await trace.call(mergeCandidateEvidence, [rawRecall], 'mergeCandidateEvidence');
  const hydratedCoreCandidates = await trace.call(hydrateCandidateCores, [runtime, mergedRecall], 'hydrateCandidateCores');

  const candidateLedger = await trace.call(
    assessCandidatesThroughFilterFunnel,
    [hydratedCoreCandidates, comparisonQuery, leafStructureArtifact, queryProfile, options.locale],
    'assessCandidatesThroughFilterFunnel'
  );

  const families = await trace.call(
    validateFamilies,
    [runtime, candidateLedger, exactCanonicalFamilies, comparisonQuery, queryProfile],
    'validateFamilies'
  );
  const rankedLeaves = await trace.call(rankPromotableLeaves, [candidateLedger, families], 'rankPromotableLeaves');
  const outcome = await trace.call(selectDecision, [rankedLeaves, families, candidateLedger, comparisonQuery], 'selectDecision');

  return trace.call(
    buildCoreResult,
    [
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
    ],
    'buildCoreResult'
  );
}
