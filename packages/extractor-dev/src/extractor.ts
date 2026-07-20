/**
 * TermExtractor — the public entry point.
 *
 * A job post flows through three stages, mirrored by the shape of `extract()`:
 *
 *   1. PREPARE  — split the document into clauses, drop noise, de-duplicate, embed
 *                 the survivors once, and resolve the salary channel. (`prepare`)
 *   2. MATCH    — score each target bucket independently. Every bucket runs one of
 *                 a few archetypes (gazetteer / semantic+lexical / inference) plus
 *                 optional cross-bucket re-ranking. (`matchBucket` and friends)
 *   3. ASSEMBLE — derive collar_kind from the occupation and package the result.
 *                 (`deriveCollarKind`, `assembleResult`)
 *
 * Occupation is matched first so capabilities can re-rank against it and collar_kind
 * can be derived from it within the same call.
 *
 * Two structured signals sit outside the per-bucket loop: `structured[bucket]`
 * field values (fused per bucket as the cleanest, highest-confidence evidence) and
 * `salary` (a parsed min/max/currency/period channel, not a bucket).
 */

import type { GazetteerResolver } from '@term-extractor/gazetteer';
import { openGazetteer } from '@term-extractor/gazetteer';
import { resolveBucketConfig } from '../../../src/buckets.ts';
import { OccupationCapabilityMap } from '../../../src/derive/capability-consistency.ts';
import { CollarMap } from '../../../src/derive/collar.ts';
import { inferFacetTerms, isFacetBucket } from '../../../src/inference/facets.ts';
import { inferFiniteBucket } from '../../../src/inference/index.ts';
import { inferLocation, setGazetteer } from '../../../src/inference/location.ts';
import { resolveLanguages } from '../../../src/languages.ts';
import { type LexicalEntry, LexicalIndex } from '../../../src/lexical-index.ts';
import { isNegated } from '../../../src/negation.ts';
import { classifyClause } from '../../../src/noise-guard.ts';
import { normalizeText } from '../../../src/normalize.ts';
import { extractSalary } from '../../../src/salary/salary.ts';
import { type Clause, splitClauses } from '../../../src/tokenizer.ts';
import type {
  BucketConfig,
  BucketName,
  ExtractedTerm,
  ExtractionResult,
  ExtractOptions,
  JobPostInput,
  MatchEvidence,
  SalaryRange,
  StructuredResolution,
  StructuredResolveOptions,
  SupportedLanguage,
} from '../../../src/types.ts';
import { ALL_BUCKETS } from '../../../src/types.ts';
import { type StoredTerm, VectorStore } from '../../../src/vector-store.ts';
import { Embedder, type EmbedderOptions, type TextEmbedder } from './embedder.ts';

export interface TermExtractorOptions extends EmbedderOptions {
  /** Directory containing vectors.bin / index.meta.json / lexical.json. */
  dataDir: string;
  /** Default language scope applied when a call omits `languages` (default: all). */
  defaultLanguages?: SupportedLanguage[];
}

/** Dependencies for building an extractor directly (embedded callers / tests). */
export interface TermExtractorComponents {
  store: VectorStore;
  lexical: LexicalIndex;
  embedder: TextEmbedder;
  gazetteer?: GazetteerResolver;
  collar?: CollarMap;
  occCaps?: OccupationCapabilityMap;
  defaultLanguages?: SupportedLanguage[];
}

/** Extra cosine required from non-title clauses in title-anchored buckets. */
const TITLE_ANCHOR_PENALTY = 0.07;
/** Extra cosine required for a semantic hit in a controlled-vocabulary bucket. */
const CONTROLLED_SEMANTIC_PENALTY = 0.12;
/** Confidence assigned to a structured-field exact hit. */
const STRUCTURED_CONFIDENCE = 0.99;
/** Only occupations at/above this score are trusted for capability consistency. */
const CONSISTENCY_OCC_MIN = 0.85;
/** Consistency boost added to a capability that matches the occupation's skills. */
const CONSISTENCY_BOOST = { essential: 0.15, optional: 0.07 } as const;

/**
 * Buckets the free-text path infers, via the shared `inferFiniteBucket` dispatcher.
 * Deliberately EXCLUDES workplace (handled by the lexical path here) even though the
 * dispatcher can infer it — the title profile opts workplace in, this path does not.
 */
