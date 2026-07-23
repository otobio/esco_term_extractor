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
import {
  type Candidate,
  type CandidateResult,
  type CandidateSource,
  type FinalizeCtx,
  finalizeFinite,
  osFinalize,
  type ResolvedTerm,
  SOURCE_PREF,
} from '../matchers/finite.js';
import { foldSurface } from '../matchers/strategy.js';
import { normalizeText, words } from '../normalize.js';
import type { Clause } from '../tokenizer.js';
import type { BucketName, ExtractedTerm } from '../types.js';

export type { Candidate, CandidateResult, ResolvedTerm };

/**
 * Connector/function words trimmed from residual boundaries after a peel, PER
 * LOCALE (en/ro/hu/et). Kept deliberately tiny — the general stopword list
 * includes content words like "customer"/"support" that must survive in an
 * occupation residual. Stub sets for hu/et to refine; `default` is used when the
 * locale is unknown.
 */
const BOUNDARY_WORDS: Record<string, Set<string>> = {
  en: new Set(['of', 'the', 'a', 'an', 'and', 'or', 'for', 'in', 'to', 'at', 'on', 'with']),
  ro: new Set(['de', 'la', 'pentru', 'si', 'cu', 'pe', 'un', 'o', 'in', 'a', 'al', 'ale']),
  hu: new Set(['a', 'az', 'es', 'vagy']),
  et: new Set(['ja', 'voi']),
  default: new Set(['of', 'the', 'a', 'and', 'or', 'de', 'la', 'si']),
};
const boundaryWordsFor = (locale?: string): Set<string> => BOUNDARY_WORDS[locale ?? ''] ?? BOUNDARY_WORDS.default;

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
export function computeResidual(
  clauses: Clause[],
  scan: LexicalHit[][],
  peelBuckets: Set<BucketName>,
  locale?: string,
  extraGrams?: string[],
): string[][] {
  const boundary = boundaryWordsFor(locale);
  const extra = uniq((extraGrams ?? []).map((g) => normalizeText(g)));
  return clauses.map((clause, ci) => {
    const toks = words(normalizeText(clause.text));
    if (!toks.length) return [];
    const consumed = new Array<boolean>(toks.length).fill(false);
    let peeled = false;
    const grams = [...scan[ci].filter((hit) => peelBuckets.has(hit.entry.bucket)).map((hit) => hit.gram), ...extra];
    for (const gram of grams) {
      const g = gram.split(' ').filter(Boolean);
      if (!g.length) continue;
      for (let i = 0; i + g.length <= toks.length; i++) {
        if (g.every((t, j) => toks[i + j] === t)) {
          for (let j = 0; j < g.length; j++) consumed[i + j] = true;
          peeled = true;
        }
      }
    }
    if (!peeled) return [];
    const segments: string[] = [];
    let run: string[] = [];
    const flush = () => {
      while (run.length && boundary.has(run[0])) run.shift();
      while (run.length && boundary.has(run[run.length - 1])) run.pop();
      if (run.length) segments.push(run.join(' '));
      run = [];
    };
    for (let i = 0; i < toks.length; i++) {
      if (consumed[i]) flush();
      else run.push(toks[i]);
    }
    flush();
    return segments;
  });
}

const uniq = (xs: string[]): string[] => [...new Set(xs.map((s) => s.trim()).filter(Boolean))];

/** Per-clause grams tagged to `bucket` in the shared scan. */
const spansFor = (bucket: BucketName, scan: LexicalHit[][]): string[][] =>
  scan.map((hits) => hits.filter((h) => h.entry.bucket === bucket).map((h) => h.gram));

/**
 * Generic occupation head nouns, PER LOCALE. A bare one of these (e.g. "asistent",
 * "manager") is never a reliable occupation on its own — it aliases dozens of
 * entries, so it resolves to ambiguous fuzzy/neural noise across every `*_assistant`
 * / `*_manager`. We skip it as an occupation candidate. It still contributes inside
 * a multi-word span ("asistent manager"), which is left untouched.
 *
 * Deliberately tuned to generic *heads* only — never specific trades (sudor,
 * electrician, strungar), which are valid bare occupations. hu/et are stubs to grow.
 */
const GENERIC_OCCUPATION_HEADS: Record<string, Set<string>> = {
  en: new Set([
    'assistant',
    'manager',
    'coordinator',
    'specialist',
    'officer',
    'associate',
    'representative',
    'agent',
    'administrator',
    'consultant',
    'supervisor',
    'staff',
    'worker',
    'operator',
    'technician',
    'clerk',
    'executive',
    'professional',
    'director',
    'analyst',
    'advisor',
    'adviser',
    'expert',
    'generalist',
    'attendant',
    'operative',
    'helper',
    'assistant',
    'superintendent',
    'lead',
    'leader',
    'personnel',
  ]),
  ro: new Set([
    'asistent',
    'manager',
    'coordonator',
    'specialist',
    'ofiter',
    'agent',
    'administrator',
    'consultant',
    'supervizor',
    'muncitor',
    'lucrator',
    'operator',
    'tehnician',
    'functionar',
    'sef',
    'responsabil',
    'reprezentant',
    'director',
    'analist',
    'consilier',
    'expert',
    'gestionar',
    'personal',
    'ajutor',
  ]),
  hu: new Set([
    'asszisztens',
    'menedzser',
    'koordinator',
    'szakerto',
    'ugyintezo',
    'munkatars',
    'operator',
    'adminisztrator',
    'tanacsado',
    'ugynok',
    'kepviselo',
    'igazgato',
    'dolgozo',
    'technikus',
    'elemzo',
  ]),
  et: new Set([
    'assistent',
    'spetsialist',
    'tootaja',
    'operaator',
    'administraator',
    'konsultant',
    'koordinaator',
    'agent',
    'tehnik',
    'analuutik',
    'juht',
  ]),
  default: new Set(['assistant', 'manager', 'asistent']),
};
const genericHeadsFor = (locale?: string): Set<string> =>
  GENERIC_OCCUPATION_HEADS[locale ?? ''] ?? GENERIC_OCCUPATION_HEADS.default;

