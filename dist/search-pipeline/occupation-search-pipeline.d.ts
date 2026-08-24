import { type PreparedQuery } from '../query/query-preparation.js';
import type { OccupationRoleSpanSelection } from '../query/occupation-role-span-selector.js';
import { OccupationCandidateBranchRetriever, type OccupationCandidateBranchRetrievalResult } from '../retrieval/occupation-candidate-branches.js';
import { type RetrievalChannel } from '../retrieval/occupation-candidates.js';
import type { OccupationRetrievalEngine, OccupationTextRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { type LeafClosenessQuery, type LeafClosenessRank } from './ranking/leaf-closeness-ranker.js';
import { type RecoveredFamilySelectionAuthority } from '../cli/rank-family-core.js';
import type { FamilyScopedLeafFit } from './ranking/family-scoped-leaf-ranker.js';
import { type LeafSelectionEvidence, type LeafSelectionEvidenceTier } from './ranking/leaf-selection-evidence-ranker.js';
import type { CapabilityFit } from './ranking/capability-fit-ranker.js';
import { type FamilyProfileHit } from './family-profile-retriever.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { OccupationLeafStructureRecord, LeafSpecializationKind } from '../runtime/occupation-leaf-structure-contract.js';
import { type TimingMap } from '../utils/timing.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import type { RetrievalBoundaryDebugCollector } from '../debug/retrieval-boundary-debug.js';
export type PipelineEvidenceChannel = RetrievalChannel | 'exact_family_canonical' | 'useful_exact' | 'cross_locale_english_backbone' | 'job_function_family_prior' | 'generic_head_family_prior' | 'reviewed_family_signal' | 'reviewed_family_penalty' | 'family_profile' | 'graph_support' | 'graph_family_recovery';
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
export type FamilyEvidenceTier = 'local_exact' | 'useful_exact' | 'cross_locale_backbone' | 'folded_alias' | 'family_profile' | 'strong_phrase' | 'graph_only';
export type PipelineDecision = {
    decisionType: 'leaf' | 'family' | 'group' | 'multi_span' | 'unresolved';
    selectedNodeId: number | null;
    selectedLabel: string | null;
    confidence: number;
    reason: string;
    explanation: PipelineDecisionExplanation;
};
export type PipelineDecisionExplanation = {
    query: string;
    normalizedQuery: string;
    roleTokens: string[];
    roleHeadTokens: string[];
    genericTokens: string[];
    candidateFamily: {
        label: string;
        evidenceTier: FamilyEvidenceTier | null;
        confidence: number;
    } | null;
    candidateLeaf: {
        label: string;
        evidenceTier: LeafSelectionEvidenceTier | null;
        confidence: number;
        roleCompatibility: RoleCompatibility;
        specializationSupport: LeafSpecializationSupport;
    } | null;
    rejectedCompetitors: Array<{
        label: string;
        kind: 'family' | 'leaf';
        reason: string;
    }>;
    finalDecisionGate: string;
};
export type PipelineCoverageStatus = {
    status: 'exact_canonical_match' | 'closest_available_match' | 'likely_dictionary_gap' | 'locale_gap' | 'english_backbone_supported' | 'cross_locale_family_only' | 'multi_span' | 'insufficient_evidence';
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
declare const ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY: PipelineLeafRankingStrategy;
export { ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY };
export declare class OccupationSearchPipeline {
    private readonly candidateBranchRetriever;
    private readonly occupationRetriever;
    private readonly leafStructureArtifact;
    private readonly leafRankingStrategy;
    constructor(candidateBranchRetriever?: OccupationCandidateBranchRetriever, occupationRetriever?: OccupationTextRetrievalEngine, leafStructureArtifact?: OccupationLeafStructureArtifact | null, leafRankingStrategy?: PipelineLeafRankingStrategy);
    static withEngine(engine: OccupationRetrievalEngine): OccupationSearchPipeline;
    static withRuntime(runtime: OccupationRuntimeContext): OccupationSearchPipeline;
    withLeafRankingStrategy(leafRankingStrategy: PipelineLeafRankingStrategy): OccupationSearchPipeline;
    run(options: OccupationSearchPipelineOptions): Promise<OccupationSearchPipelineResult>;
}
export declare function isFamilyProfileRetrievalEnabled(): boolean;
export declare function firstSelectableLeafInFamily(family: RankedPipelineFamily, preparedQuery: PreparedQuery, rankedFamilies: RankedPipelineFamily[], specializationKindsCache: Map<number, LeafSpecializationKind[]>, exactQueryText?: string): RankedPipelineLeaf | null;
export declare function recoveredFamilySelectionAuthority(family: RankedPipelineFamily, preparedQuery: PreparedQuery, specializationKindsCache: Map<number, LeafSpecializationKind[]>): RecoveredFamilySelectionAuthority;
export declare function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number;
export type LeafSpecializationSupport = 'supported' | 'neutral' | 'unsupported';
export type RoleCompatibility = 'compatible' | 'weakly_compatible' | 'unknown' | 'incompatible';
