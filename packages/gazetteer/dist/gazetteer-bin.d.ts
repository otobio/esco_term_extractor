import { type FuzzyMatch, type GazetteerReader } from './gazetteer-index.js';
import type { LocationRecord } from './location-store.js';
import type { GazetteerPlace } from './place.js';
import { GazetteerResolver } from './resolver.js';
/** Build the GZB buffer from the curated dataset records. Pure. */
export declare function pack(records: LocationRecord[]): Buffer;
export declare class GazetteerBin implements GazetteerReader {
    private readonly depth;
    private readonly country;
    private readonly flags;
    private readonly population;
    private readonly ancOff;
    private readonly ancestors;
    private readonly keyOff;
    private readonly keyBlob;
    private readonly nameOff;
    private readonly nameBlob;
    private readonly surfOff;
    private readonly postOff;
    private readonly postings;
    private readonly surfBlob;
    private readonly countryDict;
    private keyToIdx?;
    private fuzzyIdx?;
    readonly size: number;
    private constructor();
    static load(path: string): Promise<GazetteerBin>;
    static fromBuffer(buf: Buffer): GazetteerBin;
    private key;
    private surf;
    place(i: number): GazetteerPlace;
    /** Binary search the byte-sorted surface dictionary → its postings (place ids).
     *  Compares UTF-8 bytes directly — no string decode/allocation on the hot path. */
    exact(normName: string): number[];
    parentsOf(i: number): number[];
    isLeaf(i: number): boolean;
    isMajor(i: number): boolean;
    dominant(i: number): boolean;
    stopword(i: number): boolean;
    populationOf(i: number): number | null;
    indexOfKey(key: string): number | undefined;
    /** Normalized surfaces of stop-word places — feed into the resolver's stopNames. */
    stopSurfaces(): string[];
    /** Lazy trigram index (built only if the structured/fuzzy path is ever used). */
    fuzzy(token: string, minLen?: number): FuzzyMatch | null;
    private buildFuzzy;
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
export declare const DATA_DIR: string;
export declare function openGazetteer(dataDir?: string): Promise<GazetteerResolver | undefined>;
/** Synchronous variant of {@link openGazetteer} (binary only, no JSON fallback) —
 *  for the inference-layer global that must initialize on a sync code path. */
export declare function openGazetteerSync(dataDir?: string): GazetteerResolver | undefined;
