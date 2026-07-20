import type { Connection } from 'mysql2/promise';
export type ManualReviewType = 'alias_conflict' | 'generic_head' | 'hierarchy_gap' | 'relatedness_gap' | 'cross_locale_gap' | 'dense_candidate';
export type BuildManualReviewQueueOptions = {
    searchRunId?: number;
    sourceName?: string;
    setKey?: string;
    limit?: number;
    dryRun?: boolean;
    includeExisting?: boolean;
};
export type ManualReviewBuildFormat = 'text' | 'json';
export type BuildManualReviewQueueResult = {
    searchRunId: number;
    sourceName: string;
    setKey: string;
    limit: number | null;
    dryRun: boolean;
    includeExisting: boolean;
    localeCount: number;
    discoveredCount: number;
    consideredCount: number;
    existingPendingCount: number;
    newCandidateCount: number;
    insertedCount: number;
    countsByType: Array<{
        reviewType: ManualReviewType;
        discovered: number;
        considered: number;
        existingPending: number;
        newCandidate: number;
        inserted: number;
    }>;
    preview: ManualReviewQueuePreviewRow[];
};
export type ManualReviewQueuePreviewRow = {
    reviewType: ManualReviewType;
    localeCode: string | null;
    subjectText: string | null;
    graphNodeId: number | null;
    graphNodeLabel: string | null;
    status: 'new' | 'existing_pending';
    existingQueueId: number | null;
    payloadJson: Record<string, unknown>;
};
export declare class ManualReviewQueueBuilder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: BuildManualReviewQueueOptions): Promise<BuildManualReviewQueueResult>;
    private resolveSearchRun;
    private resolveLocaleCount;
    private loadEvaluationFailureCandidates;
    private loadEvaluationQueries;
    private loadExpectations;
    private loadSearchRunResults;
    private loadSearchMetaSignalCandidates;
    private loadPendingLookup;
    private attachPendingStatus;
    private insertCandidate;
}
export declare function formatBuildManualReviewQueueResult(result: BuildManualReviewQueueResult, format?: ManualReviewBuildFormat): string;
export declare function formatTable<T extends Record<string, unknown>>(rows: T[], columns: Array<[keyof T, string]>): string;
