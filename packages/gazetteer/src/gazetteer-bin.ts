/**
 * gazetteer-bin.ts — the shipped runtime artifact: a compact, memory-lean binary
 * ("GZB1") packed from the curated location dataset, plus a zero-parse loader.
 *
 * Why binary: the JSON index re-parses text and materializes a JS object per place,
 * a Map over every surface, and number[][] adjacency — heavy in both load time and
 * resident memory. GZB stores the same data as columnar typed arrays + UTF-8 blobs
 * in one little-endian buffer, loaded as ArrayBuffer VIEWS (no copy, no parse). Only
 * matched places decode a string; nothing is materialized up front.
 *
 * Layout (all offsets absolute, numeric sections 4-byte aligned):
 *   header: magic "GZB1" · u32 version · u32 placeCount · u32 surfCount ·
 *           u32 countryDictCount · u32 sectionOffset[18]
 *   sections: countryDict · depth(u8) · kind(u8) · country(u8) · flags(u8) ·
 *   population(i32) · prominence(u32) · parent(i32) · ancOff(u32) · ancestors(i32) ·
 *   keyOff(u32) · keyBlob · nameOff(u32) · nameBlob · surfOff(u32) · postOff(u32) ·
 *   postings(i32) · surfBlob
 *
 * flags bits: 1 capital · 2 seat · 4 dominant · 8 stopword · 16 isLeaf · 32 isMajor.
 * isLeaf/isMajor are PRECOMPUTED at pack time (isMajor = container | capital | seat |
 * dominant), so the runtime needs no patterns.ts and the same-name tiebreak (dominant
 * ⇒ trusted bare) is realized in data with no resolver change.
 *
 * Implements {@link GazetteerReader}: a drop-in for the resolver.
 *
 * CLI:  tsx src/gazetteer/gazetteer-bin.ts pack --file data/location --out data/gazetteer.gzb
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { timed } from '@term-extractor/utils/perf';
import { type FuzzyMatch, GazetteerIndex, type GazetteerReader } from './gazetteer-index.js';
import type { LocationRecord } from './location-store.js';
import type { GazetteerPlace } from './place.js';
import { GAZETTEER_CONFIG, GazetteerResolver } from './resolver.js';

const MAGIC = 0x475a4231; // "GZB1"
const VERSION = 1;
const KIND_CODE: Record<string, number> = { country: 0, admin1: 1, admin2: 2, admin3: 3, settlement: 4 };
const F_CAPITAL = 1,
  F_SEAT = 2,
  F_DOMINANT = 4,
  F_STOPWORD = 8,
  F_LEAF = 16,
  F_MAJOR = 32;
const NUM_SECTIONS = 18;
const align4 = (n: number): number => (n + 3) & ~3;

// ─────────────────────────────────────────────────────────────────────── pack

/** Build the GZB buffer from the curated dataset records. Pure. */
export function pack(records: LocationRecord[]): Buffer {
  const n = records.length;
  const idxOf = new Map<string, number>();
  records.forEach((r, i) => idxOf.set(r.key, i));

  const maxDepth = new Map<string, number>();
  for (const r of records) maxDepth.set(r.countryCode, Math.max(maxDepth.get(r.countryCode) ?? 0, r.depth));

  const countryList = [...new Set(records.map((r) => r.countryCode))];
  const countryIdx = new Map(countryList.map((c, i) => [c, i]));

  const depth = Buffer.alloc(n);
  const kind = Buffer.alloc(n);
  const country = Buffer.alloc(n);
  const flags = Buffer.alloc(n);
  const population = Buffer.alloc(n * 4);
  const prominence = Buffer.alloc(n * 4);
  const parent = Buffer.alloc(n * 4);
  const ancOff = Buffer.alloc((n + 1) * 4);
  const ancestorsList: number[] = [];
  const keyParts: Buffer[] = [];
  const nameParts: Buffer[] = [];
  const keyOff = Buffer.alloc((n + 1) * 4);
  const nameOff = Buffer.alloc((n + 1) * 4);
  let keyPos = 0,
    namePos = 0,
    ancPos = 0;

  // surface -> place ids (1:many)
  const surfaceMap = new Map<string, number[]>();

  records.forEach((r, i) => {
    depth[i] = r.depth;
    kind[i] = KIND_CODE[r.kind] ?? 4;
    country[i] = countryIdx.get(r.countryCode)!;
    const isLeaf = r.depth >= (maxDepth.get(r.countryCode) ?? r.depth);
    const isContainer = !isLeaf;
    const isMajor = isContainer || r.isCapital || r.isAdminSeat || r.dominant;
    flags[i] =
      (r.isCapital ? F_CAPITAL : 0) |
      (r.isAdminSeat ? F_SEAT : 0) |
      (r.dominant ? F_DOMINANT : 0) |
      (r.stopword ? F_STOPWORD : 0) |
      (isLeaf ? F_LEAF : 0) |
      (isMajor ? F_MAJOR : 0);
    population.writeInt32LE(r.population == null ? -1 : Math.min(r.population, 0x7fffffff), i * 4);
    prominence.writeUInt32LE(Math.min(Math.max(0, Math.round(r.prominence)), 0xffffffff), i * 4);
    parent.writeInt32LE(r.parentKey != null && idxOf.has(r.parentKey) ? idxOf.get(r.parentKey)! : -1, i * 4);

    ancOff.writeUInt32LE(ancPos, i * 4);
    let cur = r.parentKey;
    const seen = new Set<string>([r.key]);
    while (cur != null && idxOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      ancestorsList.push(idxOf.get(cur)!);
      ancPos++;
      cur = records[idxOf.get(cur)!].parentKey;
    }

    keyOff.writeUInt32LE(keyPos, i * 4);
    const kb = Buffer.from(r.key, 'utf8');
    keyParts.push(kb);
    keyPos += kb.length;
    nameOff.writeUInt32LE(namePos, i * 4);
    const nb = Buffer.from(r.name, 'utf8');
    nameParts.push(nb);
    namePos += nb.length;

    for (const s of r.surfaces) {
      const arr = surfaceMap.get(s.text);
      if (arr) {
        if (!arr.includes(i)) arr.push(i);
      } else surfaceMap.set(s.text, [i]);
    }
  });
  ancOff.writeUInt32LE(ancPos, n * 4);
  keyOff.writeUInt32LE(keyPos, n * 4);
  nameOff.writeUInt32LE(namePos, n * 4);

  const ancestors = Buffer.alloc(ancestorsList.length * 4);
  ancestorsList.forEach((v, i) => ancestors.writeInt32LE(v, i * 4));
  const keyBlob = Buffer.concat(keyParts);
  const nameBlob = Buffer.concat(nameParts);

  // distinct surfaces sorted by UTF-8 BYTES (matches the byte-compare in exact())
  const distinct = [...surfaceMap.keys()].sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')),
  );
  const s = distinct.length;
  const surfOff = Buffer.alloc((s + 1) * 4);
  const postOff = Buffer.alloc((s + 1) * 4);
  const surfParts: Buffer[] = [];
  const postingsList: number[] = [];
  let surfPos = 0,
    postPos = 0;
  distinct.forEach((surf, i) => {
    surfOff.writeUInt32LE(surfPos, i * 4);
    const sb = Buffer.from(surf, 'utf8');
    surfParts.push(sb);
    surfPos += sb.length;
    postOff.writeUInt32LE(postPos, i * 4);
    for (const pid of surfaceMap.get(surf)!) {
      postingsList.push(pid);
      postPos++;
    }
  });
  surfOff.writeUInt32LE(surfPos, s * 4);
  postOff.writeUInt32LE(postPos, s * 4);
  const surfBlob = Buffer.concat(surfParts);
  const postings = Buffer.alloc(postingsList.length * 4);
  postingsList.forEach((v, i) => postings.writeInt32LE(v, i * 4));

  // country dict: u16 count already in header; here u8-len-prefixed strings
  const dictParts: Buffer[] = [];
  for (const c of countryList) {
    const b = Buffer.from(c, 'utf8');
    dictParts.push(Buffer.from([b.length]), b);
  }
  const countryDict = Buffer.concat(dictParts);

  // assemble: header then sections (numeric sections 4-aligned)
  const sections = [
    countryDict,
    depth,
    kind,
    country,
    flags,
    population,
    prominence,
    parent,
    ancOff,
    ancestors,
    keyOff,
    keyBlob,
    nameOff,
    nameBlob,
    surfOff,
    postOff,
    postings,
    surfBlob,
  ];
  const headerSize = 4 + 4 * 4 + NUM_SECTIONS * 4; // magic + 4 counts + offsets
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
  out.writeUInt32LE(countryList.length, 16);
  offsets.forEach((o, i) => out.writeUInt32LE(o, 20 + i * 4));
  sections.forEach((sec, i) => sec.copy(out, offsets[i]));
  return out;
}

