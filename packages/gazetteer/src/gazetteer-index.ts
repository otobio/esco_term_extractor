/**
 * Self-contained gazetteer index for location resolution.
 *
 * On disk (`gazetteer.json`): places[], parents[], surface map, majorCities.
 * At load we derive a trigram index and per-place name list for fuzzy matching,
 * keeping the file compact. No embeddings, no OpenSearch at query time.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeText } from './normalize.ts';
import { EXONYMS, MAJOR_CITIES } from './patterns.ts';
import { depthFromTermType, type GazetteerPlace } from './place.ts';
import type { DictionaryTerm } from './types.ts';

/** Injectable per-locale data (tests supply synthetic; production uses the merged
 *  pattern views by default). */
export interface GazetteerPatterns {
  majorCities?: ReadonlyMap<string, string>;
  exonyms?: ReadonlyMap<string, string>;
}

export const GAZETTEER_SCHEMA_VERSION = 2;

export interface LocationEdge {
  parentKey: string;
  childKey: string;
}

interface GazetteerFile {
  schemaVersion: number;
  places: GazetteerPlace[];
  /** placeIdx -> ancestor placeIdx (nearest parent first, walking up to the coarsest). */
  parents: number[][];
  /** normalizedName -> placeIdx[]. */
  surface: Record<string, number[]>;
}

const FILE = 'gazetteer.json';

/** "Cluj-Napoca, Cluj" -> "Cluj-Napoca" (strip a trailing ", county" suffix). */
function bareName(displayName: string): string {
  const comma = displayName.indexOf(',');
  return comma >= 0 ? displayName.slice(0, comma).trim() : displayName.trim();
}

function trigrams(norm: string): string[] {
  const s = ` ${norm} `;
  if (s.length <= 3) return [s];
  const out: string[] = [];
  for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3));
  return out;
}

/** Levenshtein distance, early-exit once it exceeds `max`. */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export interface FuzzyMatch {
  index: number;
  distance: number;
}

/**
 * The read-only surface the resolver needs. Both the JSON-backed {@link GazetteerIndex}
 * and the binary {@link GazetteerBin} implement it, so either can drive the resolver.
 */
export interface GazetteerReader {
  readonly size: number;
  place(index: number): GazetteerPlace;
  exact(normName: string): number[];
  fuzzy(token: string, minLen?: number): FuzzyMatch | null;
  parentsOf(index: number): number[];
  isLeaf(index: number): boolean;
  isMajor(index: number): boolean;
  indexOfKey(key: string): number | undefined;
}

export class GazetteerIndex implements GazetteerReader {
  private readonly keyToIdx: Map<string, number>;
  private readonly surfaceMap: Map<string, number[]>;
  private readonly namesByPlace: string[][];
  private readonly trigramIdx: Map<string, Set<number>>;
  private readonly maxDepthByLang: Map<string, number>;
  private readonly majorSet: Set<number>;

  private readonly majorCities: ReadonlyMap<string, string>;

