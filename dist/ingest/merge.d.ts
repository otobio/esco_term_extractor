import type { CanonicalMatch, SearchBucket } from './index.js';
export type MergeTier = 'structured' | 'profile' | 'unstructured';
/** Map a match to its precedence tier off `evidenceSignal` (structured / title profile / body). */
export declare function defaultTierOf(match: CanonicalMatch): MergeTier;
export interface MergePolicy {
    /** Assign each match to a precedence tier (default: {@link defaultTierOf}). */
    tierOf?: (match: CanonicalMatch) => MergeTier;
    /** Minimum confidence to admit a match from a tier. Default: structured 0, profile 0, unstructured 0.75. */
    minConfidence?: Partial<Record<MergeTier, number>>;
    /** Buckets a tier may contribute to (omitted tier = all buckets). Default confines `unstructured` off identity buckets. */
    allowedBuckets?: Partial<Record<MergeTier, ReadonlySet<SearchBucket>>>;
    /** Max keys admitted per bucket from a tier (0 / omitted = unlimited). Default caps `unstructured` at 8. */
    maxPerBucket?: Partial<Record<MergeTier, number>>;
}
/**
 * Merge matches by signal priority. Trusted tiers (structured, profile) coexist
 * and win any bucket they touch; the unstructured tier is admitted only where no
 * trusted tier claimed the bucket, and only after its gate, bucket policy and cap.
 */
export declare function mergeSignals(matches: CanonicalMatch[], policy?: MergePolicy): CanonicalMatch[];
