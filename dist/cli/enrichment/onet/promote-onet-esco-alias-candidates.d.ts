import type { Connection } from 'mysql2/promise';
export declare const DEFAULT_ONET_ALIAS_REPORT_PATH: string;
export type PromoteOnetEscoAliasCandidatesOptions = {
    reportPath?: string;
    minConfidence?: number;
    limit?: number;
    dryRun?: boolean;
};
export type PromoteOnetEscoAliasCandidatesResult = {
    reportPath: string;
    minConfidence: number;
    dryRun: boolean;
    eligible: number;
    inserted: number;
    skipped: number;
};
export declare function promoteOnetEscoAliasCandidates(connection: Connection, options?: PromoteOnetEscoAliasCandidatesOptions): Promise<PromoteOnetEscoAliasCandidatesResult>;