  private constructor(
    readonly places: GazetteerPlace[],
    private readonly parentsArr: number[][],
    surface: Record<string, number[]>,
    // Injectable so tests can drive promotion/exonyms with synthetic data without
    // coupling to real locale data; production (and `load`) default to the merged views.
    patterns: GazetteerPatterns = {},
  ) {
    this.majorCities = patterns.majorCities ?? MAJOR_CITIES;
    this.keyToIdx = new Map(places.map((p, i) => [p.canonicalKey, i]));
    this.surfaceMap = new Map(Object.entries(surface));
    // Exonyms: extra exact surfaces pointing at an existing place's canonical key.
    for (const [exonym, key] of patterns.exonyms ?? EXONYMS) {
      const idx = this.keyToIdx.get(key);
      if (idx === undefined) continue;
      const norm = normalizeText(exonym);
      const arr = this.surfaceMap.get(norm) ?? [];
      if (!arr.includes(idx)) arr.push(idx);
      this.surfaceMap.set(norm, arr);
    }
    // Deepest tier present PER country (languageCode ≈ country): a place is a leaf
    // — and so needs corroboration — only when it sits at its own country's max
    // depth. RO leaf = depth 3, NG leaf = depth 2; no cross-country constant.
    this.maxDepthByLang = new Map();
    for (const p of places) {
      if (p.depth > (this.maxDepthByLang.get(p.languageCode) ?? 0)) this.maxDepthByLang.set(p.languageCode, p.depth);
    }
    // Derive per-place names + trigram index for fuzzy matching.
    this.namesByPlace = places.map(() => []);
    this.trigramIdx = new Map();
    for (const [norm, idxs] of this.surfaceMap) {
      for (const idx of idxs) this.namesByPlace[idx].push(norm);
      for (const tri of trigrams(norm)) {
        let set = this.trigramIdx.get(tri);
        if (!set) this.trigramIdx.set(tri, (set = new Set()));
        for (const idx of idxs) set.add(idx);
      }
    }
    this.majorSet = this.computeMajor();
  }

  get size(): number {
    return this.places.length;
  }

  place(index: number): GazetteerPlace {
    return this.places[index];
  }

  /** A leaf is the deepest tier for its country (RO locality, NG LGA) — the only
   *  tier that needs corroboration; every coarser container is trusted bare. */
  isLeaf(index: number): boolean {
    const p = this.places[index];
    return p.depth >= (this.maxDepthByLang.get(p.languageCode) ?? p.depth);
  }

  isMajor(index: number): boolean {
    return this.majorSet.has(index);
  }

  /** Always-trusted places: every container (non-leaf admin unit), plus known
   *  major cities (a leaf whose name maps — in MAJOR_CITIES — to the parent
   *  subdivision it actually sits under, so a same-named village elsewhere is not
   *  promoted). Computed at load so it tracks the depth model, not a stored list. */
  private computeMajor(): Set<number> {
    const major = new Set<number>();
    const slugOf = (key: string) => key.slice(key.lastIndexOf(':') + 1);
    for (let idx = 0; idx < this.places.length; idx++) {
      if (!this.isLeaf(idx)) {
        major.add(idx);
        continue;
      }
      const wantParent = this.majorCities.get(normalizeText(bareName(this.places[idx].displayName)));
      if (!wantParent) continue;
      if ((this.parentsArr[idx] ?? []).some((pi) => slugOf(this.places[pi].canonicalKey) === wantParent))
        major.add(idx);
    }
    return major;
  }

  /** Ancestor place indices, nearest-parent first (walking up to the coarsest). */
  parentsOf(index: number): number[] {
    return this.parentsArr[index] ?? [];
  }

  indexOfKey(key: string): number | undefined {
    return this.keyToIdx.get(key);
  }

  /** Exact place indices for an already-normalized name. */
  exact(normName: string): number[] {
    return this.surfaceMap.get(normName) ?? [];
  }

