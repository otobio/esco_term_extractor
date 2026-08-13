/**
 * Ingest-domain adapter — the tight, self-contained surface a job-ingest service
 * consumes. It owns its OpenSearch connection and taxonomy data (zero dependency
 * on any caller) and exposes free functions over a `Runtime`:
 *
 *   createRuntime(config)          → holds the OS client + lexical/gazetteer data
 *   derive(input, opts)            → one structured field, or a custom `profile`
 *                                    (e.g. `title`) that resolves many buckets
 *   deriveMany(requests, opts)     → a batch of structured fields (one _msearch)
 *   analyzeJobListing(text, opts)  → unstructured body → matches + salary ranges
 *   explicitBuckets(matches)       → group/dedupe matches into per-bucket keys
 *
 * Structured finite buckets resolve from the packed lexical/runtime binary;
 * open buckets still go through OpenSearch. The dense `--verify` path is
 * intentionally not wired here.
 */
import { fileURLToPath } from 'node:url';
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import { openGazetteer } from '@term-extractor/gazetteer';
import { americanToBritishOrthography, isLikelyEnglishVerb, toEnglishVerbRootForm } from '@term-extractor/utils/lang';
import { timed } from '@term-extractor/utils/perf';
import { getOccupationFamilyContext, giveObjectRelated, giveVerbSynonym } from 'occupation-search-engine';
import { OccupationCapabilityMap } from '../derive/capabilities.js';
import { CollarMap } from '../derive/collar.js';
import { MATCH_ACCEPT_THRESHOLD, searchCapability } from '../derive/skill-spans.js';
import { DisplayTitleStore } from '../display-titles.js';
import { inferAltFamilyFromJobFunction } from '../inference/occupation.js';
import { type LexicalEntry, LexicalIndex } from '../lexical-index.js';
import { additiveHybridStrategy } from '../matchers/additive-hybrid.js';
import { finalizeFinite, osFinalize, type ResolvedTerm } from '../matchers/finite.js';
import { lexicalStrategy } from '../matchers/lexical.js';
import { createOpenSearchClient, type OpenSearchClientOptions } from '../matchers/os-client.js';
import { buildFilters, strategyForBucket } from '../matchers/resolve.js';
import type { OpenSearchClient, TermMatchStrategy } from '../matchers/types.js';
import { resolveDescription, resolveTitle } from '../profiles/index.js';
import { extractSalary } from '../salary/salary.js';
import { splitClauses } from '../tokenizer.js';
import {
  ALL_BUCKETS,
  type BucketName,
  type ExtractedTerm,
  type SalaryRange,
  type SupportedLanguage,
} from '../types.js';
import { logIngestCall, summarizeIngestOptions } from './logger.js';

export type SearchBucket = BucketName;

export {
  defaultTierOf,
  type MergePolicy,
  type MergeTier,
  mergeSignals,
} from './merge.js';

export interface CanonicalMatch {
  canonicalKey: string;
  bucket: SearchBucket;
  termType: string;
  matchedAlias: string;
  sourceText: string;
  evidenceSignal: string;
  evidenceMatchText: string;
  itemIndex: number;
  propositionIndex: number;
  confidence: number;
  source: 'lexical' | 'fuzzy' | 'fallback' | 'neural' | 'derived';
  isConditional: boolean;
  isPreferred: boolean;
  isOffered: boolean;
  structuralTrust: number;
  legitimacyScore: number;
}

export interface SalaryRangeMatch {
  minAmount: number | null;
  maxAmount: number | null;
  currency: 'RON' | 'EUR' | 'USD' | 'HUF' | null;
  period: 'hour' | 'day' | 'week' | 'month' | 'year' | null;
  taxMode: 'gross' | 'net' | null;
  rawText: string;
  normalizedText: string;
  confidence: number;
}

export interface IngestJobAnalysisResult {
  matches: CanonicalMatch[];
  salaryRanges: SalaryRangeMatch[];
}

