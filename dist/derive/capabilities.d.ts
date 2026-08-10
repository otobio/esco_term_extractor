interface OccCaps {
    e: string[];
    o: string[];
}
export declare class OccupationCapabilityMap {
    private readonly bin;
    private readonly map;
    private constructor();
    /** Loads the packed OCB binary (zero-parse, ArrayBuffer views) — the production path. */
    static load(dir: string): Promise<OccupationCapabilityMap | undefined>;
    /** In-memory construction (tests, snapshot tooling) — never touches disk. */
    static fromEntries(entries: Record<string, OccCaps>): OccupationCapabilityMap;
    get size(): number;
    /** 'essential' | 'optional' | null for a capability given an occupation. */
    relation(occupationKey: string, capabilityKey: string): 'essential' | 'optional' | null;
    /** Essential capability/knowledge keys for an occupation (empty if unknown). */
    essentialFor(occupationKey: string): string[];
    has(occupationKey: string): boolean;
}
export {};
