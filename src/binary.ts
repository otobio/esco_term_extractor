/**
 * Shared binary helpers for the packed runtime artifacts.
 *
 * These helpers cover the repeated low-level primitives: 4-byte alignment,
 * UTF-8 string-table packing, string-table loading, and bytewise string-table
 * lookup. Artifact-specific layouts still live in their own modules.
 */
const dec = new TextDecoder();

export const align4 = (n: number): number => (n + 3) & ~3;

export type BinaryStringTable = {
  count: number;
  offsets: Uint32Array;
  bytes: Uint8Array;
};

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

export function readStringTable(bytes: Uint8Array, offset: number, expectedCount: number): BinaryStringTable {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(offset, true);
  if (count !== expectedCount) {
    throw new Error(`String table count mismatch at offset ${offset}: expected=${expectedCount}, file=${count}.`);
  }

  const offsets = new Uint32Array(count + 1);
  let cursor = offset + 4;
  for (let i = 0; i <= count; i += 1) {
    offsets[i] = dv.getUint32(cursor, true);
    cursor += 4;
  }

  const bytesOffset = offset + 4 + (count + 1) * 4;
  return {
    count,
    offsets,
    bytes: bytes.subarray(bytesOffset, bytesOffset + offsets[count]),
  };
}

export function stringAt(table: BinaryStringTable, stringId: number): string {
  if (stringId < 0 || stringId >= table.count) return '';
  return dec.decode(table.bytes.subarray(table.offsets[stringId], table.offsets[stringId + 1]));
}

export function findStringId(table: BinaryStringTable, value: string): number {
  if (!value) return -1;
  const q = Buffer.from(value, 'utf8');
  let lo = 0;
  let hi = table.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = Buffer.compare(q, table.bytes.subarray(table.offsets[mid], table.offsets[mid + 1]));
    if (cmp === 0) return mid;
    if (cmp < 0) hi = mid - 1;
    else lo = mid + 1;
  }
  return -1;
}
