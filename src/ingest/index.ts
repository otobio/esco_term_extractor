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
 * Structured resolution and the title profile run purely over OpenSearch (no
 * embedding model); the dense `--verify` path is intentionally not wired here.
 */
import { fileURLToPath } from 'node:url';
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import { openGazetteer } from '@term-extractor/gazetteer';
import { CollarMap } from '../derive/collar.ts';
import { inferOccupation } from '../inference/occupation.ts';
import { LexicalIndex } from '../lexical-index.ts';
import { additiveHybridStrategy } from '../matchers/additive-hybrid.ts';
import { finalizeFinite, osFinalize, type ResolvedTerm } from '../matchers/finite.ts';
import { lexicalStrategy } from '../matchers/lexical.ts';
import { createOpenSearchClient, type OpenSearchClientOptions } from '../matchers/os-client.ts';
import { buildFilters, strategyForBucket } from '../matchers/resolve.ts';
import type { OpenSearchClient, TermMatchStrategy } from '../matchers/types.ts';
import { resolveTitle } from '../profiles/index.ts';
import { extractSalary } from '../salary/salary.ts';
import { splitClauses } from '../tokenizer.ts';
import {
  ALL_BUCKETS,
  type BucketName,
  type ExtractedTerm,
  type SalaryRange,
  type SupportedLanguage,
} from '../types.ts';
import { logIngestCall, summarizeIngestOptions } from './logger.ts';

export type SearchBucket = BucketName;

export {
  defaultTierOf,
  type MergePolicy,
  type MergeTier,
  mergeSignals,
} from './merge.ts';

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
}

export interface RuntimeConfig extends OpenSearchClientOptions {
  /** Directory holding the lexical + gazetteer snapshots (defaults to the packaged data). */
  dataDir?: string;
}

export interface Runtime {
  readonly client: OpenSearchClient;
  lexical(): Promise<LexicalIndex>;
  gazetteer(): Promise<GazetteerResolver | undefined>;
  /** occupation→collar_kind graph edges; used by the title profile to derive collar. */
  collar(): Promise<CollarMap | undefined>;
}