// ─────────────────────────────────────────────────────────────────────── load

const dec = new TextDecoder();

export class GazetteerBin implements GazetteerReader {
  private readonly depth: Uint8Array;
  private readonly country: Uint8Array;
  private readonly flags: Uint8Array;
  private readonly population: Int32Array;
  private readonly ancOff: Uint32Array;
  private readonly ancestors: Int32Array;
  private readonly keyOff: Uint32Array;
  private readonly keyBlob: Uint8Array;
  private readonly nameOff: Uint32Array;
  private readonly nameBlob: Uint8Array;
  private readonly surfOff: Uint32Array;
  private readonly postOff: Uint32Array;
  private readonly postings: Int32Array;
  private readonly surfBlob: Uint8Array;
  private readonly countryDict: string[];
  private keyToIdx?: Map<string, number>;
  private fuzzyIdx?: { tri: Map<string, number[]>; names: string[]; place: Int32Array };

  readonly size: number;

  private constructor(ab: ArrayBuffer) {
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a GZB file');
    if (dv.getUint32(4, true) !== VERSION) throw new Error(`GZB version ${dv.getUint32(4, true)} != ${VERSION}`);
    const n = dv.getUint32(8, true);
    const s = dv.getUint32(12, true);
    const dictCount = dv.getUint32(16, true);
    this.size = n;
    const off = (i: number) => dv.getUint32(20 + i * 4, true);
    this.depth = new Uint8Array(ab, off(1), n);
    // off(2) kind, off(6) prominence, off(7) parent are packed but not materialized
    // (no accessor uses them yet); add a field + view when a feature needs them.
    this.country = new Uint8Array(ab, off(3), n);
    this.flags = new Uint8Array(ab, off(4), n);
    this.population = new Int32Array(ab, off(5), n);
    this.ancOff = new Uint32Array(ab, off(8), n + 1);
    this.ancestors = new Int32Array(ab, off(9), this.ancOff[n]);
    this.keyOff = new Uint32Array(ab, off(10), n + 1);
    this.keyBlob = new Uint8Array(ab, off(11), this.keyOff[n]);
    this.nameOff = new Uint32Array(ab, off(12), n + 1);
    this.nameBlob = new Uint8Array(ab, off(13), this.nameOff[n]);
    this.surfOff = new Uint32Array(ab, off(14), s + 1);
    this.postOff = new Uint32Array(ab, off(15), s + 1);
    this.postings = new Int32Array(ab, off(16), this.postOff[s]);
    this.surfBlob = new Uint8Array(ab, off(17), this.surfOff[s]);
    // country dict
    this.countryDict = [];
    let p = off(0);
    const bytes = new Uint8Array(ab);
    for (let i = 0; i < dictCount; i++) {
      const len = bytes[p++];
      this.countryDict.push(dec.decode(bytes.subarray(p, p + len)));
      p += len;
    }
  }

