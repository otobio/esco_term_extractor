/**
 * lexical-bin.ts — the shipped runtime artifact for the lexical alias index: a
 * compact, memory-lean binary ("LXB1") packed from the canonical alias map,
 * plus a zero-parse loader. Mirrors `packages/gazetteer/src/gazetteer-bin.ts`.
 *
 * Why binary: the JSON index (`lexical.json`, tens of MB) re-parses text and
 * materializes an object per entry plus a `Map` over every alias — heavy in both
 * load time and resident memory, paid on every cold start. LXB stores the same
 * data as columnar typed arrays + UTF-8 blobs in one little-endian buffer, loaded
 * as ArrayBuffer VIEWS (no copy, no parse). Only matched entries decode a string;
 * nothing is materialized up front.
 *
 * Layout (all offsets absolute, numeric sections 4-byte aligned):
 *   header: magic "LXB1" · u32 version · u32 entryCount · u32 aliasCount ·
 *           u32 bucketDictCount · u32 langDictCount · u32 termTypeDictCount ·
 *           u32 sectionOffset[14]
 *   sections: bucketDict · langDict · termTypeDict · bucket(u8) · lang(u8) ·
 *   termType(u8) · keyOff(u32) · keyBlob · nameOff(u32) · nameBlob ·
 *   aliasOff(u32) · postOff(u32) · postings(i32) · aliasBlob
 *
 * `bucket`/`lang`/`termType` are dict-encoded (small closed-ish sets) rather than
 * hardcoded against `types.ts`'s unions, so the format survives new buckets/langs/
 * term types without a version bump.
 */
import { readFile } from 'node:fs/promises';
import { timed } from '@term-extractor/utils/perf';
import type { BucketName, SupportedLanguage } from './types.js';
import type { LexicalEntry } from './lexical-index.js';

const MAGIC = 0x4c584231; // "LXB1"
const VERSION = 1;
const NUM_SECTIONS = 14;
const align4 = (n: number): number => (n + 3) & ~3;

const dictBuf = (list: string[]): Buffer =>
  Buffer.concat(
    list.map((s) => {
      const b = Buffer.from(s, 'utf8');
      return Buffer.concat([Buffer.from([b.length]), b]);
    }),
  );

// ─────────────────────────────────────────────────────────────────────── pack

