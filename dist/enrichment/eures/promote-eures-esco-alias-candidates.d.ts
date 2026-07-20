import type { Connection } from 'mysql2/promise';
export declare const DEFAULT_EURES_ALIAS_REPORT_PATH: string;
export type PromoteEuresEscoAliasCandidatesOptions = {
    reportPath?: string;
    minConfidence?: number;
    limit?: number;
    dryRun?: boolean;
    includeReviewedExactBridge?: boolean;
};
export type PromoteEuresEscoAliasCandidatesResult = {
    reportPath: string;
    minConfidence: number;
    dryRun: boolean;
    eligible: number;
    inserted: number;
    skipped: number;
};
export declare function promoteEuresEscoAliasCandidates(connection: Connection, options?: PromoteEuresEscoAliasCandidatesOptions): Promise<PromoteEuresEscoAliasCandidatesResult>;
