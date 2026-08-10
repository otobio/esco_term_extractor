/**
 * capabilities-bin.ts — the shipped runtime artifact for the occupation →
 * capability/knowledge graph edges: a compact, memory-lean binary ("OCB1")
 * packed from the OpenSearch `canonical_relationships` snapshot, plus a
 * zero-parse loader. Mirrors `lexical-bin.ts`.
 *
 * Why binary: the JSON snapshot (`occupation_capabilities.json`, ~6MB) parses
 * into an object-per-occupation plus a `Set` per essential/optional list —
 * heavy in both load time and resident memory, paid on every cold start. OCB
 * stores the same one-to-many edges as columnar typed arrays + UTF-8 blobs in
 * one little-endian buffer, loaded as ArrayBuffer views (no copy, no parse).
 * Only matched capability keys decode a string; nothing is materialized up front.
 *
 * Layout (all offsets absolute, numeric sections 4-byte aligned):
 *   header: magic "OCB1" · u32 version · u32 occupationCount(n) · u32 capabilityCount(m) ·
 *           u32 sectionOffset[6]
 *   sections: occKeyTable (self-describing string table) · capKeyTable (ditto) ·
 *   essentialOff(u32, n+1) · essentialPostings(i32) · optionalOff(u32, n+1) · optionalPostings(i32)
 *
 * Both occupation keys and capability keys are sorted by UTF-8 bytes, so both
 * sides of a lookup (`relation`, `essentialFor`) resolve via binary search
 * with no string decode on the miss path.
 */
import { readFile } from 'node:fs/promises';
import { timed } from '@term-extractor/utils/perf';
import { writeStringTable } from './display-titles.js';

const MAGIC = 0x4f434231; // "OCB1"
const VERSION = 1;
const NUM_SECTIONS = 6;
const align4 = (n: number): number => (n + 3) & ~3;

type BinaryStringTable = {
  count: number;
  offsets: Uint32Array;
  bytes: Uint8Array;
};

function readStringTableAt(bytes: Uint8Array, dv: DataView, offset: number, expectedCount: number): BinaryStringTable {
  const count = dv.getUint32(offset, true);
  if (count !== expectedCount) {
    throw new Error(`OCB string table count mismatch at offset ${offset}: expected=${expectedCount}, file=${count}.`);
  }
  const offsets = new Uint32Array(count + 1);
  let cursor = offset + 4;
  for (let i = 0; i <= count; i++) {
    offsets[i] = dv.getUint32(cursor, true);
    cursor += 4;
  }
  const bytesOffset = offset + 4 + (count + 1) * 4;
  return { count, offsets, bytes: bytes.subarray(bytesOffset, bytesOffset + offsets[count]) };
}

const dec = new TextDecoder();

function stringAt(table: BinaryStringTable, id: number): string {
  if (id < 0 || id >= table.count) return '';
  return dec.decode(table.bytes.subarray(table.offsets[id], table.offsets[id + 1]));
}

