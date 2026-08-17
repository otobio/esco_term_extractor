/**
 * Collar-binary loader for the occupation -> collar_kind edge map.
 *
 * This is a tiny one-to-one runtime artifact: occupation keys are sorted and
 * binary-searched, while collar kinds are dictionary-encoded because the collar
 * vocabulary is small and finite. The binary keeps collar derivation zero-parse
 * at load time and avoids materializing a JSON object for every cold start.
 */
import { readFile } from 'node:fs/promises';
import {
  align4,
  findStringId,
  readStringTable,
  stringAt,
  writeStringTable,
  type BinaryStringTable,
} from '../binary.js';

const MAGIC = 0x434c4231; // "CLB1"
const VERSION = 1;
const NUM_SECTIONS = 4;

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
export function packOccupationCollars(entries: CollarEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.occupationKey, 'utf8'), Buffer.from(b.occupationKey, 'utf8')),
  );

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1].occupationKey === sorted[i].occupationKey) {
      throw new Error(`duplicate occupation key in collar snapshot: ${sorted[i].occupationKey}`);
    }
  }

  const collarKeysSorted = [...new Set(sorted.map((entry) => entry.collar))].sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')),
  );
  const collarIdx = new Map(collarKeysSorted.map((key, index) => [key, index]));

  const occKeyTable = writeStringTable(sorted.map((entry) => entry.occupationKey));
  const collarTable = writeStringTable(collarKeysSorted);
  const collarIds = Buffer.alloc(sorted.length * 2);
  const confidences = Buffer.alloc(sorted.length * 4);

  sorted.forEach((entry, index) => {
    const collarId = collarIdx.get(entry.collar);
    if (collarId === undefined) {
      throw new Error(`unknown collar key in snapshot pack: ${entry.collar}`);
    }
    collarIds.writeUInt16LE(collarId, index * 2);
    confidences.writeFloatLE(entry.confidence, index * 4);
  });

  const sections = [occKeyTable, collarTable, collarIds, confidences];
  const headerSize = 4 + 3 * 4 + NUM_SECTIONS * 4;
  const offsets: number[] = [];
  let pos = align4(headerSize);
  for (const section of sections) {
    offsets.push(pos);
    pos = align4(pos + section.length);
  }

  const out = Buffer.alloc(pos);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(VERSION, 4);
  out.writeUInt32LE(sorted.length, 8);
  out.writeUInt32LE(collarKeysSorted.length, 12);
  offsets.forEach((offset, index) => out.writeUInt32LE(offset, 16 + index * 4));
  sections.forEach((section, index) => section.copy(out, offsets[index]));
  return out;
}

export class CollarBin {
  private readonly occTable: BinaryStringTable;
  private readonly collarTable: BinaryStringTable;
  private readonly collarIds: Uint16Array;
  private readonly confidences: Float32Array;

  readonly size: number;

  private constructor(ab: ArrayBuffer) {
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a CLB file');
    if (dv.getUint32(4, true) !== VERSION) throw new Error(`CLB version ${dv.getUint32(4, true)} != ${VERSION}`);
    const n = dv.getUint32(8, true);
    const m = dv.getUint32(12, true);
    this.size = n;
    const off = (i: number) => dv.getUint32(16 + i * 4, true);
    const bytes = new Uint8Array(ab);
    this.occTable = readStringTable(bytes, off(0), n);
    this.collarTable = readStringTable(bytes, off(1), m);
    this.collarIds = new Uint16Array(ab, off(2), n);
    this.confidences = new Float32Array(ab, off(3), n);
  }

  static async load(path: string): Promise<CollarBin> {
    const buf = await readFile(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer; // fresh, aligned
    return new CollarBin(ab);
  }

  static fromBuffer(buf: Buffer): CollarBin {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new CollarBin(ab);
  }

  lookup(occupationKey: string): CollarEdge | undefined {
    const oi = findStringId(this.occTable, occupationKey);
    if (oi < 0) return undefined;
    const collarKey = stringAt(this.collarTable, this.collarIds[oi]);
    if (!collarKey) return undefined;
    return { collar: collarKey, confidence: this.confidences[oi] };
  }
}
