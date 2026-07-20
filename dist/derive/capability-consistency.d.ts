interface OccCaps {
    e: string[];
    o: string[];
}
export declare class OccupationCapabilityMap {
    private readonly map;
    private constructor();
    static load(dir: string): Promise<OccupationCapabilityMap | undefined>;
    static fromEntries(entries: Record<string, OccCaps>): OccupationCapabilityMap;
    get size(): number;
    /** 'essential' | 'optional' | null for a capability given an occupation. */
    relation(occupationKey: string, capabilityKey: string): 'essential' | 'optional' | null;
    has(occupationKey: string): boolean;
}
export {};