  /**
   * Best fuzzy match for a single normalized token (typo tolerance). Only for
   * tokens >= `minLen`; edit distance <= 1 (or 2 for long tokens). Returns null
   * when no place is within range.
   */
  fuzzy(token: string, minLen = 5): FuzzyMatch | null {
    if (token.length < minLen) return null;
    const maxDist = token.length >= 8 ? 2 : 1;
    // Candidate places sharing trigrams, ranked by shared-trigram count.
    const shared = new Map<number, number>();
    for (const tri of trigrams(token)) {
      const set = this.trigramIdx.get(tri);
      if (!set) continue;
      for (const idx of set) shared.set(idx, (shared.get(idx) ?? 0) + 1);
    }
    const candidates = [...shared.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
    let best: FuzzyMatch | null = null;
    for (const [idx] of candidates) {
      for (const name of this.namesByPlace[idx]) {
        if (Math.abs(name.length - token.length) > maxDist) continue;
        const d = boundedLevenshtein(token, name, maxDist);
        if (d <= maxDist && (!best || d < best.distance)) best = { index: idx, distance: d };
      }
      if (best && best.distance === 0) break;
    }
    return best;
  }

  static async load(dir: string): Promise<GazetteerIndex> {
    const data: GazetteerFile = JSON.parse(await readFile(join(dir, FILE), 'utf8'));
    if (data.schemaVersion !== GAZETTEER_SCHEMA_VERSION) {
      throw new Error(
        `Gazetteer schema ${data.schemaVersion} != ${GAZETTEER_SCHEMA_VERSION}; rebuild with 'npm run build:gazetteer'.`,
      );
    }
    return new GazetteerIndex(data.places, data.parents, data.surface);
  }

  /** In-memory build (used by build.save and by tests). `patterns` is injectable so
   *  tests can drive promotion/exonyms with synthetic data; omit for production. */
  static fromTerms(
    locationTerms: DictionaryTerm[],
    edges: LocationEdge[],
    patterns?: GazetteerPatterns,
  ): GazetteerIndex {
    const built = GazetteerIndex.build(locationTerms, edges);
    return new GazetteerIndex(built.places, built.parents, built.surface, patterns);
  }

  private static build(locationTerms: DictionaryTerm[], edges: LocationEdge[]): GazetteerFile {
    // One place row per canonical key; aggregate surfaces across all language rows.
    const keyToIdx = new Map<string, number>();
    const places: GazetteerPlace[] = [];
    const surfacesByIdx: Set<string>[] = [];

    for (const t of locationTerms) {
      let idx = keyToIdx.get(t.canonicalKey);
      if (idx === undefined) {
        idx = places.length;
        keyToIdx.set(t.canonicalKey, idx);
        places.push({
          canonicalKey: t.canonicalKey,
          displayName: t.displayName,
          depth: depthFromTermType(t.termType),
          languageCode: t.languageCode,
        });
        surfacesByIdx.push(new Set());
      } else if (t.languageCode === 'ro' && places[idx].languageCode !== 'ro') {
        // Prefer a Romanian display name when available.
        places[idx].displayName = t.displayName;
        places[idx].languageCode = 'ro';
      }
      const set = surfacesByIdx[idx];
      for (const s of [t.displayName, t.value, bareName(t.displayName), ...t.aliases]) {
        const norm = normalizeText(s ?? '');
        // Require >= 3 chars: 2-letter county codes (CJ, IS, MS, IF, CT) normalize
        // to common words ("is", "if", "ms") and would match everywhere.
        if (norm.length >= 3 && !/^\d+$/.test(norm)) set.add(norm);
      }
    }

    // Surface map.
    const surface: Record<string, number[]> = {};
    for (let idx = 0; idx < surfacesByIdx.length; idx++) {
      for (const norm of surfacesByIdx[idx]) (surface[norm] ??= []).push(idx);
    }

    // Hierarchy: child -> nearest parent, then walk up to collect ancestors.
    const parentKeyOf = new Map<string, string>();
    for (const e of edges) parentKeyOf.set(e.childKey, e.parentKey);
    const parents: number[][] = places.map((p) => {
      const chain: number[] = [];
      let cur = parentKeyOf.get(p.canonicalKey);
      const seen = new Set<string>([p.canonicalKey]);
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const pIdx = keyToIdx.get(cur);
        if (pIdx !== undefined) chain.push(pIdx);
        cur = parentKeyOf.get(cur);
      }
      return chain;
    });

    // Always-trusted places (containers + known major cities) are derived at load
    // from the depth model — see computeMajor — so they are not stored here.
    return { schemaVersion: GAZETTEER_SCHEMA_VERSION, places, parents, surface };
  }

  static async save(dir: string, locationTerms: DictionaryTerm[], edges: LocationEdge[]): Promise<number> {
    await mkdir(dir, { recursive: true });
    const file = GazetteerIndex.build(locationTerms, edges);
    await writeFile(join(dir, FILE), JSON.stringify(file));
    return file.places.length;
  }
}

export type { GazetteerPlace };
