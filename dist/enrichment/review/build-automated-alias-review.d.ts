import type { Connection } from 'mysql2/promise';
export declare const DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR = "artifacts/enrichment/review";
export declare const DEFAULT_ONET_ALIAS_REPORT_PATH: string;
export declare const DEFAULT_EURES_ALIAS_REPORT_PATH: string;
export type BuildAutomatedAliasReviewOptions = {
    onetReportPath?: string;
    euresReportPath?: string;
    decisionsPath?: string;
    manualQueuePath?: string;
    includeOnet?: boolean;
    includeEures?: boolean;
};
export type BuildAutomatedAliasReviewResult = {
    decisionsPath: string;
    manualQueuePath: string;
    groupsReviewed: number;
    automatedDecisions: number;
    manualQueueItems: number;
    byRuleId: Record<string, number>;
};
export declare function buildAutomatedAliasReview(connection: Connection, options?: BuildAutomatedAliasReviewOptions): Promise<BuildAutomatedAliasReviewResult>;
