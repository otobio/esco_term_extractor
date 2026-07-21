import type { Connection } from 'mysql2/promise';
import { type RetrievalProfile } from '../retrieval/occupation-candidates.js';
export type RunEvaluationSearchOptions = {
    runLabel?: string;
    sourceName?: string;
    setKey?: string;
    modelKey?: string;
    limit?: number;
    siblingLimit?: number;
    maxQueries?: number;
    notes?: string;
    dryRun?: boolean;
};
export type RunEvaluationSearchResult = {
    runLabel: string;
    sourceName: string;
    setKey: string;
    modelKey: string;
    retrievalProfile: RetrievalProfile;
    limit: number;
    siblingLimit: number;
    maxQueries: number | null;
    dryRun: boolean;
    matchingQueryCount: number;
    processedQueryCount: number;
    selectedCount: number;
    unresolvedCount: number;
    insertedResultCount: number;
    searchRunId: number | null;
};
export declare class EvaluationSearchRunPersister {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: RunEvaluationSearchOptions): Promise<RunEvaluationSearchResult>;
    private loadEvaluationQueries;
    private insertSearchRun;
    private insertQueryRows;
}
export declare function defaultEvaluationSearchSetKey(): string;
