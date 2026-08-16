import {
  expandTokenVariants,
  normalizeQueryLocale,
  prepareFamilyScopedQueryFromPrepared,
  prepareQuery,
  type FamilyScopedPreparedQuery,
  type PreparedQuery,
  type SupportedQueryLocale
} from '../query/query-preparation.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import type { OccupationIntentVocabulary } from '../query/query-intent.js';
import type { OccupationRoleSpanSelection } from '../query/occupation-role-span-selector.js';
import { prepareOccupationRetrievalQuery, type PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { occupationRoleHeadSharesEquivalentClass } from '../query/occupation-role-head-equivalence.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { isEnglishQuery } from '../utils/lang.js';
import {
  DEFAULT_SIBLING_LIMIT,
  OccupationCandidateBranchExpander,
  type ExpandedOccupationCandidate,
  type ExpandOccupationCandidateBranchesOptions,
  type ExpandOccupationCandidateBranchesResult,
  type OccupationCandidateBranch
} from '../retrieval/occupation-candidate-branches.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever,
  retrievalSurfaceLocales,
  type RetrievalProfile,
  type RetrievalChannel
} from '../retrieval/occupation-candidates.js';
import type { OccupationRetrievalEngine, OccupationTextHit, OccupationTextRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { createRetrievalEngine } from '../retrieval/retrieval-engine-factory.js';
import { TokenLeafClosenessRanker, type LeafClosenessRank } from './ranking/leaf-closeness-ranker.js';
import { FamilyScopedLeafRanker, type FamilyScopedLeafFit } from './ranking/family-scoped-leaf-ranker.js';
import {
  LeafSelectionEvidenceRanker,
  type LeafSelectionEvidence,
  type LeafSelectionEvidenceTier
} from './ranking/leaf-selection-evidence-ranker.js';
import { CapabilityFitRanker, type CapabilityFit } from './ranking/capability-fit-ranker.js';
import { FamilyProfileRetriever, type FamilyProfileHit } from './family-profile-retriever.js';
import { getGenericHeadFamilyPriors, hasGenericHeadVenueContext, type GenericHeadFamilyPrior } from './generic-head-family-priors.js';
import { getJobFunctionFamilyPriors, normalizeJobFunction, type JobFunctionFamilyPrior } from './job-function-family-priors.js';
import {
  BRANCH_MARGIN_POLICY,
  EVIDENCE_NORMALIZATION_POLICY,
  FAMILY_SCORING_POLICY,
  GENERIC_RISK_PENALTY,
  LEAF_SCORING_POLICY,
  NUMERIC_COMPARISON_POLICY,
  PIPELINE_DECISION_GATE
} from '../scoring/scoring-policy.js';
import {
  hydrateRuntimeSearchMetaRecord,
  hydrateRuntimeSearchMetaRecords,
  loadOccupationSearchMetaArtifactRequired,
  type RuntimeSearchMetaCoreRecord,
  type RuntimeSearchMetaRecord
} from '../runtime/occupation-search-meta-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type {
  OccupationLeafStructureRecord,
  LeafAuthorityKind,
  LeafSpecializationKind
} from '../runtime/occupation-leaf-structure-contract.js';
import { preparedQueryRequestsAuthority, preparedQuerySupportsSpecializationKind } from '../runtime/occupation-leaf-structure-rules.js';
import {
  findReviewedFamilySignalMatches,
  loadOccupationReviewedFamilySignalsArtifactRequired,
  type ReviewedFamilySignalMatch
} from '../runtime/occupation-reviewed-family-signals.js';
import { timed, type TimingMap } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost, requirePositiveIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { readOptionalEnv } from '../config/env.js';
import { getOccupationFamilyContext } from '../api/occupation-family-taxonomy.js';

export type PipelineEvidenceChannel =
  | RetrievalChannel
  | 'exact_family_canonical'
  | 'cross_locale_english_backbone'
  | 'job_function_family_prior'
  | 'generic_head_family_prior'
  | 'reviewed_family_signal'
  | 'reviewed_family_penalty'
  | 'family_profile'
  | 'graph_support'
  | 'graph_family_recovery';

export type PipelineEvidenceRecord = {
  channel: PipelineEvidenceChannel;
  score: number;
  sourceStage: string;
  details: Record<string, unknown>;
};

export type PipelineLeafCandidate = {
  graphNodeId: number;
  canonicalLabel: string;
  familyKey: string;
  familyKind: 'family' | 'group' | 'node';
  familyNodeId: number;
  familyLabel: string;
  genericRisk: 'low' | 'medium' | 'high' | null;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  leafStructure: OccupationLeafStructureRecord | null;
  evidence: PipelineEvidenceRecord[];
  closeness: LeafClosenessRank | null;
  familyScopedFit: FamilyScopedLeafFit | null;
  capabilityFit: CapabilityFit | null;
  selectionEvidence: LeafSelectionEvidence | null;
  score: number;
  confidence: number;
};

export type PipelineFamilyCandidate = {
  familyKey: string;
  familyKind: 'family' | 'group' | 'node';
  familyNodeId: number;
  familyLabel: string;
  evidence: PipelineEvidenceRecord[];
  supportingLeafIds: Set<number>;
  branchShare: number;
  branchMarginRatio: number | null;
  evidenceTier: FamilyEvidenceTier | null;
  evidenceTierRank: number;
  score: number;
  confidence: number;
};

export type FamilyEvidenceTier =
  | 'local_exact'
  | 'cross_locale_backbone'
  | 'folded_alias'
  | 'family_profile'
  | 'strong_phrase'
  | 'graph_only';

export type PipelineDecision = {
  decisionType: 'leaf' | 'family' | 'group' | 'multi_span' | 'unresolved';
  selectedNodeId: number | null;
  selectedLabel: string | null;
  confidence: number;
  reason: string;
  explanation: PipelineDecisionExplanation;
};

// Surfaces the intermediate state that actually decided the outcome (resolution.md #21), so "why did
// this occupation win?" is answerable from the result alone rather than by re-running the pipeline
// with debugger breakpoints. Every field is read from state already computed by earlier stages.
export type PipelineDecisionExplanation = {
  query: string;
  normalizedQuery: string;
  roleTokens: string[];
  roleHeadTokens: string[];
  genericTokens: string[];
  candidateFamily: { label: string; evidenceTier: FamilyEvidenceTier | null; confidence: number } | null;
  candidateLeaf: {
    label: string;
    evidenceTier: LeafSelectionEvidenceTier | null;
    confidence: number;
    roleCompatibility: RoleCompatibility;
    specializationSupport: LeafSpecializationSupport;
  } | null;
  rejectedCompetitors: Array<{ label: string; kind: 'family' | 'leaf'; reason: string }>;
  finalDecisionGate: string;
};

export type PipelineCoverageStatus = {
  status:
    | 'exact_canonical_match'
    | 'closest_available_match'
    | 'likely_dictionary_gap'
    | 'locale_gap'
    | 'english_backbone_supported'
    | 'cross_locale_family_only'
    | 'multi_span'
    | 'insufficient_evidence';
  exactCanonicalAvailable: boolean;
  closestMatchAvailable: boolean;
  likelyDictionaryGap: boolean;
  crossLocaleBackboneSupported: boolean;
  crossLocaleFamilyOnly: boolean;
  summary: string;
  signals: {
    topLeafCanonicalTerm: string | null;
    topFamilyCanonicalTerm: string | null;
    topFamilyEvidenceTier: FamilyEvidenceTier | null;
    matchedLabel: string | null;
    matchedLabelSource: 'canonical' | 'alias' | null;
    matchedUsefulTokens: string[];
    missingUsefulTokens: string[];
    roleTokens: string[];
    roleHeadTokens: string[];
    domainTokens: string[];
    matchedRoleTokens: string[];
    missingRoleTokens: string[];
    matchedDomainTokens: string[];
    intentConfidence: number;
  };
};

export type OccupationSearchPipelineOptions = ExpandOccupationCandidateBranchesOptions & {
  topFamilyLimit?: number;
  topLeavesPerFamily?: number;
  jobFunction?: string;
  debug?: boolean;
};

// resolution.md #11: distinguishes "was the expected candidate even retrieved" (recall) from
// "was it ranked correctly" (precision) by recording every candidate's rank and truncation fate
// at the two pool-narrowing points (family consolidation, leaf narrowing within families).
export type CandidatePoolTraceEntry = {
  poolKind: 'family' | 'leaf';
  identifier: string | number;
  label: string;
  familyKey?: string;
  rankBeforeTruncation: number;
  survived: boolean;
  discardReason: string | null;
};

export type PipelineSpanResult = {
  spanIndex: number;
  query: string;
  preparedQuery: PreparedQuery;
  decision: PipelineDecision;
  coverageStatus: PipelineCoverageStatus;
  rankedFamilies: RankedPipelineFamily[];
  rankedLeaves: RankedPipelineLeaf[];
  scannedAliasHitCount: number;
  scannedOpenSearchHitCount: number;
  debug: {
    stages: string[];
    attempts: PipelineAttemptSummary[];
    timings: TimingMap;
    rawBranchExpansion: ExpandOccupationCandidateBranchesResult | null;
    candidatePoolTrace: CandidatePoolTraceEntry[];
  };
};

export type OccupationSearchPipelineResult = {
  queryContext: {
    originalQuery: string;
    query: string;
    querySpans: string[];
    locale: string;
    querySignals: string[];
    keptQuerySignals: string[];
    querySignalCleaningMs: number;
    roleSpanSelection: OccupationRoleSpanSelection | null;
    sourceName: string;
    retrievalProfile: RetrievalProfile;
    modelKey: string;
    modelDimensions: number | null;
    limit: number;
    siblingLimit: number;
    evaluationQueryId: number | null;
    scannedAliasHitCount: number;
    scannedOpenSearchHitCount: number;
    jobFunction: string | null;
  };
  preparedQuery: PreparedQuery;
  decision: PipelineDecision;
  coverageStatus: PipelineCoverageStatus;
  spanResults: PipelineSpanResult[];
  rankedFamilies: RankedPipelineFamily[];
  rankedLeaves: RankedPipelineLeaf[];
  debug: {
    stages: string[];
    attempts: PipelineAttemptSummary[];
    timings: TimingMap;
    rawBranchExpansion: ExpandOccupationCandidateBranchesResult | null;
    candidatePoolTrace: CandidatePoolTraceEntry[];
  };
};

export type PipelineAttemptKind = 'primary' | 'synonym_fallback';

export type PipelineAttemptSummary = {
  attempt: number;
  kind: PipelineAttemptKind;
  query: string;
  status: 'used' | 'skipped';
  decisionType: PipelineDecision['decisionType'];
  confidence: number;
  reason: string;
};

export type RankedPipelineFamily = Omit<PipelineFamilyCandidate, 'supportingLeafIds'> & {
  rank: number;
  supportingLeafCount: number;
  leaves: RankedPipelineLeaf[];
  selectionAuthority?: RecoveredFamilySelectionAuthority;
};

export type RankedPipelineLeaf = PipelineLeafCandidate & {
  rank: number;
};

type PipelineState = {
  occupationRetriever: OccupationTextRetrievalEngine;
  leafStructureArtifact: OccupationLeafStructureArtifact | null;
  preparedQuery: PreparedQuery;
  familyScopedPreparedQuery: FamilyScopedPreparedQuery;
  rolePreparedQuery: PreparedQuery;
  roleFamilyScopedPreparedQuery: FamilyScopedPreparedQuery;
  branchExpansion: ExpandOccupationCandidateBranchesResult | null;
  candidateFamilies: Map<string, PipelineFamilyCandidate>;
  candidateLeafs: Map<number, PipelineLeafCandidate>;
  recoveredAliasesByNodeId: Map<number, string[]>;
  recoveredCapabilityLabelsByNodeId: Map<number, string[]>;
  timings: TimingMap;
  rankedFamilies: RankedPipelineFamily[];
  rankedLeaves: RankedPipelineLeaf[];
  decision: PipelineDecision | null;
  stages: string[];
  candidatePoolTrace: CandidatePoolTraceEntry[];
  topFamilyLimit: number;
  topLeavesPerFamily: number;
  jobFunction: string | null;
  debugEnabled: boolean;
};

type PipelineStage = (state: PipelineState) => Promise<PipelineState>;

type NormalizedPipelineOptions = ExpandOccupationCandidateBranchesOptions & {
  query: string;
  locale: string;
  sourceName: string;
  modelKey: string;
  limit: number;
  topFamilyLimit: number;
  topLeavesPerFamily: number;
  jobFunction?: string;
  debug: boolean;
};

type FamilyLeafRecoveryFields = {
  graph_node_id: number;
  canonical_label: string;
  generic_risk: 'low' | 'medium' | 'high';
  has_hierarchy: number;
  has_capability_support: number;
  family_node_id: number;
  family_label: string;
  group_node_id: number | null;
  group_label: string | null;
};

const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const FAMILY_SCOPED_LEAF_RANKER = new FamilyScopedLeafRanker();
const CAPABILITY_FIT_RANKER = new CapabilityFitRanker();
const LEAF_SELECTION_EVIDENCE_RANKER = new LeafSelectionEvidenceRanker();
const FAMILY_PROFILE_RETRIEVER = new FamilyProfileRetriever();
const CANONICAL_USEFUL_COVERAGE_CACHE = new WeakMap<PreparedQuery, Map<PipelineLeafCandidate, number>>();
// canonicalLabel is a stable, immutable string per graph node -- folding/tokenizing it is a pure
// function of that string, so cache by label text once instead of re-folding/re-tokenizing the same
// leaf's canonical label on every sort comparison and every gate check across every pipeline.run() call.
const CANONICAL_LABEL_FOLD_CACHE = new Map<string, string>();
const CANONICAL_LABEL_TOKEN_CACHE = new Map<string, string[]>();

function foldedCanonicalLabel(label: string): string {
  let folded = CANONICAL_LABEL_FOLD_CACHE.get(label);

  if (folded === undefined) {
    folded = foldSearchText(label);
    CANONICAL_LABEL_FOLD_CACHE.set(label, folded);
  }

  return folded;
}

function canonicalLabelTokens(label: string): string[] {
  let tokens = CANONICAL_LABEL_TOKEN_CACHE.get(label);

  if (tokens === undefined) {
    tokens = tokenizeNormalizedText(foldedCanonicalLabel(label));
    CANONICAL_LABEL_TOKEN_CACHE.set(label, tokens);
  }

  return tokens;
}

export class OccupationSearchPipeline {
  public constructor(
    private readonly expander: OccupationCandidateBranchExpander = new OccupationCandidateBranchExpander(
      OccupationCandidateRetriever.withEngine(null, createRetrievalEngine())
    ),
    private readonly occupationRetriever: OccupationTextRetrievalEngine = createRetrievalEngine().occupations,
    private readonly leafStructureArtifact: OccupationLeafStructureArtifact | null = null
  ) {}

