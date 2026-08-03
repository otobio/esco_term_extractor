export type FixedTable = {
    count: number;
    width: number;
    values?: Uint32Array;
    file?: FileBackedFixedTable;
};
export type BinaryStringTable = {
    count: number;
    offsets: Uint32Array;
    bytes: Buffer;
};
export type FileBackedFixedTable = {
    filePath: string;
    dataOffset: number;
    pageRowCount: number;
    cache: Map<number, Uint32Array>;
    maxPages: number;
};
export type FileBackedUint32Rows = {
    count: number;
    filePath: string;
    dataOffset: number;
    pageRowCount: number;
    cache: Map<number, Uint32Array>;
    maxPages: number;
};
export declare function readStringTable(filePath: string, expectedCount: number): Promise<BinaryStringTable>;
export declare function readStringTableSync(filePath: string, expectedCount: number): BinaryStringTable;
export declare function readFixedTable(filePath: string, width: number, expectedCount: number): Promise<FixedTable>;
export declare function readFixedTableSync(filePath: string, width: number, expectedCount: number): FixedTable;
export declare function readFileBackedFixedTableSync(filePath: string, width: number, expectedCount: number, options?: {
    pageRowCount?: number;
    maxPages?: number;
}): FixedTable;
export declare function readUint32Rows(filePath: string): Promise<Uint32Array>;
export declare function readFileBackedUint32RowsSync(filePath: string, options?: {
    pageRowCount?: number;
    maxPages?: number;
}): FileBackedUint32Rows;
export declare function stringAt(table: BinaryStringTable, stringId: number): string;
export declare function findStringId(table: BinaryStringTable, value: string): number;
export declare function rowValue(table: FixedTable, rowIndex: number, columnIndex: number): number;
export declare function uint32RowsLength(rows: Uint32Array | FileBackedUint32Rows): number;
export declare function uint32RowsSlice(rows: Uint32Array | FileBackedUint32Rows, offset: number, length: number): number[];
export declare function uint32RowValue(rows: Uint32Array | FileBackedUint32Rows, rowIndex: number): number;
export declare function closeFixedTable(table: FixedTable): void;
export declare function closeUint32Rows(rows: Uint32Array | FileBackedUint32Rows): void;
export declare function closeFileBackedFixedTable(file: FileBackedFixedTable): void;
export declare function closeFileBackedUint32Rows(rows: FileBackedUint32Rows): void;
export declare function findRange(table: FixedTable, keyColumns: number[]): {
    offset: number;
    length: number;
} | null;
export declare function writeStringTable(strings: string[]): Buffer;
export declare function writeFixedTable(rows: number[][], width: number): Buffer;
export declare function writeUint32Rows(rows: number[]): Buffer;