export interface DeriveRequest {
  bucket?: SearchBucket;
  input: string;
  /** `lexical` forces the exact/fuzzy strategy; `neural`/`hybrid` force additive-hybrid. */
  mode?: string;
  /** Custom analysis pipeline for a free-text field (currently only `title`). */
  profile?: string;
  /** Text language — lexical scan / OS surface filter. */
  locale?: string;
  /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`. Used by the
   *  gazetteer-backed title profile; a Nigerian listing is country `ng` even when
   *  its text is English. Defaults to `locale` when omitted. */
  countryCode?: string;
  /** Resolved canonical job_function slug used as title-profile context for occupation disambiguation. */
  jobFunction?: string;
}

export interface RuntimeConfig extends OpenSearchClientOptions {
  /** Directory holding the lexical + gazetteer snapshots (defaults to the packaged data). */
  dataDir?: string;
  /** Directory containing gazetteer.gzb. Defaults to the gazetteer package data. */
  gazetteerDataDir?: string;
}

export interface Runtime {
  readonly client: OpenSearchClient;
  lexical(): Promise<LexicalIndex>;
  gazetteer(): Promise<GazetteerResolver | undefined>;
  displayTitles(): Promise<DisplayTitleStore | undefined>;
  /** occupation→collar_kind graph edges; used by the title profile to derive collar. */
  collar(): Promise<CollarMap | undefined>;
  /** occupation→essential/optional capability graph edges; used by the title profile
   *  to backfill essential capabilities the text never mentioned. */
  capabilities(): Promise<OccupationCapabilityMap | undefined>;
}

export interface DeriveOptions {
  runtime: Runtime;
  /** Text language — lexical scan / OS surface filter. */
  locale?: string;
  /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`; defaults to `locale`. */
  countryCode?: string;
  /** Resolved canonical job_function slug used as title-profile context for occupation disambiguation. */
  jobFunction?: string;
  bucket?: SearchBucket;
  profile?: string;
  mode?: string;
}

