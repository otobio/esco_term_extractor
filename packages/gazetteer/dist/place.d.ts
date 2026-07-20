import type { SupportedLanguage } from './types.js';
/**
 * Location depth, counted from the country root: depth 1 = the coarsest subdivision
 * under the country (RO region, NG state), increasing toward the leaf (RO locality,
 * NG LGA). Only the ORDER is comparable across countries, not the absolute value —
 * RO has 3 tiers (region/county/locality), NG has 2 (state/LGA). So the resolver
 * decides trust by whether a place is the LEAF of its own country
 * (`GazetteerIndex.isLeaf`), never by a fixed depth cutoff.
 */
export declare const LEAF_DEPTH_FALLBACK = 99;
/** Parse a `depthN` term type to its integer; anything else falls back to a leaf. */
export declare function depthFromTermType(termType: string): number;
/** A place as stored in the gazetteer index (one row per canonical key). */
export interface GazetteerPlace {
    canonicalKey: string;
    displayName: string;
    /** Depth from the country root (1 = coarsest). See {@link depthFromTermType}. */
    depth: number;
    languageCode: SupportedLanguage;
}
