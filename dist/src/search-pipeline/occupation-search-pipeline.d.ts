import { type PreparedQuery } from '../query/query-preparation.js';
import type { OccupationRoleSpanSelection } from '../query/occupation-role-span-selector.js';
import { OccupationCandidateBranchRetriever, type OccupationCandidateBranchRetrievalResult } from '../retrieval/occupation-candidate-branches.js';
import type { OccupationRetrievalEngine, OccupationTextRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { type LeafClosenessQuery } from './ranking/leaf-closeness-ranker.js';
import { type FamilyEvidenceTier, type PipelineFamilyCandidate, type PipelineLeafCandidate, type RankedPipelineFamily, type RankedPipelineLeaf, type RecoveredFamilySelectionAuthority } from '../cli/rank-family-core.js';
import { type LeafSelectionEvidenceTier } from './ranking/leaf-selection-evidence-ranker.js';
import { type FamilyProfileHit } from './family-profile-retriever.js';
import { type SearchMetaArtifactCacheEntry } from '../runtime/occupation-search-meta-artifact.js';
import { type FamilyProfileArtifactCacheEntry } from '../runtime/occupation-family-profile-artifact.js';
import type { OccupationFamilyTokenRelevanceArtifactCacheEntry } from '../runtime/occupation-family-token-relevance-artifact.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { LeafSpecializationKind } from '../runtime/occupation-leaf-structure-contract.js';
import { type TimingMap } from '../utils/timing.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import type { RetrievalBoundaryDebugCollector } from '../debug/retrieval-boundary-debug.js';
export type { FamilyEvidenceTier, PipelineEvidenceChannel, PipelineEvidenceRecord, PipelineFamilyCandidate, PipelineLeafCandidate, RankedPipelineFamily, RankedPipelineLeaf } from '../cli/rank-family-core.js';
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
    debug?: boolean | 'family-rank-output';
    debugFamilyRankComparisonStrategies?: readonly NamedFamilyRankingStrategy[] | null;
    disabledCommonRolePhraseRoleKeys?: readonly string[];
};
export type NamedFamilyRankingStrategy = {
    name: FamilyRankComparisonEntry['strategy'];
    strategy: PipelineFamilyRankingStrategy;
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
export type FamilyRankComparisonEntry = {
    strategy: 'evidence' | 'top2-v4' | 'core-2';
    familyKey: string;
    familyNodeId: number;
    familyLabel: string;
    rank: number;
    confidence: number;
    survived: boolean;
};
export type FamilyStructureDebugEntry = {
    familyKey: string;
    familyNodeId: number;
    familyLabel: string;
    rank: number;
    structuralSupport: number;
    structuralContradiction: number;
    structuralRejected: boolean;
    rawStructuralScore: number;
    alignedDimensions: string[];
    contradictedDimensions: string[];
    rejectionReasons: string[];
};
export type PipelineDebugInfo = {
    stages: string[];
    attempts: PipelineAttemptSummary[];
    timings: TimingMap;
    rawBranchExpansion: OccupationCandidateBranchRetrievalResult | null;
    candidatePoolTrace: CandidatePoolTraceEntry[];
    familyProfileHits: FamilyProfileHit[];
    leafFirstFamilies: LeafFirstFamilyDebugEntry[];
    familyRankComparison: FamilyRankComparisonEntry[];
    familyStructure: FamilyStructureDebugEntry[];
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
        familyRankComparison: PipelineDebugInfo['familyRankComparison'];
        familyStructure: PipelineDebugInfo['familyStructure'];
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
        familyRankComparison: PipelineDebugInfo['familyRankComparison'];
        familyStructure: PipelineDebugInfo['familyStructure'];
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
export interface PipelineFamilyRankingStrategy {
    rankForRecovery(preparedQuery: PreparedQuery, sourceName: string, topFamilyLimit: number, candidateFamilies: readonly PipelineFamilyCandidate[], candidateLeafsByFamilyKey: ReadonlyMap<string, readonly PipelineLeafCandidate[]>, jobFunction?: string | null): RankedPipelineFamily[];
    rankForSelection(preparedQuery: PreparedQuery, families: RankedPipelineFamily[], recoverAuthority: (family: RankedPipelineFamily, preparedQuery: PreparedQuery) => RecoveredFamilySelectionAuthority, isBroadRoleQuery: (preparedQuery: PreparedQuery) => boolean, compareBroadRoleFamilies: (left: RankedPipelineFamily, right: RankedPipelineFamily) => number): RankedPipelineFamily[];
}
export type Top2V4PipelineFamilyRankingStrategyArtifacts = {
    familyProfileArtifact: FamilyProfileArtifactCacheEntry;
    searchMetaArtifact: SearchMetaArtifactCacheEntry;
    leafStructureArtifact: OccupationLeafStructureArtifact;
    familyTokenRelevanceArtifact: OccupationFamilyTokenRelevanceArtifactCacheEntry;
};
export declare function createTop2V4PipelineFamilyRankingStrategy(artifacts: Top2V4PipelineFamilyRankingStrategyArtifacts): PipelineFamilyRankingStrategy;
export declare const CORE2_PIPELINE_FAMILY_RANKING_STRATEGY: PipelineFamilyRankingStrategy;
declare const ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY: PipelineLeafRankingStrategy;
export { ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY };
export declare class OccupationSearchPipeline {
    private readonly candidateBranchRetriever;
    private readonly occupationRetriever;
    private readonly leafStructureArtifact;
    private readonly leafRankingStrategy;
    private readonly familyRankingStrategy;
    constructor(candidateBranchRetriever?: OccupationCandidateBranchRetriever, occupationRetriever?: OccupationTextRetrievalEngine, leafStructureArtifact?: OccupationLeafStructureArtifact | null, leafRankingStrategy?: PipelineLeafRankingStrategy, familyRankingStrategy?: PipelineFamilyRankingStrategy);
    static withEngine(engine: OccupationRetrievalEngine): OccupationSearchPipeline;
    static withRuntime(runtime: OccupationRuntimeContext): OccupationSearchPipeline;
    withLeafRankingStrategy(leafRankingStrategy: PipelineLeafRankingStrategy): OccupationSearchPipeline;
    withFamilyRankingStrategy(familyRankingStrategy: PipelineFamilyRankingStrategy): OccupationSearchPipeline;
    run(options: OccupationSearchPipelineOptions): Promise<OccupationSearchPipelineResult>;
}
export declare function isFamilyProfileRetrievalEnabled(): boolean;
export declare function firstSelectableLeafInFamily(family: RankedPipelineFamily, preparedQuery: PreparedQuery, rankedFamilies: RankedPipelineFamily[], specializationKindsCache: Map<number, LeafSpecializationKind[]>, exactQueryText?: string): RankedPipelineLeaf | null;
export declare function recoveredFamilySelectionAuthority(family: RankedPipelineFamily, preparedQuery: PreparedQuery, specializationKindsCache: Map<number, LeafSpecializationKind[]>): RecoveredFamilySelectionAuthority;
export type LeafSpecializationSupport = 'supported' | 'neutral' | 'unsupported';
export type RoleCompatibility = 'compatible' | 'weakly_compatible' | 'unknown' | 'incompatible';
