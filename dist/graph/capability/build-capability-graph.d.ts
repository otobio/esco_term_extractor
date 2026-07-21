import type { Connection } from 'mysql2/promise';
export type BuildCapabilityGraphOptions = {
    sourceName?: string;
    locales?: string[];
};
export declare class CapabilityGraphBuilder {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: BuildCapabilityGraphOptions): Promise<void>;
    private resolveLocales;
    private loadOccupationNodeIdByExternalUri;
    private loadLinkedCapabilityConcepts;
    private buildLinkCandidates;
    private insertCapabilities;
    private insertCapabilityLinks;
}