  public static withEngine(engine: OccupationRetrievalEngine): OccupationSearchPipeline {
    return new OccupationSearchPipeline(
      new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(null, engine)),
      engine.occupations,
      null
    );
  }

  public static withRuntime(runtime: OccupationRuntimeContext): OccupationSearchPipeline {
    return new OccupationSearchPipeline(
      new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(null, runtime.retrievalEngine)),
      runtime.retrievalEngine.occupations,
      runtime.leafStructureRuntimeEnabled ? runtime.leafStructureArtifact : null
    );
  }

  public async run(options: OccupationSearchPipelineOptions): Promise<OccupationSearchPipelineResult> {
    const normalizedOptions = normalizeOptions(options);
    const cleanedQuery = await cleanOccupationQuerySurface(normalizedOptions.query, normalizedOptions.locale);

    if (!cleanedQuery) {
      throw new Error('Provide a query string for pipeline query preparation.');
    }

    const activeOptions: NormalizedPipelineOptions = { ...normalizedOptions, query: cleanedQuery };

    if (activeOptions.locale !== DEFAULT_RETRIEVAL_LOCALE && (await isEnglishQuery(activeOptions.query, activeOptions.sourceName))) {
      activeOptions.locale = DEFAULT_RETRIEVAL_LOCALE;
    }
    //console.log(activeOptions.query, await isEnglishQuery(activeOptions.query, activeOptions.sourceName));

    const intentVocabularyArtifact = await timed(
      () => loadOccupationIntentVocabularyArtifactRequired(activeOptions.sourceName),
      'pipeline.intent_vocabulary.artifact_load',
      {} as TimingMap
    );

    const primaryRetrievalQuery = await prepareOccupationRetrievalQuery(
      {
        sourceName: activeOptions.sourceName,
        locale: activeOptions.locale,
        originalQuery: activeOptions.query
      },
      intentVocabularyArtifact.artifact
    );

    const preparedQuery = primaryRetrievalQuery.preparedQuery;

    const isMultiSpan = shouldResolveIndependentOccupationSpans(primaryRetrievalQuery.originalQuery, primaryRetrievalQuery.querySpans);

    const retrievalResults: ExpandOccupationCandidateBranchesResult[] = [];

    if (isMultiSpan) {
      for (const span of primaryRetrievalQuery.querySpans) {
        const spanRetrievalQuery = await prepareOccupationRetrievalQuery(
          {
            sourceName: activeOptions.sourceName,
            locale: activeOptions.locale,
            originalQuery: span
          },
          intentVocabularyArtifact.artifact
        );

        retrievalResults.push(
          await this.expander.run({
            ...activeOptions,
            query: span,
            evaluationQueryId: undefined,
            retrievalQuery: spanRetrievalQuery,
            preparedQuery: spanRetrievalQuery.preparedQuery
          })
        );
      }
    } else {
      retrievalResults.push(
        await this.expander.run({
          ...activeOptions,
          query: primaryRetrievalQuery.query,
          evaluationQueryId: undefined,
          retrievalQuery: primaryRetrievalQuery,
          preparedQuery: preparedQuery
        })
      );
    }

    const primaryRetrievalResult = retrievalResults[0];

    if (retrievalResults.length > 1) {
      const spanResults: PipelineSpanResult[] = [];

      for (const [index, retrievalResult] of retrievalResults.entries()) {
        const spanOptions: NormalizedPipelineOptions = {
          ...activeOptions,
          query: retrievalResult.originalQuery,
          evaluationQueryId: undefined
        };
        const spanAttempt = await runRankingAttempt(
          retrievalResult,
          intentVocabularyArtifact.artifact,
          spanOptions,
          this.occupationRetriever,
          this.leafStructureArtifact
        );
        const attempts = [summarizeAttempt(1, 'primary', spanAttempt, 'used', 'multi-span independent span retrieval attempt')];
        const result = toPipelineResult(spanAttempt, attempts);

        spanResults.push({
          spanIndex: index + 1,
          query: retrievalResult.originalQuery,
          preparedQuery: result.preparedQuery,
          decision: result.decision,
          coverageStatus: result.coverageStatus,
          rankedFamilies: result.rankedFamilies.slice(0, 1),
          rankedLeaves: result.rankedLeaves.slice(0, 1),
          scannedAliasHitCount: result.queryContext.scannedAliasHitCount,
          scannedOpenSearchHitCount: result.queryContext.scannedOpenSearchHitCount,
          debug: result.debug
        });
      }

      return toMultiSpanPipelineResult(primaryRetrievalQuery, retrievalResults, spanResults, activeOptions.jobFunction ?? null);
    }

    const primaryAttempt = await runRankingAttempt(
      primaryRetrievalResult,
      intentVocabularyArtifact.artifact,
      activeOptions,
      this.occupationRetriever,
      this.leafStructureArtifact
    );
    const attempts: PipelineAttemptSummary[] = [summarizeAttempt(1, 'primary', primaryAttempt, 'used', 'primary retrieval attempt')];
    let selectedAttempt = primaryAttempt;

    if (shouldAttemptSynonymFallback(primaryAttempt.state)) {
      const fallbackOptions = await planSynonymFallbackAttempt(primaryAttempt.state, activeOptions);

      if (fallbackOptions) {
        const fallbackRetrievalResult = await this.expander.run(fallbackOptions);
        const fallbackAttempt = await runRankingAttempt(
          fallbackRetrievalResult,
          intentVocabularyArtifact.artifact,
          activeOptions,
          this.occupationRetriever,
          this.leafStructureArtifact
        );

        attempts.push(summarizeAttempt(2, 'synonym_fallback', fallbackAttempt, 'used', 'single synonym fallback attempt'));
        selectedAttempt = chooseBetterAttempt(primaryAttempt, fallbackAttempt);
      } else {
        attempts.push({
          attempt: 2,
          kind: 'synonym_fallback',
          query: primaryRetrievalResult.query,
          status: 'skipped',
          decisionType: primaryAttempt.state.decision.decisionType,
          confidence: primaryAttempt.state.decision.confidence,
          reason: 'fallback gate reached, but synonym fallback planner did not produce a safe alternate query'
        });
      }
    }

    return toPipelineResult(selectedAttempt, attempts, activeOptions.locale);
  }
}

function shouldResolveIndependentOccupationSpans(originalQuery: string, querySpans: string[]): boolean {
  return querySpans.length > 1 && hasIndependentOccupationSpanSeparator(originalQuery);
}

function hasIndependentOccupationSpanSeparator(value: string): boolean {
  return /[\r\n\t;•·▪‣◦|/]+/iu.test(value);
}

type PipelineAttemptResult = {
  branchExpansion: ExpandOccupationCandidateBranchesResult;
  state: PipelineState & { decision: PipelineDecision };
};

async function runRankingAttempt(
  retrievalResult: ExpandOccupationCandidateBranchesResult,
  intentVocabulary: OccupationIntentVocabulary,
  options: NormalizedPipelineOptions,
  occupationRetriever: OccupationTextRetrievalEngine,
  leafStructureArtifact: OccupationLeafStructureArtifact | null
): Promise<PipelineAttemptResult> {
  const preparedQuery = retrievalResult.preparedQuery;
  const familyScopedPreparedQuery = prepareFamilyScopedQueryFromPrepared(preparedQuery);
  const roleQuery = intentRoleQuery(preparedQuery);
  const rolePreparedQuery = await prepareQuery(roleQuery, retrievalResult.locale, {
    sourceName: retrievalResult.sourceName,
    intentVocabulary
  });
  const roleFamilyScopedPreparedQuery = prepareFamilyScopedQueryFromPrepared(rolePreparedQuery);

  let state: PipelineState = {
    occupationRetriever,
    leafStructureArtifact,
    preparedQuery,
    familyScopedPreparedQuery,
    rolePreparedQuery,
    roleFamilyScopedPreparedQuery,
    branchExpansion: retrievalResult,
    candidateFamilies: new Map(),
    candidateLeafs: new Map(),
    recoveredAliasesByNodeId: new Map(),
    recoveredCapabilityLabelsByNodeId: new Map(),
    rankedFamilies: [],
    rankedLeaves: [],
    decision: null,
    stages: [],
    candidatePoolTrace: [],

    timings: { ...retrievalResult.timings },
    topFamilyLimit: options.topFamilyLimit,
    topLeavesPerFamily: options.topLeavesPerFamily,
    jobFunction: options.jobFunction ?? null,
    debugEnabled: options.debug
  };

  const stages: PipelineStage[] = [
    accumulateCurrentRetrievalEvidenceStage,
    resolveLeafFirstStage,
    retrieveFamilyProfileEvidenceStage,
    applyJobFunctionFamilyPriorStage,
    applyGenericHeadFamilyPriorStage,
    applyReviewedFamilySignalStage,
    consolidateFamiliesStage,
    recoverLeavesInsideTopFamiliesStage,
    narrowLeavesWithinFamiliesStage,
    selectPipelineDecisionStage
  ];

  for (const stage of stages) {
    state = await timed(() => stage(state), `pipeline.stage.${stage.name || 'anonymous'}`, state.timings);

    if (state.decision) {
      break;
    }
  }

  if (!state.decision) {
    throw new Error('Pipeline did not produce a decision.');
  }

  return {
    branchExpansion: retrievalResult,
    state: {
      ...state,
      decision: state.decision
    }
  };
}

async function retrieveFamilyProfileEvidenceStage(state: PipelineState): Promise<PipelineState> {
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

  const familyProfileArtifact = await timed(
    () => loadOccupationFamilyProfileArtifactRequired(branchExpansion.sourceName),
    'pipeline.family_profile.artifact_load',
    state.timings
  );
  const profileHits = await timed(
    () =>
      FAMILY_PROFILE_RETRIEVER.retrieve({
        preparedQuery: state.familyScopedPreparedQuery,
        artifact: familyProfileArtifact,
        locale: branchExpansion.locale,
        rawQuery: branchExpansion.originalQuery,
        limit: Math.max(state.topFamilyLimit * 3, 12)
      }),
    'pipeline.family_profile.retrieve',
    state.timings
  );

  for (const hit of profileHits) {
    const family = getOrCreateProfileFamily(state, hit);
    family.evidence.push(familyProfileEvidence(hit));

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
async function resolveLeafFirstStage(state: PipelineState): Promise<PipelineState> {
  if (state.candidateLeafs.size === 0) {
    return {
      ...state,
      stages: appendStage(state, 'skip_leaf_first_resolution_no_candidates')
    };
  }

  const branchExpansion = requireBranchExpansion(state);
  const leavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
  const provisionalFamilies: RankedPipelineFamily[] = Array.from(leavesByFamilyKey.keys())
    .map((familyKey) => state.candidateFamilies.get(familyKey))
    .filter((family): family is PipelineFamilyCandidate => family !== undefined)
    .map((family) => scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.rolePreparedQuery))
    .sort(compareFamilies)
    .map((family, index) => ({
      ...family,
      rank: index + 1,
      supportingLeafCount: family.supportingLeafIds.size,
      leaves: []
    }));

  const scoredFamilies: RankedPipelineFamily[] = provisionalFamilies.map((provisionalFamily) => {
    const scoredLeaves = (leavesByFamilyKey.get(provisionalFamily.familyKey) ?? []).map((leaf) =>
      scoreLeafCandidate(leaf, provisionalFamily, state)
    );
    const orderedLeaves = rankEligibleLeavesFirst(scoredLeaves, state.preparedQuery, branchExpansion.originalQuery).map((leaf, index) => ({
      ...leaf,
      rank: index + 1
    }));

    return {
      ...provisionalFamily,
      leaves: orderedLeaves
    };
  });

  const selectableTopLeaves = scoredFamilies
    .map((family) => {
      const topLeaf = family.leaves[0];
      return topLeaf && isLeafFullySelectable(topLeaf, family, state.preparedQuery, scoredFamilies) ? { leaf: topLeaf, family } : null;
    })
    .filter((entry): entry is { leaf: RankedPipelineLeaf; family: RankedPipelineFamily } => entry !== null)
    .sort((left, right) => compareLeavesForQuery(left.leaf, right.leaf, state.preparedQuery, branchExpansion.originalQuery));

  // A leaf can win the cross-family textual comparison above purely on token/role overlap even
  // when its own family is meaningfully weaker than another candidate family that never got to
  // field a leaf. Guard against that by requiring the winning leaf's family to be within
  // LEAF_FIRST_FAMILY_STRENGTH_MARGIN of the strongest scored family, unless the leaf itself is a
  // genuine exact canonical/alias match for the raw query (which should still short-circuit).
  const bestFamilyConfidence = scoredFamilies.reduce((max, family) => Math.max(max, family.confidence), 0);
  const familyStrengthEligibleLeaves = selectableTopLeaves.filter(
    (entry) =>
      isRawExactMatch(entry.leaf, state.preparedQuery) ||
      entry.family.confidence >= bestFamilyConfidence - PIPELINE_DECISION_GATE.LEAF_FIRST_FAMILY_STRENGTH_MARGIN
  );

  const exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner =
    selectableTopLeaves.find(({ leaf }) => {
      if (!hasLeafRoleGrounding(leaf, state.preparedQuery)) {
        return false;
      }

      if (hasRawQueryFullStringExactCanonical(leaf, state.preparedQuery, branchExpansion.originalQuery)) {
        return true;
      }

      if (!passesCategoryQueryGuards(leaf, state.preparedQuery)) {
        return false;
      }

      return hasRawQueryCanonicalSingularPluralForm(leaf, state.preparedQuery) || hasRawQueryExactLeafAlias(leaf, state.preparedQuery);
    }) ?? null;

  const winner =
    exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner ?? familyStrengthEligibleLeaves[0] ?? null;

  if (!winner) {
    return {
      ...state,
      stages: appendStage(state, 'skip_leaf_first_resolution_no_selectable_leaf')
    };
  }

  const rescuedFamilyIndex = scoredFamilies.findIndex((family) => family.familyKey === winner.family.familyKey);
  const reorderedFamilies =
    rescuedFamilyIndex > 0
      ? [
          scoredFamilies[rescuedFamilyIndex]!,
          ...scoredFamilies.slice(0, rescuedFamilyIndex),
          ...scoredFamilies.slice(rescuedFamilyIndex + 1)
        ]
      : scoredFamilies;
  const rankedFamilies = reorderedFamilies.map((family, index) => ({ ...family, rank: index + 1 }));
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
      reason:
        exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner !== null
          ? 'a leaf cleared the exact leaf canonical-or-alias rescue gate during leaf-first global resolution'
          : 'leaf-first global resolution selected the best structurally eligible leaf across all candidate families',
      explanation: buildDecisionExplanation(
        { ...state, rankedFamilies, rankedLeaves },
        winningFamily,
        winner.leaf,
        exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner !== null
          ? 'a leaf cleared the exact leaf canonical-or-alias rescue gate during leaf-first global resolution'
          : 'leaf-first global resolution selected the best structurally eligible leaf across all candidate families'
      )
    },
    stages: appendStage(state, 'resolve_leaf_first')
  };
}

async function applyJobFunctionFamilyPriorStage(state: PipelineState): Promise<PipelineState> {
  const priors = getJobFunctionFamilyPriors(state.jobFunction ?? undefined);
  const priorList = Array.isArray(priors) ? priors : [];

  if (priorList.length === 0) {
    return {
      ...state,
      stages: appendStage(state, 'skip_job_function_family_prior')
    };
  }

  const priorsByFamilyNodeId = new Map(priorList.map((prior) => [prior.familyNodeId, prior]));
  let appliedCount = 0;

  for (const family of state.candidateFamilies.values()) {
    if (family.familyKind !== 'family') {
      continue;
    }

    const prior = priorsByFamilyNodeId.get(family.familyNodeId);

    if (!prior || !hasJobFunctionPriorRoleGate(family, state, state.preparedQuery)) {
      continue;
    }

    family.evidence.push(jobFunctionFamilyPriorEvidence(prior, state.jobFunction));
    appliedCount += 1;
  }

  return {
    ...state,
    stages: appendStage(state, appliedCount > 0 ? 'apply_job_function_family_prior' : 'skip_job_function_family_prior_no_role_gate')
  };
}