export interface DeriveOptions {
  runtime: Runtime;
  /** Text language — lexical scan / OS surface filter. */
  locale?: string;
  /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`; defaults to `locale`. */
  countryCode?: string;
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

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));

export function createRuntime(config: RuntimeConfig = {}): Runtime {
  const client = createOpenSearchClient(config);
  const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
  let lexicalP: Promise<LexicalIndex> | undefined;
  let gazetteerP: Promise<GazetteerResolver | undefined> | undefined;
  let collarP: Promise<CollarMap | undefined> | undefined;
  return {
    client,
    lexical: () => (lexicalP ??= LexicalIndex.load(dataDir)),
    gazetteer: () => (gazetteerP ??= openGazetteer()), // package-owned data dir
    collar: () => (collarP ??= CollarMap.load(dataDir)),
  };
}

/** A resolved structured term, tagged with the bucket + original input it came from. */
interface StructuredResult {
  bucket: SearchBucket;
  sourceText: string;
  term: ResolvedTerm;
  /** Set when `term` came from the alt occupation engine (`packages/occupation`) —
   *  same `occupation` bucket, a second independent detector alongside OS/finite. */
  altTermType?: 'occupation' | 'occupation_group';
}

function strategyFor(bucket: SearchBucket, mode?: string): TermMatchStrategy {
  if (mode === 'lexical') return lexicalStrategy;
  if (mode === 'neural' || mode === 'hybrid') return additiveHybridStrategy;
  return strategyForBucket(bucket);
}

/**
 * One batched `_msearch` over structured surfaces, then per item the SAME finite
 * resolution the title profile uses: OS resolution (`osFinalize`) UNIONED with rule
 * inference (`finalizeFinite`). For finite buckets this recovers stated-but-unindexed
 * values (e.g. "Banking, Finance & Insurance") that the OS index alone would drop;
 * for buckets with no inferer (occupation/capabilities) `finalizeFinite` is a no-op
 * and only the OS strategy result survives. Per-item strategy still honors `mode`.
 *
 * `occupation` items also run the alt occupation engine (`inferOccupation`), same as
 * the title profile — a failure there degrades to no alt output for that item.
 */
async function resolveStructured(
  items: { bucket: SearchBucket; surface: string; mode?: string; locale?: string }[],
  client: OpenSearchClient,
): Promise<StructuredResult[]> {
  if (!items.length) return [];
  const ctx = { queryModelId: await client.queryModelId(), buildFilters };
  const strategies = items.map((it) => strategyFor(it.bucket, it.mode));
  const [responses, altTerms] = await Promise.all([
    client.msearch(
      items.map((it, i) =>
        strategies[i].buildQuery({ bucket: it.bucket, surface: it.surface, locale: it.locale }, ctx),
      ),
    ),
    Promise.all(
      items.map((it) =>
        it.bucket === 'occupation'
          ? inferOccupation(
              [{ text: it.surface, source: 'structured' }],
              it.locale as SupportedLanguage | undefined,
              2,
            ).catch(() => [] as ExtractedTerm[])
          : Promise.resolve([] as ExtractedTerm[]),
      ),
    ),
  ]);
  const out: StructuredResult[] = [];
  items.forEach((it, i) => {
    const os = osFinalize(
      it.bucket,
      [{ surface: it.surface, source: 'span', response: responses[i] }],
      { locale: it.locale },
      strategies[i],
    );
    const terms = finalizeFinite(it.bucket, os, [{ text: it.surface, source: 'structured' }], { locale: it.locale });
    for (const term of terms) out.push({ bucket: it.bucket, sourceText: it.surface, term });
    for (const alt of altTerms[i]) {
      out.push({
        bucket: it.bucket,
        sourceText: it.surface,
        term: {
          key: altOccupationCanonicalKey(alt),
          name: alt.displayName,
          score: alt.score,
          lang: alt.languageCode,
          status: 'resolved',
          span: alt.evidence?.[0]?.clause ?? alt.displayName,
        },
        altTermType: alt.termType === 'occupation_group' ? 'occupation_group' : 'occupation',
      });
    }
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

/** `altTermType` set means `term` came from the alt occupation engine (see
 *  `StructuredResult.altTermType`) — same bucket, but its own termType/signal/score. */
function toMatch(
  term: ResolvedTerm,
  bucket: SearchBucket,
  sourceText: string,
  signal: string,
  altTermType?: 'occupation' | 'occupation_group',
): CanonicalMatch {
  return {
    canonicalKey: term.key,
    bucket,
    termType: altTermType ?? 'canonical',
    matchedAlias: term.span,
    sourceText,
    evidenceSignal: altTermType
      ? altTermType === 'occupation_group'
        ? 'alt_occupation_family'
        : 'alt_occupation'
      : signal,
    evidenceMatchText: term.span,
    itemIndex: 0,
    propositionIndex: 0,
    // Resolved is a confident single winner; ambiguous is a soft co-candidate that
    // should rank but not clear the searchable-confidence gate. Alt occupation terms
    // carry the engine's own confidence directly (already in [0,1]).
    confidence: altTermType ? term.score : term.status === 'resolved' ? 1 : 0.5,
    source: 'derived',
    isConditional: false,
    isPreferred: false,
    isOffered: false,
    structuralTrust: 1,
    legitimacyScore: 1,
  };
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
  const gaz = await opts.runtime.gazetteer();
  if (!gaz) return [];
  const country = opts.countryCode ?? opts.locale;
  const terms =
    mode === 'structured'
      ? gaz.resolve([], input, country)
      : gaz.resolve(splitClauses(input, 'text'), undefined, country);
  return terms.map((t) => {
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
}

async function deriveProfile(input: string, opts: DeriveOptions): Promise<CanonicalMatch[]> {
  if (opts.profile !== 'title') throw new Error(`unknown profile: "${opts.profile}" (known: title)`);
  const [lexical, gazetteer, collar] = await Promise.all([
    opts.runtime.lexical(),
    opts.runtime.gazetteer(),
    opts.runtime.collar(),
  ]);
  const result = await resolveTitle(input, {
    client: opts.runtime.client,
    lexical,
    gazetteer,
    collar, // occupation→collar_kind graph edge
    locale: opts.locale,
    countryCode: opts.countryCode, // gazetteer country gate (resolveTitle falls back to locale)
  });
  const matches: CanonicalMatch[] = [];
  for (const [bucket, terms] of Object.entries(result.byBucket)) {
    for (const t of terms as ResolvedTerm[]) {
      matches.push(toMatch(t, bucket as SearchBucket, input, 'title'));
    }
  }
  // Alt occupation engine (opt-in): surfaced as occupation matches tagged with an
  // alt signal, carrying the engine's own confidence — beside, not overriding, the
  // profile's own occupation.
  for (const t of result.altOccupation ?? []) matches.push(altToMatch(t, input));
  return matches;
}

/** Resolve one structured field, or run a custom `profile` (e.g. `title`) over free text. */
export async function derive(input: string, opts: DeriveOptions): Promise<CanonicalMatch[]> {
  if (!input.trim()) {
    await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output: [] });
    return [];
  }

  let output: CanonicalMatch[];
  if (opts.profile) {
    output = await deriveProfile(input, opts);
  } else {
    if (!opts.bucket) throw new Error('derive requires a bucket or a profile');
    // Location is gazetteer-owned (structured place field), not an OS lexical bucket.
    if (opts.bucket === 'location') {
      output = await deriveLocation(input, opts, 'structured', 'structured');
    } else {
      const results = await resolveStructured(
        [{ bucket: opts.bucket, surface: input, mode: opts.mode, locale: opts.locale }],
        opts.runtime.client,
      );
      output = results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured', r.altTermType));
    }
  }

  await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output });
  return output;
}

/** Resolve a batch of structured fields in a single `_msearch` (profile requests delegate to `derive`). */
export async function deriveMany(requests: DeriveRequest[], opts: BatchOptions): Promise<CanonicalMatch[]> {
  const structured = requests.filter((r) => !r.profile && r.input.trim());
  const profiled = requests.filter((r) => r.profile && r.input.trim());
  // Location is gazetteer-owned — resolve it separately, not via the OS _msearch.
  const locationReqs = structured.filter((r) => r.bucket === 'location');
  const osItems = structured.filter((r) => r.bucket !== 'location');
  const items = osItems.map((r) => {
    if (!r.bucket) throw new Error('a structured deriveMany request requires a bucket');
    return { bucket: r.bucket, surface: r.input, mode: r.mode, locale: r.locale ?? opts.locale };
  });
  const results = await resolveStructured(items, opts.runtime.client);
  const matches = results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured', r.altTermType));
  for (const r of locationReqs) {
    matches.push(
      ...(await deriveLocation(
        r.input,
        { runtime: opts.runtime, locale: r.locale ?? opts.locale, countryCode: r.countryCode ?? opts.countryCode },
        'structured',
        'structured',
      )),
    );
  }
  for (const r of profiled) {
    matches.push(
      ...(await deriveProfile(r.input, {
        runtime: opts.runtime,
        locale: r.locale ?? opts.locale,
        countryCode: r.countryCode ?? opts.countryCode,
        profile: r.profile,
      })),
    );
  }
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

/** Unstructured body: every clause probed against every bucket, deduped per key, plus salary parsing. */
export async function analyzeJobListing(text: string, opts: BatchOptions): Promise<IngestJobAnalysisResult> {
  if (!text.trim()) {
    const output = { matches: [], salaryRanges: [] };
    await logIngestCall('analyzeJobListing', { input: text, options: summarizeIngestOptions(opts), output });
    return output;
  }
  const clauses = splitClauses(text, 'text');
  // Location is gazetteer-owned; every OTHER bucket is probed via OS per clause.
  const items = clauses.flatMap((clause) =>
    ALL_BUCKETS.filter((b) => b !== 'location').map((bucket) => ({
      bucket,
      surface: clause.text,
      locale: opts.locale,
    })),
  );
  const results = await resolveStructured(items, opts.runtime.client);
  const best = new Map<string, StructuredResult>();
  results.forEach((r) => {
    const slot = `${r.bucket}:${r.term.key}`;
    const prev = best.get(slot);
    if (!prev || (r.term.status === 'resolved' && prev.term.status !== 'resolved')) best.set(slot, r);
  });
  const matches = [...best.values()].map((r) => toMatch(r.term, r.bucket, r.sourceText, 'description', r.altTermType));
  matches.push(...(await deriveLocation(text, opts, 'unstructured', 'description'))); // gazetteer over the body
  const output = { matches, salaryRanges: extractSalary(text).map(toSalaryMatch) };
  await logIngestCall('analyzeJobListing', { input: text, options: summarizeIngestOptions(opts), output });
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
