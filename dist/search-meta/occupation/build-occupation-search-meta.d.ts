import type { Connection } from 'mysql2/promise';
export type BuildOccupationSearchMetaOptions = {
    sourceName?: string;
    locales?: string[];
    skipReset?: boolean;
};
export declare class OccupationSearchMetaBuilder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: BuildOccupationSearchMetaOptions): Promise<void>;
    private resolveLocales;
    private loadActiveLeafOccupations;
    private loadSourceNodes;
    private loadRelationships;
    private loadAliases;
    private loadCapabilities;
    private buildArtifactsForOccupation;
    private insertSearchMetaRecords;
    private insertSearchMetaAliases;
    private insertSearchMetaAncestors;
    private insertSearchMetaSiblings;
    private insertSearchMetaCapabilityHints;
}
