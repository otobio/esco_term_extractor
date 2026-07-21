/**
 * Shared finite-bucket resolution — the single primitive used by BOTH the title
 * profile (`profiles/lookups.ts`) and the ingest structured path
 * (`ingest/index.ts`), so the two produce identical results for the same bucket +
 * input.
 *
 *   osFinalize()     → resolve OS candidates for a bucket into ranked ResolvedTerms
 *   finalizeFinite() → UNION that OS resolution with rule inference (highest score
 *                      per canonical key)
 *
 * This lives under matchers/ (next to the OS strategy code it depends on) rather
 * than in the inference layer, which stays OS-free.
 *
 * `ResolvedTerm.agreement` is an optional dense-embedding cosine in [0,1] between
 * the span and the resolved term, stamped only when a verifier is supplied — a
 * non-destructive check that a soft/fuzzy match (e.g. "senior python
 * developer"→sensor_engineer) is semantically real; never reorders or removes.
 * `agreementCrossLingual` is true when that score was computed cross-lingually
 * (no same-locale surface for the term, so it fell back to the English display
 * name) — cross-lingual cosine runs systematically lower, so such a score should
 * not be over-trusted. `verifyTargets` holds the term's own same-locale surfaces
 * (value + up to 2 aliases) gathered for a fair monolingual verify; empty means
 * no same-locale row, so verify falls back to the English display name. It is
 * internal to the verify step and deleted from the final result.
 *
 * `CandidateSource` governs ranking when several candidates resolve to different
 * keys within one bucket (see `osFinalize`): `span` (an exact alias span found in
 * the title) is most trustworthy, then `residual` (the occupation core after
 * peeling modifiers), then `clause` (the whole clause verbatim — prone to fuzzy
 * noise). `osFinalize` ranks grounded (exact) matches first, then residual over
 * full-clause, then raw score — the residual boost is a priority, not a magic
 * number, because a full clause out-scores a clean residual purely by having more
 * tokens to fuzzy-match (e.g. "senior python developer"→sensor_engineer 50 vs
 * residual "python developer" ~5).
 *
 * `FinalizeCtx.titleMode` is true for the title profile (short, terse text) — it
 * loosens rule-inference gates that are otherwise strict for noisier
 * body/description text; unset (falsy) for ingest/extractor callers. See
 * `inferFiniteBucket`'s `opts`.
 *
 * `finalizeFinite` UNIONS OS/dictionary resolution with rule-based inference,
 * highest score per canonical key: an OS term is kept but has its score lifted
 * and its status promoted to 'resolved' (inference is the higher-trust signal
 * for finite buckets, so a confirmed key clears an OS-side ambiguous tie); a
 * key only inference found is added fresh as a resolved term.
 */
import type { Clause } from '../tokenizer.js';
import type { BucketName } from '../types.js';
import type { TermMatchStrategy } from './types.js';
export interface ResolvedTerm {
    key: string;
    name: string;
    score: number;
    lang: string;
    status: 'resolved' | 'ambiguous';
    span: string;
    agreement?: number;
    agreementCrossLingual?: boolean;
    verifyTargets?: string[];
}
export type CandidateSource = 'span' | 'residual' | 'clause';
export declare const SOURCE_PREF: Record<CandidateSource, number>;
export interface Candidate {
    surface: string;
    source: CandidateSource;
}
export interface CandidateResult extends Candidate {
    response: unknown;
}
export interface FinalizeCtx {
    locale?: string;
    titleMode?: boolean;
}
export declare function osFinalize(bucket: BucketName, results: CandidateResult[], ctx: FinalizeCtx, strategy?: TermMatchStrategy): ResolvedTerm[];
export declare function finalizeFinite(bucket: BucketName, os: ResolvedTerm[], clauses: Clause[], ctx: FinalizeCtx): ResolvedTerm[];
