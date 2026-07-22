import type { Connection } from 'mysql2/promise';
export type RankedGapAnalysisFormat = 'text' | 'json';
export type ReportRankedGapAnalysisOptions = {
    searchRunId: number;
    sourceName?: string;
    setKey?: string;
    limit?: number;
};
export type SelectedClassification = 'exact_leaf_hit' | 'acceptable_hit' | 'family_or_group_hit' | 'miss' | 'unresolved' | 'missing_expectation';
export type GapBucket = 'selected_success' | 'selected_miss_top1_leaf_hit' | 'selected_miss_top2_or_top3_leaf_hit' | 'selected_miss_no_top3_leaf_hit' | 'unresolved_top1_leaf_hit' | 'unresolved_top2_or_top3_leaf_hit' | 'unresolved_no_top3_leaf_hit' | 'family_or_group_with_top1_leaf_hit' | 'top3_miss_best_branch_hit' | 'missing_expectation' | 'no_ranked_evidence';
export type RankedLeafEvidence = {
    rank: number;
    graphNodeId: number;
    label: string | null;
    evidenceTier: string | null;
    retrievalScore: number;
    resolverScore: number;
    leafMarginRatio: number;
    branchShare: number;
    branchMarginRatio: number;
    exactAliasScore: number;
    foldedAliasScore: number;
    opensearchLexicalScore: number;
    capabilityTaskScore: number;
};
export type BestBroaderBranchEvidence = {
    branchNodeId: number;
    branchKind: string | null;
    branchLabel: string | null;
    retrievalScore: number;
};
export type QueryGapAnalysis = {
    evaluationQueryId: number;
    queryText: string;
    category: string;
    classification: SelectedClassification;
    bucket: GapBucket;
    selectedGraphNodeId: number | null;
    selectedDecisionStage: string | null;
    expectedExactLeafIds: number[];
    expectedAcceptableLeafIds: number[];
    expectedFamilyIds: number[];
    expectedGroupIds: number[];
    correctLeafRank: number | null;
    top1LeafHit: boolean;
    top3LeafHit: boolean;
    bestBroaderBranchHit: boolean;
    topLeaf: RankedLeafEvidence | null;
    correctLeaf: RankedLeafEvidence | null;
    bestBroaderBranch: BestBroaderBranchEvidence | null;
};
export type RankedGapAnalysisReport = {
    searchRunId: number;
    runLabel: string;
    sourceName: string;
    setKey: string;
    maxQueries: number | null;
    queryCount: number;
    bucketCounts: Record<GapBucket, number>;
    classificationCounts: Record<SelectedClassification, number>;
    categoryBucketCounts: Record<string, Partial<Record<GapBucket, number>>>;
    promotionCandidateCounts: {
        top1LeafHitNotSelected: number;
        top2OrTop3LeafHitNotSelected: number;
        bestBranchHitWithoutTop3LeafHit: number;
    };
    promotionCandidates: QueryGapAnalysis[];
    branchOnlyCandidates: QueryGapAnalysis[];
    riskyGaps: QueryGapAnalysis[];
};
export declare class RankedGapAnalysisReporter {
    private readonly connection;
    constructor(connection: Connection);
    run(options: ReportRankedGapAnalysisOptions): Promise<RankedGapAnalysisReport>;
    private loadRunScope;
    private loadEvaluationQueries;
    private loadExpectations;
    private loadSearchRunResults;
}
export declare function formatRankedGapAnalysisReport(report: RankedGapAnalysisReport, format?: RankedGapAnalysisFormat): string;