const FREE_TEXT_INFER_BUCKETS = new Set<BucketName>([
  'employment',
  'schedule',
  'level',
  'qualifications',
  'company_type',
  'company_size',
]);

/**
 * Canonical keys the fuzzy (semantic/lexical) path must NOT produce — they are too
 * brittle for it and are handled only by strict inference. Currently: driving
 * license classes (single-letter discriminator) and language requirements
 * (bare language names are not requirements).
 */
function suppressedFromFuzzy(key: string): boolean {
  return key.includes(':language_requirement:') || key.includes(':license:driving_license_');
}

/** A single bucket match under construction, before it becomes an ExtractedTerm. */
interface Candidate {
  bucket: BucketName;
  canonicalKey: string;
  displayName: string;
  termType: string;
  languageCode: SupportedLanguage;
  score: number;
  semantic: boolean;
  lexical: boolean;
  structured: boolean;
  inferred: boolean;
  evidence: MatchEvidence[];
}

/**
 * Everything derived once per `extract()` call and shared across the matching
 * stage — so the per-bucket helpers read cleanly instead of threading state.
 */
interface ExtractionRun {
  input: JobPostInput;
  /** Kept clauses (noise dropped, de-duplicated), in document order. */
  clauses: Clause[];
  /** Clause embeddings aligned to `clauses`; empty when no bucket needed vectors. */
  vectors: Float32Array[];
  configs: Map<BucketName, BucketConfig>;
  languages: SupportedLanguage[] | undefined;
  targetBuckets: BucketName[];
  /** Buckets to process, occupation first (capabilities/collar depend on it). */
  order: BucketName[];
  structuredLocation: string | undefined;
  salary: SalaryRange[];
  clausesSkipped: number;
}

export class TermExtractor {
  private readonly defaultLanguages?: SupportedLanguage[];

  private constructor(
    private readonly store: VectorStore,
    private readonly lexical: LexicalIndex,
    private readonly embedder: TextEmbedder,
    private readonly gazetteer: GazetteerResolver | undefined,
    private readonly collar: CollarMap | undefined,
    private readonly occCaps: OccupationCapabilityMap | undefined,
    defaultLanguages?: SupportedLanguage[],
  ) {
    this.defaultLanguages = defaultLanguages;
    setGazetteer(gazetteer); // install as the inferLocation global
  }

  /** Load the vector store, lexical index, embedder, and derivation maps. */
  static async load(options: TermExtractorOptions): Promise<TermExtractor> {
    const [store, lexical, gazetteer, collar, occCaps] = await Promise.all([
      VectorStore.load(options.dataDir),
      LexicalIndex.load(options.dataDir),
      // The gazetteer is self-contained in @term-extractor/gazetteer (its own data dir);
      // this one resolver backs BOTH free-text extraction and structured resolution.
      openGazetteer(),
      CollarMap.load(options.dataDir),
      OccupationCapabilityMap.load(options.dataDir),
    ]);
    const embedder = new Embedder({ model: options.model ?? store.model, batchSize: options.batchSize });
    return new TermExtractor(store, lexical, embedder, gazetteer, collar, occCaps, options.defaultLanguages);
  }

  /** Build an extractor from already-constructed components (no disk load). */
  static fromComponents(components: TermExtractorComponents): TermExtractor {
    return new TermExtractor(
      components.store,
      components.lexical,
      components.embedder,
      components.gazetteer,
      components.collar,
      components.occCaps,
      components.defaultLanguages,
    );
  }

  /** The embedding model backing this extractor. */
  get model(): string {
    return this.embedder.model;
  }

  /** Buckets present in the loaded index. */
  get buckets(): BucketName[] {
    return this.store.buckets();
  }

  /**
   * Convenience for the common unstructured case: extract every bucket from a job
   * post's title + description.
   */
  extractFromJobPost(
    title: string | undefined,
    description: string | undefined,
    options: ExtractOptions = {},
  ): Promise<ExtractionResult> {
    return this.extract({ title, description }, options);
  }