async function applyGenericHeadFamilyPriorStage(state: PipelineState): Promise<PipelineState> {
  const authoritativeHeadTokens = authoritativeIntentRoleHeadTokens(state.preparedQuery);
  const priors = getGenericHeadFamilyPriors(
    authoritativeHeadTokens,
    state.preparedQuery.intent.roleTokens,
    state.preparedQuery.intent.venueTokens,
    Boolean(state.preparedQuery.commonRolePhraseMatch || state.preparedQuery.familyAliasMatch)
  );
  const priorList = Array.isArray(priors) ? priors : [];
  const venueAwarePriorFamilyIds = new Set(priorList.filter((prior) => prior.strength === 'primary').map((prior) => prior.familyNodeId));
  const hasVenueContext = hasGenericHeadVenueContext(state.preparedQuery.intent.roleTokens, state.preparedQuery.intent.venueTokens);

  if (priorList.length === 0) {
    return {
      ...state,
      stages: appendStage(state, 'skip_generic_head_family_prior')
    };
  }

  if (hasVenueContext) {
    for (const prior of priorList) {
      if (prior.strength !== 'primary') {
        continue;
      }

      getOrCreateRuntimeFamily(state, {
        familyNodeId: prior.familyNodeId,
        familyLabel: prior.familyLabel,
        groupNodeId: null,
        groupLabel: null
      });
    }
  }

  const priorsByFamilyNodeId = new Map(priorList.map((prior) => [prior.familyNodeId, prior]));
  let appliedCount = 0;

  for (const family of state.candidateFamilies.values()) {
    if (family.familyKind !== 'family') {
      continue;
    }

    const prior = priorsByFamilyNodeId.get(family.familyNodeId);

    if (!prior) {
      continue;
    }

    const venueOverride = hasVenueContext && prior.strength === 'primary' && venueAwarePriorFamilyIds.has(family.familyNodeId);

    if (!venueOverride && !hasGenericHeadPriorRoleGate(family, state, state.preparedQuery)) {
      continue;
    }

    family.evidence.push(genericHeadFamilyPriorEvidence(prior, state.preparedQuery));
    appliedCount += 1;
  }

  return {
    ...state,
    stages: appendStage(state, appliedCount > 0 ? 'apply_generic_head_family_prior' : 'skip_generic_head_family_prior_no_role_gate')
  };
}

async function applyReviewedFamilySignalStage(state: PipelineState): Promise<PipelineState> {
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
    const family =
      match.rule.action === 'support'
        ? getOrCreateRuntimeFamily(state, {
            familyNodeId: match.rule.familyNodeId,
            familyLabel: match.rule.familyLabel,
            groupNodeId: null,
            groupLabel: null
          })
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

function hasJobFunctionPriorRoleGate(family: PipelineFamilyCandidate, state: PipelineState, preparedQuery: PreparedQuery): boolean {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return false;
  }

  if (family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
    return true;
  }

  if (
    maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) > 0 ||
    maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery) > 0
  ) {
    return true;
  }

  return Array.from(family.supportingLeafIds).some((leafId) => {
    const leaf = state.candidateLeafs.get(leafId);

    if (!leaf) {
      return false;
    }

    return hasLeafCandidateRoleGrounding(leaf, preparedQuery);
  });
}

function hasGenericHeadPriorRoleGate(family: PipelineFamilyCandidate, state: PipelineState, preparedQuery: PreparedQuery): boolean {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return false;
  }

  if (family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
    return true;
  }

  if (
    maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery) ||
    maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery)
  ) {
    return true;
  }

  return Array.from(family.supportingLeafIds).some((leafId) => {
    const leaf = state.candidateLeafs.get(leafId);

    if (!leaf) {
      return false;
    }

    return hasLeafCandidateRoleGrounding(leaf, preparedQuery);
  });
}

function hasLeafCandidateRoleGrounding(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const roleTokens = authoritativeIntentRoleHeadTokens(preparedQuery);

  if (roleTokens.length === 0) {
    return false;
  }

  return matchedIntentTokens(roleTokens, [leaf.canonicalLabel, ...matchedAliasLabels(leaf.evidence)]).matched.length > 0;
}

function hasAuthoritativeAliasEvidence(branchExpansion: ExpandOccupationCandidateBranchesResult): boolean {
  return branchExpansion.candidates.some((candidate) =>
    candidate.evidence.some(
      (evidence) =>
        evidence.channel === 'exact_canonical' || (evidence.channel === 'exact_alias' && evidence.aliasRole === 'canonical_label')
    )
  );
}

function appendStage(state: PipelineState, stage: string): string[] {
  return state.debugEnabled ? [...state.stages, stage] : state.stages;
}

export function isFamilyProfileRetrievalEnabled(): boolean {
  const disableValue = readOptionalEnv('OSE_DISABLE_FAMILY_PROFILE_RETRIEVAL')?.toLowerCase();

  if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
    return false;
  }

  const enableValue = readOptionalEnv('OSE_ENABLE_FAMILY_PROFILE_RETRIEVAL')?.toLowerCase();
  return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}

function shouldAttemptSynonymFallback(state: PipelineAttemptResult['state']): boolean {
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

async function planSynonymFallbackAttempt(
  _state: PipelineAttemptResult['state'],
  _options: NormalizedPipelineOptions
): Promise<NormalizedPipelineOptions | null> {
  // Deliberately no-op until synonym lookup is implemented. The pipeline loop is now ready for a
  // single bounded fallback attempt without changing the primary scoring path.
  return null;
}

function chooseBetterAttempt(primary: PipelineAttemptResult, fallback: PipelineAttemptResult): PipelineAttemptResult {
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

function compareAttemptCoverage(left: PipelineAttemptResult, right: PipelineAttemptResult): number {
  const leftCoverage = buildCoverageStatus(left.state.decision, left.state.rankedFamilies[0] ?? null, left.state.preparedQuery);
  const rightCoverage = buildCoverageStatus(right.state.decision, right.state.rankedFamilies[0] ?? null, right.state.preparedQuery);

  return (
    leftCoverage.signals.missingUsefulTokens.length - rightCoverage.signals.missingUsefulTokens.length ||
    leftCoverage.signals.missingRoleTokens.length - rightCoverage.signals.missingRoleTokens.length ||
    right.state.decision.confidence - left.state.decision.confidence ||
    (right.state.rankedFamilies[0]?.confidence ?? 0) - (left.state.rankedFamilies[0]?.confidence ?? 0)
  );
}

function summarizeAttempt(
  attempt: number,
  kind: PipelineAttemptKind,
  result: PipelineAttemptResult,
  status: PipelineAttemptSummary['status'],
  reason: string
): PipelineAttemptSummary {
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

function toPipelineResult(
  attempt: PipelineAttemptResult,
  attempts: PipelineAttemptSummary[],
  localeOverride?: string
): OccupationSearchPipelineResult {
  const branchExpansion = attempt.branchExpansion;
  const state = attempt.state;

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
      stages: state.stages,
      attempts,
      timings: state.timings,
      rawBranchExpansion: state.debugEnabled ? branchExpansion : null,
      candidatePoolTrace: state.candidatePoolTrace
    }
  };
}

function toMultiSpanPipelineResult(
  primaryRetrievalQuery: PreparedOccupationRetrievalQuery,
  retrievalResults: ExpandOccupationCandidateBranchesResult[],
  spanResults: PipelineSpanResult[],
  jobFunction: string | null
): OccupationSearchPipelineResult {
  const branchExpansion = {
    ...retrievalResults[0],
    originalQuery: primaryRetrievalQuery.originalQuery,
    query: primaryRetrievalQuery.query,
    querySpans: primaryRetrievalQuery.querySpans,
    querySignals: primaryRetrievalQuery.querySignals,
    keptQuerySignals: primaryRetrievalQuery.keptQuerySignals,
    querySignalCleaningMs: primaryRetrievalQuery.querySignalCleaningMs,
    roleSpanSelection: primaryRetrievalQuery.roleSpanSelection
  };
  const confidence =
    spanResults.length === 0 ? 0 : roundScore(spanResults.reduce((sum, span) => sum + span.decision.confidence, 0) / spanResults.length);
  const preparedQuery = emptyPreparedQuery(branchExpansion);
  const decision: PipelineDecision = {
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
      candidatePoolTrace: spanResults.flatMap((span) => span.debug.candidatePoolTrace)
    }
  };
}

function mergeMultiSpanRetrievalTimings(retrievalResults: ExpandOccupationCandidateBranchesResult[]): TimingMap {
  const timings: TimingMap = {};

  for (const [index, retrievalResult] of retrievalResults.entries()) {
    const prefix = `span_${index + 1}.retrieval`;

    for (const [key, elapsedMs] of Object.entries(retrievalResult.timings)) {
      timings[`${prefix}.${key}`] = elapsedMs;
    }
  }

  return timings;
}

function queryContextFromBranchExpansion(
  branchExpansion: ExpandOccupationCandidateBranchesResult,
  scannedCounts: Partial<
    Pick<OccupationSearchPipelineResult['queryContext'], 'scannedAliasHitCount' | 'scannedOpenSearchHitCount' | 'jobFunction' | 'locale'>
  > = {}
): OccupationSearchPipelineResult['queryContext'] {
  return {
    originalQuery: branchExpansion.originalQuery,
    query: branchExpansion.query,
    querySpans: branchExpansion.querySpans,
    locale: scannedCounts.locale ?? branchExpansion.locale,
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
    jobFunction: scannedCounts.jobFunction ?? null
  };
}