/** A bare (single-token) generic occupation head for the locale — folded to match. */
const isGenericHead = (surface: string, locale?: string): boolean => {
  const f = foldSurface(surface).trim();
  return f.length > 0 && !f.includes(' ') && genericHeadsFor(locale).has(f);
};

/** Finite buckets: exact alias spans confirmed by OS, UNIONED with our rule-based
 *  inference (dictionary + inference, highest score per canonical key wins). */
export function aliasLookup(bucket: BucketName, opts: { peels?: boolean } = {}): BucketLookup {
  return {
    bucket,
    peels: opts.peels ?? false,
    candidates: (_clauses, scan) => uniq(spansFor(bucket, scan).flat()).map((surface) => ({ surface, source: 'span' })),
    finalize: (results, clauses, ctx) => finalizeFinite(bucket, osFinalize(bucket, results, ctx), clauses, ctx),
  };
}

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
export function openSemanticLookup(
  bucket: BucketName,
  opts: { wholeClauseFallback?: boolean; dropGenericHeads?: boolean } = {},
): BucketLookup {
  const wholeClauseFallback = opts.wholeClauseFallback ?? true;
  const dropGenericHeads = opts.dropGenericHeads ?? false;
  return {
    bucket,
    candidates: (clauses, scan, ctx) => {
      // Drop bare generic head nouns from the spans first, so the fallback gate
      // below reflects *usable* spans (a bare "asistent" must not block the
      // whole-clause fallback for "asistent vanzari").
      const perClause = spansFor(bucket, scan).map((grams) =>
        dropGenericHeads ? grams.filter((g) => !isGenericHead(g, ctx.locale)) : grams,
      );
      // Dedupe surfaces, keeping the most trustworthy provenance if one repeats.
      const bySurface = new Map<string, CandidateSource>();
      const add = (raw: string, source: CandidateSource) => {
        const surface = raw.trim();
        if (!surface) return;
        if (dropGenericHeads && isGenericHead(surface, ctx.locale)) return; // bare generic head → noise
        const prev = bySurface.get(surface);
        if (prev === undefined || SOURCE_PREF[source] > SOURCE_PREF[prev]) bySurface.set(surface, source);
      };
      clauses.forEach((clause, i) => {
        perClause[i].forEach((s) => add(s, 'span'));
        if (wholeClauseFallback && !perClause[i].length) {
          add(clause.text, 'clause'); // whole clause verbatim
          (ctx.residual?.[i] ?? []).forEach((s) => add(s, 'residual')); // soft munch: modifier-peeled core
        }
      });
      return [...bySurface].map(([surface, source]) => ({ surface, source }));
    },
    finalize: (results, _clauses, ctx) => osFinalize(bucket, results, ctx),
  };
}

/** Location: resolved locally by the gazetteer (no OS probes) — via `ctx.locationTerms`,
 *  resolved early in `resolveTitle` rather than here (see `PEEL_BUCKETS`). */
export const gazetteerLookup: BucketLookup = {
  bucket: 'location',
  candidates: () => [],
  finalize: (_results, _clauses, ctx) =>
    (ctx.locationTerms ?? []).map((t) => ({
      key: t.canonicalKey,
      name: t.displayName,
      score: t.score,
      lang: t.languageCode,
      status: 'resolved' as const,
      span: t.evidence?.[0]?.clause ?? t.displayName,
    })),
};

// Peel buckets are modifiers wrapped around the occupation core → their spans are
// removed from the occupation residual (soft munch), via the shared alias scan.
// Location peels too, but its matched span comes from the gazetteer, which runs
// its own tokenization/matching rather than the shared scan — wired directly in
// resolveTitle (title.ts) as an extra peel input, not through this array.
const PEEL_BUCKETS: BucketName[] = ['level', 'workplace', 'schedule', 'employment', 'company_size'];
const OTHER_FINITE: BucketName[] = [
  'benefits',
  'sector',
  'job_function',
  'collar_kind',
  'qualifications',
  'compensation',
];

/** Every bucket lookup the title profile runs (uniform interface, own mechanism). */
export const LOOKUPS: BucketLookup[] = [
  openSemanticLookup('occupation', { dropGenericHeads: true }), // whole-clause fallback ON; bare generic heads skipped
  openSemanticLookup('capabilities', { wholeClauseFallback: false }), // spans only — titles aren't skill phrases
  ...PEEL_BUCKETS.map((b) => aliasLookup(b, { peels: true })),
  ...OTHER_FINITE.map((b) => aliasLookup(b)),
  gazetteerLookup,
];
