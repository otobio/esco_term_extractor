import { readFile } from 'node:fs/promises';

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
  return table.values[rowIndex * table.width + columnIndex] ?? 0;
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
