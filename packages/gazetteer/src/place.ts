import type { SupportedLanguage } from './types.ts';

/**
 * Location depth, counted from the country root: depth 1 = the coarsest subdivision
 * under the country (RO region, NG state), increasing toward the leaf (RO locality,
 * NG LGA). Only the ORDER is comparable across countries, not the absolute value —
 * RO has 3 tiers (region/county/locality), NG has 2 (state/LGA). So the resolver
 * decides trust by whether a place is the LEAF of its own country
 * (`GazetteerIndex.isLeaf`), never by a fixed depth cutoff.
 */
export const LEAF_DEPTH_FALLBACK = 99; // unknown/absent term type → treat as a leaf (safest gating)

/** Parse a `depthN` term type to its integer; anything else falls back to a leaf. */
export function depthFromTermType(termType: string): number {
  const m = /^depth(\d+)$/.exec((termType ?? '').trim());
  return m ? Number(m[1]) : LEAF_DEPTH_FALLBACK;
}

/** A place as stored in the gazetteer index (one row per canonical key). */
export interface GazetteerPlace {
  canonicalKey: string;
  displayName: string;
  /** Depth from the country root (1 = coarsest). See {@link depthFromTermType}. */
  depth: number;
  languageCode: SupportedLanguage;
}
