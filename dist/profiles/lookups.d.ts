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
import type { BucketName } from '../types.js';
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
}
export interface BucketLookup {
    readonly bucket: BucketName;
    /** True if this bucket's matched spans are "modifiers" that get peeled from the
     *  occupation residual (level/location/workplace/schedule/employment/company_size). */
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
 */
export declare function computeResidual(clauses: Clause[], scan: LexicalHit[][], peelBuckets: Set<BucketName>, locale?: string): string[][];
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
/** Location: resolved locally by the gazetteer (no OS probes). */
export declare const gazetteerLookup: BucketLookup;
/** Every bucket lookup the title profile runs (uniform interface, own mechanism). */
export declare const LOOKUPS: BucketLookup[];
