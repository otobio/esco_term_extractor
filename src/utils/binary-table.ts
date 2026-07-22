import { closeSync, openSync, readSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

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

export async function readStringTable(filePath: string, expectedCount: number): Promise<BinaryStringTable> {
  const buffer = await readFile(filePath);
  const count = buffer.readUInt32LE(0);

  if (count !== expectedCount) {
    throw new Error(`String table count mismatch at ${filePath}: manifest=${expectedCount}, file=${count}.`);
  }

  const offsets = new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count + 1);
  const bytesOffset = 4 + (count + 1) * 4;

  return {
    count,
    offsets,
    bytes: buffer.subarray(bytesOffset)
  };
}

export async function readFixedTable(filePath: string, width: number, expectedCount: number): Promise<FixedTable> {
  const buffer = await readFile(filePath);
  return parseFixedTable(buffer, filePath, width, expectedCount);
}

export function readFixedTableSync(filePath: string, width: number, expectedCount: number): FixedTable {
  const buffer = readFileSync(filePath);
  return parseFixedTable(buffer, filePath, width, expectedCount);
}

export function readFileBackedFixedTableSync(
  filePath: string,
  width: number,
  expectedCount: number,
  options: { pageRowCount?: number; maxPages?: number } = {}
): FixedTable {
  const header = Buffer.allocUnsafe(8);
  readFileRangeSync(filePath, header, 0);
  const count = header.readUInt32LE(0);
  const rowWidth = header.readUInt32LE(4);

  if (count !== expectedCount || rowWidth !== width) {
    throw new Error(`Fixed table shape mismatch at ${filePath}: manifest=${expectedCount}x${width}, file=${count}x${rowWidth}.`);
  }

  return {
    count,
    width,
    file: {
      filePath,
      dataOffset: 8,
      pageRowCount: options.pageRowCount ?? 4096,
      cache: new Map(),
      maxPages: options.maxPages ?? 8
    }
  };
}

function parseFixedTable(buffer: Buffer, filePath: string, width: number, expectedCount: number): FixedTable {
  const count = buffer.readUInt32LE(0);
  const rowWidth = buffer.readUInt32LE(4);

  if (count !== expectedCount || rowWidth !== width) {
    throw new Error(`Fixed table shape mismatch at ${filePath}: manifest=${expectedCount}x${width}, file=${count}x${rowWidth}.`);
  }

  return {
    count,
    width,
    values: new Uint32Array(buffer.buffer, buffer.byteOffset + 8, count * width)
  };
}

export async function readUint32Rows(filePath: string): Promise<Uint32Array> {
  const buffer = await readFile(filePath);
  const count = buffer.readUInt32LE(0);
  return new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count);
}

export function readFileBackedUint32RowsSync(
  filePath: string,
  options: { pageRowCount?: number; maxPages?: number } = {}
): FileBackedUint32Rows {
  const header = Buffer.allocUnsafe(4);
  readFileRangeSync(filePath, header, 0);

  return {
    count: header.readUInt32LE(0),
    filePath,
    dataOffset: 4,
    pageRowCount: options.pageRowCount ?? 16384,
    cache: new Map(),
    maxPages: options.maxPages ?? 8
  };
}

export function stringAt(table: BinaryStringTable, stringId: number): string {
  if (stringId >= table.count) {
    return '';
  }

  return table.bytes.toString('utf8', table.offsets[stringId], table.offsets[stringId + 1]);
}

export function findStringId(table: BinaryStringTable, value: string): number {
  let low = 0;
  let high = table.count - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const current = stringAt(table, mid);

    if (current < value) {
      low = mid + 1;
    } else if (current > value) {
      high = mid - 1;
    } else {
      return mid;
    }
  }

  return -1;
}

export function rowValue(table: FixedTable, rowIndex: number, columnIndex: number): number {
  if (table.values) {
    return table.values[rowIndex * table.width + columnIndex] ?? 0;
  }

  if (table.file) {
    const page = fixedTablePage(table, table.file, rowIndex);
    const pageRowIndex = rowIndex % table.file.pageRowCount;
    return page[pageRowIndex * table.width + columnIndex] ?? 0;
  }

  return 0;
}

export function uint32RowsLength(rows: Uint32Array | FileBackedUint32Rows): number {
  return rows instanceof Uint32Array ? rows.length : rows.count;
}

export function uint32RowsSlice(rows: Uint32Array | FileBackedUint32Rows, offset: number, length: number): number[] {
  if (rows instanceof Uint32Array) {
    return Array.from(rows.subarray(offset, offset + length));
  }

  const values: number[] = [];
  const end = Math.min(offset + length, rows.count);

  for (let cursor = offset; cursor < end; cursor += 1) {
    const page = uint32RowsPage(rows, cursor);
    values.push(page[cursor % rows.pageRowCount] ?? 0);
  }

  return values;
}

export function uint32RowValue(rows: Uint32Array | FileBackedUint32Rows, rowIndex: number): number {
  if (rows instanceof Uint32Array) {
    return rows[rowIndex] ?? 0;
  }

  const page = uint32RowsPage(rows, rowIndex);
  return page[rowIndex % rows.pageRowCount] ?? 0;
}

