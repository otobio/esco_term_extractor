/**
 * Generic signal-priority merge for canonical matches.
 *
 * Matches arrive from three kinds of source, ranked by how much we trust them:
 *
 *   structured   (1) — explicit fields (location, work_type, …). Authoritative.
 *   profile      (2) — a custom analysis of a free-text field (e.g. the `title`
 *                      profile deciding occupation). Authoritative; coexists with
 *                      structured but is dedup-checked against it.
 *   unstructured (3) — the whole-body firehose. Heavily gated: it may only fill
 *                      buckets no trusted tier claimed, must clear a confidence
 *                      floor, is capped per bucket, and is barred outright from
 *                      the identity buckets (occupation/level/location/…).
 *
 * The rule set is fixed; the thresholds, tier mapping and bucket policy are all
 * overridable so the same primitive can drive both `searchable` (strict) and
 * `ranking` (permissive), and be reused by any consumer.
 */
import { ALL_BUCKETS } from '../types.ts';
import type { CanonicalMatch, SearchBucket } from './index.ts';

export type MergeTier = 'structured' | 'profile' | 'unstructured';

const TIER_RANK: Record<MergeTier, number> = { structured: 0, profile: 1, unstructured: 2 };
const TRUSTED: ReadonlySet<MergeTier> = new Set<MergeTier>(['structured', 'profile']);

/** Identity buckets: a wrong firehose guess here is worst, so `unstructured` never sources them. */
const IDENTITY_BUCKETS: ReadonlySet<SearchBucket> = new Set<SearchBucket>([
  'occupation',
  'level',
  'location',
  'workplace',
  'employment',
]);
const DEFAULT_UNSTRUCTURED_BUCKETS: ReadonlySet<SearchBucket> = new Set(
  ALL_BUCKETS.filter((b) => !IDENTITY_BUCKETS.has(b)),
);

/** Map a match to its precedence tier off `evidenceSignal` (structured / title profile / body). */
export function defaultTierOf(match: CanonicalMatch): MergeTier {
  if (match.evidenceSignal === 'structured') return 'structured';
  if (match.evidenceSignal === 'title') return 'profile';
  return 'unstructured';
}

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

const DEFAULT_MIN_CONFIDENCE: Record<MergeTier, number> = { structured: 0, profile: 0, unstructured: 0.75 };
const DEFAULT_MAX_PER_BUCKET: Partial<Record<MergeTier, number>> = { unstructured: 8 };

/** `a` outranks `b`: higher tier authority first, then higher confidence. */
function outranks(a: CanonicalMatch, b: CanonicalMatch, tierOf: (m: CanonicalMatch) => MergeTier): boolean {
  const ra = TIER_RANK[tierOf(a)];
  const rb = TIER_RANK[tierOf(b)];
  if (ra !== rb) return ra < rb;
  return a.confidence > b.confidence;
}

/**
 * Merge matches by signal priority. Trusted tiers (structured, profile) coexist
 * and win any bucket they touch; the unstructured tier is admitted only where no
 * trusted tier claimed the bucket, and only after its gate, bucket policy and cap.
 */
export function mergeSignals(matches: CanonicalMatch[], policy: MergePolicy = {}): CanonicalMatch[] {
  const tierOf = policy.tierOf ?? defaultTierOf;
  const minConf: Record<MergeTier, number> = { ...DEFAULT_MIN_CONFIDENCE, ...policy.minConfidence };
  const allowed: Partial<Record<MergeTier, ReadonlySet<SearchBucket>>> = {
    unstructured: DEFAULT_UNSTRUCTURED_BUCKETS,
    ...policy.allowedBuckets,
  };
  const maxPer: Partial<Record<MergeTier, number>> = { ...DEFAULT_MAX_PER_BUCKET, ...policy.maxPerBucket };

  // 1. Admission filter (tier gate + per-tier bucket policy), grouped by bucket.
  const byBucket = new Map<SearchBucket, CanonicalMatch[]>();
  for (const match of matches) {
    const tier = tierOf(match);
    if (match.confidence < (minConf[tier] ?? 0)) continue;
    const allow = allowed[tier];
    if (allow && !allow.has(match.bucket)) continue;
    const list = byBucket.get(match.bucket);
    if (list) list.push(match);
    else byBucket.set(match.bucket, [match]);
  }

  // 2. Per bucket: trusted tiers claim it; dedupe by key keeping the top-ranked; cap the untrusted tail.
  const out: CanonicalMatch[] = [];
  for (const group of byBucket.values()) {
    const trustedClaimed = group.some((m) => TRUSTED.has(tierOf(m)));
    const best = new Map<string, CanonicalMatch>();
    for (const match of group) {
      if (trustedClaimed && !TRUSTED.has(tierOf(match))) continue;
      const current = best.get(match.canonicalKey);
      if (!current || outranks(match, current, tierOf)) best.set(match.canonicalKey, match);
    }
    out.push(...capByTier([...best.values()], tierOf, maxPer));
  }
  return out;
}

/** Keep only the top-confidence N keys for any tier with a finite cap; other tiers pass through. */
function capByTier(
  matches: CanonicalMatch[],
  tierOf: (m: CanonicalMatch) => MergeTier,
  maxPer: Partial<Record<MergeTier, number>>,
): CanonicalMatch[] {
  const counts = new Map<MergeTier, number>();
  return matches
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .filter((match) => {
      const tier = tierOf(match);
      const cap = maxPer[tier] ?? 0;
      if (!cap) return true;
      const seen = counts.get(tier) ?? 0;
      if (seen >= cap) return false;
      counts.set(tier, seen + 1);
      return true;
    });
}