  /** Extract terms for every target bucket. See the file header for the stages. */
  async extract(input: JobPostInput, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const run = await this.prepare(input, options);

    const matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>> = {};
    for (const bucket of run.order) {
      const matches = await this.matchBucket(bucket, run, matchesByBucket);
      if (matches.length) matchesByBucket[bucket] = matches;
    }

    this.deriveCollarKind(matchesByBucket, run, options);

    return this.assembleResult(matchesByBucket, run);
  }

  // ---------------------------------------------------------------------------
  // Stage 1 — PREPARE
  // ---------------------------------------------------------------------------

  /**
   * Turn the raw document into everything the matching stage needs: clean clauses,
   * their embeddings (only if some bucket needs them), per-bucket configs, the
   * salary channel, and the bucket processing order.
   */
  private async prepare(input: JobPostInput, options: ExtractOptions): Promise<ExtractionRun> {
    const targetBuckets = options.targetBuckets?.length ? options.targetBuckets : ALL_BUCKETS;
    const languages = resolveLanguages(options.languages ?? this.defaultLanguages);

    const { clauses, clausesSkipped } = this.buildClauses(input);

    const configs = new Map<BucketName, BucketConfig>();
    for (const b of targetBuckets) configs.set(b, resolveBucketConfig(b, options.bucketOverrides?.[b]));

    // Embed clauses only if a targeted bucket actually needs vectors. A gazetteer-
    // or inference-only request (e.g. location) skips the model entirely.
    const needEmbeddings = [...configs.values()].some(
      (c) => c.matchStrategy !== 'gazetteer' && c.matchStrategy !== 'inferred',
    );
    const vectors = needEmbeddings && clauses.length ? await this.embedder.embed(clauses.map((c) => c.text)) : [];
    if (vectors.length) this.assertDim(vectors[0]);

    // Process occupation first so capabilities can re-rank against it (and collar
    // can derive from it) in the same pass.
    const order = [...targetBuckets].sort((a, b) => Number(b === 'occupation') - Number(a === 'occupation'));

    return {
      input,
      clauses,
      vectors,
      configs,
      languages,
      targetBuckets,
      order,
      structuredLocation: typeof input === 'object' ? input.structured?.location : undefined,
      salary: this.resolveSalary(input),
      clausesSkipped,
    };
  }

