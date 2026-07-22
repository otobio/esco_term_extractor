/**
 * Uniform per-bucket lookup for the title profile.
 *
 * Every bucket implements the SAME `BucketLookup` interface, with its own
 * mechanism behind it — so the pipeline treats them identically, with no
 * per-bucket special-casing. Two phases keep a single `_msearch`:
 *
 *   candidates() → OS surfaces to probe (empty for locally-resolved buckets)
 *   finalize()   → this bucket's results, from its OS responses and/or locally
 *
 * Mechanisms:
 *   - occupation / capabilities → openSemanticLookup: alias spans + a whole-clause
 *     fallback; resolved by the OS additive strategy (handles paraphrase).
 *   - finite buckets            → aliasLookup: exact alias spans; OS lexical.
 *   - location                  → gazetteerLookup: resolved locally by the gazetteer.
 */
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import type { LexicalHit } from '../lexical-index.js';
import { type Candidate, type CandidateResult, type FinalizeCtx, type ResolvedTerm } from '../matchers/finite.js';
import type { Clause } from '../tokenizer.js';
import type { BucketName, ExtractedTerm } from '../types.js';
export type { Candidate, CandidateResult, ResolvedTerm };
/** Title-profile lookup context: the finite-resolution slice ({@link FinalizeCtx})
 *  plus the extra fields the title scan needs. */
export interface LookupCtx extends FinalizeCtx {
    /** Gazetteer COUNTRY gate (ro/ng/hu/ee) — distinct from `locale`. A Nigerian
     *  listing is country `ng` even when its text language is English. */
    countryCode?: string;
    gazetteer?: GazetteerResolver;
    /** Per-clause residual segments (clause minus peel-bucket spans). Used as extra
     *  occupation candidates so a modifier-wrapped title resolves on its core. */
    residual?: string[][];
    /** Location terms resolved up front, ahead of the residual (see `PEEL_BUCKETS`).
     *  `gazetteerLookup.finalize` reads this instead of re-resolving. */
    locationTerms?: ExtractedTerm[];
}
export interface BucketLookup {
    readonly bucket: BucketName;
    /** True if this bucket's matched spans get peeled from the occupation residual
     *  (see `PEEL_BUCKETS`; location peels too, but not via this flag). */
    readonly peels?: boolean;
    /** OS candidates from the per-clause scan; `[]` for local-only buckets. */
    candidates(clauses: Clause[], scan: LexicalHit[][], ctx: LookupCtx): Candidate[];
    /** This bucket's results, from its OS responses and/or local resolution. */
    finalize(results: CandidateResult[], clauses: Clause[], ctx: LookupCtx): ResolvedTerm[];
}
/**
 * Residual segments per clause: contiguous tokens NOT covered by any peel-bucket
 * span, with boundary stopwords dropped. Empty when nothing peeled (so the
 * residual would just equal the clause). These become extra occupation
 * candidates — e.g. peel level "head" from "Head of VPS Infrastructure" →
 * residual "vps infrastructure".
 *
 * `extraGrams` peels additional matched spans that don't come from the shared
 * alias scan — namely the gazetteer's matched location text (see `resolveTitle`),
 * which is resolved through a separate mechanism but should peel the same way.
 * Applied uniformly to every clause; a gram absent from a given clause's tokens is
 * a harmless no-op (same as an alias-scan gram that doesn't appear there).
 */
export declare function computeResidual(clauses: Clause[], scan: LexicalHit[][], peelBuckets: Set<BucketName>, locale?: string, extraGrams?: string[]): string[][];
/** Finite buckets: exact alias spans confirmed by OS, UNIONED with our rule-based
 *  inference (dictionary + inference, highest score per canonical key wins). */
export declare function aliasLookup(bucket: BucketName, opts?: {
    peels?: boolean;
}): BucketLookup;
/**
 * Open semantic buckets: exact alias spans, plus (optionally) a whole-clause
 * fallback for a clause that yielded no span — so un-anchored surfaces still
 * resolve via the additive strategy.
 *
 * `wholeClauseFallback` is ON for occupation (a title's un-anchored phrase IS
 * the occupation, e.g. "Head of VPS Infrastructure") but OFF for capabilities —
 * a whole title is almost never a skill phrase, so that fallback was pure noise
 * (~77% of titles). Capabilities therefore resolves from spans only.
 */
export declare function openSemanticLookup(bucket: BucketName, opts?: {
    wholeClauseFallback?: boolean;
    dropGenericHeads?: boolean;
}): BucketLookup;
/** Location: resolved locally by the gazetteer (no OS probes) — via `ctx.locationTerms`,
 *  resolved early in `resolveTitle` rather than here (see `PEEL_BUCKETS`). */
export declare const gazetteerLookup: BucketLookup;
/** Every bucket lookup the title profile runs (uniform interface, own mechanism). */
export declare const LOOKUPS: BucketLookup[];
