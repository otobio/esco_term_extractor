export type CollarEdge = {
    collar: string;
    confidence: number;
};
export type CollarEntry = {
    occupationKey: string;
    collar: string;
    confidence: number;
};
/** Build the CLB buffer from occupation -> collar_kind edges. Pure. */
export declare function packOccupationCollars(entries: CollarEntry[]): Buffer;
export declare class CollarBin {
    private readonly occTable;
    private readonly collarTable;
    private readonly collarIds;
    private readonly confidences;
    readonly size: number;
    private constructor();
    static load(path: string): Promise<CollarBin>;
    static fromBuffer(buf: Buffer): CollarBin;
    lookup(occupationKey: string): CollarEdge | undefined;
}
