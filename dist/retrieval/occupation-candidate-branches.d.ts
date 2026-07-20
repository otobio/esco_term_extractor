import { OccupationCandidateRetriever, type CandidateEvidenceRecord, type RetrieveOccupationCandidatesOptions, type RetrieveOccupationCandidatesResult } from './occupation-candidates.js';
import { type TimingMap } from '../utils/timing.js';
export declare const DEFAULT_SIBLING_LIMIT = 5;
export type ExpandOccupationCandidateBranchesOptions = RetrieveOccupationCandidatesOptions & {
    siblingLimit?: number;
};
export type CandidateBranchKind = 'family' | 'group' | 'node';
export type ExpandedCandidateAncestor = {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
    distanceFromLeaf: number;
    ancestorRole: string;
};
export type ExpandedCandidateSibling = {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
    siblingKind: string;
    weight: number | null;
};
export type ExpandedOccupationCandidate = {
    graphNodeId: number;
    canonicalLabel: string;
    totalScore: number;
    channelScores: RetrieveOccupationCandidatesResult['candidates'][number]['channelScores'];
    evidence: CandidateEvidenceRecord[];
    genericRisk: 'low' | 'medium' | 'high' | null;
    hasHierarchy: boolean;
    hasCapabilitySupport: boolean;
    familyNodeId: number | null;
    familyLabel: string | null;
    groupNodeId: number | null;
    groupLabel: string | null;
    parentNodeId: number | null;
    parentLabel: string | null;
    ancestors: ExpandedCandidateAncestor[];
    siblings: ExpandedCandidateSibling[];
    branchKey: string;
    branchKind: CandidateBranchKind;
    branchNodeId: number;
    branchLabel: string;
};
export type CandidateBranchScoreSummary = {
    candidateCount: number;
    maxCandidateScore: number;
    totalCandidateScore: number;
    channelScores: {
        exactAlias: number;
        foldedAlias: number;
        ngramAlias: number;
        openSearchLexical: number;
        capabilityTask: number;
        denseEmbedding: number;
    };
};
export type OccupationCandidateBranch = {
    branchKey: string;
    branchKind: CandidateBranchKind;
    branchNodeId: number;
    branchLabel: string;
    scoreSummary: CandidateBranchScoreSummary;
    candidates: ExpandedOccupationCandidate[];
};
export type ExpandOccupationCandidateBranchesResult = {
    originalQuery: string;
    query: string;
    querySpans: string[];
    locale: string;
    normalizedQuery: string;
    foldedQuery: string;
    querySignals: string[];
    keptQuerySignals: string[];
    querySignalCleaningMs: number;
    roleSpanSelection: RetrieveOccupationCandidatesResult['roleSpanSelection'];
    sourceName: string;
    retrievalProfile: RetrieveOccupationCandidatesResult['retrievalProfile'];
    modelKey: string;
    modelDimensions: number | null;
    limit: number;
    siblingLimit: number;
    evaluationQueryId: number | null;
    scannedAliasHitCount: number;
    scannedOpenSearchHitCount: number;
    scannedDenseEmbeddingCount: number;
    timings: TimingMap;
    candidates: ExpandedOccupationCandidate[];
    branches: OccupationCandidateBranch[];
};
export declare class OccupationCandidateBranchExpander {
    private readonly retriever;
    constructor(retriever?: OccupationCandidateRetriever);
    run(options: ExpandOccupationCandidateBranchesOptions): Promise<ExpandOccupationCandidateBranchesResult>;
}