function findInTable(table: BinaryStringTable, key: string): number {
  const q = Buffer.from(key, 'utf8');
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

export type OccupationCapabilityEntry = {
  occupationKey: string;
  essential: string[];
  optional: string[];
};

/** Build the OCB buffer from occupation → essential/optional capability-key edges. Pure. */
export function packOccupationCapabilities(entries: OccupationCapabilityEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.occupationKey, 'utf8'), Buffer.from(b.occupationKey, 'utf8')),
  );
  const n = sorted.length;

  const capSet = new Set<string>();
  for (const e of sorted) {
    for (const k of e.essential) capSet.add(k);
    for (const k of e.optional) capSet.add(k);
  }
  const capKeysSorted = [...capSet].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  const capIdx = new Map(capKeysSorted.map((k, i) => [k, i]));
  const m = capKeysSorted.length;

  const essentialOff = Buffer.alloc((n + 1) * 4);
  const optionalOff = Buffer.alloc((n + 1) * 4);
  const essentialPostingsList: number[] = [];
  const optionalPostingsList: number[] = [];

  sorted.forEach((e, i) => {
    essentialOff.writeUInt32LE(essentialPostingsList.length, i * 4);
    for (const k of e.essential) essentialPostingsList.push(capIdx.get(k)!);
    optionalOff.writeUInt32LE(optionalPostingsList.length, i * 4);
    for (const k of e.optional) optionalPostingsList.push(capIdx.get(k)!);
  });
  essentialOff.writeUInt32LE(essentialPostingsList.length, n * 4);
  optionalOff.writeUInt32LE(optionalPostingsList.length, n * 4);

  const essentialPostings = Buffer.alloc(essentialPostingsList.length * 4);
  essentialPostingsList.forEach((v, i) => essentialPostings.writeInt32LE(v, i * 4));
  const optionalPostings = Buffer.alloc(optionalPostingsList.length * 4);
  optionalPostingsList.forEach((v, i) => optionalPostings.writeInt32LE(v, i * 4));

  const occKeyTable = writeStringTable(sorted.map((e) => e.occupationKey));
  const capKeyTable = writeStringTable(capKeysSorted);

  const sections = [occKeyTable, capKeyTable, essentialOff, essentialPostings, optionalOff, optionalPostings];
  const headerSize = 4 + 3 * 4 + NUM_SECTIONS * 4;
  const offsets: number[] = [];
  let pos = align4(headerSize);
  for (const sec of sections) {
    offsets.push(pos);
    pos = align4(pos + sec.length);
  }

  const out = Buffer.alloc(pos);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(VERSION, 4);
  out.writeUInt32LE(n, 8);
  out.writeUInt32LE(m, 12);
  offsets.forEach((o, i) => out.writeUInt32LE(o, 16 + i * 4));
  sections.forEach((sec, i) => sec.copy(out, offsets[i]));
  return out;
}

export class CapabilitiesBin {
  private readonly occTable: BinaryStringTable;
  private readonly capTable: BinaryStringTable;
  private readonly essentialOff: Uint32Array;
  private readonly essentialPostings: Int32Array;
  private readonly optionalOff: Uint32Array;
  private readonly optionalPostings: Int32Array;

  readonly size: number;

  private constructor(ab: ArrayBuffer) {
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not an OCB file');
    if (dv.getUint32(4, true) !== VERSION) throw new Error(`OCB version ${dv.getUint32(4, true)} != ${VERSION}`);
    const n = dv.getUint32(8, true);
    const m = dv.getUint32(12, true);
    this.size = n;
    const off = (i: number) => dv.getUint32(16 + i * 4, true);
    const bytes = new Uint8Array(ab);
    this.occTable = readStringTableAt(bytes, dv, off(0), n);
    this.capTable = readStringTableAt(bytes, dv, off(1), m);
    this.essentialOff = new Uint32Array(ab, off(2), n + 1);
    this.essentialPostings = new Int32Array(ab, off(3), this.essentialOff[n]);
    this.optionalOff = new Uint32Array(ab, off(4), n + 1);
    this.optionalPostings = new Int32Array(ab, off(5), this.optionalOff[n]);
  }

  static async load(path: string): Promise<CapabilitiesBin> {
    return timed(async () => {
      const buf = await readFile(path);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer; // fresh, aligned
      return new CapabilitiesBin(ab);
    }, `capabilities_bin_load path=${path}`);
  }

  static fromBuffer(buf: Buffer): CapabilitiesBin {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new CapabilitiesBin(ab);
  }

  has(occupationKey: string): boolean {
    return findInTable(this.occTable, occupationKey) >= 0;
  }

  /** 'essential' | 'optional' | null for a capability given an occupation. */
  relation(occupationKey: string, capabilityKey: string): 'essential' | 'optional' | null {
    const oi = findInTable(this.occTable, occupationKey);
    if (oi < 0) return null;
    const ci = findInTable(this.capTable, capabilityKey);
    if (ci < 0) return null;

    for (let p = this.essentialOff[oi]; p < this.essentialOff[oi + 1]; p++) {
      if (this.essentialPostings[p] === ci) return 'essential';
    }
    for (let p = this.optionalOff[oi]; p < this.optionalOff[oi + 1]; p++) {
      if (this.optionalPostings[p] === ci) return 'optional';
    }
    return null;
  }

  /** Essential capability/knowledge keys for an occupation (empty if unknown). */
  essentialFor(occupationKey: string): string[] {
    const oi = findInTable(this.occTable, occupationKey);
    if (oi < 0) return [];
    const out: string[] = [];
    for (let p = this.essentialOff[oi]; p < this.essentialOff[oi + 1]; p++) {
      out.push(stringAt(this.capTable, this.essentialPostings[p]));
    }
    return out;
  }
}
