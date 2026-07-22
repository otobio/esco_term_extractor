export type FixedTable = {
    count: number;
    width: number;
    values: Uint32Array;
};
export type BinaryStringTable = {
    count: number;
    offsets: Uint32Array;
    bytes: Buffer;
};
export declare function readStringTable(filePath: string, expectedCount: number): Promise<BinaryStringTable>;
export declare function readFixedTable(filePath: string, width: number, expectedCount: number): Promise<FixedTable>;
export declare function readUint32Rows(filePath: string): Promise<Uint32Array>;
export declare function stringAt(table: BinaryStringTable, stringId: number): string;
export declare function findStringId(table: BinaryStringTable, value: string): number;
export declare function rowValue(table: FixedTable, rowIndex: number, columnIndex: number): number;
export declare function findRange(table: FixedTable, keyColumns: number[]): {
    offset: number;
    length: number;
} | null;
export declare function writeStringTable(strings: string[]): Buffer;
export declare function writeFixedTable(rows: number[][], width: number): Buffer;
export declare function writeUint32Rows(rows: number[]): Buffer;
