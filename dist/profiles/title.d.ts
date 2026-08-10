/**
 * Title resolve profile — a clear pipeline over the uniform BucketLookup set.
 *
 *   splitClauses         → clauses
 *   scan (lookupAll)     → per-clause alias hits (ONE number-aware pass, all buckets)
 *   location (gazetteer) → resolved early, local, no OS round trip
 *   residual             → peel modifier spans (level/workplace/…/location) → occupation core
 *   candidates           → each bucket's OS surfaces (its own mechanism)
 *   match (one _msearch)  → responses
 *   finalize             → each bucket's results (OS and/or local gazetteer)
 *
 * Candidate generation lives in its own stage, not inside the match loop, so the
 * pipeline reads top-to-bottom. Location resolves locally via the gazetteer;
 * occupation/capabilities via OS additive; finite buckets via OS lexical — all
 * behind the same interface, no per-bucket special-casing here.
 *
 * Two extra stages run after finalize: (7) an optional dense-agreement verify —
 * stamps each non-location resolved term with the MAX cosine in [0,1] between its
 * span and the term's same-locale surfaces (or the English display name as a
 * cross-lingual fallback), never reordering or removing; (8) collar_kind derived
 * from the resolved occupation via the occupation→collar graph edge, merged with
 * any explicitly-stated collar_kind (highest score per key) — runs after verify
 * so the derived, non-OS term is never sent for dense agreement; (9) essential
 * capabilities of that same occupation backfilled from the occupation→capability
 * graph, for any essential capability the title text never mentioned — low,
 * clearly-tagged score so a span-grounded capability always outranks it.
 *
 * The alt occupation engine (`inferOccupation`) is kicked off right after clause
 * splitting so it overlaps with the OS `_msearch`, and is awaited only at the
 * end. It is still in dev, so a failure must never break the profile — a
 * rejection degrades to no alt output, surfaced alongside `byBucket.occupation`
 * rather than merged into it.
 *
 * The alias scan (`lookupAll`) covers the locale plus `en`+`global`, mirroring
 * `buildFilters`, so English/global surfaces are always found even when the
 * locale is a country code whose surfaces are English (e.g. `ng` — English
 * titles, only the location stored as `ng`).
 *
 * `countryCode` gates the gazetteer by COUNTRY and is distinct from `locale`
 * (the text language) — defaults to `locale`, which coincides for single-country
 * locales but must be passed explicitly for en/hu/et callers.
 */
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import type { OccupationCapabilityMap } from '../derive/capabilities.js';
import type { CollarMap } from '../derive/collar.js';
import type { LexicalIndex } from '../lexical-index.js';
import type { OpenSearchClient } from '../matchers/types.js';
import type { ExtractedTerm } from '../types.js';
import { type ResolvedTerm } from './lookups.js';
export type { ResolvedTerm };
export type Verifier = (pairs: {
    span: string;
    texts: string[];
}[]) => Promise<number[]>;
export interface TitleDeps {
    client: OpenSearchClient;
    lexical: LexicalIndex;
    gazetteer?: GazetteerResolver;
    locale?: string;
    countryCode?: string;
    jobFunction?: string;
    verify?: Verifier;
    collar?: CollarMap;
    capabilities?: OccupationCapabilityMap;
}
export interface ProfileResult {
    clauses: string[];
    byBucket: Record<string, ResolvedTerm[]>;
    altOccupation?: ExtractedTerm[];
}
export declare function resolveTitle(text: string, deps: TitleDeps): Promise<ProfileResult>;
