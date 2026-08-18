import type { Connection, RowDataPacket } from 'mysql2/promise';
export type BuildCapabilityGraphOptions = {
    sourceName?: string;
    locales?: string[];
};
export type SourceCapabilityConceptRow = RowDataPacket & {
    id: number;
    source_kind: string;
    source_name: string;
    locale_code: string;
    external_uri: string;
    entity_kind: string;
    concept_type: string | null;
    preferred_label: string;
    normalized_label: string | null;
    description: string | null;
    definition_text: string | null;
};
export type CapabilityRecord = {
    externalUri: string;
    canonicalKey: string;
    capabilityType: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
    label: string;
    normalizedLabel: string;
    localeCode: string;
    description: string | null;
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
export declare function buildCapabilityRecords(concepts: SourceCapabilityConceptRow[]): CapabilityRecord[];
