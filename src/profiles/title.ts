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
import { timed } from '@term-extractor/utils/perf';
import { getOccupationFamilyContext } from 'occupation-search-engine';
import type { OccupationCapabilityMap } from '../derive/capabilities.js';
import type { CollarMap } from '../derive/collar.js';
import { inferLocation, setGazetteer } from '../inference/location.js';
import { inferOccupation } from '../inference/occupation.js';
import type { LexicalIndex } from '../lexical-index.js';
import { numberVariants } from '../matchers/morphology.js';
import { buildFilters, strategyForBucket } from '../matchers/resolve.js';
import type { OpenSearchClient } from '../matchers/types.js';
import { splitClauses } from '../tokenizer.js';
import type { BucketName, ExtractedTerm, SupportedLanguage } from '../types.js';
import {
  type BucketLookup,
  type Candidate,
  type CandidateResult,
  computeResidual,
  LOOKUPS,
  type ResolvedTerm,
} from './lookups.js';

const PEEL_BUCKETS = new Set<BucketName>(LOOKUPS.filter((l) => l.peels).map((l) => l.bucket));

export type { ResolvedTerm };

export type Verifier = (pairs: { span: string; texts: string[] }[]) => Promise<number[]>;

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

const DISPLAY_SOURCE = ['canonical_key', 'value', 'display_name', 'aliases', 'searchable', 'language_code'];

const ALT_OCCUPATION_LIMIT = 2;
/** Score given to an essential capability backfilled from the occupation graph
 *  when the title text never mentioned it — deliberately low so any span-grounded
 *  capability match always outranks it. */
const CAPABILITY_BACKFILL_SCORE = 0.4;
/** Cap on how many ungrounded essential capabilities one occupation can backfill. */
const CAPABILITY_BACKFILL_MAX = 5;

export async function resolveTitle(text: string, deps: TitleDeps): Promise<ProfileResult> {
  const { client, lexical, gazetteer, locale } = deps;
  const countryCode = deps.countryCode ?? locale;
  setGazetteer(gazetteer);

  const clauses = splitClauses(text, 'text');
  if (!clauses.length) return { clauses: [], byBucket: {} };

  const langs: SupportedLanguage[] | undefined = locale
    ? ([...new Set(locale === 'en' ? ['en', 'global'] : [locale, 'en', 'global'])] as SupportedLanguage[])
    : undefined;
  const expand = (gram: string) => numberVariants(gram, locale);
  const scan = clauses.map((clause) => lexical.lookupAll(clause.text, langs, expand));

  // Resolved ahead of the residual so its matched span peels like other modifiers.
  // A hierarchy-inferred term (`evidence[].clause` = "inferred from …") never
  // appeared in the text, so it's excluded from what gets peeled.
  const locationTerms = gazetteer ? await timed(() => inferLocation(clauses, countryCode), 'title_location') : [];
  const locationGrams = locationTerms.flatMap((t) =>
    t.evidence.filter((e) => !e.clause.startsWith('inferred from ')).map((e) => e.clause),
  );

  const residual = computeResidual(clauses, scan, PEEL_BUCKETS, locale, locationGrams);

  const ctx = { locale, countryCode, gazetteer, residual, titleMode: true, locationTerms };
  const plan: { lookup: BucketLookup; candidate: Candidate }[] = [];
  for (const lookup of LOOKUPS) {
    for (const candidate of lookup.candidates(clauses, scan, ctx)) plan.push({ lookup, candidate });
  }

  const matchCtx = { queryModelId: await client.queryModelId(), buildFilters };
  const responses = plan.length
    ? await timed(
        () =>
          client.msearch(
            plan.map(({ lookup, candidate }) => {
              const q = strategyForBucket(lookup.bucket).buildQuery(
                { bucket: lookup.bucket, surface: candidate.surface, locale },
                matchCtx,
              ) as Record<string, unknown> & { _source?: string[] };
              q._source = DISPLAY_SOURCE;
              return q;
            }),
          ),
        `title_bucket_scan plan=${plan.length}`,
      )
    : [];

  const byLookup = new Map<BucketLookup, CandidateResult[]>();
  plan.forEach((p, i) => {
    const list = byLookup.get(p.lookup) ?? [];
    list.push({ ...p.candidate, response: responses[i] });
    byLookup.set(p.lookup, list);
  });

  const byBucket: Record<string, ResolvedTerm[]> = {};
  for (const lookup of LOOKUPS) {
    const terms = lookup.finalize(byLookup.get(lookup) ?? [], clauses, ctx);
    if (terms.length) byBucket[lookup.bucket] = terms;
  }

  if (deps.verify) {
    const rows = Object.entries(byBucket)
      .filter(([bucket]) => bucket !== 'location')
      .flatMap(([, terms]) => terms);
    if (rows.length) {
      const scores = await deps.verify(
        rows.map((t) => ({ span: t.span, texts: t.verifyTargets?.length ? t.verifyTargets : [t.name] })),
      );
      rows.forEach((t, i) => {
        t.agreement = scores[i];
        if (!t.verifyTargets?.length) t.agreementCrossLingual = true;
        delete t.verifyTargets;
      });
    }
  }

  const altP = timed(
    () =>
      inferOccupation(clauses, locale as SupportedLanguage | undefined, {
        limit: ALT_OCCUPATION_LIMIT,
        ...(deps.jobFunction && { jobFunction: deps.jobFunction }),
      }).catch(() => [] as ExtractedTerm[]),
    'title_alt_occupation',
  );
  const altOccupation = await altP;
  if (deps.collar) {
    const derived = await deriveCollarKind(byBucket.occupation ?? [], altOccupation, deps.collar);
    if (derived) {
      const byKey = new Map<string, ResolvedTerm>((byBucket.collar_kind ?? []).map((t) => [t.key, t]));
      const prev = byKey.get(derived.key);
      if (!prev || derived.score > prev.score) byKey.set(derived.key, derived);
      byBucket.collar_kind = [...byKey.values()].sort((a, b) => b.score - a.score);
    }
  }
  if (deps.capabilities) {
    const existing = new Set((byBucket.capabilities ?? []).map((t) => t.key));
    const derived = await deriveEssentialCapabilities(
      byBucket.occupation ?? [],
      altOccupation,
      deps.capabilities,
      existing,
      locale,
    );
    if (derived.length) {
      byBucket.capabilities = [...(byBucket.capabilities ?? []), ...derived].sort((a, b) => b.score - a.score);
    }
  }
  return {
    clauses: clauses.map((c) => c.text),
    byBucket,
    ...(altOccupation.length ? { altOccupation } : {}),
  };
}

