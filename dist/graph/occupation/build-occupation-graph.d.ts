import type { Connection } from 'mysql2/promise';
export type BuildOccupationGraphOptions = {
    sourceName?: string;
    locales?: string[];
};
export declare class OccupationGraphBuilder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: BuildOccupationGraphOptions): Promise<void>;
    private resolveLocales;
    private loadSourceConcepts;
    private insertGraphNodes;
    private insertNodeSources;
    private buildAliasCandidates;
    private loadSourceAliases;
    private insertGraphAliases;
    private buildRelationshipCandidates;
    private insertRelationships;
}
