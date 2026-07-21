import type { Connection } from 'mysql2/promise';
export declare const DEFAULT_AUTOMATED_ALIAS_DECISIONS_PATH = "artifacts/enrichment/review/automated-review-decisions.csv";
export type ApplyAutomatedAliasReviewOptions = {
    decisionsPath?: string;
    dryRun?: boolean;
    limit?: number;
};
export type ApplyAutomatedAliasReviewResult = {
    decisionsPath: string;
    dryRun: boolean;
    eligible: number;
    inserted: number;
    skipped: number;
    byRuleId: Record<string, number>;
};
export declare function applyAutomatedAliasReview(connection: Connection, options?: ApplyAutomatedAliasReviewOptions): Promise<ApplyAutomatedAliasReviewResult>;