/** Build the LXB buffer from an already-resolved entries/alias map. Pure. */
export function pack(entries: LexicalEntry[], byAlias: Map<string, number[]>): Buffer {
  const n = entries.length;
  const bucketList = [...new Set(entries.map((e) => e.bucket))];
  const bucketIdx = new Map(bucketList.map((b, i) => [b, i]));
  const langList = [...new Set(entries.map((e) => e.languageCode))];
  const langIdx = new Map(langList.map((l, i) => [l, i]));
  const ttList = [...new Set(entries.map((e) => e.termType))];
  const ttIdx = new Map(ttList.map((t, i) => [t, i]));

  const bucketArr = Buffer.alloc(n);
  const langArr = Buffer.alloc(n);
  const ttArr = Buffer.alloc(n);
  const keyOff = Buffer.alloc((n + 1) * 4);
  const nameOff = Buffer.alloc((n + 1) * 4);
  const keyParts: Buffer[] = [];
  const nameParts: Buffer[] = [];
  let keyPos = 0,
    namePos = 0;

  entries.forEach((e, i) => {
    bucketArr[i] = bucketIdx.get(e.bucket)!;
    langArr[i] = langIdx.get(e.languageCode)!;
    ttArr[i] = ttIdx.get(e.termType)!;
    keyOff.writeUInt32LE(keyPos, i * 4);
    const kb = Buffer.from(e.canonicalKey, 'utf8');
    keyParts.push(kb);
    keyPos += kb.length;
    nameOff.writeUInt32LE(namePos, i * 4);
    const nb = Buffer.from(e.displayName, 'utf8');
    nameParts.push(nb);
    namePos += nb.length;
  });
  keyOff.writeUInt32LE(keyPos, n * 4);
  nameOff.writeUInt32LE(namePos, n * 4);
  const keyBlob = Buffer.concat(keyParts);
  const nameBlob = Buffer.concat(nameParts);

  // distinct aliases sorted by UTF-8 BYTES (matches the byte-compare in exact())
  const distinct = [...byAlias.keys()].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  const s = distinct.length;
  const aliasOff = Buffer.alloc((s + 1) * 4);
  const postOff = Buffer.alloc((s + 1) * 4);
  const aliasParts: Buffer[] = [];
  const postingsList: number[] = [];
  let aliasPos = 0,
    postPos = 0;
  distinct.forEach((alias, i) => {
    aliasOff.writeUInt32LE(aliasPos, i * 4);
    const ab = Buffer.from(alias, 'utf8');
    aliasParts.push(ab);
    aliasPos += ab.length;
    postOff.writeUInt32LE(postPos, i * 4);
    for (const idx of byAlias.get(alias)!) {
      postingsList.push(idx);
      postPos++;
    }
  });
  aliasOff.writeUInt32LE(aliasPos, s * 4);
  postOff.writeUInt32LE(postPos, s * 4);
  const aliasBlob = Buffer.concat(aliasParts);
  const postings = Buffer.alloc(postingsList.length * 4);
  postingsList.forEach((v, i) => postings.writeInt32LE(v, i * 4));

  const bucketDict = dictBuf(bucketList);
  const langDict = dictBuf(langList);
  const termTypeDict = dictBuf(ttList);

  const sections = [
    bucketDict,
    langDict,
    termTypeDict,
    bucketArr,
    langArr,
    ttArr,
    keyOff,
    keyBlob,
    nameOff,
    nameBlob,
    aliasOff,
    postOff,
    postings,
    aliasBlob,
  ];
  const headerSize = 4 + 6 * 4 + NUM_SECTIONS * 4; // magic + 6 counts + offsets (bucket/lang/tt dicts share sectionOffset slots too)
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
  out.writeUInt32LE(s, 12);
  out.writeUInt32LE(bucketList.length, 16);
  out.writeUInt32LE(langList.length, 20);
  out.writeUInt32LE(ttList.length, 24);
  offsets.forEach((o, i) => out.writeUInt32LE(o, 28 + i * 4));
  sections.forEach((sec, i) => sec.copy(out, offsets[i]));
  return out;
}

// ─────────────────────────────────────────────────────────────────────── load

const dec = new TextDecoder();

export class LexicalBin {
  private readonly bucket: Uint8Array;
  private readonly lang: Uint8Array;
  private readonly termType: Uint8Array;
  private readonly keyOff: Uint32Array;
  private readonly keyBlob: Uint8Array;
  private readonly nameOff: Uint32Array;
  private readonly nameBlob: Uint8Array;
  private readonly aliasOff: Uint32Array;
  private readonly postOff: Uint32Array;
  private readonly postings: Int32Array;
  private readonly aliasBlob: Uint8Array;
  private readonly bucketDict: string[];
  private readonly langDict: string[];
  private readonly termTypeDict: string[];
  private bucketIdx?: Map<string, number>;
  private langIdx?: Map<string, number>;

  readonly size: number;

