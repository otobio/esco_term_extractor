import type { Connection } from 'mysql2/promise';
export type SeedEvaluationSetOptions = {
    sourceName?: string;
    setKey?: string;
    resetSet?: boolean;
};
export type SeedEvaluationSetResult = {
    sourceName: string;
    setKey: string;
    resetSet: boolean;
    queryCount: number;
    expectationCount: number;
    insertedQueryCount: number;
    reusedQueryCount: number;
    insertedExpectationCount: number;
    reusedExpectationCount: number;
    resetDeletedQueryCount: number;
    resetDeletedExpectationCount: number;
};
export declare class EvaluationSetSeeder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: SeedEvaluationSetOptions): Promise<SeedEvaluationSetResult>;
    private resolveSeeds;
    private resolveTarget;
    private resolveCanonicalLabel;
    private resolveAlias;
    private resolveHierarchyTarget;
    private resetSet;
    private deleteOwnedExpectations;
    private deleteOwnedQueries;
    private deleteMatchingExpectation;
    private upsertEvaluationQuery;
    private findExistingQuery;
    private findMatchingQueryIds;
    private insertExpectationIfMissing;
}
export declare function defaultEvaluationSetKey(): string;
export declare function evaluationSetSize(setKey?: string): number;
export declare function countSeededEvaluationQueries(connection: Connection, options?: Pick<SeedEvaluationSetOptions, 'sourceName' | 'setKey'>): Promise<number>;
