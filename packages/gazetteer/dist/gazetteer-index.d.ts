import { type GazetteerPlace } from './place.js';
import type { DictionaryTerm } from './types.js';
/** Injectable per-locale data (tests supply synthetic; production uses the merged
 *  pattern views by default). */
export interface GazetteerPatterns {
    majorCities?: ReadonlyMap<string, string>;
    exonyms?: ReadonlyMap<string, string>;
}
export declare const GAZETTEER_SCHEMA_VERSION = 2;
export interface LocationEdge {
    parentKey: string;
    childKey: string;
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
export declare class GazetteerIndex implements GazetteerReader {
    readonly places: GazetteerPlace[];
    private readonly parentsArr;
    private readonly keyToIdx;
    private readonly surfaceMap;
    private readonly namesByPlace;
    private readonly trigramIdx;
    private readonly maxDepthByLang;
    private readonly majorSet;
    private readonly majorCities;
    private constructor();
    get size(): number;
    place(index: number): GazetteerPlace;
    /** A leaf is the deepest tier for its country (RO locality, NG LGA) — the only
     *  tier that needs corroboration; every coarser container is trusted bare. */
    isLeaf(index: number): boolean;
    isMajor(index: number): boolean;
    /** Always-trusted places: every container (non-leaf admin unit), plus known
     *  major cities (a leaf whose name maps — in MAJOR_CITIES — to the parent
     *  subdivision it actually sits under, so a same-named village elsewhere is not
     *  promoted). Computed at load so it tracks the depth model, not a stored list. */
    private computeMajor;
    /** Ancestor place indices, nearest-parent first (walking up to the coarsest). */
    parentsOf(index: number): number[];
    indexOfKey(key: string): number | undefined;
    /** Exact place indices for an already-normalized name. */
    exact(normName: string): number[];
    /**
     * Best fuzzy match for a single normalized token (typo tolerance). Only for
     * tokens >= `minLen`; edit distance <= 1 (or 2 for long tokens). Returns null
     * when no place is within range.
     */
    fuzzy(token: string, minLen?: number): FuzzyMatch | null;
    static load(dir: string): Promise<GazetteerIndex>;
    /** In-memory build (used by build.save and by tests). `patterns` is injectable so
     *  tests can drive promotion/exonyms with synthetic data; omit for production. */
    static fromTerms(locationTerms: DictionaryTerm[], edges: LocationEdge[], patterns?: GazetteerPatterns): GazetteerIndex;
    private static build;
    static save(dir: string, locationTerms: DictionaryTerm[], edges: LocationEdge[]): Promise<number>;
}
export type { GazetteerPlace };
