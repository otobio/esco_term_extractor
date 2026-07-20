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
 * highest score per canonical key: an OS term is kept but has its score lifted;
 * a key only inference found is added fresh as a resolved term.
 */

import { finiteInferenceLanguages, inferFiniteBucket } from '../inference/index.ts';
import type { Clause } from '../tokenizer.ts';
import type { BucketName } from '../types.ts';
import { numberVariants } from './morphology.ts';
import { strategyForBucket } from './resolve.ts';
import { foldSurface } from './strategy.ts';
import type { TermMatchStrategy } from './types.ts';

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
export const SOURCE_PREF: Record<CandidateSource, number> = { span: 2, residual: 1, clause: 0 };

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

function sameLocaleSurfaces(hits: any[], key: string, locale?: string): string[] {
  if (!locale) return [];
  const out: string[] = [];
  for (const h of hits) {
    const s = h?._source;
    if (s?.canonical_key !== key || s?.language_code !== locale) continue;
    for (const surf of [s.value, ...(s.aliases ?? [])]) {
      const t = (surf ?? '').trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 2);
}

function isGrounded(hit: any, surface: string, locale?: string): boolean {
  const src = hit?._source ?? {};
  const own = [src.value, src.display_name, ...(src.aliases ?? [])].filter(Boolean).map(foldSurface);
  return numberVariants(foldSurface(surface), locale).some((v) => own.includes(foldSurface(v)));
}

function titleCaseKey(key: string): string {
  const tail = key.split(':').slice(1).join(' ').replace(/_/g, ' ').trim();
  return tail.replace(/\b\w/g, (ch) => ch.toUpperCase()) || key;
}

export function osFinalize(
  bucket: BucketName,
  results: CandidateResult[],
  ctx: FinalizeCtx,
  strategy: TermMatchStrategy = strategyForBucket(bucket),
): ResolvedTerm[] {
  interface Ranked extends ResolvedTerm {
    grounded: boolean;
    pref: number;
  }
  const rank = (a: Ranked, b: Ranked) =>
    Number(b.grounded) - Number(a.grounded) || b.pref - a.pref || b.score - a.score;
  const byKey = new Map<string, Ranked>();
  const push = (t: Ranked) => {
    const prev = byKey.get(t.key);
    if (!prev || rank(t, prev) < 0) byKey.set(t.key, t);
  };
  const info = (h: any) => ({
    name: h?._source?.display_name ?? h?._source?.value ?? '?',
    lang: h?._source?.language_code ?? '?',
    score: h?._score ?? 0,
  });
  for (const { surface, source, response } of results) {
    const pref = SOURCE_PREF[source];
    const hits = ((response as any)?.hits?.hits ?? []) as any[];
    const res = strategy.select(response, { bucket, surface, locale: ctx.locale }) as any;
    if (res.status === 'resolved') {
      const d = info(hits[0]);
      push({
        key: res.key,
        name: d.name,
        score: res.score,
        lang: d.lang,
        status: 'resolved',
        span: surface,
        grounded: isGrounded(hits[0], surface, ctx.locale),
        pref,
        verifyTargets: sameLocaleSurfaces(hits, res.key, ctx.locale),
      });
    } else if (res.status === 'ambiguous') {
      for (const cand of res.candidates) {
        const h = hits.find((x) => x._source?.canonical_key === cand);
        const d = info(h);
        push({
          key: cand,
          name: d.name,
          score: d.score,
          lang: d.lang,
          status: 'ambiguous',
          span: surface,
          grounded: isGrounded(h, surface, ctx.locale),
          pref,
          verifyTargets: sameLocaleSurfaces(hits, cand, ctx.locale),
        });
      }
    }
  }
  return [...byKey.values()].sort(rank).map(({ grounded, pref, ...t }) => t);
}

export function finalizeFinite(
  bucket: BucketName,
  os: ResolvedTerm[],
  clauses: Clause[],
  ctx: FinalizeCtx,
): ResolvedTerm[] {
  const inferred = inferFiniteBucket(bucket, clauses, finiteInferenceLanguages(ctx.locale), {
    titleMode: ctx.titleMode,
  });
  if (!inferred.length) return os;
  const byKey = new Map<string, ResolvedTerm>(os.map((t) => [t.key, t]));
  for (const it of inferred) {
    const prev = byKey.get(it.canonicalKey);
    if (prev) {
      if (it.score > prev.score) prev.score = it.score;
    } else {
      byKey.set(it.canonicalKey, {
        key: it.canonicalKey,
        name: titleCaseKey(it.canonicalKey),
        score: it.score,
        lang: ctx.locale ?? 'global',
        status: 'resolved',
        span: it.evidence,
      });
    }
  }
  return [...byKey.values()];
}
