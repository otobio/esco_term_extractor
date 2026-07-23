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
import { openGazetteer } from '@term-extractor/gazetteer';
import { timed } from '@term-extractor/utils/perf';
import { CollarMap } from '../derive/collar.js';
import { LexicalIndex } from '../lexical-index.js';
import { additiveHybridStrategy } from '../matchers/additive-hybrid.js';
import { finalizeFinite, osFinalize } from '../matchers/finite.js';
import { lexicalStrategy } from '../matchers/lexical.js';
import { createOpenSearchClient } from '../matchers/os-client.js';
import { buildFilters, strategyForBucket } from '../matchers/resolve.js';
import { classifyClause } from '../noise-guard.js';
import { resolveTitle } from '../profiles/index.js';
import { extractSalary } from '../salary/salary.js';
import { splitClauses } from '../tokenizer.js';
import { ALL_BUCKETS } from '../types.js';
import { logIngestCall, summarizeIngestOptions } from './logger.js';
export { defaultTierOf, mergeSignals, } from './merge.js';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
export function createRuntime(config = {}) {
    const client = createOpenSearchClient(config);
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    const gazetteerDataDir = config.gazetteerDataDir ?? process.env.ESCO_TERM_EXTRACTOR_GAZETTEER_DATA_DIR;
    let lexicalP;
    let gazetteerP;
    let collarP;
    return {
        client,
        lexical: () => (lexicalP ??= timed(() => LexicalIndex.load(dataDir), 'runtime_lexical_load')),
        gazetteer: () => (gazetteerP ??= timed(() => openGazetteer(gazetteerDataDir), 'runtime_gazetteer_load')),
        collar: () => (collarP ??= timed(() => CollarMap.load(dataDir), 'runtime_collar_load')),
    };
}
const LOCAL_STRUCTURED_FINITE_BUCKETS = new Set(['sector', 'job_function']);
function strategyFor(bucket, mode) {
    if (mode === 'lexical')
        return lexicalStrategy;
    if (mode === 'neural' || mode === 'hybrid')
        return additiveHybridStrategy;
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
 * Never called with bucket `occupation` — that bucket always goes through
 * `deriveOccupation` (the title-profile pipeline, which owns its own alt-occupation
 * engine call) instead, for both the single-field and body-text paths.
 */
async function resolveStructured(items, client) {
    if (!items.length)
        return [];
    const out = [];
    const localItems = items.filter((it) => LOCAL_STRUCTURED_FINITE_BUCKETS.has(it.bucket));
    for (const it of localItems) {
        const terms = finalizeFinite(it.bucket, [], [{ text: it.surface, source: 'structured' }], { locale: it.locale });
        for (const term of terms)
            out.push({ bucket: it.bucket, sourceText: it.surface, term });
    }
    const osItems = items.filter((it) => !LOCAL_STRUCTURED_FINITE_BUCKETS.has(it.bucket));
    if (!osItems.length)
        return out;
    const strategies = osItems.map((it) => strategyFor(it.bucket, it.mode));
    const responses = await timed(async () => {
        const ctx = { queryModelId: await client.queryModelId(), buildFilters };
        return client.msearch(osItems.map((it, i) => strategies[i].buildQuery({ bucket: it.bucket, surface: it.surface, locale: it.locale }, ctx)));
    }, `ingest_resolve_structured items=${osItems.length}`);
    osItems.forEach((it, i) => {
        const os = osFinalize(it.bucket, [{ surface: it.surface, source: 'span', response: responses[i] }], { locale: it.locale }, strategies[i]);
        const terms = finalizeFinite(it.bucket, os, [{ text: it.surface, source: 'structured' }], { locale: it.locale });
        for (const term of terms)
            out.push({ bucket: it.bucket, sourceText: it.surface, term });
    });
    return out;
}
function altOccupationCanonicalKey(term) {
    const prefix = term.termType === 'occupation_group' ? 'occupation:alt_family' : 'occupation:alt';
    return `${prefix}:${term.canonicalKey}`;
}
/** Alt occupation-engine term → CanonicalMatch: bucket `occupation`, an
 *  `alt_occupation`/`alt_occupation_family` signal, and the engine's own confidence. */
function altToMatch(term, sourceText) {
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
function toMatch(term, bucket, sourceText, signal) {
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
function abroadFromLocation(gaz, input, country) {
    if (!country)
        return [];
    const terms = gaz.resolve([], input, undefined);
    if (!terms.length)
        return [];
    const allForeign = terms.every((t) => t.languageCode !== country);
    if (!allForeign)
        return [];
    return [
        {
            canonicalKey: 'workplace:abroad',
            bucket: 'workplace',
            termType: 'canonical',
            matchedAlias: input,
            sourceText: input,
            evidenceSignal: 'location_country_mismatch',
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
async function deriveLocation(input, opts, mode, signal) {
    const gaz = await timed(() => opts.runtime.gazetteer(), 'ingest_derive_location_gazetteer');
    if (!gaz)
        return [];
    const country = opts.countryCode ?? opts.locale;
    const terms = mode === 'structured'
        ? gaz.resolve([], input, country)
        : gaz.resolve(splitClauses(input, 'text'), undefined, country);
    const matches = terms.map((t) => {
        const span = t.evidence?.[0]?.clause ?? t.displayName;
        return {
            canonicalKey: t.canonicalKey,
            bucket: 'location',
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
    if (mode === 'structured')
        matches.push(...abroadFromLocation(gaz, input, country));
    return matches;
}
/**
 * Free-text `title` profile: full title-profile pipeline (clause split, lexical
 * alias-scan, modifier-peeled residual, OS additive query, generic-head
 * suppression, alt-occupation engine, collar_kind derivation). Every bucket the
 * pipeline resolves is kept, tagged with the `title` evidence signal.
 */
async function deriveProfile(input, opts) {
    if (opts.profile !== 'title')
        throw new Error(`unknown profile: "${opts.profile}" (known: title)`);
    const [lexical, gazetteer, collar] = await timed(() => Promise.all([opts.runtime.lexical(), opts.runtime.gazetteer(), opts.runtime.collar()]), 'ingest_derive_profile_deps');
    const result = await timed(() => resolveTitle(input, {
        client: opts.runtime.client,
        lexical,
        gazetteer,
        collar, // occupation→collar_kind graph edge
        locale: opts.locale,
        countryCode: opts.countryCode, // gazetteer country gate (resolveTitle falls back to locale)
        ...(opts.jobFunction && { jobFunction: opts.jobFunction }),
    }), 'ingest_derive_profile_resolve_title');
    const matches = [];
    for (const [bucket, terms] of Object.entries(result.byBucket)) {
        for (const t of terms) {
            matches.push(toMatch(t, bucket, input, 'title'));
        }
    }
    // Alt occupation engine (opt-in): surfaced as occupation matches tagged with an
    // alt signal, carrying the engine's own confidence — beside, not overriding, the
    // profile's own occupation.
    for (const t of result.altOccupation ?? [])
        matches.push(altToMatch(t, input));
    return matches;
}
/**
 * Structured `occupation` field: NOT a separate resolution — it's the same
 * `deriveProfile` title-profile run, narrowed to the `occupation` bucket (a
 * structured occupation field, e.g. "Senior React Developer", is title-shaped,
 * so it deserves the same candidate quality a free-text title gets). Only the
 * `occupation` bucket survives (a structured occupation field must not also
 * surface level/workplace/etc.); the plain occupation match's evidence signal
 * is remapped from `title` to `structured` — the alt-occupation engine's own
 * signal (`alt_occupation`/`alt_occupation_family`) passes through unchanged.
 */
async function deriveOccupation(input, opts) {
    const matches = await deriveProfile(input, { ...opts, profile: 'title' });
    return matches
        .filter((m) => m.bucket === 'occupation')
        .map((m) => (m.evidenceSignal === 'title' ? { ...m, evidenceSignal: 'structured' } : m));
}
/** Resolve one structured field, or run a custom `profile` (e.g. `title`) over free text. */
export async function derive(input, opts) {
    if (!input.trim()) {
        await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output: [] });
        return [];
    }
    const output = await timed(async () => {
        if (opts.profile)
            return deriveProfile(input, opts);
        if (!opts.bucket)
            throw new Error('derive requires a bucket or a profile');
        // Location is gazetteer-owned (structured place field), not an OS lexical bucket.
        if (opts.bucket === 'location')
            return deriveLocation(input, opts, 'structured', 'structured');
        if (opts.bucket === 'occupation')
            return deriveOccupation(input, opts);
        const results = await resolveStructured([{ bucket: opts.bucket, surface: input, mode: opts.mode, locale: opts.locale }], opts.runtime.client);
        return results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured'));
    }, `ingest_derive bucket=${opts.bucket ?? ''} profile=${opts.profile ?? ''}`);
    await logIngestCall('derive', { input, options: summarizeIngestOptions(opts), output });
    return output;
}
/** Resolve a batch of structured fields in a single `_msearch` (profile requests delegate to `derive`). */
export async function deriveMany(requests, opts) {
    const structured = requests.filter((r) => !r.profile && r.input.trim());
    const profiled = requests.filter((r) => r.profile && r.input.trim());
    // Location is gazetteer-owned, and occupation goes through the title-profile
    // pipeline (see deriveOccupation) — both resolved separately, not via the OS _msearch.
    const locationReqs = structured.filter((r) => r.bucket === 'location');
    const occupationReqs = structured.filter((r) => r.bucket === 'occupation');
    const osItems = structured.filter((r) => r.bucket !== 'location' && r.bucket !== 'occupation');
    const matches = await timed(async () => {
        const items = osItems.map((r) => {
            if (!r.bucket)
                throw new Error('a structured deriveMany request requires a bucket');
            return { bucket: r.bucket, surface: r.input, mode: r.mode, locale: r.locale ?? opts.locale };
        });
        const results = await resolveStructured(items, opts.runtime.client);
        const out = results.map((r) => toMatch(r.term, r.bucket, r.sourceText, 'structured'));
        for (const r of locationReqs) {
            out.push(...(await deriveLocation(r.input, { runtime: opts.runtime, locale: r.locale ?? opts.locale, countryCode: r.countryCode ?? opts.countryCode }, 'structured', 'structured')));
        }
        for (const r of occupationReqs) {
            out.push(...(await deriveOccupation(r.input, {
                runtime: opts.runtime,
                locale: r.locale ?? opts.locale,
                countryCode: r.countryCode ?? opts.countryCode,
            })));
        }
        for (const r of profiled) {
            out.push(...(await deriveProfile(r.input, {
                runtime: opts.runtime,
                locale: r.locale ?? opts.locale,
                countryCode: r.countryCode ?? opts.countryCode,
                ...(r.jobFunction && { jobFunction: r.jobFunction }),
                profile: r.profile,
            })));
        }
        return out;
    }, `ingest_derive_many requests=${requests.length} os=${osItems.length} location=${locationReqs.length} occupation=${occupationReqs.length} profiled=${profiled.length}`);
    await logIngestCall('deriveMany', { requests, options: summarizeIngestOptions(opts), output: matches });
    return matches;
}
function toSalaryMatch(r) {
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
export async function analyzeJobListing(text, opts) {
    if (!text.trim()) {
        const output = { matches: [], salaryRanges: [] };
        await logIngestCall('analyzeJobListing', { input: text, options: summarizeIngestOptions(opts), output });
        return output;
    }
    const bucketsToProbe = (opts.buckets ?? ALL_BUCKETS).filter((b) => b !== 'location' && b !== 'occupation');
    const clauses = splitClauses(text, 'text');
    // Bucket-matching only: contact/legal boilerplate never matches a canonical term,
    // so dropping it here shrinks the OS cross product. `deriveLocation`/`extractSalary`
    // below still run over the raw, unfiltered `text` — this filter never reaches them.
    const signalClauses = clauses.filter((c) => classifyClause(c.text).keep);
    const items = signalClauses.flatMap((clause) => bucketsToProbe.map((bucket) => ({
        bucket,
        surface: clause.text,
        locale: opts.locale,
    })));
    const matches = await timed(async () => {
        const results = await resolveStructured(items, opts.runtime.client);
        const best = new Map();
        results.forEach((r) => {
            const slot = `${r.bucket}:${r.term.key}`;
            const prev = best.get(slot);
            if (!prev || (r.term.status === 'resolved' && prev.term.status !== 'resolved'))
                best.set(slot, r);
        });
        const out = [...best.values()].map((r) => toMatch(r.term, r.bucket, r.sourceText, 'description'));
        out.push(...(await deriveLocation(text, opts, 'unstructured', 'description'))); // gazetteer over the body
        return out;
    }, `ingest_analyze_job_listing clauses=${clauses.length} kept=${signalClauses.length} items=${items.length}`);
    const output = { matches, salaryRanges: extractSalary(text).map(toSalaryMatch) };
    await logIngestCall('analyzeJobListing', { input: text, options: summarizeIngestOptions(opts), output });
    return output;
}
/** Group matches into per-bucket canonical-key lists, deduped, highest confidence winning. */
export function explicitBuckets(matches) {
    const buckets = Object.fromEntries(ALL_BUCKETS.map((b) => [b, []]));
    const byBucket = new Map();
    for (const match of matches) {
        const list = byBucket.get(match.bucket) ?? [];
        list.push(match);
        byBucket.set(match.bucket, list);
    }
    for (const [bucket, bucketMatches] of byBucket) {
        const deduped = new Map();
        for (const match of bucketMatches) {
            const key = `${match.canonicalKey}:${match.propositionIndex}`;
            const current = deduped.get(key);
            if (!current || match.confidence > current.confidence)
                deduped.set(key, match);
        }
        buckets[bucket] = [...new Set([...deduped.values()].map((m) => m.canonicalKey))];
    }
    return buckets;
}