  /** Split the document into clauses, drop noise clauses, de-duplicate on form. */
  private buildClauses(input: JobPostInput): { clauses: Clause[]; clausesSkipped: number } {
    const seen = new Set<string>();
    const clauses: Clause[] = [];
    let clausesSkipped = 0;
    for (const c of this.collectClauses(input)) {
      if (!classifyClause(c.text).keep) {
        clausesSkipped++;
        continue;
      }
      const key = normalizeText(c.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clauses.push(c);
    }
    return { clauses, clausesSkipped };
  }

  /**
   * Salary is a separate structured channel (min/max/currency/period/tax), not a
   * bucket. Pre-known structured ranges pass through; otherwise parse the text.
   */
  private resolveSalary(input: JobPostInput): SalaryRange[] {
    const passthrough = typeof input === 'object' ? input.salary : undefined;
    if (passthrough?.length) return passthrough;
    return extractSalary(this.collectRawText(input));
  }

  // ---------------------------------------------------------------------------
  // Stage 2 — MATCH (one bucket)
  // ---------------------------------------------------------------------------

  /**
   * Score a single bucket. Gazetteer buckets go through the dedicated resolver;
   * every other bucket fuses (in precedence order) structured-field evidence,
   * per-clause semantic + lexical hits, and rule-based inference, then — for
   * capabilities — re-ranks against a confident occupation before the per-bucket cap.
   */
  private async matchBucket(
    bucket: BucketName,
    run: ExtractionRun,
    matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>>,
  ): Promise<ExtractedTerm[]> {
    const cfg = run.configs.get(bucket)!;

    if (cfg.matchStrategy === 'gazetteer') return this.matchByGazetteer(cfg, run);

    const merged = new Map<string, Candidate>();
    await this.matchStructuredField(merged, bucket, cfg, run);
    this.matchClauses(merged, bucket, cfg, run);
    this.matchByInference(merged, bucket, run);
    if (bucket === 'capabilities') this.rerankByOccupation(merged, matchesByBucket);

    return this.finalize(merged, cfg);
  }

  /** Location and other gazetteer buckets resolve via place names, no embeddings. */
  private matchByGazetteer(cfg: BucketConfig, run: ExtractionRun): ExtractedTerm[] {
    if (!this.gazetteer) return [];
    const free = inferLocation(run.clauses);
    const structured = run.structuredLocation
      ? inferLocation([{ text: run.structuredLocation, source: 'structured' }], undefined, 'structured')
      : [];
    return [...structured, ...free].slice(0, cfg.maxPerBucket);
  }

  /**
   * Fuse a deliberate `structured[bucket]` value first: it is the strongest,
   * cleanest signal (exact alias, no prose noise), so it seeds the bucket.
   */
  private async matchStructuredField(
    merged: Map<string, Candidate>,
    bucket: BucketName,
    cfg: BucketConfig,
    run: ExtractionRun,
  ): Promise<void> {
    const value = typeof run.input === 'object' ? run.input.structured?.[bucket] : undefined;
    if (value) await this.mergeStructured(merged, bucket, value, run.languages, semanticEnabled(cfg));
  }

  /** Per-clause semantic + lexical matching, gated by the bucket's strategy. */
  private matchClauses(
    merged: Map<string, Candidate>,
    bucket: BucketName,
    cfg: BucketConfig,
    run: ExtractionRun,
  ): void {
    for (let i = 0; i < run.clauses.length; i++) {
      const clause = run.clauses[i];
      if (semanticEnabled(cfg)) this.addSemanticMatch(merged, bucket, cfg, clause, run.vectors[i], run.languages);
      if (lexicalEnabled(cfg)) this.addLexicalMatches(merged, bucket, cfg, clause, run.vectors[i], run.languages);
    }
  }

  /**
   * Best cosine match for one clause within the bucket, kept above the (possibly
   * penalized) threshold. Title-anchored buckets demand a higher score from
   * description/section clauses; controlled buckets add a strict semantic backstop
   * (aliases carry them — semantic only catches un-aliased paraphrase). A match is
   * dropped when its term name is explicitly negated in the clause.
   */
  private addSemanticMatch(
    merged: Map<string, Candidate>,
    bucket: BucketName,
    cfg: BucketConfig,
    clause: Clause,
    vector: Float32Array,
    languages: SupportedLanguage[] | undefined,
  ): void {
    const anchored = cfg.titleAnchored && clause.source !== 'title' && clause.source !== 'text';
    const threshold =
      cfg.semanticThreshold +
      (anchored ? TITLE_ANCHOR_PENALTY : 0) +
      (cfg.matchStrategy === 'controlled' ? CONTROLLED_SEMANTIC_PENALTY : 0);

    const best = this.store.searchBest(vector, bucket, languages);
    if (!best || best.score < threshold) return;
    const term = this.store.term(best.index);
    if (!term || suppressedFromFuzzy(term.canonicalKey)) return;
    if (isNegated(clause.text, normalizeText(term.displayName))) return;

    this.merge(merged, {
      bucket,
      canonicalKey: term.canonicalKey,
      displayName: term.displayName,
      termType: term.termType,
      languageCode: term.languageCode,
      score: best.score,
      semantic: true,
      lexical: false,
      structured: false,
      inferred: false,
      evidence: [{ clause: clause.text, method: 'semantic', score: round(best.score) }],
    });
  }

  /**
   * Exact normalized-alias hits for one clause. Negated aliases ("no remote",
   * "fără X") are dropped. A single-word alias is only trusted when the clause
   * embedding is actually near the term — this kills common-word aliases that
   * collide across languages ("marketing" → a banking manager, "munca"/"agent" →
   * a specific but wrong occupation). Real short-title words corroborate weakly
   * too, so we favor precision: a missed occupation beats a confidently wrong one.
   * (With embeddings skipped there is nothing to corroborate against, so we drop
   * unigrams entirely.)
   */
  private addLexicalMatches(
    merged: Map<string, Candidate>,
    bucket: BucketName,
    cfg: BucketConfig,
    clause: Clause,
    vector: Float32Array | undefined,
    languages: SupportedLanguage[] | undefined,
  ): void {
    for (const { entry: hit, words, gram } of this.lexical.lookup(clause.text, bucket, languages)) {
      if (suppressedFromFuzzy(hit.canonicalKey)) continue;
      if (isNegated(clause.text, gram)) continue;
      if (words < 2) {
        const sim = vector ? this.store.similarityTo(vector, hit.canonicalKey, hit.languageCode) : null;
        if (sim === null || sim < cfg.unigramCorroboration) continue;
      }
      this.merge(merged, {
        bucket,
        canonicalKey: hit.canonicalKey,
        displayName: hit.displayName,
        termType: hit.termType,
        languageCode: hit.languageCode,
        score: cfg.lexicalConfidence,
        semantic: false,
        lexical: true,
        structured: false,
        inferred: false,
        evidence: [{ clause: clause.text, method: 'lexical', score: cfg.lexicalConfidence }],
      });
    }
  }

  /**
   * Rule-based inference (employment / schedule / level / qualifications /
   * company_size): terms implied by numeric or idiomatic signals that aliases and
   * embeddings miss. Explicit hits outrank inferred ones via score; inference only
   * adds what is otherwise absent.
   */
  private matchByInference(merged: Map<string, Candidate>, bucket: BucketName, run: ExtractionRun): void {
    if (!FREE_TEXT_INFER_BUCKETS.has(bucket)) return;
    for (const it of inferFiniteBucket(bucket, run.clauses, run.languages)) {
      const st = this.store.termByKey(it.canonicalKey);
      this.merge(merged, {
        bucket,
        canonicalKey: it.canonicalKey,
        displayName: st?.displayName ?? it.canonicalKey.split(':').pop()!,
        termType: st?.termType ?? bucket,
        languageCode: st?.languageCode ?? 'en',
        score: it.score,
        semantic: false,
        lexical: false,
        structured: false,
        inferred: true,
        evidence: [{ clause: it.evidence, method: 'inferred', score: round(it.score) }],
      });
    }
  }

  /**
   * Boost capabilities that are the essential/optional skills of a CONFIDENT
   * occupation, before the per-bucket cap, so they survive the cutoff. Runs against
   * only high-scoring occupations — a weak/wrong occupation guess must not drag in
   * its (wrong) capabilities.
   */
  private rerankByOccupation(
    merged: Map<string, Candidate>,
    matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>>,
  ): void {
    const confidentOcc = (matchesByBucket.occupation ?? []).filter((o) => o.score >= CONSISTENCY_OCC_MIN);
    if (!this.occCaps || !confidentOcc.length) return;

    for (const cand of merged.values()) {
      let rel: 'essential' | 'optional' | null = null;
      for (const o of confidentOcc) {
        const r = this.occCaps.relation(o.canonicalKey, cand.canonicalKey);
        if (r === 'essential') {
          rel = 'essential';
          break;
        }
        if (r === 'optional') rel ??= 'optional';
      }
      if (!rel) continue;
      cand.score = Math.min(0.99, cand.score + CONSISTENCY_BOOST[rel]);
      cand.evidence.push({ clause: 'consistent with occupation', method: 'derived', score: round(cand.score) });
    }
  }

  /** Turn the candidate map into the ranked, capped list of terms for a bucket. */
  private finalize(merged: Map<string, Candidate>, cfg: BucketConfig): ExtractedTerm[] {
    return [...merged.values()]
      .map(toExtractedTerm)
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.maxPerBucket);
  }