function multiSpanCoverageStatus(spanResults: PipelineSpanResult[]): PipelineCoverageStatus {
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

function emptyCoverageSignals(): PipelineCoverageStatus['signals'] {
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

function sumSpanMetric(spanResults: PipelineSpanResult[], read: (span: PipelineSpanResult) => number): number {
  return spanResults.reduce((sum, span) => sum + read(span), 0);
}

function mergeSpanTimings(primaryTimings: TimingMap, spanResults: PipelineSpanResult[]): TimingMap {
  const timings: TimingMap = { ...primaryTimings };

  for (const span of spanResults) {
    for (const [key, elapsedMs] of Object.entries(span.debug.timings)) {
      timings[`span_${span.spanIndex}.${key}`] = elapsedMs;
    }
  }

  return timings;
}

function emptyPreparedQuery(branchExpansion: ExpandOccupationCandidateBranchesResult): PreparedQuery {
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

function buildCoverageStatus(
  decision: PipelineDecision,
  topFamily: RankedPipelineFamily | null,
  preparedQuery: PreparedQuery
): PipelineCoverageStatus {
  const topLeaf = topFamily?.leaves[0] ?? null;
  const closeness = topLeaf?.closeness ?? null;
  const crossLocaleBackboneSupported =
    topFamily?.evidenceTier === 'cross_locale_backbone' ||
    Boolean(topFamily?.evidence.some((record) => record.channel === 'cross_locale_english_backbone'));
  const crossLocaleFamilyOnly = Boolean(
    crossLocaleBackboneSupported && (decision.decisionType === 'family' || decision.decisionType === 'group')
  );
  const exactCanonicalAvailable = Boolean(
    decision.decisionType === 'leaf' &&
      topLeaf &&
      closeness &&
      (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
        (closeness.matchedLabelSource === 'canonical' && (closeness.exactNormalizedLabel || closeness.exactFoldedLabel)))
  );
  const closestMatchAvailable = Boolean(topLeaf || topFamily);
  const hasUnrepresentedQueryTerms = Boolean(closeness && closeness.missingUsefulTokens.length > 0);
  const likelyDictionaryGap = Boolean(
    closestMatchAvailable &&
      !exactCanonicalAvailable &&
      hasUnrepresentedQueryTerms &&
      (decision.decisionType === 'family' || decision.decisionType === 'group' || decision.decisionType === 'unresolved')
  );

  if (!closestMatchAvailable) {
    return coverageStatus(
      topLeaf,
      topFamily,
      {
        status: 'insufficient_evidence',
        summary: 'No reliable family or leaf candidate was found.'
      },
      preparedQuery
    );
  }

  if (exactCanonicalAvailable) {
    return coverageStatus(
      topLeaf,
      topFamily,
      {
        status: 'exact_canonical_match',
        exactCanonicalAvailable: true,
        crossLocaleBackboneSupported,
        summary: 'The query matched an available canonical occupation leaf exactly.'
      },
      preparedQuery
    );
  }

  if (crossLocaleFamilyOnly) {
    return coverageStatus(
      topLeaf,
      topFamily,
      {
        status: 'cross_locale_family_only',
        crossLocaleBackboneSupported,
        crossLocaleFamilyOnly: true,
        summary:
          'English backbone support helped select the broader family, but local leaf evidence is not strong enough to select one leaf.'
      },
      preparedQuery
    );
  }

  if (likelyDictionaryGap) {
    return coverageStatus(
      topLeaf,
      topFamily,
      {
        status: crossLocaleBackboneSupported ? 'locale_gap' : 'likely_dictionary_gap',
        likelyDictionaryGap: true,
        crossLocaleBackboneSupported,
        summary: crossLocaleBackboneSupported
          ? 'English backbone support found a broader match, but local leaf coverage is incomplete.'
          : 'A broader/closest match is available, but the top leaf does not represent all useful query terms.'
      },
      preparedQuery
    );
  }

  if (crossLocaleBackboneSupported) {
    return coverageStatus(
      topLeaf,
      topFamily,
      {
        status: 'english_backbone_supported',
        crossLocaleBackboneSupported,
        summary: 'The result is supported by local evidence plus English backbone evidence from the same occupation graph.'
      },
      preparedQuery
    );
  }

  return coverageStatus(
    topLeaf,
    topFamily,
    {
      status: 'closest_available_match',
      crossLocaleBackboneSupported,
      summary: 'The result is the closest available canonical match found in the current occupation graph.'
    },
    preparedQuery
  );
}

function coverageStatus(
  topLeaf: RankedPipelineLeaf | null,
  topFamily: RankedPipelineFamily | null,
  overrides: Pick<PipelineCoverageStatus, 'status' | 'summary'> & Partial<Omit<PipelineCoverageStatus, 'status' | 'summary' | 'signals'>>,
  preparedQuery: PreparedQuery
): PipelineCoverageStatus {
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

function coverageSignals(
  topLeaf: RankedPipelineLeaf | null,
  topFamily: RankedPipelineFamily | null,
  preparedQuery: PreparedQuery
): PipelineCoverageStatus['signals'] {
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

async function accumulateCurrentRetrievalEvidenceStage(state: PipelineState): Promise<PipelineState> {
  const branchExpansion = requireBranchExpansion(state);
  const searchMetaArtifact =
    branchExpansion.locale === 'en'
      ? null
      : await timed(
          () => loadOccupationSearchMetaArtifactRequired(branchExpansion.sourceName),
          'pipeline.cross_locale.search_meta_artifact_load',
          state.timings
        );
  const totalBranchScore = branchExpansion.branches.reduce((total, branch) => total + branch.scoreSummary.totalCandidateScore, 0);
  const sortedBranches = [...branchExpansion.branches].sort(
    (left, right) => right.scoreSummary.totalCandidateScore - left.scoreSummary.totalCandidateScore
  );
  const [topBranch, secondBranch] = sortedBranches;

  for (const branch of branchExpansion.branches) {
    const bestOtherBranch = (topBranch?.branchKey === branch.branchKey ? secondBranch : topBranch) ?? null;
    const branchShare = totalBranchScore > 0 ? roundScore(branch.scoreSummary.totalCandidateScore / totalBranchScore) : 0;
    const branchMarginRatio =
      bestOtherBranch && bestOtherBranch.scoreSummary.totalCandidateScore > 0
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

        const crossLocaleSearchMetaRecord = searchMetaArtifact?.getCoreRecord(candidate.graphNodeId) ?? null;
        const hydratedCrossLocaleSearchMetaRecord =
          searchMetaArtifact && crossLocaleSearchMetaRecord
            ? await hydrateRuntimeSearchMetaRecord(searchMetaArtifact, crossLocaleSearchMetaRecord)
            : null;
        const crossLocaleEvidence = buildCrossLocaleEnglishBackboneEvidence(
          record,
          candidate.graphNodeId,
          candidate.canonicalLabel,
          hydratedCrossLocaleSearchMetaRecord
        );

        if (crossLocaleEvidence) {
          family.evidence.push(crossLocaleEvidence);
        }
      }
    }
  }

  return {
    ...state,
    stages: appendStage(state, 'accumulate_current_retrieval_evidence')
  };
}

async function consolidateFamiliesStage(state: PipelineState): Promise<PipelineState> {
  const scoredFamilies = Array.from(state.candidateFamilies.values())
    .map((family) => scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.rolePreparedQuery))
    .sort(compareFamilies);
  const rankedFamilies = scoredFamilies.slice(0, state.topFamilyLimit).map((family, index) => ({
    ...family,
    rank: index + 1,
    supportingLeafCount: family.supportingLeafIds.size,
    leaves: []
  }));

  const candidatePoolTrace = state.debugEnabled
    ? [
        ...state.candidatePoolTrace,
        ...scoredFamilies.map((family, index) => ({
          poolKind: 'family' as const,
          identifier: family.familyNodeId,
          label: family.familyLabel,
          rankBeforeTruncation: index + 1,
          survived: index < state.topFamilyLimit,
          discardReason: index < state.topFamilyLimit ? null : 'below_top_family_limit'
        }))
      ]
    : state.candidatePoolTrace;

  return {
    ...state,
    rankedFamilies,
    candidatePoolTrace,
    stages: appendStage(state, 'consolidate_families')
  };
}

async function recoverLeavesInsideTopFamiliesStage(state: PipelineState): Promise<PipelineState> {
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
  const searchMetaArtifact = await timed(
    () => loadOccupationSearchMetaArtifactRequired(branchExpansion.sourceName),
    'pipeline.family_recovery.search_meta_artifact_load',
    state.timings
  );
  const recoveredRecords = await timed(
    () => searchMetaArtifact.getLeafCoreRecordsForFamilies(familyIds),
    'pipeline.family_recovery.load_family_leaf_records',
    state.timings
  );
  const hydratedRecoveredRecords = await timed(
    () => hydrateRuntimeSearchMetaRecords(searchMetaArtifact, recoveredRecords),
    'pipeline.family_recovery.hydrate_leaf_details',
    state.timings
  );
  const recoveredRows = await timed(
    () => recoveredRecords.map(toFamilyLeafRecoveryFields),
    'pipeline.family_recovery.map_recovered_rows',
    state.timings
  );
  const aliasesByNodeId = await timed(
    () => loadLeafAliasesFromRecords(hydratedRecoveredRecords, state.familyScopedPreparedQuery.locale),
    'pipeline.family_recovery.load_leaf_aliases',
    state.timings
  );
  const capabilityLabelsByNodeId = await timed(
    () => loadLeafCapabilityLabelsFromRecords(hydratedRecoveredRecords),
    'pipeline.family_recovery.load_capability_labels',
    state.timings
  );
  const lexicalHitsByNodeId = await timed(
    () => retrieveLexicalFamilyHits(state, familyIds, state.occupationRetriever),
    'pipeline.family_recovery.lexical_family_hits',
    state.timings
  );
  const familiesByKey = new Map(state.rankedFamilies.map((family) => [family.familyKey, family]));

  for (const row of recoveredRows) {
    const familyKey = `family:${row.family_node_id}`;
    const family = familiesByKey.get(familyKey);

    if (!family) {
      continue;
    }

    const existing = state.candidateLeafs.get(row.graph_node_id);
    const lexicalHit = lexicalHitsByNodeId.get(row.graph_node_id) ?? null;

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
      leafStructure: stateLeafStructure(state, row.graph_node_id),
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
    rankedFamilies: state.rankedFamilies.map((family) => ({
      ...family,
      supportingLeafCount: recoveredLeafCountsByFamilyKey.get(family.familyKey) ?? 0
    })),
    stages: appendStage(state, 'recover_leaves_inside_top_families')
  };
}

async function retrieveLexicalFamilyHits(
  state: PipelineState,
  familyNodeIds: number[],
  retriever: OccupationTextRetrievalEngine
): Promise<Map<number, OccupationTextHit>> {
  const branchExpansion = requireBranchExpansion(state);
  const hitsByNodeId = new Map<number, OccupationTextHit>();
  const surfaceLocales = retrievalSurfaceLocales(branchExpansion.locale);
  // Family-constrained leaf recovery searches role intent only; domain/context terms are support evidence elsewhere.
  const roleQuery = intentRoleQuery(state.preparedQuery);

  for (const surfaceLocale of surfaceLocales) {
    // Same (roleQuery, surfaceLocale, sourceName) is reused for every family below, so prepare once per surface.
    const preparedQuery = await prepareQuery(roleQuery, surfaceLocale, { sourceName: branchExpansion.sourceName });

    const familyHits = await Promise.all(
      familyNodeIds.map((familyNodeId) =>
        retriever.retrieveWithinFamily({
          query: roleQuery,
          locale: surfaceLocale,
          preparedQuery,
          sourceName: branchExpansion.sourceName,
          familyNodeId,
          limit: Math.max(state.topLeavesPerFamily * 4, 25)
        })
      )
    );

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

function lexicalFamilyEvidence(hit: OccupationTextHit): PipelineEvidenceRecord {
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

async function narrowLeavesWithinFamiliesStage(state: PipelineState): Promise<PipelineState> {
  const branchExpansion = requireBranchExpansion(state);
  const candidateLeavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
  const leafPoolTraceEntries: CandidatePoolTraceEntry[] = [];
  const narrowedFamilies = state.rankedFamilies.map((family) => {
    const scoredLeaves = (candidateLeavesByFamilyKey.get(family.familyKey) ?? []).map((leaf) => scoreLeafCandidate(leaf, family, state));
    const orderedLeaves = rankEligibleLeavesFirst(scoredLeaves, state.preparedQuery, branchExpansion.originalQuery);
    const leaves = orderedLeaves.slice(0, state.topLeavesPerFamily).map((leaf, index) => ({ ...leaf, rank: index + 1 }));

    if (state.debugEnabled) {
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
    }

    return {
      ...family,
      leaves
    };
  });
  const authorityRankedFamilies = rankFamiliesForSelectionAuthority(narrowedFamilies, state.preparedQuery);
  const rankedFamilies = promoteExactLeafRescueFamily(
    authorityRankedFamilies,
    flattenRankedLeaves(authorityRankedFamilies),
    state.preparedQuery,
    branchExpansion.originalQuery
  );
  const rankedLeaves = flattenRankedLeaves(rankedFamilies);

  return {
    ...state,
    rankedFamilies,
    rankedLeaves,
    candidatePoolTrace: state.debugEnabled ? [...state.candidatePoolTrace, ...leafPoolTraceEntries] : state.candidatePoolTrace,
    stages: appendStage(state, 'narrow_leaves_within_families')
  };
}

function flattenRankedLeaves(families: RankedPipelineFamily[]): RankedPipelineLeaf[] {
  return families.flatMap((family) => family.leaves.map((leaf) => ({ ...leaf })));
}

function groupCandidateLeavesByFamilyKey(candidateLeafs: Map<number, PipelineLeafCandidate>): Map<string, PipelineLeafCandidate[]> {
  const grouped = new Map<string, PipelineLeafCandidate[]>();

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

function countCandidateLeavesByFamilyKey(candidateLeafs: Map<number, PipelineLeafCandidate>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const leaf of candidateLeafs.values()) {
    counts.set(leaf.familyKey, (counts.get(leaf.familyKey) ?? 0) + 1);
  }

  return counts;
}

function toFamilyLeafRecoveryFields(record: RuntimeSearchMetaCoreRecord): FamilyLeafRecoveryFields {
  return {
    graph_node_id: record.graphNodeId,
    canonical_label: record.canonicalLabel,
    generic_risk: record.genericRisk,
    has_hierarchy: record.hasHierarchy ? 1 : 0,
    has_capability_support: record.hasCapabilitySupport ? 1 : 0,
    family_node_id: record.familyNodeId as number,
    family_label: record.familyLabel ?? '',
    group_node_id: record.groupNodeId,
    group_label: record.groupLabel
  };
}

function loadLeafAliasesFromRecords(records: RuntimeSearchMetaRecord[], locale: string): Map<number, string[]> {
  const aliasesByNodeId = new Map<number, string[]>();

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

function loadLeafCapabilityLabelsFromRecords(records: RuntimeSearchMetaRecord[]): Map<number, string[]> {
  const labelsByNodeId = new Map<number, string[]>();

  for (const record of records) {
    const labels = labelsByNodeId.get(record.graphNodeId) ?? [];

    for (const capability of record.capabilityLabels) {
      labels.push(capability.label, capability.normalizedLabel);
    }

    labelsByNodeId.set(record.graphNodeId, Array.from(new Set(labels)));
  }

  return labelsByNodeId;
}

function mergeStringMap(left: Map<number, string[]>, right: Map<number, string[]>): Map<number, string[]> {
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
async function selectPipelineDecisionStage(state: PipelineState): Promise<PipelineState> {
  const branchExpansion = requireBranchExpansion(state);
  const topFamily = state.rankedFamilies[0] ?? null;
  const topLeaf = topFamily?.leaves[0] ?? null;

  const exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback =
    selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(
      state.rankedFamilies,
      state.rankedLeaves,
      state.preparedQuery,
      branchExpansion.originalQuery
    );

  if (exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback) {
    const rescuedFamily =
      state.rankedFamilies.find(
        (family) => family.familyKey === exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.familyKey
      ) ?? topFamily;

    return {
      ...state,
      decision: {
        decisionType: 'leaf',
        selectedNodeId: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.graphNodeId,
        selectedLabel: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.canonicalLabel,
        confidence: exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback.confidence,
        reason: 'a leaf cleared the exact leaf canonical-or-alias rescue gate',
        explanation: buildDecisionExplanation(
          state,
          rescuedFamily,
          exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback,
          'a leaf cleared the exact leaf canonical-or-alias rescue gate'
        )
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
        explanation: buildDecisionExplanation(
          state,
          exactFamilyCanonicalRescue,
          exactFamilyCanonicalRescue.leaves[0] ?? null,
          'a family cleared the narrow exact family canonical rescue gate'
        )
      },
      stages: appendStage(state, 'select_decision')
    };
  }

  const topSelectableLeaf = topFamily ? firstSelectableLeafInFamily(topFamily, state.preparedQuery, state.rankedFamilies) : null;

  if (topSelectableLeaf && topFamily) {
    return {
      ...state,
      decision: {
        decisionType: 'leaf',
        selectedNodeId: topSelectableLeaf.graphNodeId,
        selectedLabel: topSelectableLeaf.canonicalLabel,
        confidence: topSelectableLeaf.confidence,
        reason: 'top leaf inside top family cleared direct evidence and confidence gates',
        explanation: buildDecisionExplanation(
          state,
          topFamily,
          topSelectableLeaf,
          'top leaf inside top family cleared direct evidence and confidence gates'
        )
      },
      stages: appendStage(state, 'select_decision')
    };
  }

  if (
    topFamily &&
    topFamily.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE &&
    hasFamilyRoleGrounding(topFamily, state.preparedQuery)
  ) {
    return {
      ...state,
      decision: {
        decisionType: topFamily.familyKind === 'group' ? 'group' : 'family',
        selectedNodeId: topFamily.familyNodeId,
        selectedLabel: topFamily.familyLabel,
        confidence: topFamily.confidence,
        reason: 'top family cleared family-first confidence gate; leaf evidence stayed below safe promotion threshold',
        explanation: buildDecisionExplanation(
          state,
          topFamily,
          topLeaf,
          'top family cleared family-first confidence gate; leaf evidence stayed below safe promotion threshold'
        )
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
        explanation: buildDecisionExplanation(
          state,
          topFamily,
          topLeaf,
          'top family had prepared multi-token phrase-window evidence; leaf evidence stayed below safe promotion threshold'
        )
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
function buildDecisionExplanation(
  state: PipelineState,
  selectedFamily: RankedPipelineFamily | null,
  selectedLeaf: RankedPipelineLeaf | null,
  finalDecisionGate: string
): PipelineDecisionExplanation {
  const preparedQuery = state.preparedQuery;
  const rejectedCompetitors: PipelineDecisionExplanation['rejectedCompetitors'] = [];

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
function selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(
  rankedFamilies: RankedPipelineFamily[],
  rankedLeaves: RankedPipelineLeaf[],
  preparedQuery: PreparedQuery,
  exactQueryText: string
): RankedPipelineLeaf | null {
  const topFamily = rankedFamilies[0] ?? null;

  const exactLeafCanonicalOrAliasFullStringCandidate = rankedLeaves.find((leaf) => {
    if (!hasLeafRoleGrounding(leaf, preparedQuery)) {
      return false;
    }

    if (hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText)) {
      return true;
    }

    if (!passesCategoryQueryGuards(leaf, preparedQuery)) {
      return false;
    }

    return hasRawQueryCanonicalSingularPluralForm(leaf, preparedQuery) || hasRawQueryExactLeafAlias(leaf, preparedQuery);
  });

  const exactLeafAuthorityCandidate =
    exactLeafCanonicalOrAliasFullStringCandidate ??
    rankedLeaves.find((leaf) => {
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
    }) ??
    null;

  if (!exactLeafAuthorityCandidate) {
    return null;
  }

  if (!topFamily || exactLeafAuthorityCandidate.familyKey !== topFamily.familyKey) {
    return exactLeafAuthorityCandidate;
  }

  return topFamily.leaves.some((leaf) => leaf.graphNodeId === exactLeafAuthorityCandidate.graphNodeId) ? exactLeafAuthorityCandidate : null;
}

function selectExactFamilyCanonicalRescue(rankedFamilies: RankedPipelineFamily[], exactQueryText: string): RankedPipelineFamily | null {
  const foldedExactQuery = foldSearchText(exactQueryText);
  const weakPunctuationExactQuery = foldWeakPunctuationLookupText(exactQueryText);

  const exactStringFamily =
    rankedFamilies.find(
      (family) =>
        family.evidence.some((record) => record.channel === 'exact_family_canonical') &&
        (foldSearchText(family.familyLabel) === foldedExactQuery ||
          foldWeakPunctuationLookupText(family.familyLabel) === weakPunctuationExactQuery)
    ) ?? null;

  if (exactStringFamily) {
    return exactStringFamily;
  }

  return rankedFamilies.find((family) => family.evidence.some((record) => record.channel === 'exact_family_canonical')) ?? null;
}

function isLeafFullySelectable(
  leaf: RankedPipelineLeaf,
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[]
): boolean {
  return (
    isLeafSelectable(leaf, family, preparedQuery, rankedFamilies) &&
    !hasAmbiguousAliasLeafTie(leaf, family) &&
    !hasUnsafeSpecializedLeafTie(leaf, family, preparedQuery) &&
    !hasInsufficientLeafSeparation(leaf, family, preparedQuery)
  );
}

function firstSelectableLeafInFamily(
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[]
): RankedPipelineLeaf | null {
  return family.leaves.find((leaf) => isLeafFullySelectable(leaf, family, preparedQuery, rankedFamilies)) ?? null;
}

function getOrCreateFamily(
  state: PipelineState,
  branch: OccupationCandidateBranch,
  branchShare: number,
  branchMarginRatio: number | null
): PipelineFamilyCandidate {
  const existing = state.candidateFamilies.get(branch.branchKey);

  if (existing) {
    return existing;
  }

  const family: PipelineFamilyCandidate = {
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

function getOrCreateProfileFamily(state: PipelineState, hit: FamilyProfileHit): PipelineFamilyCandidate {
  return getOrCreateRuntimeFamily(state, {
    familyNodeId: hit.familyNodeId,
    familyLabel: hit.familyLabel,
    groupNodeId: hit.groupNodeId,
    groupLabel: hit.groupLabel
  });
}

function getOrCreateRuntimeFamily(
  state: PipelineState,
  input: {
    familyNodeId: number;
    familyLabel: string;
    groupNodeId: number | null;
    groupLabel: string | null;
  }
): PipelineFamilyCandidate {
  const familyKey = `family:${input.familyNodeId}`;
  const existing = state.candidateFamilies.get(familyKey);

  if (existing) {
    return existing;
  }

  const family: PipelineFamilyCandidate = {
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

function getOrCreateLeaf(
  state: PipelineState,
  branch: OccupationCandidateBranch,
  candidate: ExpandedOccupationCandidate
): PipelineLeafCandidate {
  const existing = state.candidateLeafs.get(candidate.graphNodeId);

  if (existing) {
    return existing;
  }

  const leaf: PipelineLeafCandidate = {
    graphNodeId: candidate.graphNodeId,
    canonicalLabel: candidate.canonicalLabel,
    familyKey: branch.branchKey,
    familyKind: branch.branchKind,
    familyNodeId: branch.branchNodeId,
    familyLabel: branch.branchLabel,
    genericRisk: candidate.genericRisk,
    hasHierarchy: candidate.hasHierarchy,
    hasCapabilitySupport: candidate.hasCapabilitySupport,
    leafStructure: stateLeafStructure(state, candidate.graphNodeId),
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

function stateLeafStructure(state: PipelineState, graphNodeId: number): OccupationLeafStructureRecord | null {
  return state.leafStructureArtifact?.getRecord(graphNodeId) ?? null;
}

function toPipelineEvidenceRecord(
  channel: RetrievalChannel,
  score: number,
  details: Record<string, unknown>,
  evidence?: { alias?: string; normalizedAlias?: string; foldedAlias?: string; aliasRole?: string; aliasWeight?: number | null }
): PipelineEvidenceRecord {
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

function buildCrossLocaleEnglishBackboneEvidence(
  evidence: PipelineEvidenceRecord,
  graphNodeId: number,
  canonicalLabel: string,
  record: RuntimeSearchMetaRecord | null
): PipelineEvidenceRecord | null {
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

function familyProfileEvidence(hit: FamilyProfileHit): PipelineEvidenceRecord {
  return {
    channel: hit.exactFamilyLabelPhrase ? 'exact_family_canonical' : 'family_profile',
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

function jobFunctionFamilyPriorEvidence(prior: JobFunctionFamilyPrior, jobFunction: string | null): PipelineEvidenceRecord {
  return {
    channel: 'job_function_family_prior',
    score: prior.strength === 'primary' ? 0.88 : 0.62,
    sourceStage: 'job_function_context',
    details: {
      job_function: jobFunction,
      prior_strength: prior.strength,
      family_node_id: prior.familyNodeId,
      family_label: prior.familyLabel
    }
  };
}

function genericHeadFamilyPriorEvidence(prior: GenericHeadFamilyPrior, preparedQuery: PreparedQuery): PipelineEvidenceRecord {
  const roleHead = preparedQuery.intent.roleHeadTokens[preparedQuery.intent.roleHeadTokens.length - 1] ?? null;

  return {
    channel: 'generic_head_family_prior',
    score: prior.strength === 'primary' ? 0.82 : 0.58,
    sourceStage: 'generic_head_context',
    details: {
      role_head: roleHead,
      // Declared so the shared role-coverage machinery (maxIntentRoleHeadEvidenceCoverage,
      // maxIntentRoleEvidenceCoverage) can see this evidence's real role-token identity instead of
      // needing a venue-only special case in hasFamilyRoleGrounding (resolution.md #15).
      matched_role_terms: roleHead ? [roleHead] : [],
      matched_tokens: roleHead ? [roleHead] : [],
      prior_strength: prior.strength,
      family_node_id: prior.familyNodeId,
      family_label: prior.familyLabel
    }
  };
}

function reviewedFamilySignalEvidence(match: ReviewedFamilySignalMatch): PipelineEvidenceRecord {
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

function englishBackboneTerms(record: RuntimeSearchMetaRecord): string[] {
  const terms = new Set<string>();
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

function scoreFamilyCandidate(
  family: PipelineFamilyCandidate,
  leafsById: Map<number, PipelineLeafCandidate>,
  preparedQuery: PreparedQuery,
  rolePreparedQuery: PreparedQuery
): PipelineFamilyCandidate {
  const evidenceTier = familyEvidenceTier(family.evidence);
  const supportingLeafs = Array.from(family.supportingLeafIds)
    .map((leafId) => leafsById.get(leafId))
    .filter((leaf): leaf is PipelineLeafCandidate => leaf !== undefined);
  const leafFitScore = maxLeafFitScore(supportingLeafs, rolePreparedQuery);
  const roleCoverage = maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery);
  const domainCoverage = maxIntentDomainEvidenceCoverage(family.evidence, preparedQuery);
  const exactCanonicalScore = maxEvidenceScore(family.evidence, ['exact_canonical']);
  const exactAliasScore = maxEvidenceScore(family.evidence, ['exact_alias']);
  const exactFamilyCanonicalScore = maxEvidenceScore(family.evidence, ['exact_family_canonical']);
  const reviewedSignalScore = maxEvidenceScore(family.evidence, ['reviewed_family_signal']);
  const reviewedPenaltyScore = maxEvidenceScore(family.evidence, ['reviewed_family_penalty']);
  const lexicalEvidenceScore = maxEvidenceScore(family.evidence, [
    'reviewed_family_signal',
    'folded_alias',
    'ngram_alias',
    'lexical',
    'capability_task',
    'family_profile'
  ]);
  const jobFunctionPriorScore = maxEvidenceScore(family.evidence, ['job_function_family_prior']);
  const genericHeadPriorScore = maxEvidenceScore(family.evidence, ['generic_head_family_prior']);
  const hasVenueContext = hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens);
  const branchStrength = Math.max(
    family.branchShare,
    ratioToScore(family.branchMarginRatio, BRANCH_MARGIN_POLICY.WEAK_RATIO, BRANCH_MARGIN_POLICY.STRONG_RATIO)
  );
  const supportBreadth =
    Math.min(supportingLeafs.length, FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES) / FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES;
  const capabilitySupport =
    supportingLeafs.length === 0 ? 0 : supportingLeafs.filter((leaf) => leaf.hasCapabilitySupport).length / supportingLeafs.length;
  const genericPenalty = averageGenericPenalty(supportingLeafs);
  const familyGroupAgreement = familyGroupAgreementScore(family.familyNodeId, preparedQuery);
  const familyGroupMismatch = familyGroupMismatchPenalty(family.familyNodeId, preparedQuery);
  const exactOccupationScore = Math.max(exactCanonicalScore, exactAliasScore);
  const exactOccupationContribution =
    exactOccupationScore *
    (FAMILY_SCORING_POLICY.EXACT_ALIAS_BASE_CONTRIBUTION + leafFitScore * FAMILY_SCORING_POLICY.EXACT_ALIAS_LEAF_FIT_WEIGHT);
  const authorityFloor = primaryUsefulExactAliasFloor(family.evidence, preparedQuery);
  const confidence = clampScore(
    Math.max(
      authorityFloor,
      branchStrength * FAMILY_SCORING_POLICY.HYBRID_BRANCH_STRENGTH_WEIGHT +
        supportBreadth * FAMILY_SCORING_POLICY.HYBRID_SUPPORT_BREADTH_WEIGHT +
        exactOccupationContribution +
        exactFamilyCanonicalScore * FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_WEIGHT +
        reviewedSignalScore * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_WEIGHT +
        lexicalEvidenceScore * FAMILY_SCORING_POLICY.LEXICAL_EVIDENCE_WEIGHT +
        jobFunctionPriorScore * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        (hasVenueContext ? genericHeadPriorScore * FAMILY_SCORING_POLICY.GENERIC_HEAD_PRIOR_WEIGHT : 0) +
        roleCoverage * FAMILY_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
        domainCoverage * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        familyGroupAgreement * FAMILY_SCORING_POLICY.GROUP_ALIGNMENT_WEIGHT +
        capabilitySupport * FAMILY_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT +
        leafFitScore * FAMILY_SCORING_POLICY.LEAF_FIT_WEIGHT -
        familyGroupMismatch * FAMILY_SCORING_POLICY.GROUP_MISMATCH_PENALTY_WEIGHT -
        reviewedPenaltyScore * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_PENALTY_WEIGHT -
        genericPenalty * FAMILY_SCORING_POLICY.GENERIC_PENALTY_WEIGHT
    )
  );

  return {
    ...family,
    evidenceTier,
    evidenceTierRank: familyEvidenceTierRank(evidenceTier),
    score: confidence,
    confidence
  };
}

function maxLeafFitScore(leafs: PipelineLeafCandidate[], preparedQuery: PreparedQuery): number {
  if (leafs.length === 0) {
    return 0;
  }

  return Math.max(
    ...leafs.map(
      (leaf) =>
        LEAF_CLOSENESS_RANKER.rank({
          preparedQuery,
          canonicalLabel: leaf.canonicalLabel,
          aliases: matchedAliasLabels(leaf.evidence)
        }).score
    )
  );
}

function primaryUsefulExactAliasFloor(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  if (hasEvidenceChannel(evidence, 'exact_family_canonical')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

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

function scoreLeafCandidate(leaf: PipelineLeafCandidate, family: RankedPipelineFamily, state: PipelineState): PipelineLeafCandidate {
  const directEvidenceScore = maxEvidenceScore(leaf.evidence, [
    'exact_canonical',
    'exact_alias',
    'folded_alias',
    'ngram_alias',
    'lexical',
    'capability_task'
  ]);
  const familySupport = family.confidence;
  const hierarchySupport = leaf.hasHierarchy ? LEAF_SCORING_POLICY.HIERARCHY_SUPPORTED : LEAF_SCORING_POLICY.HIERARCHY_UNSUPPORTED;
  const capabilitySupport = leaf.hasCapabilitySupport
    ? LEAF_SCORING_POLICY.CAPABILITY_SUPPORTED
    : LEAF_SCORING_POLICY.CAPABILITY_UNSUPPORTED;
  const aliases = Array.from(
    new Set([...matchedAliasLabels(leaf.evidence), ...(state.recoveredAliasesByNodeId.get(leaf.graphNodeId) ?? [])])
  );
  const closeness = LEAF_CLOSENESS_RANKER.rank({
    preparedQuery: state.roleFamilyScopedPreparedQuery,
    canonicalLabel: leaf.canonicalLabel,
    aliases
  });
  const familyScopedFit = FAMILY_SCOPED_LEAF_RANKER.rank({
    preparedQuery: state.roleFamilyScopedPreparedQuery,
    canonicalLabel: leaf.canonicalLabel,
    aliases,
    capabilityLabels: state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? []
  });
  const capabilityFit = CAPABILITY_FIT_RANKER.rank({
    preparedQuery: state.roleFamilyScopedPreparedQuery,
    capabilityLabels: state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? []
  });
  const roleCoverage = roleCoverageForLabels(state.preparedQuery, [leaf.canonicalLabel, ...aliases]);
  const domainSupport = domainSupportForLabels(state.preparedQuery, [
    leaf.canonicalLabel,
    ...aliases,
    ...(state.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? [])
  ]);
  const selectionEvidence = LEAF_SELECTION_EVIDENCE_RANKER.rank({
    evidence: leaf.evidence,
    closeness,
    familyScopedFit,
    capabilityFit
  });
  const confidence = clampScore(
    directEvidenceScore * LEAF_SCORING_POLICY.DIRECT_EVIDENCE_WEIGHT +
      closeness.score * LEAF_SCORING_POLICY.CLOSENESS_WEIGHT +
      roleCoverage * LEAF_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
      domainSupport * LEAF_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
      familySupport * LEAF_SCORING_POLICY.FAMILY_SUPPORT_WEIGHT +
      hierarchySupport * LEAF_SCORING_POLICY.HIERARCHY_SUPPORT_WEIGHT +
      capabilitySupport * LEAF_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT -
      closeness.titleExtraTokenRatio * LEAF_SCORING_POLICY.EXTRA_TOKEN_RATIO_PENALTY_WEIGHT
  );

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

function matchedAliasLabels(evidence: PipelineEvidenceRecord[]): string[] {
  const aliases = new Set<string>();

  for (const record of evidence) {
    if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
      continue;
    }

    const alias = typeof record.details.alias === 'string' ? record.details.alias.trim() : '';
    const normalizedAlias = typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias.trim() : '';
    const matchedTokens = Array.isArray(record.details.matched_tokens)
      ? record.details.matched_tokens.filter((token): token is string => typeof token === 'string' && token.trim().length > 0)
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

function isLeafSelectable(
  leaf: RankedPipelineLeaf,
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[]
): boolean {
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
    'folded_alias',
    'ngram_alias',
    'lexical',
    'capability_task'
  ]);
  if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
    return true;
  }

  const closeness = leaf.closeness;
  const clearsStandardGate =
    leaf.confidence >= PIPELINE_DECISION_GATE.LEAF_STANDARD_CONFIDENCE &&
    directEvidenceScore >= PIPELINE_DECISION_GATE.LEAF_STANDARD_DIRECT_EVIDENCE &&
    family.confidence >= PIPELINE_DECISION_GATE.LEAF_STANDARD_FAMILY_CONFIDENCE;
  const clearsExactUsefulTokenGate = Boolean(
    closeness &&
      leaf.confidence >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_CONFIDENCE &&
      directEvidenceScore >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_DIRECT_EVIDENCE &&
      family.confidence >= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_FAMILY_CONFIDENCE &&
      closeness.usefulQueryCoverage >= 1 &&
      closeness.titleExtraTokenRatio <= PIPELINE_DECISION_GATE.LEAF_EXACT_USEFUL_MAX_EXTRA_TOKEN_RATIO
  );
  const clearsControlledAcronymExpansionGate = Boolean(
    closeness &&
      preparedQuery.acronymTokens.length > 0 &&
      family.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE &&
      leaf.confidence >= family.confidence &&
      directEvidenceScore > 0 &&
      closeness.usefulQueryCoverage >= 1 &&
      closeness.missingUsefulTokens.length === 0
  );

  return clearsStandardGate || clearsExactUsefulTokenGate || clearsControlledAcronymExpansionGate;
}

// Shared by isLeafSelectable and
// selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback so they
// can't drift.
function passesCategoryQueryGuards(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
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
const COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE: Partial<Record<SupportedQueryLocale, ReadonlySet<string>>> = {
  en: new Set(['personnel', 'staff', 'workers', 'professionals', 'employees', 'team'])
};

function isCollectiveOccupationalQuery(preparedQuery: PreparedQuery): boolean {
  const collectiveNouns = COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE[preparedQuery.locale];

  if (!collectiveNouns || preparedQuery.foldedTokens.length < 2) {
    return false;
  }

  const lastToken = preparedQuery.foldedTokens[preparedQuery.foldedTokens.length - 1];
  return collectiveNouns.has(lastToken);
}

function isBroadRoleQuery(preparedQuery: PreparedQuery): boolean {
  if (!preparedQuery.isGenericShape) {
    return false;
  }

  if (preparedQuery.usefulFoldedTokens.length === 1) {
    return true;
  }

  // A bare single-generic-head query (e.g. "technician", "assistant") has its only token classified
  // as generic, so it never becomes a "useful" folded token above -- without this branch the broad-role
  // guard would never activate for exactly the case it exists to protect (resolution.md #16), letting
  // the pipeline manufacture a specific leaf out of a single generic word.
  return preparedQuery.usefulFoldedTokens.length === 0 && preparedQuery.genericTokens.length === 1;
}

function hasBroadRoleLeafAuthority(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
  const queryTokenCount = preparedQuery.usefulFoldedTokens.length;

  if (queryTokenCount === 0) {
    return false;
  }

  if (canonicalTokenCount(leaf.canonicalLabel) <= queryTokenCount) {
    return true;
  }

  const closeness = leaf.closeness;

  return Boolean(
    closeness &&
      closeness.matchedLabelSource === 'alias' &&
      (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) &&
      tokenizeNormalizedText(foldSearchText(closeness.matchedLabel)).length <= queryTokenCount
  );
}

function isLeafSelectionEvidencePromotable(
  leaf: RankedPipelineLeaf,
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[]
): boolean {
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

  if (
    tier === 'exact_alias' &&
    hasEvidenceChannel(family.evidence, 'cross_locale_english_backbone') &&
    hasCompetingAliasEvidenceFamily(family, rankedFamilies) &&
    !hasRawQueryExactAlias(leaf, preparedQuery)
  ) {
    return false;
  }

  switch (tier) {
    case 'exact_alias':
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

function hasCompetingAliasEvidenceFamily(family: RankedPipelineFamily, rankedFamilies: RankedPipelineFamily[]): boolean {
  return rankedFamilies.some(
    (candidate) =>
      candidate.familyKey !== family.familyKey &&
      (hasEvidenceChannel(candidate.evidence, 'exact_alias') || hasEvidenceChannel(candidate.evidence, 'folded_alias'))
  );
}

function hasRawQueryExactAlias(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return leaf.evidence.some((record) => {
    if (record.channel !== 'exact_alias') {
      return false;
    }

    const normalizedAlias = normalizedAliasDetail(record);
    const foldedAlias = foldedAliasDetail(record);

    return normalizedAlias === preparedQuery.normalized || foldedAlias === preparedQuery.folded;
  });
}

function hasPreparedPhraseWindowAnchor(leaf: RankedPipelineLeaf): boolean {
  return leaf.evidence.some((record) => {
    if (record.channel !== 'lexical') {
      return false;
    }

    const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];

    return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
  });
}

function isPreparedPhraseWindowQuery(value: string): boolean {
  const match = value.match(/^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(\d+)_idx_\d+$/u);

  if (!match) {
    return false;
  }

  return Number.parseInt(match[1] ?? '0', 10) >= 2;
}

function hasAmbiguousAliasLeafTie(topLeaf: RankedPipelineLeaf, family: RankedPipelineFamily): boolean {
  const topExactAliasScore = maxEvidenceScore(topLeaf.evidence, ['exact_alias']);
  const topMatchedAlias = topLeaf.closeness?.matchedLabelSource === 'alias' ? topLeaf.closeness.matchedLabel : '';
  const topMatchedAliasFolded = topMatchedAlias ? foldSearchText(topMatchedAlias) : '';

  if (topExactAliasScore <= 0 || !topMatchedAlias) {
    return false;
  }

  return family.leaves.slice(1).some((leaf) => {
    const leafExactAliasScore = maxEvidenceScore(leaf.evidence, ['exact_alias']);
    const sameAlias =
      leaf.closeness?.matchedLabelSource === 'alias' && foldSearchText(leaf.closeness.matchedLabel) === topMatchedAliasFolded;
    const selectedIsClearlyMoreGeneral = canonicalTokenCount(topLeaf.canonicalLabel) < canonicalTokenCount(leaf.canonicalLabel);

    return (
      leafExactAliasScore > 0 &&
      sameAlias &&
      topLeaf.confidence - leaf.confidence <= PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
      !selectedIsClearlyMoreGeneral
    );
  });
}

// General counterpart to hasAmbiguousAliasLeafTie/hasUnsafeSpecializedLeafTie: those two only catch
// specific tie *shapes* (same alias, or specialized-vs-generic). A broad/collective query like
// "Security Personnel" can have several role-grounded leaves within LEAF_SEPARATION_MARGIN of each
// other (e.g. "security consultant" .753 vs "security guard" .714) without matching either shape, so
// it slips through and gets promoted to a specific leaf the query never actually distinguished.
// "Credible alternative" is deliberately narrow (role-compatible, specialization-supported, role-
// grounded) so noisy/unrelated retrieval hits with a low score can't force an artificial abstention.
function hasInsufficientLeafSeparation(topLeaf: RankedPipelineLeaf, family: RankedPipelineFamily, preparedQuery: PreparedQuery): boolean {
  if (
    hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
    hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
    (hasRawQueryExactAlias(topLeaf, preparedQuery) && leafCanonicalCoversRoleHead(topLeaf, preparedQuery)) ||
    hasControlledAcronymLeafAuthority(topLeaf, preparedQuery)
  ) {
    return false;
  }

  const bestCredibleAlternativeConfidence = family.leaves.slice(1).reduce((max, leaf) => {
    const isCredible =
      isLeafPromotableByRoleCompatibility(leaf, preparedQuery) &&
      leafSpecializationSupport(leaf, preparedQuery) !== 'unsupported' &&
      hasLeafRoleGrounding(leaf, preparedQuery);
    return isCredible ? Math.max(max, leaf.confidence) : max;
  }, Number.NEGATIVE_INFINITY);

  if (bestCredibleAlternativeConfidence === Number.NEGATIVE_INFINITY) {
    return false;
  }

  return topLeaf.confidence - bestCredibleAlternativeConfidence < PIPELINE_DECISION_GATE.LEAF_SEPARATION_MARGIN;
}

function hasUnsafeSpecializedLeafTie(topLeaf: RankedPipelineLeaf, family: RankedPipelineFamily, preparedQuery: PreparedQuery): boolean {
  if (
    hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
    hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
    (hasRawQueryExactAlias(topLeaf, preparedQuery) && leafCanonicalCoversRoleHead(topLeaf, preparedQuery)) ||
    hasControlledAcronymLeafAuthority(topLeaf, preparedQuery)
  ) {
    return false;
  }

  if (!leafCanonicalAddsUnrequestedSpecificity(topLeaf, preparedQuery)) {
    return false;
  }

  return family.leaves
    .slice(1)
    .some(
      (leaf) =>
        leaf.confidence >= topLeaf.confidence - PIPELINE_DECISION_GATE.AMBIGUOUS_ALIAS_TIE_MARGIN &&
        leafStructuralPreferenceScore(leaf, preparedQuery) >= leafStructuralPreferenceScore(topLeaf, preparedQuery)
    );
}

function hasRawQueryExactCanonical(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return (
    leaf.evidence.some((record) => record.channel === 'exact_canonical') ||
    foldedCanonicalLabel(leaf.canonicalLabel) === preparedQuery.folded
  );
}

function hasRawQueryFullStringExactCanonical(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  exactQueryText: string = preparedQuery.raw
): boolean {
  return (
    foldedCanonicalLabel(leaf.canonicalLabel) === foldSearchText(exactQueryText) ||
    foldWeakPunctuationLookupText(leaf.canonicalLabel) === foldWeakPunctuationLookupText(exactQueryText)
  );
}

function isRawExactMatch(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return hasRawQueryExactCanonical(leaf, preparedQuery) || hasRawQueryPrimaryExactAlias(leaf, preparedQuery);
}

function hasRawQueryCanonicalSingularPluralForm(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
  if (preparedQuery.usefulFoldedTokens.length !== 1 || canonicalTokenCount(leaf.canonicalLabel) !== 1) {
    return false;
  }

  const queryToken = preparedQuery.usefulFoldedTokens[0] ?? '';
  const canonicalToken = foldedCanonicalLabel(leaf.canonicalLabel);

  if (!queryToken || !canonicalToken) {
    return false;
  }

  return tokenMatchesLocaleVariant(queryToken, new Set([canonicalToken]), normalizeQueryLocale(preparedQuery.locale));
}

function hasRawQueryExactLeafAlias(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  // Full-string leaf-alias authority only: exact/folded alias evidence must equal the entire
  // prepared query surface after normalization/folding. `family_supporting` is intentionally
  // excluded because it is broad family-side support, not leaf authority.
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
      return normalizedAlias === preparedQuery.normalized;
    }

    const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';
    return foldedAlias === preparedQuery.folded;
  });
}

function hasRawQueryPrimaryExactAlias(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return leaf.evidence.some((record) => {
    if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
      return false;
    }

    const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';

    return (
      aliasRole === 'locale_primary' &&
      (normalizedAliasDetail(record) === preparedQuery.normalized || foldedAliasDetail(record) === preparedQuery.folded)
    );
  });
}

function normalizedAliasDetail(record: PipelineEvidenceRecord): string {
  return typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias : '';
}

function foldedAliasDetail(record: PipelineEvidenceRecord): string {
  const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';

  if (foldedAlias) {
    return foldedAlias;
  }

  const normalizedAlias = normalizedAliasDetail(record);
  return normalizedAlias ? foldSearchText(normalizedAlias) : '';
}

function hasControlledAcronymLeafAuthority(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);

  if (preparedQuery.acronymTokens.length === 0 || roleHeadTokens.length === 0) {
    return false;
  }

  const labels = [
    leaf.canonicalLabel,
    ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
    ...matchedAliasLabels(leaf.evidence)
  ];

  return (
    matchedIntentTokens(roleHeadTokens, labels).missing.length === 0 &&
    (leaf.selectionEvidence?.tier === 'strong_phrase' ||
      leaf.selectionEvidence?.tier === 'exact_alias' ||
      leaf.selectionEvidence?.tier === 'folded_alias' ||
      leaf.evidence.some((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery)))
  );
}

function leafCanonicalCoversRoleHead(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const canonicalTokens = new Set(canonicalLabelTokens(leaf.canonicalLabel));
  const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);

  return roleHeadTokens.some((token) => roleHeadTokenMatchesCanonical(token, canonicalTokens, preparedQuery));
}

function roleHeadTokenMatchesCanonical(token: string, canonicalTokens: Set<string>, preparedQuery: PreparedQuery): boolean {
  if (tokenMatchesLabelTokens(token, canonicalTokens)) {
    return true;
  }

  return occupationRoleHeadSharesEquivalentClass(token, preparedQuery.locale, canonicalTokens);
}

function leafCanonicalAddsUnrequestedSpecificity(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
  const canonicalTokens = canonicalLabelTokens(leaf.canonicalLabel);
  const allowedTokens = new Set(
    [
      ...preparedQuery.usefulFoldedTokens,
      ...preparedQuery.intent.roleTokens,
      ...authoritativeIntentRoleHeadTokens(preparedQuery),
      ...preparedQuery.intent.domainTokens
    ].map((token) => foldSearchText(token))
  );

  return canonicalTokens.some((token) => !tokenMatchesLabelTokens(token, allowedTokens));
}

function maxEvidenceScore(evidence: PipelineEvidenceRecord[], channels: PipelineEvidenceChannel[]): number {
  const channelSet = new Set(channels);
  const matchingEvidence = evidence.filter((record) => channelSet.has(record.channel));
  return maxOf(matchingEvidence, (record) => normalizeEvidenceScore(record));
}

function normalizeEvidenceScore(record: PipelineEvidenceRecord): number {
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

function numericDetail(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function averageGenericPenalty(leafs: PipelineLeafCandidate[]): number {
  if (leafs.length === 0) {
    return 0;
  }

  return leafs.reduce((sum, leaf) => sum + genericRiskPenalty(leaf.genericRisk), 0) / leafs.length;
}

function genericRiskPenalty(risk: PipelineLeafCandidate['genericRisk']): number {
  if (risk === 'high') {
    return GENERIC_RISK_PENALTY.HIGH;
  }

  if (risk === 'medium') {
    return GENERIC_RISK_PENALTY.MEDIUM;
  }

  return GENERIC_RISK_PENALTY.LOW;
}

function compareFamilies(left: PipelineFamilyCandidate, right: PipelineFamilyCandidate): number {
  return (
    left.evidenceTierRank - right.evidenceTierRank ||
    right.confidence - left.confidence ||
    right.branchShare - left.branchShare ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

function rankFamiliesForSelectionAuthority(families: RankedPipelineFamily[], preparedQuery: PreparedQuery): RankedPipelineFamily[] {
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

// Reorders families to put the exact-leaf rescue's family first (resolution.md #8). Safe because
// the rescue itself only fires on raw exact canonical/plural/alias full-string leaf evidence, the
// same authority level normal ranking would already prefer if it weren't scoped per-family.
function promoteExactLeafRescueFamily(
  rankedFamilies: RankedPipelineFamily[],
  rankedLeaves: RankedPipelineLeaf[],
  preparedQuery: PreparedQuery,
  exactQueryText: string
): RankedPipelineFamily[] {
  const exactLeafRescue = selectExactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallback(
    rankedFamilies,
    rankedLeaves,
    preparedQuery,
    exactQueryText
  );

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

export type RecoveredFamilySelectionAuthority = {
  roleGrounded: number;
  groupAgreement: number;
  groupMismatch: number;
  jobFunctionPrior: number;
  genericHeadPrior: number;
  reviewedSignal: number;
  exactFamilyCanonical: number;
  primaryExactAliasLeafCount: number;
  exactRoleLeafCount: number;
  partialRoleLeafCount: number;
  bestRoleTokenMatchCount: number;
  capabilityRoleCoverage: number;
  capabilityLeafCount: number;
  exactAliasCount: number;
  foldedAliasCount: number;
  exactEvidenceCount: number;
  roleHeadCoverage: number;
  roleCoverage: number;
  bestLeafRoleCoverage: number;
  bestLeafStructuralPreference: number;
  structuralAlignment: number;
  supportedSpecializationLeafCount: number;
  profileRoleCoverage: number;
  confidence: number;
  branchShare: number;
};

function compareRecoveredFamilySelectionAuthority(
  left: RankedPipelineFamily,
  right: RankedPipelineFamily,
  preparedQuery: PreparedQuery
): number {
  const leftAuthority = recoveredFamilySelectionAuthority(left, preparedQuery);
  const rightAuthority = recoveredFamilySelectionAuthority(right, preparedQuery);

  const exactBranchShareDifference = Math.abs(leftAuthority.branchShare - rightAuthority.branchShare);
  const bothHaveExactAlias = leftAuthority.exactAliasCount > 0 && rightAuthority.exactAliasCount > 0;
  const foldedAliasAuthority = bothHaveExactAlias
    ? 0
    : Number(rightAuthority.foldedAliasCount > 0) - Number(leftAuthority.foldedAliasCount > 0) ||
      rightAuthority.foldedAliasCount - leftAuthority.foldedAliasCount ||
      rightAuthority.exactEvidenceCount - leftAuthority.exactEvidenceCount;

  if (bothHaveExactAlias && exactBranchShareDifference > 0.2) {
    return rightAuthority.branchShare - leftAuthority.branchShare;
  }

  // if (!usesRecoveredRoleAgreementOrdering(preparedQuery)) {
  //   return compareLegacyRecoveredFamilySelectionAuthority(left, right, leftAuthority, rightAuthority, foldedAliasAuthority);
  // }

  return (
    rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
    // Curated/deliberate signals (group agreement, job-function prior, generic-head prior, reviewed
    // family signal, exact family canonical) must outrank the general roleCoverage/structuralAlignment
    // heuristics below them, since those heuristics can be misled by an incomplete pre-recovery leaf
    // snapshot (see roleCoverage's own comment) or by a narrow/spurious token match that a deliberate
    // curated signal already resolves correctly.
    rightAuthority.groupAgreement - leftAuthority.groupAgreement ||
    leftAuthority.groupMismatch - rightAuthority.groupMismatch ||
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    rightAuthority.genericHeadPrior - leftAuthority.genericHeadPrior ||
    rightAuthority.reviewedSignal - leftAuthority.reviewedSignal ||
    rightAuthority.exactFamilyCanonical - leftAuthority.exactFamilyCanonical ||
    // Only a MAJORITY role-token match (>0.5) is trusted this early -- a minority match (e.g. one
    // generic token out of three) is exactly the kind of narrow/spurious coverage that should lose
    // to the broader multi-signal evidence (capabilityLeafCount, partialRoleLeafCount, etc.) further
    // down, so it's deferred there via the plain roleCoverage difference instead.
    Number(rightAuthority.roleCoverage > 0.5) - Number(leftAuthority.roleCoverage > 0.5) ||
    rightAuthority.structuralAlignment - leftAuthority.structuralAlignment ||
    rightAuthority.supportedSpecializationLeafCount - leftAuthority.supportedSpecializationLeafCount ||
    rightAuthority.primaryExactAliasLeafCount - leftAuthority.primaryExactAliasLeafCount ||
    rightAuthority.exactRoleLeafCount - leftAuthority.exactRoleLeafCount ||
    rightAuthority.bestRoleTokenMatchCount - leftAuthority.bestRoleTokenMatchCount ||
    rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
    rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
    rightAuthority.capabilityRoleCoverage - leftAuthority.capabilityRoleCoverage ||
    rightAuthority.capabilityLeafCount - leftAuthority.capabilityLeafCount ||
    rightAuthority.partialRoleLeafCount - leftAuthority.partialRoleLeafCount ||
    rightAuthority.roleCoverage - leftAuthority.roleCoverage ||
    rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
    Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
    foldedAliasAuthority ||
    rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
    rightAuthority.confidence - leftAuthority.confidence ||
    rightAuthority.branchShare - leftAuthority.branchShare ||
    rightAuthority.bestLeafStructuralPreference - leftAuthority.bestLeafStructuralPreference ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

function compareLegacyRecoveredFamilySelectionAuthority(
  left: RankedPipelineFamily,
  right: RankedPipelineFamily,
  leftAuthority: RecoveredFamilySelectionAuthority,
  rightAuthority: RecoveredFamilySelectionAuthority,
  foldedAliasAuthority: number
): number {
  return (
    rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
    rightAuthority.groupAgreement - leftAuthority.groupAgreement ||
    leftAuthority.groupMismatch - rightAuthority.groupMismatch ||
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    rightAuthority.genericHeadPrior - leftAuthority.genericHeadPrior ||
    rightAuthority.reviewedSignal - leftAuthority.reviewedSignal ||
    rightAuthority.exactFamilyCanonical - leftAuthority.exactFamilyCanonical ||
    Number(rightAuthority.roleCoverage > 0.5) - Number(leftAuthority.roleCoverage > 0.5) ||
    rightAuthority.structuralAlignment - leftAuthority.structuralAlignment ||
    rightAuthority.supportedSpecializationLeafCount - leftAuthority.supportedSpecializationLeafCount ||
    Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
    foldedAliasAuthority ||
    rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
    rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
    rightAuthority.roleCoverage - leftAuthority.roleCoverage ||
    rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
    rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
    rightAuthority.confidence - leftAuthority.confidence ||
    rightAuthority.branchShare - leftAuthority.branchShare ||
    rightAuthority.bestLeafStructuralPreference - leftAuthority.bestLeafStructuralPreference ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

function usesRecoveredRoleAgreementOrdering(preparedQuery: PreparedQuery): boolean {
  return preparedQuery.locale === 'en' && preparedQuery.acronymTokens.length === 0 && exactRoleMatchThreshold(preparedQuery) >= 2;
}

function recoveredFamilySelectionAuthority(family: RankedPipelineFamily, preparedQuery: PreparedQuery): RecoveredFamilySelectionAuthority {
  const foldedAliasAuthorityCount = foldedAliasCount(family, preparedQuery);
  const roleAgreement = familyRoleAgreementAuthority(family, preparedQuery);
  const capabilityAgreement = familyCapabilityAgreementAuthority(family);

  return {
    roleGrounded: hasFamilyRoleGrounding(family, preparedQuery) ? 1 : 0,
    groupAgreement: familyGroupAgreementScore(family.familyNodeId, preparedQuery),
    groupMismatch: familyGroupMismatchPenalty(family.familyNodeId, preparedQuery),
    jobFunctionPrior: maxEvidenceScore(family.evidence, ['job_function_family_prior']),
    genericHeadPrior: maxEvidenceScore(family.evidence, ['generic_head_family_prior']),
    reviewedSignal: maxEvidenceScore(family.evidence, ['reviewed_family_signal']),
    exactFamilyCanonical: exactFamilyCanonicalCount(family),
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
    bestLeafRoleCoverage: Math.max(
      ...family.leaves.map((leaf) =>
        roleCoverageForLabels(preparedQuery, [
          leaf.canonicalLabel,
          ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
          ...matchedAliasLabels(leaf.evidence)
        ])
      ),
      0
    ),
    bestLeafStructuralPreference: maxOf(family.leaves.filter(hasGenuineLeafEvidence), (leaf) =>
      leafStructuralPreferenceScore(leaf, preparedQuery)
    ),
    structuralAlignment: maxOf(family.leaves.filter(hasGenuineLeafEvidence), (leaf) => leafStructuralAlignmentScore(leaf, preparedQuery)),
    supportedSpecializationLeafCount: Math.min(
      family.leaves.filter((leaf) => leafHasSupportedStructuralSpecialization(leaf, preparedQuery)).length,
      5
    ),
    profileRoleCoverage: maxFamilyProfileRoleCoverage(family.evidence),
    confidence: family.confidence,
    branchShare: family.branchShare
  };
}

function primaryExactAliasLeafCount(family: RankedPipelineFamily, preparedQuery: PreparedQuery): number {
  return Math.min(family.leaves.filter((leaf) => hasRawQueryPrimaryExactAlias(leaf, preparedQuery)).length, 5);
}

function applyRecoveredFamilySelectionAuthority(
  family: RankedPipelineFamily,
  rank: number,
  preparedQuery: PreparedQuery
): RankedPipelineFamily {
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

function recoveredFamilyConfidenceFloor(authority: RecoveredFamilySelectionAuthority, preparedQuery: PreparedQuery): number {
  if (authority.exactFamilyCanonical > 0) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

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

type FamilyRoleAgreementAuthority = {
  exactRoleLeafCount: number;
  partialRoleLeafCount: number;
  bestRoleTokenMatchCount: number;
};

type FamilyCapabilityAgreementAuthority = {
  capabilityRoleCoverage: number;
  capabilityLeafCount: number;
};

function familyRoleAgreementAuthority(family: RankedPipelineFamily, preparedQuery: PreparedQuery): FamilyRoleAgreementAuthority {
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

function familyCapabilityAgreementAuthority(family: RankedPipelineFamily): FamilyCapabilityAgreementAuthority {
  return {
    capabilityRoleCoverage: maxOf(family.leaves, (leaf) => leaf.capabilityFit?.coverage ?? 0),
    capabilityLeafCount: Math.min(
      family.leaves.filter((leaf) => leaf.capabilityFit?.tier === 'strong' || leaf.capabilityFit?.tier === 'partial').length,
      5
    )
  };
}

function familyGroupAgreementScore(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const preferredGroups = preparedQuery.intent.occupationClassPreference.preferredFamilyGroups;

  if (!family || preferredGroups.length === 0) {
    return 0;
  }

  return preferredGroups.includes(family.group) ? 1 : 0;
}

function familyGroupMismatchPenalty(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const disfavoredGroups = preparedQuery.intent.occupationClassPreference.disfavoredFamilyGroups;

  if (!family || disfavoredGroups.length === 0) {
    return 0;
  }

  return disfavoredGroups.includes(family.group) ? 1 : 0;
}

function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number {
  const roleTokenCount = preparedQuery.intent.roleTokens.length;

  if (roleTokenCount === 0) {
    return 0;
  }

  return roleTokenCount >= 2 ? 2 : 1;
}

function leafRoleTokenMatch(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): string[] {
  return matchedIntentTokens(preparedQuery.intent.roleTokens, [
    leaf.canonicalLabel,
    ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
    ...matchedAliasLabels(leaf.evidence)
  ]).matched;
}

function usefulQueryTokensCoveredByMatch(matchedRoleTokens: string[], preparedQuery: PreparedQuery): boolean {
  if (preparedQuery.usefulFoldedTokens.length === 0) {
    return true;
  }

  return preparedQuery.usefulFoldedTokens.every((token) => tokenListHasEquivalent(matchedRoleTokens, token));
}

function exactAliasCount(family: RankedPipelineFamily): number {
  const familyExactCount = family.evidence.filter(
    (record) => record.channel === 'exact_alias' || record.channel === 'exact_canonical'
  ).length;
  const leafExactCount = family.leaves.reduce(
    (count, leaf) =>
      count + leaf.evidence.filter((record) => record.channel === 'exact_alias' || record.channel === 'exact_canonical').length,
    0
  );

  return familyExactCount + leafExactCount;
}

function exactFamilyCanonicalCount(family: RankedPipelineFamily): number {
  return family.evidence.filter((record) => record.channel === 'exact_family_canonical').length;
}

function foldedAliasCount(family: RankedPipelineFamily, preparedQuery: PreparedQuery): number {
  const foldedRecords = [
    ...family.evidence.filter((record) => record.channel === 'folded_alias'),
    ...family.leaves.flatMap((leaf) => leaf.evidence.filter((record) => record.channel === 'folded_alias'))
  ];

  if (!requiresSpecificAcronymAliasAuthority(preparedQuery)) {
    return foldedRecords.length;
  }

  const minimumRoleMatches = minimumSpecificAliasRoleMatches(preparedQuery);
  return foldedRecords.filter(
    (record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery) || aliasRoleMatchCount(record, preparedQuery) >= minimumRoleMatches
  ).length;
}

function exactEvidenceCount(family: RankedPipelineFamily, foldedAliasAuthorityCount: number): number {
  const familyExactCount = family.evidence.filter(
    (record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias'
  ).length;
  const leafExactCount = family.leaves.reduce(
    (count, leaf) =>
      count + leaf.evidence.filter((record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias').length,
    0
  );

  return familyExactCount + leafExactCount + foldedAliasAuthorityCount;
}

function requiresSpecificAcronymAliasAuthority(preparedQuery: PreparedQuery): boolean {
  const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
  return preparedQuery.acronymTokens.length > 0 && preparedQuery.intent.roleTokens.length > Math.max(roleHeadTokens.length, 1);
}

function minimumSpecificAliasRoleMatches(preparedQuery: PreparedQuery): number {
  return Math.min(preparedQuery.intent.roleTokens.length, Math.max(2, authoritativeIntentRoleHeadTokens(preparedQuery).length + 1));
}

function aliasRoleMatchCount(record: PipelineEvidenceRecord, preparedQuery: PreparedQuery): number {
  return matchedIntentTokens(preparedQuery.intent.roleTokens, aliasEvidenceLabels(record)).matched.length;
}

function aliasHasRawAcronymRoleAuthority(record: PipelineEvidenceRecord, preparedQuery: PreparedQuery): boolean {
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

function authoritativeIntentRoleHeadTokens(preparedQuery: PreparedQuery): string[] {
  if (preparedQuery.intent.authoritativeRoleHeadTokens.length > 0) {
    return preparedQuery.intent.authoritativeRoleHeadTokens;
  }

  if (preparedQuery.intent.roleHeadRequiresContext && !preparedQuery.intent.roleHeadHasContext) {
    return [];
  }

  return preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens;
}

function aliasEvidenceLabels(record: PipelineEvidenceRecord): string[] {
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

function maxFamilyProfileRoleCoverage(evidence: PipelineEvidenceRecord[]): number {
  return Math.max(
    ...evidence.filter((record) => record.channel === 'family_profile').map((record) => numericDetail(record.details.role_coverage) ?? 0),
    0
  );
}

function compareBroadRoleFamilies(left: RankedPipelineFamily, right: RankedPipelineFamily): number {
  const leftAuthority = broadRoleFamilyAuthority(left);
  const rightAuthority = broadRoleFamilyAuthority(right);

  return (
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    rightAuthority.profileAndSemanticSupport - leftAuthority.profileAndSemanticSupport ||
    rightAuthority.profileCoverage - leftAuthority.profileCoverage ||
    leftAuthority.bestRepresentativeTokenCount - rightAuthority.bestRepresentativeTokenCount ||
    rightAuthority.profileLeafCount - leftAuthority.profileLeafCount ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

type BroadRoleFamilyAuthority = {
  jobFunctionPrior: number;
  profileAndSemanticSupport: number;
  profileCoverage: number;
  bestRepresentativeTokenCount: number;
  profileLeafCount: number;
};

type ProfileSemanticAuthority = {
  hasProfileSemanticSupport: boolean;
  profileCoverage: number;
  bestRepresentativeTokenCount: number;
  profileLeafCount: number;
};

function broadRoleFamilyAuthority(family: RankedPipelineFamily): BroadRoleFamilyAuthority {
  const profileAuthority = profileSemanticAuthority(family);

  return {
    jobFunctionPrior: maxEvidenceScore(family.evidence, ['job_function_family_prior']),
    profileAndSemanticSupport: profileAuthority.hasProfileSemanticSupport ? 1 : 0,
    profileCoverage: profileAuthority.profileCoverage,
    bestRepresentativeTokenCount: profileAuthority.bestRepresentativeTokenCount,
    profileLeafCount: profileAuthority.profileLeafCount
  };
}

function profileSemanticAuthority(family: RankedPipelineFamily): ProfileSemanticAuthority {
  const familyProfileEvidenceRecords = family.evidence.filter(
    (record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical'
  );
  const bestFamilyProfile = familyProfileEvidenceRecords.reduce<PipelineEvidenceRecord | null>(
    (best, record) => (best === null || record.score > best.score ? record : best),
    null
  );
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

function familyEvidenceTier(evidence: PipelineEvidenceRecord[]): FamilyEvidenceTier {
  if (hasEvidenceChannel(evidence, 'exact_family_canonical')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'exact_canonical')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'exact_alias')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'cross_locale_english_backbone')) {
    return 'cross_locale_backbone';
  }

  if (hasEvidenceChannel(evidence, 'folded_alias')) {
    return 'folded_alias';
  }

  if (hasEvidenceChannel(evidence, 'reviewed_family_signal')) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'generic_head_family_prior')) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'ngram_alias')) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'family_profile')) {
    return 'family_profile';
  }

  if (hasPreparedPhraseWindowFamilyEvidence(evidence)) {
    return 'strong_phrase';
  }

  return 'graph_only';
}

function familyEvidenceTierRank(tier: FamilyEvidenceTier): number {
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

  if (tier === 'family_profile') {
    return 5;
  }

  return 6;
}

function hasEvidenceChannel(evidence: PipelineEvidenceRecord[], channel: PipelineEvidenceChannel): boolean {
  return evidence.some((record) => record.channel === channel);
}

function hasPreparedPhraseWindowFamilyEvidence(evidence: PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'lexical') {
      return false;
    }

    const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];

    return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
  });
}

// Filters to leaves that can actually be promoted before ranking rather than ranking everyone and
// gating the winner afterward (resolution.md #12). Deferred leaves still stay visible in diagnostics
// and family recovery, but they no longer crowd promotable leaves out of the top slots.
function rankEligibleLeavesFirst(
  leaves: PipelineLeafCandidate[],
  preparedQuery: PreparedQuery,
  exactQueryText: string
): PipelineLeafCandidate[] {
  const promotableLeaves: PipelineLeafCandidate[] = [];
  const deferredLeaves: PipelineLeafCandidate[] = [];

  for (const leaf of leaves) {
    (isLeafPromotableByRoleCompatibility(leaf, preparedQuery) ? promotableLeaves : deferredLeaves).push(leaf);
  }

  const byQuery = (left: PipelineLeafCandidate, right: PipelineLeafCandidate) =>
    compareLeavesForQuery(left, right, preparedQuery, exactQueryText);

  return [...promotableLeaves.sort(byQuery), ...deferredLeaves.sort(byQuery)];
}

function compareLeavesForQuery(
  left: PipelineLeafCandidate,
  right: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  exactQueryText: string
): number {
  return (
    compareAcronymRoleLeafAuthority(left, right, preparedQuery) || compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText)
  );
}

function compareAcronymRoleLeafAuthority(left: PipelineLeafCandidate, right: PipelineLeafCandidate, preparedQuery: PreparedQuery): number {
  if (!requiresSpecificAcronymAliasAuthority(preparedQuery)) {
    return 0;
  }

  const leftAuthority = leafRoleAuthority(left, preparedQuery);
  const rightAuthority = leafRoleAuthority(right, preparedQuery);

  return (
    rightAuthority.roleHeadMatches - leftAuthority.roleHeadMatches ||
    rightAuthority.roleMatches - leftAuthority.roleMatches ||
    rightAuthority.rawAcronymAliasAuthority - leftAuthority.rawAcronymAliasAuthority
  );
}

function leafRoleAuthority(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery
): { roleHeadMatches: number; roleMatches: number; rawAcronymAliasAuthority: number } {
  const labels = [
    leaf.canonicalLabel,
    ...(leaf.closeness?.matchedLabel ? [leaf.closeness.matchedLabel] : []),
    ...matchedAliasLabels(leaf.evidence)
  ];

  return {
    roleHeadMatches: matchedIntentTokens(authoritativeIntentRoleHeadTokens(preparedQuery), labels).matched.length,
    roleMatches: matchedIntentTokens(groundingRoleTokens(preparedQuery), labels).matched.length,
    rawAcronymAliasAuthority: leaf.evidence.some((record) => aliasHasRawAcronymRoleAuthority(record, preparedQuery)) ? 1 : 0
  };
}

function compareLeavesForPreparedQuery(
  left: PipelineLeafCandidate,
  right: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  exactQueryText: string
): number {
  const exactCanonicalAuthority =
    Number(hasRawQueryFullStringExactCanonical(right, preparedQuery, exactQueryText)) -
    Number(hasRawQueryFullStringExactCanonical(left, preparedQuery, exactQueryText));

  if (exactCanonicalAuthority !== 0) {
    return exactCanonicalAuthority;
  }

  return compareLeaves(left, right, preparedQuery) || left.canonicalLabel.localeCompare(right.canonicalLabel);
}

const ROLE_COMPATIBILITY_RANK: Record<RoleCompatibility, number> = {
  unknown: 0,
  compatible: 0,
  weakly_compatible: 1,
  incompatible: 2
};

function roleCompatibilityRank(compatibility: RoleCompatibility): number {
  return ROLE_COMPATIBILITY_RANK[compatibility];
}

export type LeafSpecializationSupport = 'supported' | 'neutral' | 'unsupported';

const LEAF_SPECIALIZATION_SUPPORT_RANK: Record<LeafSpecializationSupport, number> = {
  supported: 0,
  neutral: 1,
  unsupported: 2
};

function leafSpecializationSupportRank(support: LeafSpecializationSupport): number {
  return LEAF_SPECIALIZATION_SUPPORT_RANK[support];
}

function closenessScoreDiffAndTitleRatio(
  left: PipelineLeafCandidate,
  right: PipelineLeafCandidate
): { closenessScoreDiff: number; titleExtraTokenRatioDiff: number } {
  return {
    closenessScoreDiff: (right.closeness?.score ?? 0) - (left.closeness?.score ?? 0),
    titleExtraTokenRatioDiff: (left.closeness?.titleExtraTokenRatio ?? 0) - (right.closeness?.titleExtraTokenRatio ?? 0)
  };
}

function shorterCanonicalTieBreak(
  left: PipelineLeafCandidate,
  right: PipelineLeafCandidate,
  closenessScoreDiff: number,
  tiedOn: boolean
): number {
  return tiedOn && Math.abs(closenessScoreDiff) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
    ? canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel)
    : 0;
}

function compareLeaves(left: PipelineLeafCandidate, right: PipelineLeafCandidate, preparedQuery: PreparedQuery): number {
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
  const aliasTiePrefersShorterCanonical = shorterCanonicalTieBreak(
    left,
    right,
    closenessScoreDiff,
    leftExactAliasScore > 0 && rightExactAliasScore > 0
  );

  if (aliasTiePrefersShorterCanonical !== 0) {
    return aliasTiePrefersShorterCanonical;
  }

  const roleCompatibilityDiff =
    roleCompatibilityRank(roleCompatibility(left, preparedQuery)) - roleCompatibilityRank(roleCompatibility(right, preparedQuery));

  if (roleCompatibilityDiff !== 0) {
    return roleCompatibilityDiff;
  }

  const specializationSupportDiff =
    leafSpecializationSupportRank(leafSpecializationSupport(left, preparedQuery)) -
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

  const sameMatchedLabel =
    Boolean(left.closeness?.matchedLabel && right.closeness?.matchedLabel) &&
    foldSearchText(left.closeness?.matchedLabel ?? '') === foldSearchText(right.closeness?.matchedLabel ?? '');
  const sameLabelTiePrefersShorterCanonical =
    sameMatchedLabel && Math.abs(titleExtraTokenRatioDiff) < NUMERIC_COMPARISON_POLICY.TIE_EPSILON
      ? shorterCanonicalTieBreak(left, right, closenessScoreDiff, true)
      : 0;

  if (sameLabelTiePrefersShorterCanonical !== 0) {
    return sameLabelTiePrefersShorterCanonical;
  }

  const familyScopedTierDiff =
    (left.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY) - (right.familyScopedFit?.tierRank ?? Number.POSITIVE_INFINITY);

  if (familyScopedTierDiff !== 0) {
    return familyScopedTierDiff;
  }

  const capabilityFitTierDiff =
    (left.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY) - (right.capabilityFit?.tierRank ?? Number.POSITIVE_INFINITY);

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

  const matchedCapabilityTermsDiff =
    (right.familyScopedFit?.matchedCapabilityTerms.length ?? 0) - (left.familyScopedFit?.matchedCapabilityTerms.length ?? 0);

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

function leafStructuralPreferenceScore(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): number {
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
  } else if (isSingleHeadOrBroadRoleQuery(preparedQuery)) {
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

  for (const kind of structure.specializationKinds) {
    score += preparedQuerySupportsSpecializationKind(preparedQuery, kind) ? 2 : -2;
  }

  return score;
}

// Closeness among structurally-compatible candidates (resolution.md last-mile selection): rewards
// leaves whose authority/specialization kinds actually agree with what the query expressed, and
// rewards plain leaves that carry no authority/specialization kind at all as the safe default when
// the query gives no such signal either way. Kept separate from leafStructuralPreferenceScore, which
// mixes in coverage/canonical-match terms that are unrelated to structural closeness.
function leafStructuralAlignmentScore(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): number {
  const structure = leaf.leafStructure;

  if (!structure || isFamilyNodePseudoLeaf(leaf)) {
    return 0;
  }

  if (structure.authorityKind !== 'none') {
    return preparedQueryRequestsAuthority(preparedQuery, structure.authorityKind) ? 1 : -2;
  }

  if (structure.specializationKinds.length === 0) {
    return 1;
  }

  let score = 0;

  for (const kind of structure.specializationKinds) {
    score += preparedQuerySupportsSpecializationKind(preparedQuery, kind) ? 1 : -1;
  }

  return score;
}

function isSingleHeadOrBroadRoleQuery(preparedQuery: PreparedQuery): boolean {
  return preparedQuery.usefulFoldedTokens.length <= 1 || isBroadRoleQuery(preparedQuery);
}

function leafHasSupportedStructuralSpecialization(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const structure = leaf.leafStructure;

  if (!structure) {
    return false;
  }

  return structure.specializationKinds.some((kind) => preparedQuerySupportsSpecializationKind(preparedQuery, kind));
}

function isAliasOnlyStructuralAuthorityLeaf(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  if (isRawExactMatch(leaf, preparedQuery)) {
    return false;
  }

  const exactOrFoldedAliasAuthority =
    leaf.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias') &&
    leaf.closeness?.matchedLabelSource === 'alias';

  if (!exactOrFoldedAliasAuthority) {
    return false;
  }

  return canonicalUsefulCoverage(leaf, preparedQuery) < 1;
}

function hasUnsafeStructuralLeafPromotion(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
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

function canonicalUsefulCoverage(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): number {
  const cachedByLeaf = CANONICAL_USEFUL_COVERAGE_CACHE.get(preparedQuery);

  if (cachedByLeaf?.has(leaf)) {
    return cachedByLeaf.get(leaf) ?? 0;
  }

  const canonicalTokens = new Set(canonicalLabelTokens(leaf.canonicalLabel));
  const usefulTokens = preparedQuery.usefulFoldedTokens;

  if (usefulTokens.length === 0) {
    return 0;
  }

  const matchedCount = usefulTokens.filter((token) => tokenMatchesLabelTokens(token, canonicalTokens)).length;
  const coverage = matchedCount / usefulTokens.length;

  if (cachedByLeaf) {
    cachedByLeaf.set(leaf, coverage);
  } else {
    CANONICAL_USEFUL_COVERAGE_CACHE.set(preparedQuery, new Map([[leaf, coverage]]));
  }

  return coverage;
}

function canonicalTokenCount(label: string): number {
  return canonicalLabelTokens(label).length;
}

function intentRoleQuery(preparedQuery: PreparedQuery): string {
  return preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedTokens.join(' ').trim() || preparedQuery.normalized;
}

function hasLeafRoleGrounding(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
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

function hasFamilyRoleGrounding(family: RankedPipelineFamily, preparedQuery: PreparedQuery): boolean {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return true;
  }

  if (
    family.evidence.some(
      (record) => record.channel === 'exact_canonical' || record.channel === 'exact_alias' || record.channel === 'folded_alias'
    )
  ) {
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

function isFamilyNodePseudoLeaf(leaf: PipelineLeafCandidate): boolean {
  return leaf.familyKind === 'family' && leaf.graphNodeId === leaf.familyNodeId;
}

// A leaf recovered purely as a family sweep-in (only `graph_family_recovery` evidence, normalized to
// 0 everywhere else in this file) carries no signal that the query actually relates to it -- e.g. an
// unrelated "coachbuilder"/"greaser" leaf pulled in just because it belongs to the winning family. Such
// leaves must not count toward family-level structural tie-break signals (leafStructuralAlignmentScore,
// leafStructuralPreferenceScore), or a family wins the tie-break merely for happening to contain some
// untagged, query-irrelevant leaf rather than for genuinely matching the query.
function hasGenuineLeafEvidence(leaf: PipelineLeafCandidate): boolean {
  return leaf.evidence.some((record) => record.channel !== 'graph_family_recovery');
}

function hasAuthoritativeLeafPromotionAuthority(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return isRawExactMatch(leaf, preparedQuery);
}

function isLeafPromotableByRoleCompatibility(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  if (isFamilyNodePseudoLeaf(leaf)) {
    return false;
  }

  if (hasAuthoritativeLeafPromotionAuthority(leaf, preparedQuery)) {
    return true;
  }

  return roleCompatibility(leaf, preparedQuery) === 'compatible';
}

function leafSpecializationSupport(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): LeafSpecializationSupport {
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

// Whether a leaf's role can stand in for the query's role, computed once before leaf ranking so
// ranking never promotes a leaf whose role plainly does not fit (resolution.md #2, #3, #12).
export type RoleCompatibility = 'compatible' | 'weakly_compatible' | 'unknown' | 'incompatible';

function roleCompatibility(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): RoleCompatibility {
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

function maxIntentRoleHeadEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);

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

function maxIntentRoleEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
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
function maxFullRoleTokenEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  // `intent.roleTokens` classification is order-sensitive (see occupation-candidates.ts
  // retrieveAliasNgramMatches for the same issue) and can drop the single most discriminating query
  // token entirely, understating how well a family's evidence actually covers the query. Union with
  // `usefulFoldedTokens`, which stays stable across reorderings, so a family that matches the dropped
  // token isn't denied credit for it while a family that never matched it isn't unfairly boosted either.
  const roleTokens = [...new Set([...preparedQuery.intent.roleTokens, ...preparedQuery.usefulFoldedTokens])];

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

function maxIntentDomainEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
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

function roleCoverageForLabels(preparedQuery: PreparedQuery, labels: string[]): number {
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

function domainSupportForLabels(preparedQuery: PreparedQuery, labels: string[]): number {
  const domainTokens = preparedQuery.intent.domainTokens;

  if (domainTokens.length === 0) {
    return 0;
  }

  const match = matchedIntentTokens(domainTokens, labels);
  return clampScore(match.matched.length / domainTokens.length);
}

function matchedIntentTokens(tokens: string[], labels: string[]): { matched: string[]; missing: string[] } {
  const labelTokens = new Set(labels.flatMap((label) => tokenizeNormalizedText(foldSearchText(label))));
  const matched = tokens.filter((token) => tokenMatchesLabelTokens(token, labelTokens));

  return {
    matched: Array.from(new Set(matched)).sort(),
    missing: tokens.filter((token) => !matched.includes(token))
  };
}

function groundingRoleTokens(preparedQuery: PreparedQuery): string[] {
  const minimumMatches = minimumRequiredRoleMatches(preparedQuery);

  if (minimumMatches > 1) {
    return preparedQuery.intent.roleTokens;
  }

  const authoritativeHeads = authoritativeIntentRoleHeadTokens(preparedQuery);
  return authoritativeHeads.length > 0 ? authoritativeHeads : preparedQuery.intent.roleTokens;
}

function minimumRequiredRoleMatches(preparedQuery: PreparedQuery): number {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return 0;
  }

  if (
    preparedQuery.intent.roleHeadRequiresContext &&
    preparedQuery.intent.roleHeadHasContext &&
    preparedQuery.intent.roleTokens.length > authoritativeIntentRoleHeadTokens(preparedQuery).length
  ) {
    return Math.min(2, preparedQuery.intent.roleTokens.length);
  }

  return 1;
}

function minimumRoleCoverageRatio(preparedQuery: PreparedQuery): number {
  const roleTokens = groundingRoleTokens(preparedQuery);

  if (roleTokens.length === 0) {
    return 0;
  }

  return minimumRequiredRoleMatches(preparedQuery) / roleTokens.length;
}

function hasSufficientRoleMatchCount(preparedQuery: PreparedQuery, matchedCount: number): boolean {
  return matchedCount >= minimumRequiredRoleMatches(preparedQuery);
}

function tokenMatchesLabelTokens(token: string, labelTokens: Set<string>): boolean {
  const foldedToken = foldSearchText(token);

  if (labelTokens.has(foldedToken)) {
    return true;
  }

  return expandTokenVariants([foldedToken], 'en').some((variant) => labelTokens.has(foldSearchText(variant)));
}

function tokenListHasEquivalent(values: string[], token: string): boolean {
  const valueTokens = new Set(values.map((value) => foldSearchText(value)));
  return tokenMatchesLabelTokens(token, valueTokens);
}

function stringArrayDetail(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function requireBranchExpansion(state: PipelineState): ExpandOccupationCandidateBranchesResult {
  if (!state.branchExpansion) {
    throw new Error('Pipeline branch expansion is missing.');
  }

  return state.branchExpansion;
}

function stageForChannel(channel: PipelineEvidenceChannel): string {
  if (channel === 'graph_family_recovery') {
    return 'family_constrained_recovery';
  }

  if (channel === 'exact_canonical' || channel === 'exact_alias' || channel === 'folded_alias' || channel === 'ngram_alias') {
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

function ratioToScore(ratio: number | null, weak: number, strong: number): number {
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

function normalizeOptions(options: OccupationSearchPipelineOptions): NormalizedPipelineOptions {
  const debug = options.debug === true;
  const requestedTopFamilyLimit = requirePositiveIntegerAtMost(options.topFamilyLimit ?? 3, 1000, 'top-family-limit');
  const requestedTopLeavesPerFamily = requirePositiveIntegerAtMost(options.topLeavesPerFamily ?? 3, 1000, 'top-leaves-per-family');
  const jobFunction = normalizeJobFunction(options.jobFunction);

  return {
    query: options.query?.trim() ?? '',
    locale: options.locale?.trim() || DEFAULT_RETRIEVAL_LOCALE,
    sourceName: options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME,
    modelKey: options.modelKey?.trim() || DEFAULT_MODEL_KEY,
    limit: requirePositiveIntegerAtMost(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1000, 'limit'),
    evaluationQueryId: options.evaluationQueryId,
    siblingLimit: requireNonNegativeIntegerAtMost(options.siblingLimit ?? DEFAULT_SIBLING_LIMIT, 1000, 'sibling-limit'),
    topFamilyLimit: debug ? requestedTopFamilyLimit : Math.min(requestedTopFamilyLimit, 3),
    topLeavesPerFamily: debug ? requestedTopLeavesPerFamily : Math.min(requestedTopLeavesPerFamily, 3),
    ...(jobFunction ? { jobFunction } : {}),
    debug
  };
}

function clampScore(value: number): number {
  return roundScore(Math.max(0, Math.min(1, value)));
}

function roundScore(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
