import type { Connection } from 'mysql2/promise';
import type { ManualReviewType } from '../manual-review/build-manual-review-queue.js';
export type SearchReadinessFormat = 'text' | 'json';
export type ReportSearchReadinessOptions = {
    baselineRunId?: number;
    candidateRunId?: number;
    sourceName?: string;
    setKey?: string;
};
export type QueryReadinessClassification = 'exact_leaf_hit' | 'acceptable_hit' | 'family_or_group_hit' | 'miss' | 'unresolved' | 'missing_expectation';
export type RunReadinessSummary = {
    searchRunId: number;
    runLabel: string;
    sourceName: string;
    setKey: string;
    maxQueries: number | null;
    queryCount: number;
    selectedCount: number;
    unresolvedCount: number;
    unresolvedExpectedCount: number;
    exactLeafHitCount: number;
    acceptableHitCount: number;
    familyOrGroupHitCount: number;
    missCount: number;
    missingExpectationCount: number;
    selectedStageCounts: Record<string, number>;
    candidateResultCounts: Record<string, number>;
    pendingReviewCountsByType: Partial<Record<ManualReviewType, number>>;
    pendingReviewTotal: number;
    evidenceQueryCounts: {
        exactAlias: number;
        foldedAlias: number;
        denseOnly: number;
    };
    rankedEvidenceCounts: {
        rankedEvidenceQueries: number;
        top3LeafHit: number;
        bestBroaderBranchHit: number;
    };
    hierarchyCandidateCount: number;
    resolutionPresent: boolean;
    classificationsByQueryId: Record<number, QueryReadinessClassification>;
    categorySummaries: CategoryReadinessSummary[];
};
export type RunReadinessDelta = {
    queryCount: number;
    selectedCount: number;
    unresolvedCount: number;
    unresolvedExpectedCount: number;
    exactLeafHitCount: number;
    acceptableHitCount: number;
    familyOrGroupHitCount: number;
    missCount: number;
    top3LeafHitCount: number;
    bestBroaderBranchHitCount: number;
    pendingReviewTotal: number;
};
export type CategoryReadinessSummary = {
    category: string;
    queryCount: number;
    selectedCount: number;
    unresolvedCount: number;
    unresolvedExpectedCount: number;
    exactLeafHitCount: number;
    acceptableHitCount: number;
    familyOrGroupHitCount: number;
    missCount: number;
    missingExpectationCount: number;
};
export type CategoryReadinessDelta = CategoryReadinessSummary;
export type SearchReadinessComparison = {
    comparable: boolean;
    reason: string | null;
    delta: RunReadinessDelta | null;
    categoryDeltas: CategoryReadinessDelta[] | null;
};
export type SearchReadinessVerdict = {
    evidenceSufficient: boolean;
    searchMachineryReady: boolean | null;
    canAnswerDod: boolean;
    summary: string;
    remaining: string[];
};
export type SearchReadinessReport = {
    mode: 'single' | 'compare';
    sourceName: string;
    setKey: string;
    primaryRun: RunReadinessSummary;
    baselineRun: RunReadinessSummary | null;
    candidateRun: RunReadinessSummary | null;
    comparison: SearchReadinessComparison | null;
    verdict: SearchReadinessVerdict;
};
export declare class SearchReadinessReporter {
    private readonly connection;
    constructor(connection: Connection);
    run(options: ReportSearchReadinessOptions): Promise<SearchReadinessReport>;
    private loadRunScope;
    private buildRunSummary;
    private loadEvaluationQueries;
    private loadExpectations;
    private loadSearchRunResults;
    private loadPendingReviewCounts;
}
export declare function formatSearchReadinessReport(report: SearchReadinessReport, format?: SearchReadinessFormat): string;