  static async load(path: string): Promise<GazetteerBin> {
    const buf = await readFile(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer; // fresh, aligned
    return new GazetteerBin(ab);
  }

  static fromBuffer(buf: Buffer): GazetteerBin {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new GazetteerBin(ab);
  }

  private key(i: number): string {
    return dec.decode(this.keyBlob.subarray(this.keyOff[i], this.keyOff[i + 1]));
  }
  private surf(i: number): string {
    return dec.decode(this.surfBlob.subarray(this.surfOff[i], this.surfOff[i + 1]));
  }

  place(i: number): GazetteerPlace {
    return {
      canonicalKey: this.key(i),
      displayName: dec.decode(this.nameBlob.subarray(this.nameOff[i], this.nameOff[i + 1])),
      depth: this.depth[i],
      languageCode: this.countryDict[this.country[i]] as GazetteerPlace['languageCode'],
    };
  }

  /** Binary search the byte-sorted surface dictionary → its postings (place ids).
   *  Compares UTF-8 bytes directly — no string decode/allocation on the hot path. */
  exact(normName: string): number[] {
    if (!normName) return [];
    const q = Buffer.from(normName, 'utf8');
    let lo = 0,
      hi = this.surfOff.length - 2; // s-1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cmp = Buffer.compare(q, this.surfBlob.subarray(this.surfOff[mid], this.surfOff[mid + 1]));
      if (cmp === 0) return Array.from(this.postings.subarray(this.postOff[mid], this.postOff[mid + 1]));
      if (cmp < 0) hi = mid - 1;
      else lo = mid + 1;
    }
    return [];
  }

  parentsOf(i: number): number[] {
    return Array.from(this.ancestors.subarray(this.ancOff[i], this.ancOff[i + 1]));
  }
  isLeaf(i: number): boolean {
    return (this.flags[i] & F_LEAF) !== 0;
  }
  isMajor(i: number): boolean {
    return (this.flags[i] & F_MAJOR) !== 0;
  }
  dominant(i: number): boolean {
    return (this.flags[i] & F_DOMINANT) !== 0;
  }
  stopword(i: number): boolean {
    return (this.flags[i] & F_STOPWORD) !== 0;
  }
  populationOf(i: number): number | null {
    return this.population[i] < 0 ? null : this.population[i];
  }

  indexOfKey(key: string): number | undefined {
    if (!this.keyToIdx) {
      this.keyToIdx = new Map();
      for (let i = 0; i < this.size; i++) this.keyToIdx.set(this.key(i), i);
    }
    return this.keyToIdx.get(key);
  }