export interface BatchOptions {
  runtime: Runtime;
  locale?: string;
  /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`; defaults to `locale`. */
  countryCode?: string;
}

export interface AnalyzeJobListingOptions extends BatchOptions {
  /** Restrict canonical extraction to this subset (default: every bucket but occupation).
   *  `location` remains gazetteer-owned rather than part of the clause/OS cross product, but
   *  it still obeys this allow-list; `occupation` stays excluded regardless because unstructured
   *  body text should not claim job identity. Narrowing this is the biggest lever on query
   *  volume because each non-location bucket dropped removes one probe per surviving clause. */
  buckets?: SearchBucket[];
}

export interface DisplayTitleOptions {
  runtime: Pick<Runtime, 'gazetteer' | 'displayTitles'>;
}

export type DisplayTitleRequest = readonly [bucket: SearchBucket, canonicalKey: string];

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));

export function createRuntime(config: RuntimeConfig = {}): Runtime {
  const client = createOpenSearchClient(config);
  const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
  const gazetteerDataDir = config.gazetteerDataDir ?? process.env.ESCO_TERM_EXTRACTOR_GAZETTEER_DATA_DIR;
  let lexicalP: Promise<LexicalIndex> | undefined;
  let gazetteerP: Promise<GazetteerResolver | undefined> | undefined;
  let displayTitlesP: Promise<DisplayTitleStore | undefined> | undefined;
  let collarP: Promise<CollarMap | undefined> | undefined;
  let capabilitiesP: Promise<OccupationCapabilityMap | undefined> | undefined;
  return {
    client,
    lexical: () => (lexicalP ??= timed(() => LexicalIndex.load(dataDir), 'runtime_lexical_load')),
    gazetteer: () => (gazetteerP ??= timed(() => openGazetteer(gazetteerDataDir), 'runtime_gazetteer_load')),
    displayTitles: () =>
      (displayTitlesP ??= timed(() => DisplayTitleStore.load(dataDir), 'runtime_display_titles_load')),
    collar: () => (collarP ??= timed(() => CollarMap.load(dataDir), 'runtime_collar_load')),
    capabilities: () =>
      (capabilitiesP ??= timed(() => OccupationCapabilityMap.load(dataDir), 'runtime_capabilities_load')),
  };
}

export async function getDisplayTitles(
  input: DisplayTitleRequest | DisplayTitleRequest[],
  options: DisplayTitleOptions,
): Promise<string | null | (string | null)[]> {
  const requests: DisplayTitleRequest[] =
    Array.isArray(input) && input.length === 2 && typeof input[0] === 'string' && typeof input[1] === 'string'
      ? [input as unknown as DisplayTitleRequest]
      : (input as unknown as DisplayTitleRequest[]);
  const store = await options.runtime.displayTitles();
  const gazetteer = requests.some(([bucket]) => bucket === 'location')
    ? ((await options.runtime.gazetteer()) as
        | (GazetteerResolver & { displayTitleForKey(key: string): string | null })
        | undefined)
    : undefined;
  const titles = await Promise.all(
    requests.map(async ([bucket, canonicalKey]) => {
      if (bucket === 'location') {
        return gazetteer?.displayTitleForKey(canonicalKey) ?? null;
      }
      return store?.titleFor(bucket, canonicalKey) ?? null;
    }),
  );
  return requests.length === 1 ? (titles[0] ?? null) : titles;
}

/** A resolved structured term, tagged with the bucket + original input it came from. */
interface StructuredResult {
  bucket: SearchBucket;
  sourceText: string;
  term: ResolvedTerm;
}

function strategyFor(bucket: SearchBucket, mode?: string): TermMatchStrategy {
  if (mode === 'lexical') return lexicalStrategy;
  if (mode === 'neural' || mode === 'hybrid') return additiveHybridStrategy;
  return strategyForBucket(bucket);
}

const FINITE_BINARY_BUCKETS = new Set<SearchBucket>([
  'employment',
  'schedule',
  'level',
  'workplace',
  'benefits',
  'compensation',
  'qualifications',
  'sector',
  'job_function',
  'company_size',
]);

function isBinaryFiniteBucket(bucket: SearchBucket): boolean {
  return FINITE_BINARY_BUCKETS.has(bucket);
}

function toResolvedTerm(entry: LexicalEntry, span: string): ResolvedTerm {
  return {
    key: entry.canonicalKey,
    name: entry.displayName,
    score: 1,
    lang: entry.languageCode,
    status: 'resolved',
    span,
  };
}

async function resolveFiniteStructured(
  items: { bucket: SearchBucket; surface: string; locale?: string }[],
  runtime: Runtime,
  options: { scanSurface?: boolean } = {},
): Promise<{ results: StructuredResult[]; altFamilyMatches: CanonicalMatch[] }> {
  if (!items.length) return { results: [], altFamilyMatches: [] };
  const lexical = await timed(() => runtime.lexical(), 'ingest_resolve_finite_structured_lexical');
  const collar = items.some((it) => it.bucket === 'job_function')
    ? await timed(() => runtime.collar(), 'ingest_resolve_finite_structured_collar')
    : undefined;
  const out: StructuredResult[] = [];
  const altFamilyMatches: CanonicalMatch[] = [];
  for (const it of items) {
    const termClauses = [{ text: it.surface, source: 'structured' }];
    const hits = options.scanSurface
      ? lexical.lookup(it.surface, it.bucket, it.locale ? [it.locale as SupportedLanguage] : undefined)
      : lexical
          .lookupExact(it.surface, it.bucket, it.locale ? [it.locale as SupportedLanguage] : undefined)
          .map((entry) => ({ entry, gram: it.surface }));
    const resolved = hits.map((hit) => toResolvedTerm(hit.entry, hit.gram));
    const terms = finalizeFinite(it.bucket, resolved, termClauses, { locale: it.locale, titleMode: true });
    for (const term of terms) out.push({ bucket: it.bucket, sourceText: it.surface, term });

    if (it.bucket === 'job_function') {
      for (const t of await inferAltFamilyFromJobFunction(it.surface, it.locale as SupportedLanguage | undefined)) {
        altFamilyMatches.push(altToMatch(t, it.surface));
        if (collar) {
          altFamilyMatches.push(...(await altFamilyCollarMatches(t, it.surface, collar)));
        }
      }
    }
  }
  return { results: out, altFamilyMatches };
}

/**
 * Structured resolution uses the cheapest trustworthy path per bucket:
 * - finite lexical buckets still probe OS and union that with inference;
 * - `sector` and `job_function` are now finite-only and resolve locally from the
 *   facet rules, with no OS call at all;
 * - occupation still goes through the title profile, not this function.
 */
async function resolveStructured(
  items: { bucket: SearchBucket; surface: string; mode?: string; locale?: string }[],
  runtime: Runtime,
  options: { allowBinaryFiniteBucketsInOs?: boolean } = {},
): Promise<StructuredResult[]> {
  if (!items.length) return [];
  const out: StructuredResult[] = [];
  const strategies = items.map((it) => strategyFor(it.bucket, it.mode));
  const queryItems = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => options.allowBinaryFiniteBucketsInOs || !isBinaryFiniteBucket(it.bucket));

  const responses = queryItems.length
    ? await timed(async () => {
        const ctx = { queryModelId: await runtime.client.queryModelId(), buildFilters };
        return runtime.client.msearch(
          queryItems.map(({ it, i }) =>
            strategies[i].buildQuery({ bucket: it.bucket, surface: it.surface, locale: it.locale }, ctx),
          ),
        );
      }, `ingest_resolve_structured items=${queryItems.length}`)
    : [];

  items.forEach((it, i) => {
    const termClauses = [{ text: it.surface, source: 'structured' }];
    const responseIndex = queryItems.findIndex(({ i: originalIndex }) => originalIndex === i);
    const os = osFinalize(
      it.bucket,
      [{ surface: it.surface, source: 'span', response: responses[responseIndex] }],
      { locale: it.locale },
      strategies[i],
    );
    const terms = finalizeFinite(it.bucket, os, termClauses, { locale: it.locale, titleMode: true });
    for (const term of terms) out.push({ bucket: it.bucket, sourceText: it.surface, term });
  });
  return out;
}

function altOccupationCanonicalKey(term: ExtractedTerm): string {
  const prefix = term.termType === 'occupation_group' ? 'occupation:alt_family' : 'occupation:alt';
  return `${prefix}:${term.canonicalKey}`;
}

/** Alt occupation-engine term → CanonicalMatch: bucket `occupation`, an
 *  `alt_occupation`/`alt_occupation_family` signal, and the engine's own confidence. */
function altToMatch(term: ExtractedTerm, sourceText: string): CanonicalMatch {
  const span = term.evidence?.[0]?.clause ?? term.displayName;
  return {
    canonicalKey: altOccupationCanonicalKey(term),
    bucket: 'occupation',
    termType: term.termType,
    matchedAlias: span,
    sourceText,
    evidenceSignal: term.termType === 'occupation_group' ? 'alt_occupation_family' : 'alt_occupation',
    evidenceMatchText: span,
    itemIndex: 0,
    propositionIndex: 0,
    confidence: term.score, // engine confidence, already in [0,1]
    source: 'derived',
    isConditional: false,
    isPreferred: false,
    isOffered: false,
    structuralTrust: 1,
    legitimacyScore: 1,
  };
}

async function altFamilyCollarMatches(
  term: ExtractedTerm,
  sourceText: string,
  collar: CollarMap,
): Promise<CanonicalMatch[]> {
  if (term.termType === 'occupation') {
    const edge = collar.lookup(`occupation:${term.canonicalKey}`) ?? collar.lookup(term.canonicalKey);
    if (edge) {
      return [
        {
          canonicalKey: edge.collar,
          bucket: 'collar_kind',
          termType: 'canonical',
          matchedAlias: term.evidence?.[0]?.clause ?? term.displayName,
          sourceText,
          evidenceSignal: 'alt_occupation_family_collar',
          evidenceMatchText: term.evidence?.[0]?.clause ?? term.displayName,
          itemIndex: 0,
          propositionIndex: 0,
          confidence: edge.confidence,
          source: 'derived',
          isConditional: false,
          isPreferred: false,
          isOffered: false,
          structuralTrust: 1,
          legitimacyScore: 1,
        },
      ];
    }
    return [];
  }

  if (term.termType !== 'occupation_group') {
    return [];
  }

  const context = await getOccupationFamilyContext(term.displayName);
  if (!context) return [];

  return [
    {
      canonicalKey: context.collarKind,
      bucket: 'collar_kind',
      termType: 'canonical',
      matchedAlias: term.evidence?.[0]?.clause ?? term.displayName,
      sourceText,
      evidenceSignal: 'alt_occupation_family_collar',
      evidenceMatchText: term.evidence?.[0]?.clause ?? term.displayName,
      itemIndex: 0,
      propositionIndex: 0,
      confidence: 10,
      source: 'derived',
      isConditional: false,
      isPreferred: false,
      isOffered: false,
      structuralTrust: 1,
      legitimacyScore: 1,
    },
  ];
}

function toMatch(term: ResolvedTerm, bucket: SearchBucket, sourceText: string, signal: string): CanonicalMatch {
  return {
    canonicalKey: term.key,
    bucket,
    termType: 'canonical',
    matchedAlias: term.span,
    sourceText,
    evidenceSignal: signal,
    evidenceMatchText: term.span,
    itemIndex: 0,
    propositionIndex: 0,
    // Resolved is a confident single winner; ambiguous is a soft co-candidate that
    // should rank but not clear the searchable-confidence gate.
    confidence: term.status === 'resolved' ? 1 : 0.5,
    source: 'derived',
    isConditional: false,
    isPreferred: false,
    isOffered: false,
    structuralTrust: 1,
    legitimacyScore: 1,
  };
}

/**
 * A structured location field that resolves ONLY to a country other than the
 * listing's own is a "works abroad" signal — e.g. a `ro` listing with location
 * "Franta". Gold treats `location` as abstaining in this case (no idiom word to
 * match, no local place to resolve), so this is emitted into `workplace`
 * instead of `location` (`workplace:abroad` already exists as a canonical term
 * for the idiom-word case; this covers the bare-foreign-country-name case that
 * idiom regexes can't catch). Unfiltered re-resolve (no `countryCode` gate) so
 * a foreign country's own gazetteer entries are visible for the comparison.
 */
function abroadFromLocation(gaz: GazetteerResolver, input: string, country: string | undefined): CanonicalMatch[] {
  if (!country) return [];
  const terms = gaz.resolve([], input, undefined);
  if (!terms.length) return [];
  const allForeign = terms.every((t) => t.languageCode !== country);
  if (!allForeign) return [];
  return [
    {
      canonicalKey: 'workplace:abroad',
      bucket: 'workplace' as SearchBucket,
      termType: 'canonical',
      matchedAlias: input,
      sourceText: input,
      evidenceSignal: 'structured',
      evidenceMatchText: input,
      itemIndex: 0,
      propositionIndex: 0,
      confidence: 1,
      source: 'derived',
      isConditional: false,
      isPreferred: false,
      isOffered: false,
      structuralTrust: 1,
      legitimacyScore: 1,
    },
  ];
}

/**
 * Location is resolved by the GAZETTEER, never the OS index — the gazetteer is the
 * accurate, extensible place authority (it will cover places OS does not). Both the
 * structured path (a place field) and the unstructured path (free-text body) route
 * here, gated by `countryCode` (falling back to `locale`).
 */
async function deriveLocation(
  input: string,
  opts: { runtime: Runtime; locale?: string; countryCode?: string },
  mode: 'structured' | 'unstructured',
  signal: string,
): Promise<CanonicalMatch[]> {
  const gaz = await timed(() => opts.runtime.gazetteer(), 'ingest_derive_location_gazetteer');
  if (!gaz) return [];
  const country = opts.countryCode ?? opts.locale;
  const terms = mode === 'structured' ? gaz.resolve([], input) : gaz.resolve(splitClauses(input, 'text'), undefined);
  const matches: CanonicalMatch[] = terms.map((t) => {
    const span = t.evidence?.[0]?.clause ?? t.displayName;
    return {
      canonicalKey: t.canonicalKey,
      bucket: 'location' as SearchBucket,
      termType: t.termType ?? 'canonical',
      matchedAlias: span,
      sourceText: input,
      evidenceSignal: signal,
      evidenceMatchText: span,
      itemIndex: 0,
      propositionIndex: 0,
      confidence: t.score, // gazetteer score (depth/corroboration), not a flat 1
      source: 'derived',
      isConditional: false,
      isPreferred: false,
      isOffered: false,
      structuralTrust: 1,
      legitimacyScore: 1,
    };
  });
  // Cross-country check only applies to an actual structured place field, not free text
  // (a country name mentioned in a job description body is not a "works abroad" signal).
  if (mode === 'structured') matches.push(...abroadFromLocation(gaz, input, country));
  return matches;
}

/**
 * Free-text `title` profile: full title-profile pipeline (clause split, lexical
 * alias-scan, modifier-peeled residual, OS additive query, generic-head
 * suppression, alt-occupation engine, collar_kind derivation). Every bucket the
 * pipeline resolves is kept, tagged with the `title` evidence signal.
 */
async function deriveProfile(input: string, opts: DeriveOptions): Promise<CanonicalMatch[]> {
  if (opts.profile !== 'title') throw new Error(`unknown profile: "${opts.profile}" (known: title)`);
  const [lexical, gazetteer, collar, capabilities] = await timed(
    () =>
      Promise.all([
        opts.runtime.lexical(),
        opts.runtime.gazetteer(),
        opts.runtime.collar(),
        opts.runtime.capabilities(),
      ]),
    'ingest_derive_profile_deps',
  );
  const result = await timed(
    () =>
      resolveTitle(input, {
        client: opts.runtime.client,
        lexical,
        gazetteer,
        collar, // occupation→collar_kind graph edge
        capabilities, // occupation→essential capability graph edges
        locale: opts.locale,
        countryCode: opts.countryCode, // gazetteer country gate (resolveTitle falls back to locale)
        ...(opts.jobFunction && { jobFunction: opts.jobFunction }),
      }),
    'ingest_derive_profile_resolve_title',
  );
  const matches: CanonicalMatch[] = [];
  for (const [bucket, terms] of Object.entries(result.byBucket)) {
    for (const t of terms as ResolvedTerm[]) {
      matches.push(toMatch(t, bucket as SearchBucket, input, 'title'));
    }
  }
  // Alt occupation engine (opt-in): surfaced as occupation matches tagged with an
  // alt signal, carrying the engine's own confidence — beside, not overriding, the
  // profile's own occupation. Any collar kinds derivable from the same resolved
  // occupation family are merged here so the profile reports collar consistently
  // even when the winning occupation came from the alt path.
  for (const t of result.altOccupation ?? []) matches.push(altToMatch(t, input));
  return matches;
}

/**
 * Structured `occupation` field: NOT a separate resolution — it's the same
 * `deriveProfile` title-profile run, narrowed to the `occupation` bucket (a
 * structured occupation field, e.g. "Senior React Developer", is title-shaped,
 * so it deserves the same candidate quality a free-text title gets). Only the
 * `occupation` bucket survives, plus any collar_kind derived from that same
 * occupation family; a structured occupation field must not also surface
 * level/workplace/etc. The plain occupation match's evidence signal is remapped
 * from `title` to `structured` — the alt-occupation engine's own signal
 * (`alt_occupation`/`alt_occupation_family`) passes through unchanged.
 */
async function deriveOccupation(
  input: string,
  opts: { runtime: Runtime; locale?: string; countryCode?: string },
): Promise<CanonicalMatch[]> {
  const matches = await deriveProfile(input, { ...opts, profile: 'title' });
  return matches
    .filter((m) => m.bucket === 'occupation' || m.bucket === 'collar_kind')
    .map((m) => (m.evidenceSignal === 'title' ? { ...m, evidenceSignal: 'structured' } : m));
}

/**
 * Structured `capabilities` field: lexical-only, no OS round-trip. The
 * capabilities dictionary (data/lexical.lxb) is the full ESCO alias set, so
 * the same exact-first / ratio-gated-fuzzy / ambiguity-penalized engine that
 * scores free-text skill spans (`searchCapability`, see
 * `src/derive/skill-spans.ts`) is reused here to score the whole structured
 * value as a single candidate. Shaky matches (low-coverage fuzzy sub-spans,
 * ambiguous non-knowledge single tokens) score below `MATCH_ACCEPT_THRESHOLD`
 * and are dropped rather than surfaced as a confident structured match.
 */
async function deriveCapability(input: string, opts: { runtime: Runtime; locale?: string }): Promise<CanonicalMatch[]> {
  const lexical = await timed(() => opts.runtime.lexical(), 'ingest_derive_capability_lexical');
  const match = searchCapability(input, opts.locale as SupportedLanguage | undefined, lexical);
  if (match.matchType === 'none' || !match.escoUri || match.confidence < MATCH_ACCEPT_THRESHOLD) return [];

  return [
    toMatch(
      {
        key: match.escoUri,
        name: match.preferredLabel ?? match.escoUri,
        score: match.confidence,
        lang: (opts.locale as SupportedLanguage) ?? 'global',
        status: 'resolved',
        span: input,
      },
      'capabilities',
      input,
      'structured',
    ),
  ];
}

/** Resolve one structured field, or run a custom `profile` (e.g. `title`) over free text. */
export async function derive(input: string, opts: DeriveOptions): Promise<CanonicalMatch[]> {
  if (!input.trim()) {
    await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output: [] });
    return [];
  }

  const output = await timed(
    async () => {
      if (opts.profile) return deriveProfile(input, opts);
      if (!opts.bucket) throw new Error('derive requires a bucket or a profile');
      // Location is gazetteer-owned (structured place field), not an OS lexical bucket.
      if (opts.bucket === 'location') return deriveLocation(input, opts, 'structured', 'structured');
      if (opts.bucket === 'occupation') return deriveOccupation(input, opts);
      if (opts.bucket === 'capabilities') return deriveCapability(input, opts);

      if (isBinaryFiniteBucket(opts.bucket)) {
        const { results, altFamilyMatches } = await resolveFiniteStructured(
          [{ bucket: opts.bucket, surface: input, locale: opts.locale }],
          opts.runtime,
        );
        return [...results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured')), ...altFamilyMatches];
      }

      const results = await resolveStructured(
        [{ bucket: opts.bucket, surface: input, mode: opts.mode, locale: opts.locale }],
        opts.runtime,
      );
      return results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured'));
    },
    `ingest_derive bucket=${opts.bucket ?? ''} profile=${opts.profile ?? ''}`,
  );

  await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output });
  return output;
}

/** Resolve a batch of structured fields in a single `_msearch` (profile requests delegate to `derive`). */
export async function deriveMany(requests: DeriveRequest[], opts: BatchOptions): Promise<CanonicalMatch[]> {
  const structured = requests.filter((r) => !r.profile && r.input.trim());
  const profiled = requests.filter((r) => r.profile && r.input.trim());
  // Location is gazetteer-owned, and occupation goes through the title-profile
  // pipeline (see deriveOccupation) — both resolved separately, not via the OS _msearch.
  const locationReqs = structured.filter((r) => r.bucket === 'location');
  const occupationReqs = structured.filter((r) => r.bucket === 'occupation');
  const capabilityReqs = structured.filter((r) => r.bucket === 'capabilities');
  const binaryItems = structured.filter((r) => r.bucket && isBinaryFiniteBucket(r.bucket));
  const osItems = structured.filter(
    (r) => !!r.bucket && r.bucket !== 'location' && r.bucket !== 'occupation' && !isBinaryFiniteBucket(r.bucket),
  );
  const matches = await timed(async () => {
    const out: CanonicalMatch[] = [];
    if (binaryItems.length) {
      const { results, altFamilyMatches } = await resolveFiniteStructured(
        binaryItems.map((r) => {
          if (!r.bucket) throw new Error('a structured deriveMany request requires a bucket');
          return { bucket: r.bucket, surface: r.input, locale: r.locale ?? opts.locale };
        }),
        opts.runtime,
      );
      out.push(...results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured')));
      out.push(...altFamilyMatches);
    }
    const items = osItems.map((r) => {
      if (!r.bucket) throw new Error('a structured deriveMany request requires a bucket');
      return { bucket: r.bucket, surface: r.input, mode: r.mode, locale: r.locale ?? opts.locale };
    });
    const results = await resolveStructured(items, opts.runtime, { allowBinaryFiniteBucketsInOs: true });
    out.push(...results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured')));
    for (const r of locationReqs) {
      out.push(
        ...(await deriveLocation(
          r.input,
          { runtime: opts.runtime, locale: r.locale ?? opts.locale, countryCode: r.countryCode ?? opts.countryCode },
          'structured',
          'structured',
        )),
      );
    }
    for (const r of occupationReqs) {
      out.push(
        ...(await deriveOccupation(r.input, {
          runtime: opts.runtime,
          locale: r.locale ?? opts.locale,
          countryCode: r.countryCode ?? opts.countryCode,
        })),
      );
    }
    for (const r of profiled) {
      out.push(
        ...(await deriveProfile(r.input, {
          runtime: opts.runtime,
          locale: r.locale ?? opts.locale,
          countryCode: r.countryCode ?? opts.countryCode,
          ...(r.jobFunction && { jobFunction: r.jobFunction }),
          profile: r.profile,
        })),
      );
    }
    for (const r of capabilityReqs) {
      out.push(
        ...(await deriveCapability(r.input, {
          runtime: opts.runtime,
          locale: r.locale ?? opts.locale,
        })),
      );
    }

    return out;
  }, `ingest_derive_many requests=${requests.length} os=${osItems.length} location=${locationReqs.length} occupation=${occupationReqs.length} profiled=${profiled.length}`);

  await logIngestCall('deriveMany', { requests, options: summarizeIngestOptions(opts), output: matches });
  return matches;
}

function toSalaryMatch(r: SalaryRange): SalaryRangeMatch {
  return {
    minAmount: r.minAmount ?? null,
    maxAmount: r.maxAmount ?? null,
    currency: r.currency ?? null,
    period: r.period ?? null,
    taxMode: r.taxMode ?? null,
    rawText: r.evidence,
    normalizedText: r.evidence,
    confidence: r.confidence,
  };
}

/** Unstructured body: every clause probed against the requested buckets, deduped per key, plus salary parsing. */
export async function analyzeJobListing(
  text: string,
  opts: AnalyzeJobListingOptions,
): Promise<IngestJobAnalysisResult> {
  if (!text.trim()) {
    const output = { matches: [], salaryRanges: [] };
    await logIngestCall('analyzeJobListing', { input: text, options: summarizeIngestOptions(opts), output });
    return output;
  }
  const requestedBuckets = (opts.buckets ?? ALL_BUCKETS).filter((b) => b !== 'occupation');
  let noSectionStructure = false;
  const matches = await timed(async () => {
    const [lexical, gazetteer] = await Promise.all([opts.runtime.lexical(), opts.runtime.gazetteer()]);
    const result = await resolveDescription(text, {
      client: opts.runtime.client,
      lexical,
      gazetteer,
      locale: opts.locale,
      countryCode: opts.countryCode,
      buckets: requestedBuckets,
    });
    // No header was ever detected — the whole body fell back to one 'unknown'
    // block, so every bucket resolved against unstructured/ungated clauses.
    // Surface this in the call log so a wave of new job-board formats that
    // defeat header detection shows up as a metric, not silently.
    noSectionStructure = result.sections.length <= 1 && result.sections.every((s) => s.kind === 'unknown');
    return Object.entries(result.byBucket).flatMap(([bucket, terms]) =>
      (terms as ResolvedTerm[]).map((term) => toMatch(term, bucket as SearchBucket, text, 'description')),
    );
  }, `ingest_analyze_job_listing buckets=${requestedBuckets.length}`);
  const output = { matches, salaryRanges: extractSalary(text).map(toSalaryMatch) };
  await logIngestCall('analyzeJobListing', {
    input: text,
    options: summarizeIngestOptions(opts),
    output,
    noSectionStructure,
  });
  return output;
}

/** Group matches into per-bucket canonical-key lists, deduped, highest confidence winning. */
export function explicitBuckets(matches: CanonicalMatch[]): Record<SearchBucket, string[]> {
  const buckets = Object.fromEntries(ALL_BUCKETS.map((b) => [b, [] as string[]])) as Record<SearchBucket, string[]>;
  const byBucket = new Map<SearchBucket, CanonicalMatch[]>();
  for (const match of matches) {
    const list = byBucket.get(match.bucket) ?? [];
    list.push(match);
    byBucket.set(match.bucket, list);
  }
  for (const [bucket, bucketMatches] of byBucket) {
    const deduped = new Map<string, CanonicalMatch>();
    for (const match of bucketMatches) {
      const key = `${match.canonicalKey}:${match.propositionIndex}`;
      const current = deduped.get(key);
      if (!current || match.confidence > current.confidence) deduped.set(key, match);
    }
    buckets[bucket] = [...new Set([...deduped.values()].map((m) => m.canonicalKey))];
  }
  return buckets;
}

export interface GetEnglishRelatedVerbsOptions {
  limit?: number;
}

export interface GetRelatedObjectsOptions {
  limit?: number;
}

/**
 * Related verbs for `verb`, deduplicated (highest-evidence first, since that's
 * the order `giveVerbSynonym` returns), reduced to root form (before the
 * spelling pass, so inflection stripping never runs through the British
 * double-consonant rule) and normalized to British spelling, then filtered
 * down to tokens that are plausibly actual English verbs. Always English —
 * ESCO's verb/object graph has no locale dimension here.
 *
 * `limit` bounds the final, filtered/deduped list — it is applied here, not
 * forwarded to `giveVerbSynonym`, since that limit is over raw (pre-filter)
 * rows and would otherwise starve the result before verb-filtering runs.
 */
export async function getEnglishRelatedVerbs(
  verb: string,
  options: GetEnglishRelatedVerbsOptions = {},
): Promise<string[]> {
  const results = await giveVerbSynonym(verb);
  const seen = new Set<string>();
  const verbs: string[] = [];
  for (const result of results) {
    const candidate = americanToBritishOrthography(toEnglishVerbRootForm(result.relatedVerb.trim().toLowerCase()));
    if (!candidate || seen.has(candidate) || !isLikelyEnglishVerb(candidate)) continue;
    seen.add(candidate);
    verbs.push(candidate);
    if (options.limit && verbs.length >= options.limit) break;
  }
  return verbs;
}

/**
 * Related objects for `object`, deduplicated (highest-evidence first).
 *
 * `limit` bounds the final, deduped list — it is applied here, not forwarded
 * to `giveObjectRelated`, so dedup never starves the result below `limit`.
 */
export async function getRelatedObjects(object: string, options: GetRelatedObjectsOptions = {}): Promise<string[]> {
  const results = await giveObjectRelated(object);
  const seen = new Set<string>();
  const objects: string[] = [];
  for (const result of results) {
    const candidate = result.relatedObject.trim().toLowerCase();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    objects.push(candidate);
    if (options.limit && objects.length >= options.limit) break;
  }
  return objects;
}