  private constructor(ab: ArrayBuffer) {
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not an LXB file');
    if (dv.getUint32(4, true) !== VERSION) throw new Error(`LXB version ${dv.getUint32(4, true)} != ${VERSION}`);
    const n = dv.getUint32(8, true);
    const s = dv.getUint32(12, true);
    const bucketDictCount = dv.getUint32(16, true);
    const langDictCount = dv.getUint32(20, true);
    const ttDictCount = dv.getUint32(24, true);
    this.size = n;
    const off = (i: number) => dv.getUint32(28 + i * 4, true);
    const bytes = new Uint8Array(ab);
    const readDict = (start: number, count: number): { list: string[]; end: number } => {
      const list: string[] = [];
      let p = start;
      for (let i = 0; i < count; i++) {
        const len = bytes[p++];
        list.push(dec.decode(bytes.subarray(p, p + len)));
        p += len;
      }
      return { list, end: p };
    };
    this.bucketDict = readDict(off(0), bucketDictCount).list;
    this.langDict = readDict(off(1), langDictCount).list;
    this.termTypeDict = readDict(off(2), ttDictCount).list;
    this.bucket = new Uint8Array(ab, off(3), n);
    this.lang = new Uint8Array(ab, off(4), n);
    this.termType = new Uint8Array(ab, off(5), n);
    this.keyOff = new Uint32Array(ab, off(6), n + 1);
    this.keyBlob = new Uint8Array(ab, off(7), this.keyOff[n]);
    this.nameOff = new Uint32Array(ab, off(8), n + 1);
    this.nameBlob = new Uint8Array(ab, off(9), this.nameOff[n]);
    this.aliasOff = new Uint32Array(ab, off(10), s + 1);
    this.postOff = new Uint32Array(ab, off(11), s + 1);
    this.postings = new Int32Array(ab, off(12), this.postOff[s]);
    this.aliasBlob = new Uint8Array(ab, off(13), this.aliasOff[s]);
  }

  static async load(path: string): Promise<LexicalBin> {
    return timed(async () => {
      const buf = await readFile(path);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer; // fresh, aligned
      return new LexicalBin(ab);
    }, `lexical_bin_load path=${path}`);
  }

  static fromBuffer(buf: Buffer): LexicalBin {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new LexicalBin(ab);
  }

  /** Raw dict-index byte — cheap bucket compare in a hot scan loop (no string decode). */
  bucketAt(i: number): number {
    return this.bucket[i];
  }
  /** Raw dict-index byte — cheap language compare in a hot scan loop (no string decode). */
  langAt(i: number): number {
    return this.lang[i];
  }

  /** Reverse-lookup a bucket name to its dict index (memoized); -1 if absent from the data. */
  bucketIndex(name: BucketName): number {
    if (!this.bucketIdx) this.bucketIdx = new Map(this.bucketDict.map((b, i) => [b, i]));
    return this.bucketIdx.get(name) ?? -1;
  }
  /** Reverse-lookup a language code to its dict index (memoized); -1 if absent from the data. */
  langIndex(name: SupportedLanguage): number {
    if (!this.langIdx) this.langIdx = new Map(this.langDict.map((l, i) => [l, i]));
    return this.langIdx.get(name) ?? -1;
  }

  /** Full decode of one entry — only called for actual hits, not scan candidates. */
  entry(i: number): LexicalEntry {
    return {
      canonicalKey: dec.decode(this.keyBlob.subarray(this.keyOff[i], this.keyOff[i + 1])),
      bucket: this.bucketDict[this.bucket[i]] as BucketName,
      displayName: dec.decode(this.nameBlob.subarray(this.nameOff[i], this.nameOff[i + 1])),
      termType: this.termTypeDict[this.termType[i]],
      languageCode: this.langDict[this.lang[i]] as SupportedLanguage,
    };
  }

  /** Binary search the byte-sorted alias dictionary → its postings (entry ids).
   *  Compares UTF-8 bytes directly — no string decode/allocation on the hot path. */
  exact(norm: string): number[] {
    if (!norm) return [];
    const q = Buffer.from(norm, 'utf8');
    let lo = 0,
      hi = this.aliasOff.length - 2; // s-1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cmp = Buffer.compare(q, this.aliasBlob.subarray(this.aliasOff[mid], this.aliasOff[mid + 1]));
      if (cmp === 0) return Array.from(this.postings.subarray(this.postOff[mid], this.postOff[mid + 1]));
      if (cmp < 0) hi = mid - 1;
      else lo = mid + 1;
    }
    return [];
  }
}
