interface CollarEdge {
    collar: string;
    confidence: number;
}
export declare class CollarMap {
    private readonly map;
    private constructor();
    static load(dir: string): Promise<CollarMap | undefined>;
    static fromEntries(entries: Record<string, CollarEdge>): CollarMap;
    get size(): number;
    lookup(occupationKey: string): CollarEdge | undefined;
}
export {};
