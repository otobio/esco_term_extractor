export type OccupationCapabilityEntry = {
    occupationKey: string;
    essential: string[];
    optional: string[];
};
/** Build the OCB buffer from occupation → essential/optional capability-key edges. Pure. */
export declare function packOccupationCapabilities(entries: OccupationCapabilityEntry[]): Buffer;
export declare class CapabilitiesBin {
    private readonly occTable;
    private readonly capTable;
    private readonly essentialOff;
    private readonly essentialPostings;
    private readonly optionalOff;
    private readonly optionalPostings;
    readonly size: number;
    private constructor();
    static load(path: string): Promise<CapabilitiesBin>;
    static fromBuffer(buf: Buffer): CapabilitiesBin;
    has(occupationKey: string): boolean;
    /** 'essential' | 'optional' | null for a capability given an occupation. */
    relation(occupationKey: string, capabilityKey: string): 'essential' | 'optional' | null;
    /** Essential capability/knowledge keys for an occupation (empty if unknown). */
    essentialFor(occupationKey: string): string[];
}