  // ---------------------------------------------------------------------------
  // Stage 3 — ASSEMBLE
  // ---------------------------------------------------------------------------

  /**
   * collar_kind is derived from the extracted occupation via the knowledge graph
   * (occupation → collar_kind edge) and merged with any explicit text match.
   */
  private deriveCollarKind(
    matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>>,
    run: ExtractionRun,
    options: ExtractOptions,
  ): void {
    if (!this.collar || !run.targetBuckets.includes('collar_kind')) return;
    const derived = this.deriveCollar(matchesByBucket.occupation ?? []);
    if (!derived) return;

    const cfg = resolveBucketConfig('collar_kind', options.bucketOverrides?.collar_kind);
    const byKey = new Map<string, ExtractedTerm>((matchesByBucket.collar_kind ?? []).map((t) => [t.canonicalKey, t]));
    const prev = byKey.get(derived.canonicalKey);
    if (!prev || derived.score > prev.score) byKey.set(derived.canonicalKey, derived);
    matchesByBucket.collar_kind = [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, cfg.maxPerBucket);
  }

  private assembleResult(
    matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>>,
    run: ExtractionRun,
  ): ExtractionResult {
    return {
      matchesByBucket,
      salary: run.salary.length ? run.salary : undefined,
      diagnostics: {
        clausesAnalyzed: run.clauses.length,
        clausesSkipped: run.clausesSkipped,
        languagesConsidered: run.languages ?? [],
        bucketsConsidered: run.targetBuckets,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Structured resolution (single keyword → one bucket)
  // ---------------------------------------------------------------------------

  /**
   * Structured resolution: map a single deliberate keyword (e.g. a structured
   * field value like "Full time" or "Cluj") to canonical term(s) in ONE bucket
   * the caller names. Lexical-exact-first, so the common case needs no embedding.
   */
  async resolveStructured(
    bucket: BucketName,
    value: string,
    options: StructuredResolveOptions = {},
  ): Promise<StructuredResolution> {
    const [result] = await this.resolveStructuredMany(bucket, [value], options);
    return result;
  }

  /**
   * Batch structured resolution against one bucket. Exact alias hits are resolved
   * without the model; only the remaining values are embedded — in a single batch.
   */
  async resolveStructuredMany(
    bucket: BucketName,
    values: string[],
    options: StructuredResolveOptions = {},
  ): Promise<StructuredResolution[]> {
    if (!ALL_BUCKETS.includes(bucket)) {
      throw new Error(`Unknown bucket: ${bucket}. Expected one of: ${ALL_BUCKETS.join(', ')}`);
    }
    const languages = resolveLanguages(options.languages ?? this.defaultLanguages);
    const topK = options.topK ?? 3;
    const cfg = resolveBucketConfig(bucket);

    // Location resolves through the gazetteer (value treated as a structured field).
    if (cfg.matchStrategy === 'gazetteer') {
      return values.map((value) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed || !this.gazetteer) return { bucket, input: value, matched: false, method: 'none', terms: [] };
        const terms = inferLocation([{ text: trimmed, source: 'structured' }], undefined, 'structured').slice(0, topK);
        return { bucket, input: value, matched: terms.length > 0, method: terms.length ? 'gazetteer' : 'none', terms };
      });
    }

    // Lexical-exact pass first: resolve whole-value alias hits without the model,
    // and collect the misses to embed together.
    const results: StructuredResolution[] = new Array(values.length);
    const pending: { i: number; value: string }[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? '';
      const trimmed = value.trim();
      if (!trimmed) {
        results[i] = { bucket, input: value, matched: false, method: 'none', terms: [] };
        continue;
      }
      const exact = dedupeEntries(this.lexical.lookupExact(trimmed, bucket, languages));
      if (exact.length) {
        results[i] = {
          bucket,
          input: value,
          matched: true,
          method: 'lexical',
          terms: exact.slice(0, topK).map((e) => lexicalTerm(e, cfg.lexicalConfidence, trimmed)),
        };
      } else if (isFacetBucket(bucket)) {
        const terms = this.facetStructuredTerms(bucket, trimmed, languages).slice(0, topK);
        if (terms.length) {
          results[i] = {
            bucket,
            input: value,
            matched: true,
            method: 'structured',
            terms,
          };
        } else if (options.semanticFallback === false) {
          results[i] = { bucket, input: value, matched: false, method: 'none', terms: [] };
        } else {
          pending.push({ i, value: trimmed });
        }
      } else if (options.semanticFallback === false) {
        results[i] = { bucket, input: value, matched: false, method: 'none', terms: [] };
      } else {
        pending.push({ i, value: trimmed });
      }
    }

    // Semantic fallback for the misses, in one batched embed.
    if (pending.length) {
      const vectors = await this.embedder.embed(pending.map((p) => p.value));
      this.assertDim(vectors[0]);
      const minScore = options.minScore ?? cfg.semanticThreshold;
      for (let j = 0; j < pending.length; j++) {
        const { i } = pending[j];
        const terms = this.store
          .searchTopK(vectors[j], bucket, topK, languages)
          .filter((h) => h.score >= minScore)
          .map((h) => semanticTerm(this.store.term(h.index), h.score, pending[j].value));
        results[i] = {
          bucket,
          input: values[i],
          matched: terms.length > 0,
          method: terms.length ? 'semantic' : 'none',
          terms,
        };
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Guard against an embedder whose output dimension differs from the index. */
  private assertDim(vector: Float32Array): void {
    if (vector.length !== this.store.dim) {
      throw new Error(
        `Embedding dimension mismatch: model "${this.embedder.model}" produced ${vector.length}-d vectors ` +
          `but the index was built at ${this.store.dim}-d (model "${this.store.model}"). ` +
          `Rebuild the index with the same model, or load the matching model.`,
      );
    }
  }

  /** Derive collar_kind from the strongest occupation that has a graph edge. */
  private deriveCollar(occupations: ExtractedTerm[]): ExtractedTerm | null {
    if (!this.collar) return null;
    for (const o of [...occupations].sort((a, b) => b.score - a.score)) {
      const edge = this.collar.lookup(o.canonicalKey);
      if (!edge) continue;
      const st = this.store.termByKey(edge.collar);
      const score = round(Math.min(0.97, edge.confidence * o.score));
      return {
        bucket: 'collar_kind',
        canonicalKey: edge.collar,
        displayName: st?.displayName ?? edge.collar.split(':').pop()!,
        termType: st?.termType ?? 'collar_kind',
        languageCode: st?.languageCode ?? 'en',
        score,
        method: 'derived',
        evidence: [{ clause: `derived from occupation: ${o.displayName}`, method: 'derived', score }],
      };
    }
    return null;
  }

  /** Raw text for whole-document parsers (salary) — order/context preserved. */
  private collectRawText(input: JobPostInput): string {
    if (typeof input === 'string') return input;
    const parts = [input.title, input.description, ...(input.sections ?? []).map((s) => s.text)];
    return parts.filter(Boolean).join('. ');
  }

  private collectClauses(input: JobPostInput): Clause[] {
    if (typeof input === 'string') return splitClauses(input, 'text');
    const out: Clause[] = [];
    if (input.title) out.push(...splitClauses(input.title, 'title'));
    if (input.description) out.push(...splitClauses(input.description, 'description'));
    for (const s of input.sections ?? []) out.push(...splitClauses(s.text, `section:${s.name}`));
    return out;
  }

  /** Merge a candidate into the map, keeping the strongest evidence per key. */
  private merge(map: Map<string, Candidate>, cand: Candidate): void {
    const existing = map.get(cand.canonicalKey);
    if (!existing) {
      map.set(cand.canonicalKey, cand);
      return;
    }
    existing.score = Math.max(existing.score, cand.score);
    existing.semantic ||= cand.semantic;
    existing.lexical ||= cand.lexical;
    existing.structured ||= cand.structured;
    existing.inferred ||= cand.inferred;
    existing.evidence.push(...cand.evidence);
    // Prefer the display name / language of the strongest single piece of evidence.
    if (cand.score > topEvidenceScore(existing)) {
      existing.displayName = cand.displayName;
      existing.languageCode = cand.languageCode;
    }
  }

  /**
   * Resolve a structured field value into `merged`: exact alias first (trusted,
   * no embedding), else a strict semantic top-1 fallback. Negation-checked too.
   */
  private async mergeStructured(
    map: Map<string, Candidate>,
    bucket: BucketName,
    value: string,
    languages: SupportedLanguage[] | undefined,
    doSemantic: boolean,
  ): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) return;
    const exact = dedupeEntries(this.lexical.lookupExact(trimmed, bucket, languages));
    if (exact.length) {
      for (const e of exact) {
        this.merge(map, {
          bucket,
          canonicalKey: e.canonicalKey,
          displayName: e.displayName,
          termType: e.termType,
          languageCode: e.languageCode,
          score: STRUCTURED_CONFIDENCE,
          semantic: false,
          lexical: true,
          structured: true,
          inferred: false,
          evidence: [{ clause: trimmed, method: 'structured', score: STRUCTURED_CONFIDENCE }],
        });
      }
      return;
    }
    if (isFacetBucket(bucket)) {
      const terms = this.facetStructuredTerms(bucket, trimmed, languages);
      for (const term of terms) {
        this.merge(map, {
          bucket,
          canonicalKey: term.canonicalKey,
          displayName: term.displayName,
          termType: term.termType,
          languageCode: term.languageCode,
          score: STRUCTURED_CONFIDENCE,
          semantic: false,
          lexical: false,
          structured: true,
          inferred: false,
          evidence: [{ clause: trimmed, method: 'structured', score: STRUCTURED_CONFIDENCE }],
        });
      }
      if (terms.length) return;
    }
    if (!doSemantic) return;
    const [vec] = await this.embedder.embed([trimmed]);
    this.assertDim(vec);
    const best = this.store.searchBest(vec, bucket, languages);
    const cfg = resolveBucketConfig(bucket);
    if (best && best.score >= cfg.semanticThreshold) {
      const term = this.store.term(best.index);
      this.merge(map, {
        bucket,
        canonicalKey: term.canonicalKey,
        displayName: term.displayName,
        termType: term.termType,
        languageCode: term.languageCode,
        score: best.score,
        semantic: true,
        lexical: false,
        structured: true,
        inferred: false,
        evidence: [{ clause: trimmed, method: 'structured', score: round(best.score) }],
      });
    }
  }

  private facetStructuredTerms(
    bucket: BucketName,
    value: string,
    languages: SupportedLanguage[] | undefined,
  ): ExtractedTerm[] {
    if (!isFacetBucket(bucket)) return [];
    const out: ExtractedTerm[] = [];
    for (const it of inferFacetTerms(bucket, [{ text: value, source: 'structured' }], languages)) {
      const term = this.store.termByKey(it.canonicalKey);
      if (!term) continue;
      out.push({
        bucket,
        canonicalKey: term.canonicalKey,
        displayName: term.displayName,
        termType: term.termType,
        languageCode: term.languageCode,
        score: STRUCTURED_CONFIDENCE,
        method: 'structured',
        evidence: [{ clause: value, method: 'structured', score: STRUCTURED_CONFIDENCE }],
      });
    }
    return out;
  }
}

/** Whether a strategy runs the semantic path. */
function semanticEnabled(cfg: BucketConfig): boolean {
  return cfg.matchStrategy === 'semantic' || cfg.matchStrategy === 'hybrid' || cfg.matchStrategy === 'controlled';
}

/** Whether a strategy runs the lexical (exact alias) path. */
function lexicalEnabled(cfg: BucketConfig): boolean {
  return cfg.matchStrategy === 'lexical' || cfg.matchStrategy === 'hybrid' || cfg.matchStrategy === 'controlled';
}

function topEvidenceScore(c: Candidate): number {
  return c.evidence.reduce((m, e) => Math.max(m, e.score), 0);
}

function toExtractedTerm(c: Candidate): ExtractedTerm {
  const evidence = c.evidence.sort((a, b) => b.score - a.score).slice(0, 5);
  return {
    bucket: c.bucket,
    canonicalKey: c.canonicalKey,
    displayName: c.displayName,
    termType: c.termType,
    languageCode: c.languageCode,
    score: round(c.score),
    method: c.structured
      ? 'structured'
      : c.semantic && c.lexical
        ? 'both'
        : c.semantic
          ? 'semantic'
          : c.lexical
            ? 'lexical'
            : 'inferred',
    evidence,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** De-duplicate lexical entries by canonical key, preserving order. */
function dedupeEntries(entries: LexicalEntry[]): LexicalEntry[] {
  const seen = new Set<string>();
  const out: LexicalEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.canonicalKey)) continue;
    seen.add(e.canonicalKey);
    out.push(e);
  }
  return out;
}

function lexicalTerm(e: LexicalEntry, score: number, input: string): ExtractedTerm {
  return {
    bucket: e.bucket,
    canonicalKey: e.canonicalKey,
    displayName: e.displayName,
    termType: e.termType,
    languageCode: e.languageCode,
    score: round(score),
    method: 'lexical',
    evidence: [{ clause: input, method: 'lexical', score: round(score) }],
  };
}

function semanticTerm(t: StoredTerm, score: number, input: string): ExtractedTerm {
  return {
    bucket: t.bucket,
    canonicalKey: t.canonicalKey,
    displayName: t.displayName,
    termType: t.termType,
    languageCode: t.languageCode,
    score: round(score),
    method: 'semantic',
    evidence: [{ clause: input, method: 'semantic', score: round(score) }],
  };
}
