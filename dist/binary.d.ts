export declare const align4: (n: number) => number;
export type BinaryStringTable = {
    count: number;
    offsets: Uint32Array;
    bytes: Uint8Array;
};
export declare function writeStringTable(strings: string[]): Buffer;
export declare function readStringTable(bytes: Uint8Array, offset: number, expectedCount: number): BinaryStringTable;
export declare function stringAt(table: BinaryStringTable, stringId: number): string;
export declare function findStringId(table: BinaryStringTable, value: string): number;