export function closeFixedTable(table: FixedTable): void {
  if (!table.file) {
    return;
  }

  closeFileBackedFixedTable(table.file);
}

export function closeUint32Rows(rows: Uint32Array | FileBackedUint32Rows): void {
  if (rows instanceof Uint32Array) {
    return;
  }

  closeFileBackedUint32Rows(rows);
}

export function closeFileBackedFixedTable(file: FileBackedFixedTable): void {
  file.cache.clear();
}

export function closeFileBackedUint32Rows(rows: FileBackedUint32Rows): void {
  rows.cache.clear();
}

function fixedTablePage(table: FixedTable, file: FileBackedFixedTable, rowIndex: number): Uint32Array {
  const pageId = Math.floor(rowIndex / file.pageRowCount);
  const cached = file.cache.get(pageId);

  if (cached) {
    file.cache.delete(pageId);
    file.cache.set(pageId, cached);
    return cached;
  }

  const startRow = pageId * file.pageRowCount;
  const rowCount = Math.min(file.pageRowCount, Math.max(0, table.count - startRow));
  const buffer = Buffer.allocUnsafe(rowCount * table.width * 4);
  readFileRangeSync(file.filePath, buffer, file.dataOffset + startRow * table.width * 4);
  const page = new Uint32Array(buffer.buffer, buffer.byteOffset, rowCount * table.width);
  cachePage(file.cache, pageId, page, file.maxPages);
  return page;
}

function uint32RowsPage(rows: FileBackedUint32Rows, rowIndex: number): Uint32Array {
  const pageId = Math.floor(rowIndex / rows.pageRowCount);
  const cached = rows.cache.get(pageId);

  if (cached) {
    rows.cache.delete(pageId);
    rows.cache.set(pageId, cached);
    return cached;
  }

  const startRow = pageId * rows.pageRowCount;
  const rowCount = Math.min(rows.pageRowCount, Math.max(0, rows.count - startRow));
  const buffer = Buffer.allocUnsafe(rowCount * 4);
  readFileRangeSync(rows.filePath, buffer, rows.dataOffset + startRow * 4);
  const page = new Uint32Array(buffer.buffer, buffer.byteOffset, rowCount);
  cachePage(rows.cache, pageId, page, rows.maxPages);
  return page;
}

function readFileRangeSync(filePath: string, buffer: Buffer, position: number): void {
  const fd = openSync(filePath, 'r');

  try {
    readSync(fd, buffer, 0, buffer.byteLength, position);
  } finally {
    closeSync(fd);
  }
}

function cachePage(cache: Map<number, Uint32Array>, pageId: number, page: Uint32Array, maxPages: number): void {
  cache.set(pageId, page);

  while (cache.size > maxPages) {
    const oldestKey = cache.keys().next().value as number | undefined;

    if (oldestKey === undefined) {
      return;
    }

    cache.delete(oldestKey);
  }
}

export function findRange(table: FixedTable, keyColumns: number[]): { offset: number; length: number } | null {
  let low = 0;
  let high = table.count - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const comparison = compareKeyAt(table, mid, keyColumns);

    if (comparison < 0) {
      low = mid + 1;
    } else if (comparison > 0) {
      high = mid - 1;
    } else {
      return {
        offset: rowValue(table, mid, table.width - 2),
        length: rowValue(table, mid, table.width - 1)
      };
    }
  }

  return null;
}

function compareKeyAt(table: FixedTable, rowIndex: number, keyColumns: number[]): number {
  for (let index = 0; index < keyColumns.length; index += 1) {
    const left = rowValue(table, rowIndex, index);
    const right = keyColumns[index] ?? 0;

    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

export function writeStringTable(strings: string[]): Buffer {
  const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
  const offsets = new Uint32Array(strings.length + 1);
  let byteLength = 0;

  encoded.forEach((buffer, index) => {
    offsets[index] = byteLength;
    byteLength += buffer.byteLength;
  });
  offsets[strings.length] = byteLength;

  const output = Buffer.allocUnsafe(4 + offsets.byteLength + byteLength);
  output.writeUInt32LE(strings.length, 0);
  Buffer.from(offsets.buffer).copy(output, 4);
  let offset = 4 + offsets.byteLength;

  for (const buffer of encoded) {
    buffer.copy(output, offset);
    offset += buffer.byteLength;
  }

  return output;
}

export function writeFixedTable(rows: number[][], width: number): Buffer {
  const output = Buffer.allocUnsafe(8 + rows.length * width * 4);
  output.writeUInt32LE(rows.length, 0);
  output.writeUInt32LE(width, 4);
  const values = new Uint32Array(output.buffer, output.byteOffset + 8, rows.length * width);

  rows.forEach((row, rowIndex) => {
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      values[rowIndex * width + columnIndex] = row[columnIndex] ?? 0;
    }
  });

  return output;
}

export function writeUint32Rows(rows: number[]): Buffer {
  const output = Buffer.allocUnsafe(4 + rows.length * 4);
  output.writeUInt32LE(rows.length, 0);
  new Uint32Array(output.buffer, output.byteOffset + 4, rows.length).set(rows);
  return output;
}