async function deriveCollarKind(
  occupations: ResolvedTerm[],
  altOccupation: ExtractedTerm[],
  collar: CollarMap,
): Promise<ResolvedTerm | null> {
  for (const o of [...occupations].sort((a, b) => b.score - a.score)) {
    const edge = collar.lookup(o.key);
    if (!edge) continue;
    return {
      key: edge.collar,
      name: edge.collar.split(':').pop() ?? edge.collar,
      score: edge.confidence,
      lang: 'global',
      status: 'resolved',
      span: `derived from occupation: ${o.name}`,
    };
  }

  for (const term of [...altOccupation].sort((a, b) => b.score - a.score)) {
    if (term.termType === 'occupation') {
      const edge = collar.lookup(`occupation:${term.canonicalKey}`) ?? collar.lookup(term.canonicalKey);
      if (edge) {
        return {
          key: edge.collar,
          name: edge.collar.split(':').pop() ?? edge.collar,
          score: edge.confidence,
          lang: 'global',
          status: 'resolved',
          span: `derived from occupation: ${term.displayName}`,
        };
      }
      continue;
    }

    const context = await getOccupationFamilyContext(term.displayName);

    if (!context) continue;

    return {
      key: context.collarKind,
      name: context.collarKind,
      score: 10,
      lang: 'global',
      status: 'resolved',
      span: `derived from occupation: ${term.displayName}`,
    };
  }
  return null;
}

/**
 * Fill in essential capabilities of the resolved occupation that the title text
 * never mentioned (e.g. "Accountant" implying double-entry bookkeeping without the
 * title ever spelling it out). Essential only — optional skills are too speculative
 * to inject without text grounding — capped per occupation, scored low enough
 * (`CAPABILITY_BACKFILL_SCORE`) that any span-grounded capability always outranks
 * it, and skipping keys the title already resolved on its own.
 */
async function deriveEssentialCapabilities(
  occupations: ResolvedTerm[],
  altOccupation: ExtractedTerm[],
  capabilities: OccupationCapabilityMap,
  existingKeys: Set<string>,
  locale?: string,
): Promise<ResolvedTerm[]> {
  const backfill = (occKey: string, occName: string): ResolvedTerm[] =>
    capabilities
      .essentialFor(occKey)
      .filter((key) => !existingKeys.has(key))
      .slice(0, CAPABILITY_BACKFILL_MAX)
      .map((key) => ({
        key,
        name: key.split(':').pop()?.replace(/_/g, ' ') ?? key,
        score: CAPABILITY_BACKFILL_SCORE,
        lang: locale ?? 'global',
        status: 'resolved' as const,
        span: `essential capability of occupation: ${occName} (not found in text)`,
      }));

  for (const o of [...occupations].sort((a, b) => b.score - a.score)) {
    if (capabilities.has(o.key)) return backfill(o.key, o.name);
  }

  for (const term of [...altOccupation].sort((a, b) => b.score - a.score)) {
    if (term.termType === 'occupation') {
      const key = capabilities.has(`occupation:${term.canonicalKey}`)
        ? `occupation:${term.canonicalKey}`
        : term.canonicalKey;
      if (capabilities.has(key)) return backfill(key, term.displayName);
    }
  }
  return [];
}