  /** Normalized surfaces of stop-word places — feed into the resolver's stopNames. */
  stopSurfaces(): string[] {
    const out = new Set<string>();
    for (let i = 0; i < this.surfOff.length - 1; i++) {
      const places = this.postings.subarray(this.postOff[i], this.postOff[i + 1]);
      if ([...places].some((p) => this.stopword(p))) out.add(this.surf(i));
    }
    return [...out];
  }

  /** Lazy trigram index (built only if the structured/fuzzy path is ever used). */
  fuzzy(token: string, minLen = 5): FuzzyMatch | null {
    if (token.length < minLen) return null;
    if (!this.fuzzyIdx) this.buildFuzzy();
    const { tri, names, place } = this.fuzzyIdx!;
    const maxDist = token.length >= 8 ? 2 : 1;
    const shared = new Map<number, number>();
    for (const t of trigrams(token)) for (const id of tri.get(t) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1);
    const cands = [...shared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
    let best: FuzzyMatch | null = null;
    for (const [id] of cands) {
      const name = names[id];
      if (Math.abs(name.length - token.length) > maxDist) continue;
      const d = bounded(token, name, maxDist);
      if (d <= maxDist && (!best || d < best.distance)) best = { index: place[id], distance: d };
      if (best?.distance === 0) break;
    }
    return best;
  }

  private buildFuzzy(): void {
    const s = this.surfOff.length - 1;
    const names: string[] = new Array(s);
    const place = new Int32Array(s);
    const tri = new Map<string, number[]>();
    for (let i = 0; i < s; i++) {
      const name = this.surf(i);
      names[i] = name;
      place[i] = this.postings[this.postOff[i]]; // first place for this surface
      for (const t of trigrams(name)) {
        let a = tri.get(t);
        if (!a) tri.set(t, (a = []));
        a.push(i);
      }
    }
    this.fuzzyIdx = { tri, names, place };
  }
}

/**
 * Open the runtime gazetteer for `dataDir`: prefers the packed binary
 * (`gazetteer.gzb`), wiring its stop-word surfaces into the resolver's stopNames;
 * falls back to the legacy JSON index; `undefined` if neither is present. The
 * extractor shares ONE resolver, so this backs both free-text and structured
 * location resolution.
 */
/** The package's own data directory (holds gazetteer.gzb / gazetteer.json / location/).
 *  Resolved from this module so it works regardless of the caller's CWD. */
export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

export async function openGazetteer(dataDir: string = DATA_DIR): Promise<GazetteerResolver | undefined> {
  return timed(async () => {
    try {
      const bin = await GazetteerBin.load(join(dataDir, 'gazetteer.gzb'));
      return resolverFor(bin);
    } catch {
      try {
        return new GazetteerResolver(await GazetteerIndex.load(dataDir));
      } catch {
        return undefined;
      }
    }
  }, `gazetteer_load path=${dataDir}`);
}

/** Synchronous variant of {@link openGazetteer} (binary only, no JSON fallback) —
 *  for the inference-layer global that must initialize on a sync code path. */
export function openGazetteerSync(dataDir: string = DATA_DIR): GazetteerResolver | undefined {
  const t0 = performance.now();
  try {
    return resolverFor(GazetteerBin.fromBuffer(readFileSync(join(dataDir, 'gazetteer.gzb'))));
  } catch {
    return undefined;
  } finally {
    console.error(`[perf] gazetteer_load_sync path=${dataDir} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

function resolverFor(bin: GazetteerBin): GazetteerResolver {
  const stopNames = new Set<string>([...GAZETTEER_CONFIG.stopNames, ...bin.stopSurfaces()]);
  return new GazetteerResolver(bin, { ...GAZETTEER_CONFIG, stopNames });
}

function trigrams(norm: string): string[] {
  const str = ` ${norm} `;
  if (str.length <= 3) return [str];
  const out: string[] = [];
  for (let i = 0; i + 3 <= str.length; i++) out.push(str.slice(i, i + 3));
  return out;
}
function bounded(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// ───────────────────────────────────────────────────────────────────────── CLI

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string', default: 'data/location' },
      out: { type: 'string', default: 'data/gazetteer.gzb' },
    },
  });
  if ((positionals[0] ?? 'pack') !== 'pack') {
    console.error('only command: pack');
    process.exit(1);
  }
  const { loadFile } = await import('./location-store.js'); // dataset-builder dep kept out of the runtime graph
  const { records } = await loadFile(values.file!);
  const buf = pack(records);
  await writeFile(values.out!, buf);
  console.log(`packed ${records.length} places → ${values.out} (${(buf.length / 1024).toFixed(0)} KB)`);
}
const invokedDirectly = process.argv[1] != null && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
