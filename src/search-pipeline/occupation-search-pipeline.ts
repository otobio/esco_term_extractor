import {
  expandTokenVariants,
  normalizeQueryLocale,
  preparedQueryRoleCapabilityVerbFoldedAdditionTokens,
  preparedQueryRoleFamilyScopedFoldedTokens,
  preparedQueryRoleFolded,
  preparedQueryRoleFoldedTokens,
  preparedQueryRoleNormalized,
  preparedQueryRoleUsefulFoldedRecallTokens,
  prepareQuery,
  type PreparedQuery,
  type SupportedQueryLocale
} from '../query/query-preparation.js';
import { foldSearchText, foldWeakPunctuationLookupText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import type { OccupationRoleSpanSelection } from '../query/occupation-role-span-selector.js';
import { prepareOccupationRetrievalQuery, type PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { occupationRoleHeadSharesEquivalentClass } from '../query/occupation-role-head-equivalence.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { isEnglishQuery } from '../utils/lang.js';
import {
  DEFAULT_SIBLING_LIMIT,
  OccupationCandidateBranchRetriever,
  type ExpandedOccupationCandidate,
  type OccupationCandidateBranchRetrievalOptions,
  type OccupationCandidateBranchRetrievalResult,
  type OccupationCandidateBranch
} from '../retrieval/occupation-candidate-branches.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever,
  retrievalSurfaceLocales,
  type RetrievalChannel
} from '../retrieval/occupation-candidates.js';
import type { OccupationRetrievalEngine, OccupationTextHit, OccupationTextRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { createRetrievalEngine } from '../retrieval/retrieval-engine-factory.js';
import { TokenLeafClosenessRanker, type LeafClosenessQuery, type LeafClosenessRank } from './ranking/leaf-closeness-ranker.js';
import { findCommonRolePhraseMatch } from '../query/common-role-phrase-atlas.js';
import type { RuntimeCapabilityRecord } from '../runtime/occupation-search-meta-artifact.js';
import {
  computeLeafSupportEvidence,
  scoreLeaf as scoreLeafAdditive,
  sumScoreBreakdown as sumAdditiveScoreBreakdown,
  compareRankedLeaves as compareAdditiveRankedLeaves,
  leafEvidenceAliasLabels,
  type RankedFamilyLeaf as AdditiveRankedFamilyLeaf
} from '../cli/rank-family-leaves-core.js';
import {
  applyRecoveredFamilySelectionAuthority,
  compareFamilies,
  compareRecoveredFamilySelectionAuthority,
  familyEvidenceTierRank,
  type RecoveredFamilySelectionAuthority
} from '../cli/rank-family-core.js';
import type { FamilyScopedLeafFit } from './ranking/family-scoped-leaf-ranker.js';
import {
  LeafSelectionEvidenceRanker,
  type LeafSelectionEvidence,
  type LeafSelectionEvidenceTier
} from './ranking/leaf-selection-evidence-ranker.js';
import type { CapabilityFit } from './ranking/capability-fit-ranker.js';
import { FamilyProfileRetriever, type FamilyProfileHit } from './family-profile-retriever.js';
import { getGenericHeadFamilyPriors, hasGenericHeadVenueContext, type GenericHeadFamilyPrior } from './generic-head-family-priors.js';
import { getJobFunctionFamilyPriors, normalizeJobFunction, type JobFunctionFamilyPrior } from './job-function-family-priors.js';
import {
  BRANCH_MARGIN_POLICY,
  EVIDENCE_NORMALIZATION_POLICY,
  FAMILY_SCORING_POLICY,
  GENERIC_RISK_PENALTY,
  NUMERIC_COMPARISON_POLICY,
  PIPELINE_DECISION_GATE
} from '../scoring/scoring-policy.js';
import {
  hydrateRuntimeSearchMetaRecord,
  hydrateRuntimeSearchMetaRecords,
  loadOccupationSearchMetaArtifactRequired,
  type RuntimeSearchMetaRecord
} from '../runtime/occupation-search-meta-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { OccupationLeafStructureRecord, LeafSpecializationKind } from '../runtime/occupation-leaf-structure-contract.js';
import {
  preparedQueryRequestsAuthority,
  preparedQuerySupportsSpecializationKind,
  resolveLeafSpecializationKinds
} from '../runtime/occupation-leaf-structure-rules.js';
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
import type { RetrievalBoundaryDebugCollector } from '../debug/retrieval-boundary-debug.js';
import { familyTokenRelevanceMultiplier, tryLoadOccupationFamilyTokenRelevanceLookup } from '../query/occupation-family-token-relevance.js';
import {
  familyCapabilityRelevanceMultiplier,
  tryLoadOccupationFamilyCapabilityRelevanceLookup
} from '../query/occupation-family-capability-relevance.js';

export type PipelineEvidenceChannel =
  | RetrievalChannel
  | 'exact_family_canonical'
  | 'useful_exact'
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
  | 'useful_exact'
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

export type OccupationSearchPipelineOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  limit?: number;
  evaluationQueryId?: number;
  siblingLimit?: number;
  debugCollector?: RetrievalBoundaryDebugCollector | null;
  topFamilyLimit?: number;
  topLeavesPerFamily?: number;
  jobFunction?: string;
  debug?: boolean;
  disabledCommonRolePhraseRoleKeys?: readonly string[];
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

export type LeafFirstFamilyDebugEntry = {
  rank: number;
  familyKey: string;
  familyLabel: string;
  familyNodeId: number;
  confidence: number;
  supportingLeafCount: number;
  topLeafLabel: string | null;
  topLeafConfidence: number | null;
  selectableLeafLabel: string | null;
  selectableLeafConfidence: number | null;
};

export type PipelineDebugInfo = {
  stages: string[];
  attempts: PipelineAttemptSummary[];
  timings: TimingMap;
  rawBranchExpansion: OccupationCandidateBranchRetrievalResult | null;
  candidatePoolTrace: CandidatePoolTraceEntry[];
  familyProfileHits: FamilyProfileHit[];
  leafFirstFamilies: LeafFirstFamilyDebugEntry[];
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
    stages: PipelineDebugInfo['stages'];
    attempts: PipelineDebugInfo['attempts'];
    timings: PipelineDebugInfo['timings'];
    rawBranchExpansion: PipelineDebugInfo['rawBranchExpansion'];
    candidatePoolTrace: PipelineDebugInfo['candidatePoolTrace'];
    familyProfileHits: PipelineDebugInfo['familyProfileHits'];
    leafFirstFamilies: PipelineDebugInfo['leafFirstFamilies'];
  };
};

export type OccupationSearchPipelineResult = {
  queryContext: {
    originalQuery: string;
    query: string;
    querySpans: string[];
    locale: string;
    keptQuerySignals: string[];
    roleSpanSelection: OccupationRoleSpanSelection | null;
    sourceName: string;
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
    stages: PipelineDebugInfo['stages'];
    attempts: PipelineDebugInfo['attempts'];
    timings: PipelineDebugInfo['timings'];
    rawBranchExpansion: PipelineDebugInfo['rawBranchExpansion'];
    candidatePoolTrace: PipelineDebugInfo['candidatePoolTrace'];
    familyProfileHits: PipelineDebugInfo['familyProfileHits'];
    leafFirstFamilies: PipelineDebugInfo['leafFirstFamilies'];
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

type PipelineLeafRankingStrategyInput = {
  preparedQuery: PreparedQuery;
  roleClosenessQuery: LeafClosenessQuery;
  roleFamilyScopedFoldedTokens: string[];
  roleCapabilityVerbFoldedAdditionTokens: string[];
  exactQueryText: string;
  family: RankedPipelineFamily;
  leaves: PipelineLeafCandidate[];
  recoveredAliasesByNodeId: Map<number, string[]>;
  recoveredCapabilityLabelsByNodeId: Map<number, string[]>;
};

type PipelineLeafRankingStrategyOutput = {
  leaves: PipelineLeafCandidate[];
};

export interface PipelineLeafRankingStrategy {
  rank(input: PipelineLeafRankingStrategyInput): PipelineLeafRankingStrategyOutput;
}

class PipelineDebugCollector {
  private stages: string[] = [];
  private familyCandidatePoolTrace: CandidatePoolTraceEntry[] = [];
  private leafCandidatePoolTrace: CandidatePoolTraceEntry[] = [];
  private readonly familyProfileHitsByKey = new Map<string, FamilyProfileHit>();
  private leafFirstFamilies: LeafFirstFamilyDebugEntry[] = [];

  public constructor(private readonly enabled: boolean) {}

  public collect(state: PipelineState, stageName: string): void {
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
    }

    if (stageName === 'consolidateFamiliesStage') {
      this.familyCandidatePoolTrace = debugBuildFamilyCandidatePoolTraceEntries(state);
    }

    if (stageName === 'narrowLeavesWithinFamiliesStage') {
      this.leafCandidatePoolTrace = debugBuildLeafCandidatePoolTraceEntries(state);
    }
  }

  public snapshot(
    attempts: PipelineAttemptSummary[],
    timings: TimingMap,
    rawBranchExpansion: OccupationCandidateBranchRetrievalResult | null
  ): PipelineDebugInfo {
    return {
      stages: [...this.stages],
      attempts,
      timings,
      rawBranchExpansion: this.enabled ? rawBranchExpansion : null,
      candidatePoolTrace: [...this.familyCandidatePoolTrace, ...this.leafCandidatePoolTrace],
      familyProfileHits: Array.from(this.familyProfileHitsByKey.values()),
      leafFirstFamilies: [...this.leafFirstFamilies]
    };
  }
}

type PipelineState = {
  occupationRetriever: OccupationTextRetrievalEngine;
  leafStructureArtifact: OccupationLeafStructureArtifact | null;
  leafRankingStrategy: PipelineLeafRankingStrategy;
  preparedQuery: PreparedQuery;
  roleClosenessQuery: LeafClosenessQuery;
  roleFamilyScopedFoldedTokens: string[];
  roleCapabilityVerbFoldedAdditionTokens: string[];
  branchExpansion: OccupationCandidateBranchRetrievalResult | null;
  candidateFamilies: Map<string, PipelineFamilyCandidate>;
  candidateLeafs: Map<number, PipelineLeafCandidate>;
  recoveredAliasesByNodeId: Map<number, string[]>;
  recoveredCapabilityLabelsByNodeId: Map<number, string[]>;
  timings: TimingMap;
  rankedFamilies: RankedPipelineFamily[];
  rankedLeaves: RankedPipelineLeaf[];
  decision: PipelineDecision | null;
  stages: string[];
  topFamilyLimit: number;
  topLeavesPerFamily: number;
  jobFunction: string | null;
  // Shared across every stage of one pipeline run so a leaf's runtime-derived specializationKinds
  // (used when the artifact's authored specializationKinds is empty/unclassified) is computed at
  // most once per leaf, not once per consumer per stage. See resolveLeafSpecializationKinds.
  leafSpecializationKindsCache: Map<number, LeafSpecializationKind[]>;
};

type PipelineStage = (state: PipelineState) => Promise<PipelineState>;

type NormalizedPipelineOptions = {
  query: string;
  locale: string;
  sourceName: string;
  limit: number;
  evaluationQueryId?: number;
  siblingLimit?: number;
  topFamilyLimit: number;
  topLeavesPerFamily: number;
  jobFunction?: string;
  debug: boolean;
  disabledCommonRolePhraseRoleKeys?: readonly string[];
  debugCollector?: RetrievalBoundaryDebugCollector | null;
};

const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const LEAF_SELECTION_EVIDENCE_RANKER = new LeafSelectionEvidenceRanker();
const FAMILY_PROFILE_RETRIEVER = new FamilyProfileRetriever();
const ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY: PipelineLeafRankingStrategy = {
  rank(input): PipelineLeafRankingStrategyOutput {
    const rolePhraseMatch = findCommonRolePhraseMatch(input.exactQueryText, input.preparedQuery.locale as SupportedQueryLocale);
    const specializationKindsCache: Map<number, LeafSpecializationKind[]> = new Map();

    type PipelineAdditiveRankedLeaf = AdditiveRankedFamilyLeaf & {
      evidenceWithUsefulExact: PipelineEvidenceRecord[];
      familyScopedFit: FamilyScopedLeafFit;
      capabilityFit: CapabilityFit;
      selectionEvidence: LeafSelectionEvidence;
    };

    const rankedLeaves: PipelineAdditiveRankedLeaf[] = input.leaves.map((leaf) => {
      const aliases = Array.from(
        new Set([...matchedAliasLabels(leaf.evidence), ...(input.recoveredAliasesByNodeId.get(leaf.graphNodeId) ?? [])])
      );

      const recoveredCapabilityLabelsForLeaf = input.recoveredCapabilityLabelsByNodeId.get(leaf.graphNodeId) ?? [];

      const capabilityLabels: RuntimeCapabilityRecord[] = recoveredCapabilityLabelsForLeaf.map((label) => ({
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
      const supportEvidence = computeLeafSupportEvidence(
        input.preparedQuery,
        leaf.canonicalLabel,
        aliases,
        capabilityLabels,
        input.roleFamilyScopedFoldedTokens,
        input.roleCapabilityVerbFoldedAdditionTokens
      );

      const scoreBreakdown = scoreLeafAdditive(
        closeness,
        aliases,
        leaf.leafStructure,
        input.preparedQuery,
        canonicalTokens,
        matchedLabelTokens,
        familyTokens,
        capabilityLabels,
        rolePhraseMatch,
        input.preparedQuery.locale,
        leaf.canonicalLabel,
        input.exactQueryText,
        leaf.graphNodeId,
        specializationKindsCache,
        input.roleFamilyScopedFoldedTokens,
        input.roleCapabilityVerbFoldedAdditionTokens,
        supportEvidence
      );
      const totalScore = sumAdditiveScoreBreakdown(scoreBreakdown);
      const canonicalUsefulTokenCoverage =
        input.preparedQuery.usefulFoldedRecallTokens.length > 0
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
    const rankedLeafByNodeId = new Map(rankedLeaves.map((leaf) => [leaf.graphNodeId, leaf]));
    // Reorder input.leaves by rankedLeaves' own position, not by re-sorting on totalScore alone --
    // a plain totalScore sort is stable, so leaves tied on score would silently fall back to
    // whatever order they arrived in, discarding every tie-break compareAdditiveRankedLeaves already
    // resolved above (canonical-label proximity, specialization genericness, etc).
    const rankIndexByNodeId = new Map(rankedLeaves.map((leaf, index) => [leaf.graphNodeId, index]));
    const orderedLeaves = [...input.leaves].sort(
      (left, right) => (rankIndexByNodeId.get(left.graphNodeId) ?? 0) - (rankIndexByNodeId.get(right.graphNodeId) ?? 0)
    );

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

const DEFAULT_PIPELINE_LEAF_RANKING_STRATEGY: PipelineLeafRankingStrategy = ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY;

export { ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY };
const CANONICAL_USEFUL_COVERAGE_CACHE = new WeakMap<PreparedQuery, Map<PipelineLeafCandidate, number>>();
// canonicalLabel is a stable, immutable string per graph node -- folding/tokenizing it is a pure
// function of that string, so cache by label text once instead of re-folding/re-tokenizing the same
// leaf's canonical label on every sort comparison and every gate check across every pipeline.run() call.
const CANONICAL_LABEL_TOKEN_CACHE = new Map<string, string[]>();

function canonicalLabelTokens(label: string): string[] {
  let tokens = CANONICAL_LABEL_TOKEN_CACHE.get(label);

  if (tokens === undefined) {
    tokens = tokenizeNormalizedText(foldSearchText(label));
    CANONICAL_LABEL_TOKEN_CACHE.set(label, tokens);
  }

  return tokens;
}

export class OccupationSearchPipeline {
  public constructor(
    private readonly candidateBranchRetriever: OccupationCandidateBranchRetriever = new OccupationCandidateBranchRetriever(
      OccupationCandidateRetriever.withEngine(null, createRetrievalEngine())
    ),
    private readonly occupationRetriever: OccupationTextRetrievalEngine = createRetrievalEngine().occupations,
    private readonly leafStructureArtifact: OccupationLeafStructureArtifact | null = null,
    private readonly leafRankingStrategy: PipelineLeafRankingStrategy = DEFAULT_PIPELINE_LEAF_RANKING_STRATEGY
  ) {}

  public static withEngine(engine: OccupationRetrievalEngine): OccupationSearchPipeline {
    return new OccupationSearchPipeline(
      new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(null, engine)),
      engine.occupations,
      null
    );
  }

  public static withRuntime(runtime: OccupationRuntimeContext): OccupationSearchPipeline {
    return new OccupationSearchPipeline(
      new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(null, runtime.retrievalEngine)),
      runtime.retrievalEngine.occupations,
      runtime.leafStructureRuntimeEnabled ? runtime.leafStructureArtifact : null
    );
  }

  public withLeafRankingStrategy(leafRankingStrategy: PipelineLeafRankingStrategy): OccupationSearchPipeline {
    return new OccupationSearchPipeline(
      this.candidateBranchRetriever,
      this.occupationRetriever,
      this.leafStructureArtifact,
      leafRankingStrategy
    );
  }

  public async run(options: OccupationSearchPipelineOptions): Promise<OccupationSearchPipelineResult> {
    const normalizedOptions = normalizeOptions(options);

    // Step 1: Clean the query - Peel noise terms, and Use the OOV to remove unknown terms, Perform Spelling Correction
    const cleanedQuery = await cleanOccupationQuerySurface(normalizedOptions.query, normalizedOptions.locale);

    if (!cleanedQuery) {
      throw new Error('Provide a query string for pipeline query preparation... Failed for: ' + normalizedOptions.query);
    }

    const activeOptions: NormalizedPipelineOptions = { ...normalizedOptions, query: cleanedQuery };

    if (activeOptions.locale !== DEFAULT_RETRIEVAL_LOCALE && (await isEnglishQuery(activeOptions.query, activeOptions.sourceName))) {
      activeOptions.locale = DEFAULT_RETRIEVAL_LOCALE;
    }

    const intentVocabularyArtifact = await timed(
      () => loadOccupationIntentVocabularyArtifactRequired(activeOptions.sourceName),
      'pipeline.intent_vocabulary.artifact_load',
      {} as TimingMap
    );

    // Step 2: Prepare the query: Do Query Intent, Do Various query forms, Compound Split, etc
    const primaryRetrievalQuery = await prepareOccupationRetrievalQuery(
      {
        sourceName: activeOptions.sourceName,
        locale: activeOptions.locale,
        originalQuery: activeOptions.query,
        disabledCommonRolePhraseRoleKeys: activeOptions.disabledCommonRolePhraseRoleKeys
      },
      intentVocabularyArtifact.artifact
    );

    if (shouldResolveIndependentOccupationSpans(primaryRetrievalQuery.originalQuery, primaryRetrievalQuery.querySpans)) {
      const spanRetrievals: Array<{
        retrievalQuery: PreparedOccupationRetrievalQuery;
        retrievalResult: OccupationCandidateBranchRetrievalResult;
      }> = [];

      for (const span of primaryRetrievalQuery.querySpans) {
        const spanRetrievalQuery = await prepareOccupationRetrievalQuery(
          {
            sourceName: activeOptions.sourceName,
            locale: activeOptions.locale,
            originalQuery: span,
            disabledCommonRolePhraseRoleKeys: activeOptions.disabledCommonRolePhraseRoleKeys
          },
          intentVocabularyArtifact.artifact
        );

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

      const spanResults: PipelineSpanResult[] = [];

      for (const [index, spanRetrieval] of spanRetrievals.entries()) {
        const retrievalResult = spanRetrieval.retrievalResult;
        const spanOptions: NormalizedPipelineOptions = {
          ...activeOptions,
          query: retrievalResult.originalQuery,
          evaluationQueryId: undefined
        };
        const spanAttempt = await runRankingAttempt(
          retrievalResult,
          spanRetrieval.retrievalQuery,
          spanOptions,
          this.occupationRetriever,
          this.leafStructureArtifact,
          this.leafRankingStrategy
        );
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
    const primaryAttempt = await runRankingAttempt(
      primaryRetrievalResult,
      primaryRetrievalQuery,
      activeOptions,
      this.occupationRetriever,
      this.leafStructureArtifact,
      this.leafRankingStrategy
    );
    const attempts: PipelineAttemptSummary[] = [summarizeAttempt(1, 'primary', primaryAttempt, 'used', 'primary retrieval attempt')];
    let selectedAttempt = primaryAttempt;

    if (shouldAttemptSynonymFallback(primaryAttempt.state)) {
      const fallbackOptions = await planSynonymFallbackAttempt(primaryAttempt.state, activeOptions);

      if (fallbackOptions) {
        const fallbackRetrievalResult = await this.candidateBranchRetriever.retrieveCandidatesWithGraphBranches(fallbackOptions);
        const fallbackAttempt = await runRankingAttempt(
          fallbackRetrievalResult,
          fallbackOptions.retrievalQuery,
          activeOptions,
          this.occupationRetriever,
          this.leafStructureArtifact,
          this.leafRankingStrategy
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
  state: PipelineState & {
    branchExpansion: OccupationCandidateBranchRetrievalResult;
    decision: PipelineDecision;
  };
  debug: PipelineDebugInfo;
};

async function runRankingAttempt(
  retrievalResult: OccupationCandidateBranchRetrievalResult,
  retrievalQuery: PreparedOccupationRetrievalQuery,
  options: NormalizedPipelineOptions,
  occupationRetriever: OccupationTextRetrievalEngine,
  leafStructureArtifact: OccupationLeafStructureArtifact | null,
  leafRankingStrategy: PipelineLeafRankingStrategy
): Promise<PipelineAttemptResult> {
  const preparedQuery = retrievalQuery.preparedQuery;
  const roleClosenessQuery: LeafClosenessQuery = {
    locale: preparedQuery.locale,
    normalized: preparedQueryRoleNormalized(preparedQuery),
    folded: preparedQueryRoleFolded(preparedQuery),
    foldedTokens: preparedQueryRoleFoldedTokens(preparedQuery),
    usefulFoldedRecallTokens: preparedQueryRoleUsefulFoldedRecallTokens(preparedQuery)
  };
  const roleFamilyScopedFoldedTokens = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery);
  const roleCapabilityVerbFoldedAdditionTokens = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery);
  const pipelineDebugCollector = new PipelineDebugCollector(options.debug);

  let state: PipelineState = {
    occupationRetriever,
    leafStructureArtifact,
    leafRankingStrategy,
    preparedQuery,
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
    timings: { ...retrievalResult.timings },
    topFamilyLimit: options.topFamilyLimit,
    topLeavesPerFamily: options.topLeavesPerFamily,
    jobFunction: options.jobFunction ?? null,
    leafSpecializationKindsCache: new Map()
  };

  const stages: PipelineStage[] = [
    accumulateCurrentRetrievalEvidenceStage,
    applyJobFunctionFamilyPriorStage,
    applyGenericHeadFamilyPriorStage,
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

async function retrieveExactFamilyCanonicalEvidenceStage(state: PipelineState): Promise<PipelineState> {
  if (!isFamilyProfileRetrievalEnabled()) {
    return {
      ...state,
      stages: appendStage(state, 'skip_exact_family_canonical_evidence')
    };
  }

  const branchExpansion = requireBranchExpansion(state);
  const familyProfileArtifact = await timed(
    () => loadOccupationFamilyProfileArtifactRequired(branchExpansion.sourceName),
    'pipeline.exact_family_canonical.artifact_load',
    state.timings
  );
  const exactHits = await timed(
    () =>
      FAMILY_PROFILE_RETRIEVER.retrieveExactCanonicalFamilies({
        preparedQuery: state.preparedQuery,
        artifact: familyProfileArtifact,
        locale: branchExpansion.locale,
        rawQuery: branchExpansion.originalQuery,
        limit: 1
      }),
    'pipeline.exact_family_canonical.retrieve',
    state.timings
  );

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
    stages: appendStage(
      state,
      exactHits.length > 0 ? 'retrieve_exact_family_canonical_evidence' : 'skip_exact_family_canonical_evidence_no_match'
    )
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
        preparedQuery: state.preparedQuery,
        artifact: familyProfileArtifact,
        locale: branchExpansion.locale,
        rawQuery: branchExpansion.originalQuery,
        limit: Math.max(state.topFamilyLimit * 3, 12)
      }),
    'pipeline.family_profile.retrieve',
    state.timings
  );

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
    .map((family) =>
      scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.roleClosenessQuery, branchExpansion.sourceName)
    )
    .sort(compareFamilies)
    .map((family, index) => ({
      ...family,
      rank: index + 1,
      supportingLeafCount: family.supportingLeafIds.size,
      leaves: []
    }));

  const scoredFamilies: RankedPipelineFamily[] = provisionalFamilies.map((provisionalFamily) => {
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
      const selectableLeaf = firstSelectableLeafInFamily(
        family,
        state.preparedQuery,
        scoredFamilies,
        state.leafSpecializationKindsCache,
        branchExpansion.originalQuery
      );
      return selectableLeaf ? { leaf: selectableLeaf, family } : null;
    })
    .filter((entry): entry is { leaf: RankedPipelineLeaf; family: RankedPipelineFamily } => entry !== null)
    .sort(
      (left, right) =>
        right.leaf.confidence - left.leaf.confidence ||
        right.family.confidence - left.family.confidence ||
        left.leaf.canonicalLabel.localeCompare(right.leaf.canonicalLabel)
    );

  // A leaf can win the cross-family textual comparison above purely on token/role overlap even
  // when its own family is meaningfully weaker than another candidate family that never got to
  // field a leaf. Guard against that by requiring the winning leaf's family to be within
  // LEAF_FIRST_FAMILY_STRENGTH_MARGIN of the strongest scored family, unless the leaf itself is a
  // genuine exact canonical/alias match for the raw query (which should still short-circuit).
  const bestFamilyConfidence = scoredFamilies.reduce((max, family) => Math.max(max, family.confidence), 0);
  const bestFamilyEvidenceTierRank = scoredFamilies.reduce(
    (min, family) => Math.min(min, family.evidenceTierRank),
    Number.POSITIVE_INFINITY
  );
  const scoredLeaves = scoredFamilies.flatMap((family) => family.leaves);
  const familyStrengthEligibleLeaves = selectableTopLeaves.filter(
    (entry) =>
      (hasRawQueryExactCanonicalOrExactAlias(entry.leaf, state.preparedQuery) &&
        !exactLeafRescueHasBroadSharedAliasRisk(entry.leaf, scoredLeaves, state.preparedQuery, branchExpansion.originalQuery)) ||
      (entry.family.evidenceTierRank <= bestFamilyEvidenceTierRank &&
        entry.family.confidence >= bestFamilyConfidence - PIPELINE_DECISION_GATE.LEAF_FIRST_FAMILY_STRENGTH_MARGIN)
  );

  const exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner =
    selectableTopLeaves
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

        return (
          hasRawQueryCanonicalVariantPhraseMatch(leaf, state.preparedQuery) ||
          hasRawQueryExactLeafAlias(leaf, state.preparedQuery) ||
          hasKnownRolePhraseAliasInQueryRescue(leaf, state.preparedQuery, branchExpansion.roleSpanSelection)
        );
      })
      .filter(
        ({ leaf }) =>
          hasRawQueryFullStringExactCanonical(leaf, state.preparedQuery, branchExpansion.originalQuery) ||
          hasRawQueryCanonicalVariantPhraseMatch(leaf, state.preparedQuery) ||
          !exactLeafRescueHasBroadSharedAliasRisk(leaf, scoredLeaves, state.preparedQuery, branchExpansion.originalQuery)
      )
      .sort(
        (left, right) =>
          compareLeavesForPreparedQuery(left.leaf, right.leaf, state.preparedQuery, branchExpansion.originalQuery) ||
          Number(hasRawQueryCanonicalVariantPhraseMatch(right.leaf, state.preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left.leaf, state.preparedQuery))
      )[0] ?? null;

  const exactFamilyCanonicalRescue = selectExactFamilyCanonicalRescue(scoredFamilies, branchExpansion.originalQuery);

  if (exactFamilyCanonicalRescue && !exactLeafFullStringCanonicalSingularPluralOrAliasRescueWithExactCanonicalFallbackWinner) {
    const rescuedFamilyIndex = scoredFamilies.findIndex((family) => family.familyKey === exactFamilyCanonicalRescue.familyKey);
    const reorderedFamilies =
      rescuedFamilyIndex > 0
        ? [
            scoredFamilies[rescuedFamilyIndex]!,
            ...scoredFamilies.slice(0, rescuedFamilyIndex),
            ...scoredFamilies.slice(rescuedFamilyIndex + 1)
          ]
        : scoredFamilies;
    const rankedFamilies = reorderedFamilies
      .map((family, index) => ({ ...family, rank: index + 1 }))
      .map((family, index) =>
        applyRecoveredFamilySelectionAuthority(family, index + 1, state.preparedQuery, (f, q) =>
          recoveredFamilySelectionAuthority(f, q, state.leafSpecializationKindsCache)
        )
      );
    const rankedLeaves = flattenRankedLeaves(rankedFamilies);
    const selectedFamily =
      rankedFamilies.find((family) => family.familyKey === exactFamilyCanonicalRescue.familyKey) ?? exactFamilyCanonicalRescue;

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
        explanation: buildDecisionExplanation(
          { ...state, rankedFamilies, rankedLeaves },
          selectedFamily,
          selectedFamily.leaves[0] ?? null,
          'an exact family canonical match outranked partial leaf evidence during leaf-first resolution'
        )
      },
      stages: appendStage(state, 'resolve_leaf_first_exact_family_canonical')
    };
  }

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
  const rankedFamilies = reorderedFamilies
    .map((family, index) => ({ ...family, rank: index + 1 }))
    .map((family, index) =>
      applyRecoveredFamilySelectionAuthority(family, index + 1, state.preparedQuery, (f, q) =>
        recoveredFamilySelectionAuthority(f, q, state.leafSpecializationKindsCache)
      )
    );
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
  // Every prior in the profile's rule (primary AND supporting) names a family the curated rule
  // considers plausible for this venue context -- not just the primary. A supporting family that
  // wasn't independently retrieved must still be created here, or the "supporting" half of every
  // profile rule is dead weight that never influences scoring (resolution.md #15 follow-up).
  const venueAwarePriorFamilyIds = new Set(priorList.map((prior) => prior.familyNodeId));
  const hasVenueContext = hasGenericHeadVenueContext(state.preparedQuery.intent.roleTokens, state.preparedQuery.intent.venueTokens);

  if (priorList.length === 0) {
    return {
      ...state,
      stages: appendStage(state, 'skip_generic_head_family_prior')
    };
  }

  if (hasVenueContext) {
    for (const prior of priorList) {
      const familyKey = `family:${prior.familyNodeId}`;

      if (!state.candidateFamilies.has(familyKey)) {
        state.candidateFamilies.set(
          familyKey,
          buildRuntimeFamilyCandidate({
            familyNodeId: prior.familyNodeId,
            familyLabel: prior.familyLabel
          })
        );
      }
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

    const venueOverride = hasVenueContext && venueAwarePriorFamilyIds.has(family.familyNodeId);

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

function hasAuthoritativeAliasEvidence(branchExpansion: OccupationCandidateBranchRetrievalResult): boolean {
  return branchExpansion.candidates.some((candidate) =>
    candidate.evidence.some(
      (evidence) =>
        evidence.channel === 'exact_canonical' || (evidence.channel === 'exact_alias' && evidence.aliasRole === 'canonical_label')
    )
  );
}

function appendStage(state: PipelineState, stage: string): string[] {
  return [...state.stages, stage];
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
): Promise<OccupationCandidateBranchRetrievalOptions | null> {
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

function toPipelineResult(
  attempt: PipelineAttemptResult,
  attempts: PipelineAttemptSummary[],
  localeOverride?: string
): OccupationSearchPipelineResult {
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

function toMultiSpanPipelineResult(
  primaryRetrievalQuery: PreparedOccupationRetrievalQuery,
  retrievalResults: OccupationCandidateBranchRetrievalResult[],
  spanResults: PipelineSpanResult[],
  jobFunction: string | null
): OccupationSearchPipelineResult {
  const branchExpansion = {
    ...retrievalResults[0],
    originalQuery: primaryRetrievalQuery.originalQuery,
    query: primaryRetrievalQuery.query,
    querySpans: primaryRetrievalQuery.querySpans,
    keptQuerySignals: primaryRetrievalQuery.keptQuerySignals,
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
      candidatePoolTrace: spanResults.flatMap((span) => span.debug.candidatePoolTrace),
      familyProfileHits: spanResults.flatMap((span) => span.debug.familyProfileHits),
      leafFirstFamilies: spanResults.flatMap((span) => span.debug.leafFirstFamilies)
    }
  };
}

function summarizeMultiSpanSpanDecision(result: OccupationSearchPipelineResult): PipelineDecision {
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

function mergeMultiSpanRetrievalTimings(retrievalResults: OccupationCandidateBranchRetrievalResult[]): TimingMap {
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
  branchExpansion: OccupationCandidateBranchRetrievalResult,
  scannedCounts: Partial<
    Pick<OccupationSearchPipelineResult['queryContext'], 'scannedAliasHitCount' | 'scannedOpenSearchHitCount' | 'jobFunction' | 'locale'>
  > = {}
): OccupationSearchPipelineResult['queryContext'] {
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

function emptyPreparedQuery(branchExpansion: OccupationCandidateBranchRetrievalResult): PreparedQuery {
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
  const signals = coverageSignals(topLeaf, topFamily, preparedQuery);
  const crossLocaleBackboneSupported =
    topFamily?.evidenceTier === 'cross_locale_backbone' ||
    Boolean(topFamily?.evidence.some((record) => record.channel === 'cross_locale_english_backbone'));
  const crossLocaleFamilyOnly = Boolean(
    crossLocaleBackboneSupported && (decision.decisionType === 'family' || decision.decisionType === 'group')
  );
  const exactCanonicalAvailable = Boolean(
    decision.decisionType === 'leaf' &&
      topLeaf &&
      (hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
        (closeness?.matchedLabelSource === 'canonical' && (closeness.exactNormalizedLabel || closeness.exactFoldedLabel)))
  );
  const closestMatchAvailable = Boolean(topLeaf || topFamily);
  const hasUnrepresentedQueryTerms = Boolean(
    closeness && (closeness.missingUsefulTokens.length > 0 || signals.missingRoleTokens.length > 0)
  );
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
  const sourceName = requireBranchExpansion(state).sourceName;
  const scoredFamilies = Array.from(state.candidateFamilies.values())
    .map((family) => scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.roleClosenessQuery, sourceName))
    .sort(compareFamilies);
  const selectedFamilies = selectFamiliesForRecovery(scoredFamilies, state.preparedQuery, state.topFamilyLimit);
  const rankedFamilies = selectedFamilies.map((family, index) => ({
    ...family,
    rank: index + 1,
    supportingLeafCount: family.supportingLeafIds.size,
    leaves: []
  }));
  const selectedFamilyKeys = new Set(selectedFamilies.map((family) => family.familyKey));

  return {
    ...state,
    rankedFamilies,
    stages: appendStage(state, 'consolidate_families')
  };
}

function selectFamiliesForRecovery(
  scoredFamilies: PipelineFamilyCandidate[],
  preparedQuery: PreparedQuery,
  topFamilyLimit: number
): PipelineFamilyCandidate[] {
  const confidentFamilies = scoredFamilies.filter((family) => family.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE);
  const selectedFamilies = (confidentFamilies.length > 0 ? confidentFamilies : scoredFamilies).slice(0, topFamilyLimit);
  const selectedFamilyKeys = new Set(selectedFamilies.map((family) => family.familyKey));
  const protectedCoverageFamilies = scoredFamilies.filter((family) => hasProtectedRecoveryCoverage(family, preparedQuery));

  if (protectedCoverageFamilies.length > 0) {
    const mergedFamilies = [...selectedFamilies];

    for (const family of protectedCoverageFamilies) {
      if (selectedFamilyKeys.has(family.familyKey)) {
        continue;
      }

      mergedFamilies.push(family);
      selectedFamilyKeys.add(family.familyKey);
    }

    return mergedFamilies.sort(compareFamilies).slice(0, topFamilyLimit);
  }

  if (!preparedQuery.intent.roleHeadRequiresContext || !preparedQuery.intent.roleHeadHasContext) {
    return selectedFamilies;
  }

  const mustKeepFamilyKeys = scoredFamilies.filter((family) => hasPrimaryGenericHeadFamilyPrior(family)).map((family) => family.familyKey);

  if (mustKeepFamilyKeys.length === 0) {
    return selectedFamilies;
  }

  const mergedFamilies = [...selectedFamilies];

  for (const familyKey of mustKeepFamilyKeys) {
    if (selectedFamilyKeys.has(familyKey)) {
      continue;
    }

    const family = scoredFamilies.find((entry) => entry.familyKey === familyKey);

    if (!family) {
      continue;
    }

    const replaceIndex = mergedFamilies.findIndex((entry) => !hasPrimaryGenericHeadFamilyPrior(entry));

    if (replaceIndex < 0) {
      continue;
    }

    mergedFamilies.splice(replaceIndex, 1, family);
    selectedFamilyKeys.add(familyKey);
  }

  return mergedFamilies.sort(compareFamilies).slice(0, topFamilyLimit);
}

function hasProtectedRecoveryCoverage(family: PipelineFamilyCandidate, preparedQuery: PreparedQuery): boolean {
  const familyProfileEvidence = family.evidence.filter(
    (record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact'
  );

  if (familyProfileEvidence.length === 0) {
    return false;
  }

  const requiresDomain = preparedQuery.intent.domainTokens.length > 0;

  return familyProfileEvidence.some((record) => {
    const coverage = numericDetail(record.details.coverage) ?? 0;
    const roleCoverage = numericDetail(record.details.role_coverage) ?? 0;
    const domainCoverage = numericDetail(record.details.domain_coverage) ?? 0;

    if (coverage < 1 || roleCoverage < 1) {
      return false;
    }

    if (requiresDomain && domainCoverage < 1) {
      return false;
    }

    return true;
  });
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
  const aliasesByNodeId = await timed(
    () => loadLeafAliasesFromRecords(hydratedRecoveredRecords, state.preparedQuery.locale),
    'pipeline.family_recovery.load_leaf_aliases',
    state.timings
  );
  const capabilityLabelsByNodeId = await timed(
    () => loadLeafCapabilityLabelsFromRecords(hydratedRecoveredRecords, state.preparedQuery.locale),
    'pipeline.family_recovery.load_capability_labels',
    state.timings
  );
  const lexicalHitsByNodeId = await timed(
    () => retrieveLexicalFamilyHits(state, familyIds, state.occupationRetriever),
    'pipeline.family_recovery.lexical_family_hits',
    state.timings
  );
  const familiesByKey = new Map(state.rankedFamilies.map((family) => [family.familyKey, family]));

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

    state.candidateLeafs.set(record.graphNodeId, {
      graphNodeId: record.graphNodeId,
      canonicalLabel: record.canonicalLabel,
      familyKey,
      familyKind: 'family',
      familyNodeId: record.familyNodeId,
      familyLabel: record.familyLabel,
      genericRisk: record.genericRisk,
      hasHierarchy: record.hasHierarchy,
      hasCapabilitySupport: record.hasCapabilitySupport,
      leafStructure: stateLeafStructure(state, record.graphNodeId),
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
  const authorityRankedFamilies = rankFamiliesForSelectionAuthority(
    narrowedFamilies,
    state.preparedQuery,
    state.leafSpecializationKindsCache
  );
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

function debugBuildLeafFirstFamilyDebugEntriesFromState(state: PipelineState): LeafFirstFamilyDebugEntry[] {
  if (state.candidateLeafs.size === 0) {
    return [];
  }

  const branchExpansion = requireBranchExpansion(state);
  const leavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
  const provisionalFamilies: RankedPipelineFamily[] = Array.from(leavesByFamilyKey.keys())
    .map((familyKey) => state.candidateFamilies.get(familyKey))
    .filter((family): family is PipelineFamilyCandidate => family !== undefined)
    .map((family) =>
      scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.roleClosenessQuery, branchExpansion.sourceName)
    )
    .sort(compareFamilies)
    .map((family, index) => ({
      ...family,
      rank: index + 1,
      supportingLeafCount: family.supportingLeafIds.size,
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
            supportingLeafCount: family.supportingLeafIds.size,
            leaves: []
          },
          leaves: leavesByFamilyKey.get(family.familyKey) ?? [],
          recoveredAliasesByNodeId: state.recoveredAliasesByNodeId,
          recoveredCapabilityLabelsByNodeId: state.recoveredCapabilityLabelsByNodeId
        })
        .leaves.map((leaf, leafIndex) => ({ ...leaf, rank: leafIndex + 1 }))
    }));

  return provisionalFamilies.map((family) => {
    const selectableLeaf = firstSelectableLeafInFamily(
      family,
      state.preparedQuery,
      provisionalFamilies,
      state.leafSpecializationKindsCache,
      branchExpansion.originalQuery
    );
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

function debugBuildFamilyCandidatePoolTraceEntries(state: PipelineState): CandidatePoolTraceEntry[] {
  const sourceName = requireBranchExpansion(state).sourceName;
  const scoredFamilies = Array.from(state.candidateFamilies.values())
    .map((family) => scoreFamilyCandidate(family, state.candidateLeafs, state.preparedQuery, state.roleClosenessQuery, sourceName))
    .sort(compareFamilies);
  const selectedFamilyKeys = new Set(state.rankedFamilies.map((family) => family.familyKey));

  return scoredFamilies.map((family, index) => ({
    poolKind: 'family' as const,
    identifier: family.familyNodeId,
    label: family.familyLabel,
    rankBeforeTruncation: index + 1,
    survived: selectedFamilyKeys.has(family.familyKey),
    discardReason: selectedFamilyKeys.has(family.familyKey) ? null : 'below_top_family_limit'
  }));
}

function debugBuildLeafCandidatePoolTraceEntries(state: PipelineState): CandidatePoolTraceEntry[] {
  const branchExpansion = requireBranchExpansion(state);
  const candidateLeavesByFamilyKey = groupCandidateLeavesByFamilyKey(state.candidateLeafs);
  const entries: CandidatePoolTraceEntry[] = [];

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

function countCandidateLeavesByFamilyKey(candidateLeafs: Map<number, PipelineLeafCandidate>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const leaf of candidateLeafs.values()) {
    counts.set(leaf.familyKey, (counts.get(leaf.familyKey) ?? 0) + 1);
  }

  return counts;
}

function familyProfileHitFromEvidenceRecord(record: PipelineEvidenceRecord): FamilyProfileHit | null {
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
    matchedSources: stringArrayDetail(record.details.matched_sources) as FamilyProfileHit['matchedSources'],
    matchingLeafIds: numberArrayDetail(record.details.matching_leaf_ids),
    matchingLeafCount: numericDetail(record.details.matching_leaf_count) ?? 0,
    profileLeafCount: numericDetail(record.details.profile_leaf_count) ?? 0
  };
}

function familyProfileHitKey(hit: FamilyProfileHit): string {
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
function loadLeafAliasesFromRecords(records: RuntimeSearchMetaRecord[], locale: string): Map<number, string[]> {
  const aliasesByNodeId = new Map<number, string[]>();

  for (const record of records) {
    const existingAliases = aliasesByNodeId.get(record.graphNodeId) ?? [];
    const recordAliases = leafEvidenceAliasLabels(record.aliases, locale, true);

    aliasesByNodeId.set(record.graphNodeId, Array.from(new Set([...existingAliases, ...recordAliases])));
  }

  return aliasesByNodeId;
}

function loadLeafCapabilityLabelsFromRecords(records: RuntimeSearchMetaRecord[], locale: string): Map<number, string[]> {
  const labelsByNodeId = new Map<number, string[]>();

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

  const topSelectableLeaf = topFamily
    ? firstSelectableLeafInFamily(
        topFamily,
        state.preparedQuery,
        state.rankedFamilies,
        state.leafSpecializationKindsCache,
        branchExpansion.originalQuery
      )
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

  const exactLeafCanonicalOrAliasFullStringCandidate =
    rankedLeaves
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
      .filter(
        (leaf) =>
          hasRawQueryFullStringExactCanonical(leaf, preparedQuery, exactQueryText) ||
          hasRawQueryCanonicalVariantPhraseMatch(leaf, preparedQuery) ||
          !exactLeafRescueHasBroadSharedAliasRisk(leaf, rankedLeaves, preparedQuery, exactQueryText)
      )
      .sort(
        (left, right) =>
          compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText) ||
          Number(hasRawQueryCanonicalVariantPhraseMatch(right, preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left, preparedQuery))
      )[0] ?? null;

  const exactLeafAuthorityCandidate =
    exactLeafCanonicalOrAliasFullStringCandidate ??
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
      .filter(
        (leaf) =>
          hasRawQueryExactCanonical(leaf, preparedQuery) ||
          !exactLeafRescueHasBroadSharedAliasRisk(leaf, rankedLeaves, preparedQuery, exactQueryText)
      )
      .sort(
        (left, right) =>
          Number(hasRawQueryCanonicalVariantPhraseMatch(right, preparedQuery)) -
            Number(hasRawQueryCanonicalVariantPhraseMatch(left, preparedQuery)) ||
          compareLeavesForPreparedQuery(left, right, preparedQuery, exactQueryText)
      )[0] ??
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

function policyControlledIsLeafFullySelectable(
  leaf: RankedPipelineLeaf,
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[],
  specializationKindsCache: Map<number, LeafSpecializationKind[]>,
  exactQueryText: string = preparedQuery.raw
): boolean {
  return (
    passesLeafSelectionBasePolicy(leaf, family, preparedQuery, rankedFamilies) &&
    !hasAmbiguousAliasLeafTie(leaf, family) &&
    !hasUnsafeSpecializedLeafTie(leaf, family, preparedQuery, specializationKindsCache, exactQueryText) &&
    !hasInsufficientLeafSeparation(leaf, family, preparedQuery)
  );
}

export function firstSelectableLeafInFamily(
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  rankedFamilies: RankedPipelineFamily[],
  specializationKindsCache: Map<number, LeafSpecializationKind[]>,
  exactQueryText: string = preparedQuery.raw
): RankedPipelineLeaf | null {
  return (
    family.leaves.find((leaf) =>
      policyControlledIsLeafFullySelectable(leaf, family, preparedQuery, rankedFamilies, specializationKindsCache, exactQueryText)
    ) ?? null
  );
}

function buildBranchFamilyCandidate(
  branch: OccupationCandidateBranch,
  branchShare: number,
  branchMarginRatio: number | null
): PipelineFamilyCandidate {
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

function addFamilyProfileEvidence(family: PipelineFamilyCandidate, hit: FamilyProfileHit): void {
  const evidence = familyProfileEvidence(hit);
  const alreadyAdded = family.evidence.some(
    (record) => record.channel === evidence.channel && record.details.family_node_id === evidence.details.family_node_id
  );

  if (!alreadyAdded) {
    family.evidence.push(evidence);
  }
}

function buildRuntimeFamilyCandidate(input: { familyNodeId: number; familyLabel: string }): PipelineFamilyCandidate {
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

function buildLeafCandidate(
  state: PipelineState,
  branch: OccupationCandidateBranch,
  candidate: ExpandedOccupationCandidate
): PipelineLeafCandidate {
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

function familyProfileEvidenceChannel(hit: FamilyProfileHit): PipelineEvidenceChannel {
  if (hit.exactFamilyLabelPhrase) {
    return 'exact_family_canonical';
  }

  if (hit.usefulFamilyLabelPhrase) {
    return 'useful_exact';
  }

  return 'family_profile';
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

function hasPrimaryGenericHeadFamilyPrior(family: PipelineFamilyCandidate): boolean {
  return family.evidence.some(
    (record) =>
      record.channel === 'generic_head_family_prior' &&
      typeof record.details.prior_strength === 'string' &&
      record.details.prior_strength === 'primary'
  );
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
  roleClosenessQuery: LeafClosenessQuery,
  sourceName: string
): PipelineFamilyCandidate {
  const evidenceTier = familyEvidenceTier(family.evidence);
  const supportingLeafs = Array.from(family.supportingLeafIds)
    .map((leafId) => leafsById.get(leafId))
    .filter((leaf): leaf is PipelineLeafCandidate => leaf !== undefined);
  const leafFitScore = maxLeafFitScore(supportingLeafs, roleClosenessQuery);
  const roleCoverage = familyRoleCoverageScore(family.evidence, preparedQuery);
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
    'useful_exact',
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
  // #1: capability-text contradiction. Mined from each leaf's real ESCO skill/knowledge text (not title/alias
  // text), so unlike raw lexical overlap it reflects what the family's occupations actually *do* -- a family
  // whose capability vocabulary doesn't cover the query's content tokens at all is a genuine signal, not a
  // side effect of a curated prior doing the disambiguation work instead of lexical overlap.
  const capabilityRelevanceContradiction = familyCapabilityRelevanceContradictionPenalty(family.familyNodeId, preparedQuery, sourceName);
  // #2: token-relevance tiebreaker. Deliberately tiny -- only meant to nudge apart two families that are
  // already close on every other signal, never to overturn a real evidence-based gap.
  const tokenRelevanceTiebreak = familyTokenRelevanceTiebreakScore(family.familyNodeId, preparedQuery, sourceName);
  const exactOccupationScore = Math.max(exactCanonicalScore, exactAliasScore);
  const exactOccupationContribution =
    exactOccupationScore *
    (FAMILY_SCORING_POLICY.EXACT_ALIAS_BASE_CONTRIBUTION + leafFitScore * FAMILY_SCORING_POLICY.EXACT_ALIAS_LEAF_FIT_WEIGHT);
  const authorityFloor = familyEvidenceAuthorityFloor(family.evidence, preparedQuery);
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
        genericPenalty * FAMILY_SCORING_POLICY.GENERIC_PENALTY_WEIGHT -
        capabilityRelevanceContradiction * FAMILY_SCORING_POLICY.CAPABILITY_RELEVANCE_CONTRADICTION_PENALTY_WEIGHT +
        tokenRelevanceTiebreak * FAMILY_SCORING_POLICY.TOKEN_RELEVANCE_TIEBREAK_WEIGHT
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

function familyRoleCoverageScore(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  if (
    preparedQuery.intent.roleTokens.length >= 2 &&
    preparedQuery.intent.domainTokens.length === 0 &&
    preparedQuery.intent.venueTokens.length === 0 &&
    !preparedQuery.commonRolePhraseMatch
  ) {
    return maxFullRoleTokenEvidenceCoverage(evidence, preparedQuery);
  }

  return maxIntentRoleEvidenceCoverage(evidence, preparedQuery);
}

function maxLeafFitScore(leafs: PipelineLeafCandidate[], roleClosenessQuery: LeafClosenessQuery): number {
  if (leafs.length === 0) {
    return 0;
  }

  return Math.max(
    ...leafs.map(
      (leaf) =>
        LEAF_CLOSENESS_RANKER.rank({
          query: roleClosenessQuery,
          canonicalLabel: leaf.canonicalLabel,
          aliases: matchedAliasLabels(leaf.evidence)
        }).score
    )
  );
}

function familyEvidenceAuthorityFloor(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  if (hasEvidenceChannel(evidence, 'exact_family_canonical')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  if (hasEvidenceChannel(evidence, 'useful_exact')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  if (preparedQuery.modifierTokens.length === 0) {
    return 0;
  }

  const usefulQuery = preparedQuery.usefulFoldedRecallTokens.join(' ');

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

function leafEvidenceWithUsefulExact(leaf: PipelineLeafCandidate, usefulExactLabel: boolean): PipelineEvidenceRecord[] {
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

function leafHasUsefulExactLabel(closeness: LeafClosenessRank): boolean {
  if (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) {
    return false;
  }

  if (closeness.usefulQueryCoverage < 1 || closeness.missingUsefulTokens.length > 0) {
    return false;
  }

  return closeness.extraTitleTokens.length > 0 && closeness.extraGenericModifierCount === closeness.extraTitleTokens.length;
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

function passesLeafSelectionBasePolicy(
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

  if (preparedQuery.usefulFoldedRecallTokens.length === 1) {
    return true;
  }

  // A bare single-generic-head query (e.g. "technician", "assistant") has its only token classified
  // as generic, so it never becomes a "useful" folded token above -- without this branch the broad-role
  // guard would never activate for exactly the case it exists to protect (resolution.md #16), letting
  // the pipeline manufacture a specific leaf out of a single generic word.
  return preparedQuery.usefulFoldedRecallTokens.length === 0 && preparedQuery.genericTokens.length === 1;
}

function hasBroadRoleLeafAuthority(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
  const queryTokenCount = preparedQuery.usefulFoldedRecallTokens.length;

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

function exactLeafRescueHasBroadSharedAliasRisk(
  topLeaf: RankedPipelineLeaf,
  rankedLeaves: RankedPipelineLeaf[],
  preparedQuery: PreparedQuery,
  exactQueryText: string
): boolean {
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

function exactLeafRescueComparableAliasKey(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): string {
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

    if (
      normalizedAlias === preparedQuery.normalized ||
      normalizedAlias === rawNormalized ||
      foldedAlias === preparedQuery.folded ||
      foldedAlias === rawFolded
    ) {
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
function hasInsufficientLeafSeparation(topLeaf: RankedPipelineLeaf, family: RankedPipelineFamily, preparedQuery: PreparedQuery): boolean {
  if (
    hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
    hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
    hasRawQueryExactLeafAlias(topLeaf, preparedQuery) ||
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

function hasUnsafeSpecializedLeafTie(
  topLeaf: RankedPipelineLeaf,
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>,
  exactQueryText: string = preparedQuery.raw
): boolean {
  if (
    hasRawQueryExactCanonical(topLeaf, preparedQuery) ||
    hasRawQueryFullStringExactCanonical(topLeaf, preparedQuery, exactQueryText) ||
    hasRawQueryPrimaryExactAlias(topLeaf, preparedQuery) ||
    hasRawQueryExactLeafAlias(topLeaf, preparedQuery) ||
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
        leafStructuralPreferenceScore(leaf, preparedQuery, specializationKindsCache) >=
          leafStructuralPreferenceScore(topLeaf, preparedQuery, specializationKindsCache)
    );
}

function hasRawQueryExactCanonical(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
  const rawFolded = foldSearchText(rawNormalized);

  return (
    leaf.evidence.some((record) => record.channel === 'exact_canonical') ||
    foldSearchText(leaf.canonicalLabel) === preparedQuery.folded ||
    foldSearchText(leaf.canonicalLabel) === rawFolded
  );
}

function hasRawQueryFullStringExactCanonical(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  exactQueryText: string = preparedQuery.raw
): boolean {
  return (
    foldSearchText(leaf.canonicalLabel) === foldSearchText(exactQueryText) ||
    foldWeakPunctuationLookupText(leaf.canonicalLabel) === foldWeakPunctuationLookupText(exactQueryText)
  );
}

function isRawExactMatch(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return hasRawQueryExactCanonical(leaf, preparedQuery) || hasRawQueryPrimaryExactAlias(leaf, preparedQuery);
}

function hasRawQueryExactCanonicalOrExactAlias(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  return hasRawQueryExactCanonical(leaf, preparedQuery) || hasRawQueryPrimaryExactAlias(leaf, preparedQuery, ['exact_alias']);
}

function hasRawQueryCanonicalVariantPhraseMatch(leaf: RankedPipelineLeaf, preparedQuery: PreparedQuery): boolean {
  const queryTokens = preparedQuery.usefulFoldedRecallTokens;
  const canonicalTokens = tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel));

  if (queryTokens.length === 0 || canonicalTokens.length === 0 || queryTokens.length !== canonicalTokens.length) {
    return false;
  }

  return queryTokens.every((queryToken, index) =>
    tokenMatchesLocaleVariant(queryToken, new Set([canonicalTokens[index] ?? '']), normalizeQueryLocale(preparedQuery.locale))
  );
}

function hasRawQueryExactLeafAlias(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
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
      return (
        normalizedAlias === preparedQuery.normalized ||
        normalizedAlias === rawNormalized ||
        (record.channel === 'exact_alias' && foldedAliasMatchesPreparedQueryVariant(normalizedAlias, preparedQuery))
      );
    }

    const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';
    return (
      foldedAlias === preparedQuery.folded ||
      foldedAlias === rawFolded ||
      (record.channel === 'exact_alias' && foldedAliasMatchesPreparedQueryVariant(foldedAlias, preparedQuery))
    );
  });
}

function hasKnownRolePhraseAliasInQueryRescue(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  roleSpanSelection: OccupationRoleSpanSelection | null
): boolean {
  const selectedSpan = roleSpanSelection?.selectedSpan;

  if (!selectedSpan || selectedSpan.longestPhraseLength < 2 || preparedQuery.intent.roleTokens.length < 2) {
    return false;
  }

  const exactEmbeddedPhraseCandidates = (roleSpanSelection?.candidates ?? []).filter(
    (candidate) =>
      candidate.exactPhraseKnown &&
      candidate.tokenCount >= 2 &&
      candidate.tokenCount >= selectedSpan.longestPhraseLength &&
      candidate.tokenCount < selectedSpan.tokenCount
  );

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

function hasRawQueryPrimaryExactAlias(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  channels: PipelineEvidenceChannel[] = ['exact_alias', 'folded_alias']
): boolean {
  const rawNormalized = normalizeSearchSurfaceText(preparedQuery.raw);
  const rawFolded = foldSearchText(rawNormalized);
  const channelSet = new Set<PipelineEvidenceChannel>(channels);

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

    return (
      normalizedAlias === preparedQuery.normalized ||
      normalizedAlias === rawNormalized ||
      foldedAlias === preparedQuery.folded ||
      foldedAlias === rawFolded ||
      (record.channel === 'exact_alias' &&
        (foldedAliasMatchesPreparedQueryVariant(normalizedAlias, preparedQuery) ||
          foldedAliasMatchesPreparedQueryVariant(foldedAlias, preparedQuery)))
    );
  });
}

function foldedAliasMatchesPreparedQueryVariant(alias: string, preparedQuery: PreparedQuery): boolean {
  const aliasTokens = tokenizeNormalizedText(foldSearchText(alias));

  if (aliasTokens.length === 0 || aliasTokens.length !== preparedQuery.foldedTokens.length) {
    return false;
  }

  const locale = normalizeQueryLocale(preparedQuery.locale);

  return preparedQuery.foldedTokens.every((queryToken, index) =>
    tokenMatchesLocaleVariant(queryToken, new Set([aliasTokens[index] ?? '']), locale)
  );
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
      ...preparedQuery.usefulFoldedRecallTokens,
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

function rankFamiliesForSelectionAuthority(
  families: RankedPipelineFamily[],
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): RankedPipelineFamily[] {
  const recoverAuthority = (family: RankedPipelineFamily, query: PreparedQuery) =>
    recoveredFamilySelectionAuthority(family, query, specializationKindsCache);
  const authorityRankedFamilies = families
    .slice()
    .sort((left, right) => compareRecoveredFamilySelectionAuthority(left, right, preparedQuery, recoverAuthority) || left.rank - right.rank)
    .map((family, index) => applyRecoveredFamilySelectionAuthority(family, index + 1, preparedQuery, recoverAuthority));
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

export function recoveredFamilySelectionAuthority(
  family: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): RecoveredFamilySelectionAuthority {
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
      leafStructuralPreferenceScore(leaf, preparedQuery, specializationKindsCache)
    ),
    structuralAlignment: maxOf(family.leaves.filter(hasGenuineLeafEvidence), (leaf) =>
      leafStructuralAlignmentScore(leaf, preparedQuery, specializationKindsCache)
    ),
    familySpecializationMismatch: familySpecializationMismatchPenalty(family.familyNodeId, preparedQuery),
    supportedSpecializationLeafCount: Math.min(
      family.leaves.filter((leaf) => leafHasSupportedStructuralSpecialization(leaf, preparedQuery, specializationKindsCache)).length,
      5
    ),
    profileFamilyLabelCoverage: maxFamilyProfileFamilyLabelCoverage(family.evidence),
    profileRoleCoverage: maxFamilyProfileRoleCoverage(family.evidence),
    confidence: family.confidence,
    branchShare: family.branchShare
  };
}

function primaryExactAliasLeafCount(family: RankedPipelineFamily, preparedQuery: PreparedQuery): number {
  return Math.min(family.leaves.filter((leaf) => hasRawQueryPrimaryExactAlias(leaf, preparedQuery)).length, 5);
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

function familyCapabilityRelevanceContradictionPenalty(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  const matchedTokens = preparedQuery.usefulFoldedRecallTokens;

  if (matchedTokens.length === 0) {
    return 0;
  }

  const lookup = tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName);

  if (!lookup) {
    return 0;
  }

  const agreement = familyCapabilityRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, matchedTokens);

  return clampScore(1 - agreement);
}

function familyTokenRelevanceTiebreakScore(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  const matchedTokens = preparedQuery.usefulFoldedRecallTokens;

  if (matchedTokens.length === 0) {
    return 0;
  }

  const lookup = tryLoadOccupationFamilyTokenRelevanceLookup(sourceName);

  if (!lookup) {
    return 0;
  }

  return familyTokenRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, matchedTokens);
}

function familySpecializationMismatchPenalty(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const specializationTerms = family?.specializationTerms;

  if (!specializationTerms || specializationTerms.length === 0) {
    return 0;
  }

  const queryTokens = new Set([...preparedQuery.usefulFoldedRecallTokens, ...preparedQuery.capabilityVerbFoldedAdditionTokens]);
  const queryMentionsSpecialization = specializationTerms.some((term) => queryTokens.has(term));

  return queryMentionsSpecialization ? 0 : 1;
}

export function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number {
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
  if (preparedQuery.usefulFoldedRecallTokens.length === 0) {
    return true;
  }

  return preparedQuery.usefulFoldedRecallTokens.every((token) => tokenListHasEquivalent(matchedRoleTokens, token));
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
    ...evidence
      .filter(
        (record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact'
      )
      .map((record) => numericDetail(record.details.role_coverage) ?? 0),
    0
  );
}

function maxFamilyProfileFamilyLabelCoverage(evidence: PipelineEvidenceRecord[]): number {
  return Math.max(
    ...evidence
      .filter(
        (record) =>
          (record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact') &&
          stringArrayDetail(record.details.matched_sources).includes('family_label')
      )
      .map((record) => numericDetail(record.details.role_coverage) ?? 0),
    0
  );
}

function compareBroadRoleFamilies(left: RankedPipelineFamily, right: RankedPipelineFamily): number {
  const leftAuthority = broadRoleFamilyAuthority(left);
  const rightAuthority = broadRoleFamilyAuthority(right);

  return (
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    left.evidenceTierRank - right.evidenceTierRank ||
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
    (record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact'
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

  if (hasEvidenceChannel(evidence, 'useful_exact')) {
    return 'useful_exact';
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

  if (hasCoveredNgramAliasEvidenceChannel(evidence)) {
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

function hasEvidenceChannel(evidence: PipelineEvidenceRecord[], channel: PipelineEvidenceChannel): boolean {
  return evidence.some((record) => record.channel === channel);
}

// A canonical-label/locale-primary ngram_alias record exists for every family as a self-match, even at
// zero query coverage -- so presence alone can't distinguish real phrase evidence from that self-match
// floor (see leaf-selection-evidence-ranker.ts for the same fix at the leaf tier). Require the query
// side to actually have matched something.
function hasCoveredNgramAliasEvidenceChannel(evidence: PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'ngram_alias') {
      return false;
    }

    const coverage = record.details.query_useful_token_coverage;
    return typeof coverage === 'number' && coverage > 0;
  });
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

  const fullRoleCoverageDiff = canonicalUsefulCoverage(right, preparedQuery) - canonicalUsefulCoverage(left, preparedQuery);

  if (
    preparedQuery.intent.roleTokens.length >= 2 &&
    preparedQuery.intent.domainTokens.length === 0 &&
    preparedQuery.intent.venueTokens.length === 0 &&
    fullRoleCoverageDiff !== 0
  ) {
    return fullRoleCoverageDiff;
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

// specializationKindsCache defaults to a fresh, unshared Map for the few callers (the leaf-ordering
// comparator chain below) that don't have a per-pipeline-run cache in scope -- those already run
// comparisons ad hoc, so an unshared cache is no worse than before this cache existed. Callers that
// do have the shared PipelineState cache (family selection authority, leaf-selection safety net)
// must pass it explicitly so the derivation is actually shared.
function leafStructuralPreferenceScore(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]> = new Map()
): number {
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
function leafStructuralAlignmentScore(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): number {
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

function isSingleHeadOrBroadRoleQuery(preparedQuery: PreparedQuery): boolean {
  return preparedQuery.usefulFoldedRecallTokens.length <= 1 || isBroadRoleQuery(preparedQuery);
}

function leafHasSupportedStructuralSpecialization(
  leaf: PipelineLeafCandidate,
  preparedQuery: PreparedQuery,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): boolean {
  const structure = leaf.leafStructure;

  if (!structure) {
    return false;
  }

  const specializationKinds = resolveLeafSpecializationKinds(specializationKindsCache, leaf.graphNodeId, structure, leaf.canonicalLabel);

  return specializationKinds.some((kind) => preparedQuerySupportsSpecializationKind(preparedQuery, kind));
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
  const usefulFoldedRecallTokens = preparedQuery.usefulFoldedRecallTokens;

  if (usefulFoldedRecallTokens.length === 0) {
    return 0;
  }

  const matchedCount = usefulFoldedRecallTokens.filter((token) => tokenMatchesLabelTokens(token, canonicalTokens)).length;
  const coverage = matchedCount / usefulFoldedRecallTokens.length;

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
  return (
    preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedRecallTokens.join(' ').trim() || preparedQuery.normalized
  );
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

function numberArrayDetail(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
}

function stringDetail(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function requireBranchExpansion(state: PipelineState): OccupationCandidateBranchRetrievalResult {
  if (!state.branchExpansion) {
    throw new Error('Pipeline branch expansion is missing.');
  }

  return state.branchExpansion;
}

function stageForChannel(channel: PipelineEvidenceChannel): string {
  if (channel === 'graph_family_recovery') {
    return 'family_constrained_recovery';
  }

  if (
    channel === 'exact_canonical' ||
    channel === 'exact_alias' ||
    channel === 'useful_exact' ||
    channel === 'folded_alias' ||
    channel === 'ngram_alias'
  ) {
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
