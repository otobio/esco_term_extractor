# Implementation Detail

This document records current runtime details that are easy to lose when changing retrieval, ranking, artifacts, or query preparation.

## Query Intent And Family Selection

Free-text job titles are prepared in two layers:

1. `cleanOccupationTitleSignals` removes weak fragments using the generated signal vocabulary.
2. Async `prepareQuery` normalizes, folds, tokenizes, expands variants/acronyms, and classifies intent using the generated occupation intent-vocabulary artifact.

The intent classifier separates:

- `roleTokens`: occupation work signal, for example `compliance auditors`.
- `roleHeadTokens`: role anchors, usually the final occupation noun in English, for example `auditors`.
- `domainTokens`: context modifiers, for example `airline`, `hospital`, `school`, or `vocational`.
- seniority, credential, ambiguous, and unresolved modifier tokens for diagnostics.

Runtime resolution must load the generated intent-vocabulary artifact. The small built-in vocabulary in `src/query/query-intent.ts` is only a curated supplement for high-value anchors/modifiers and explicit test fixtures. It is not a production fallback for missing runtime artifacts.

Runtime boot is centralized through `OccupationRuntimeContext`:

```ts
const runtime = await OccupationRuntimeContext.load({
  sourceName: 'esco_1_2_1',
  retrievalBackend: 'binary-cache'
});

const pipeline = OccupationSearchPipeline.withRuntime(runtime);
```

The context validates and warms the deterministic runtime handles once:

- search-meta core/details handle
- binary retrieval index when `retrievalBackend='binary-cache'`
- signal vocabulary
- intent vocabulary
- role-head equivalences
- retrieval engine instance

This is a boot/readiness layer, not an eager full hydration layer. Search-meta
details remain lazy by byte range, family-profile scoring opens compact binary
tables on first use, and alias-ngram retrieval loads only the requested locale's
binary artifact on demand.
New CLIs and API entrypoints should construct a runtime context once and then
create pipelines with `OccupationSearchPipeline.withRuntime(runtime)` instead of
letting each stage discover artifacts independently.

## Multi-Occupation Spans

Signal cleaning can produce multiple kept spans from one submitted title when the title uses clause separators such as `/`, `|`, newlines, or explicit connectors. These spans represent separate occupation contexts, not related evidence for one role.

Runtime behavior:

- `OccupationCandidateRetriever` exposes the kept `querySpans` from signal cleaning.
- `OccupationSearchPipeline` detects more than one kept span before final ranking.
- Each span is sent through the normal pipeline independently, as if the caller had made separate title-resolution calls.
- The top-level result uses `decisionType=multi_span`, leaves top-level family/leaf rankings empty, and exposes concrete outcomes in `spanResults`.
- Multi-span coverage reports only the aggregate span count; leaf/family details stay on the span-level coverage and rankings.
- `getCanonicalTerm` exposes the same structure as `occupationContexts`; top-level canonical term arrays are only a convenience aggregate with one representative term per span first.

This prevents evidence pooling across unrelated roles. For example, `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD` should produce independent span results for `LUCRATOR COMERCIAL` and `AJUTOR BUCATAR FAST FOOD`. The kitchen-helper/fast-food evidence must not be combined with commercial-worker evidence to select one blended family or leaf.

Bracketed recruiter markers such as `(m/f)` are stripped before clause splitting. They must not produce a second occupation context.

## Intent Vocabulary Artifact

The generated artifact is exported by:

```bash
npm run query:intent:export-vocab
```

It is included in the full runtime artifact build:

```bash
npm run runtime:artifacts-build
```

Default files:

- `artifacts/runtime/occupation-intent-vocabulary.esco_1_2_1.binary.manifest.json`
- binary sidecars for `strings`, `localeRows`, `termIds`, and `phraseIds`
- optional human-review mirror at `data/runtime-review/occupation-intent-vocabulary.esco_1_2_1.jsonl`

The JSONL mirror is generated for inspection only. Runtime does not read it, and
it intentionally lives outside `artifacts/runtime` so the production contract
stays binary-only.

The builder derives locale profiles from runtime search-meta records:

- canonical labels and aliases contribute candidate role heads and role modifiers
- family/group labels contribute domain/context evidence
- capability labels contribute background vocabulary, but query intent is never derived from selected result capabilities
- known domain and credential terms are preserved as explicit buckets

The generated records cover the locales present in search-meta, including English, Romanian, Hungarian, Estonian, and an `unknown` profile. The built-in English/Romanian list remains intentionally small because the generated artifact is the scalable source of truth.

## Async `prepareQuery`

`prepareQuery` and `prepareFamilyScopedQuery` are async because the complete query form now includes generated intent classification. Callers should pass an already loaded `intentVocabulary` when they are preparing multiple query views in one request.

The pipeline does this once per attempt:

- load `loadOccupationIntentVocabularyArtifactRequired(sourceName)`
- prepare the full query
- prepare a role-only query for family-profile scoring and family-constrained recovery
- derive family-scoped views from the already prepared full and role queries

This avoids a partial implementation where one stage uses generated intent and another silently uses fallback behavior.

## Runtime Performance

The intent vocabulary now loads as a compact binary artifact: a shared UTF-8
string table, fixed-width locale rows, and flat `Uint32` postings for each term
and phrase bucket. Runtime validates the manifest and binary table widths once,
then lazily decodes only the requested locale profiles (`locale`, `en`,
`unknown`) through the query-intent lookup cache instead of parsing a JSONL file
into nested string arrays on startup. Query-time classification still uses a
`WeakMap` cache keyed by artifact object and locale, so the role/domain `Set`
lookups are built once per loaded artifact rather than per query.

Search-meta uses a hot-core plus lazy-details binary runtime shape:

- manifest JSON for source/count and sidecar paths
- binary core rows for graph ids, family/group/parent links, generic risk, hierarchy support, and ancestor/sibling ranges
- binary detail rows pointing into alias and capability row tables
- a shared UTF-8 string table for labels and text fields

Branch expansion and family mapping read only core rows, because those stages need graph structure and family grouping, not every alias/capability string. Stages that genuinely need text details hydrate selected records from binary detail ranges:

- cross-locale English-backbone support hydrates only the directly selected record
- family-constrained leaf recovery hydrates only recovered leaves inside selected families
- canonical-term capability output hydrates only the selected canonical leaf
- artifact builders that derive generated dictionaries use `loadOccupationSearchMetaArtifactWithDetailsRequired(sourceName)` because they need the complete alias/capability text corpus

Do not put aliases or capability labels back into the always-loaded core rows. That recreates the large parse/allocation cost on every runtime artifact load and makes branch expansion pay for data it usually does not inspect.

The binary retrieval index is the portable non-OpenSearch retrieval artifact. It
is exported by:

```bash
npm run retrieval:index:export
```

and included in:

```bash
npm run runtime:artifacts-build
```

Search-meta runtime data is exported as binary tables, not JSONL records. The
manifest points to:

- a global UTF-8 string table
- core rows sorted by `graphNodeId`
- ancestor and sibling rows
- family leaf posting ranges
- detail rows sorted by `graphNodeId`
- alias rows
- capability rows

Runtime code loads the table buffers and exposes accessor methods such as
`getCoreRecord`, `getDetails`, `getLeafCoreRecordsForFamilies`, `getAliases`,
and `getCapabilityLabels`. Query-time paths should decode aliases and capability
labels only for selected candidates or recovered family leaves. Build-time
exporters that truly need all records should call the explicit
`getAllRecordsWithDetails()` helper.

When rebuilding from DB, use:

```bash
npm run runtime:artifacts-rebuild-db
```

This runs capability graph build before occupation search-meta build, then
exports all runtime artifacts from the same graph ID snapshot.

The retrieval index artifact is immutable and built from runtime search-meta
accessors. Runtime does not hydrate all aliases/capability labels or construct
large lookup maps per process. The binary-cache backend loads:

- sorted UTF-8 string table
- fixed-width alias evidence rows
- fixed-width text/canonical/family records
- exact alias lookup index and row postings
- folded alias lookup index and row postings
- canonical-label lookup index and row postings
- lexical field postings
- alias token postings for safe subphrase retrieval

Query-time work should remain bounded: binary-search string ids, binary-search
lookup indexes, scan sorted postings ranges, and read fixed-width row metadata.
Do not add direct OpenSearch calls inside pipeline stages; retrieval replacement
must stay behind `OccupationRetrievalEngine`.

Alias ngram retrieval uses generated runtime artifacts instead of hydrating
search-meta details during query startup. The exporter:

```bash
npm run retrieval:aliases:ngram:export -- --locales=en,ro,hu,et --include-family-supporting
```

produces:

- `artifacts/runtime/occupation-alias-ngrams.esco_1_2_1.en.family.binary.manifest.json`
- binary sidecars for strings, fixed rows, feature values, feature postings, and feature posting rows

The binary records store already weighted sparse features, alias metadata, useful
tokens, and family-supporting alias rows collapsed to the family node when
requested. Runtime requires the binary alias-ngram artifact, validates the
manifest and fixed table widths, and scans each candidate row's compact feature
slice against the small query feature-id map. Query-time retrieval must not
hydrate all search-meta details, rebuild feature postings from JSON, or recompute
alias IDF.

Alias-ngram retrieval and family-supporting aliases are enabled by default. Use
`OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL=1` to turn off the channel and
`OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1` only when intentionally testing
leaf-only artifacts.

Runtime artifact loaders use bounded LRU caches keyed by resolved manifest path.
They compare the manifest file size and mtime on each load request, so a rebuilt
artifact at the same path is reloaded without requiring a process restart.
Source-scoped artifacts default to two cached entries and can be tuned globally
with `OSE_RUNTIME_ARTIFACT_CACHE_SIZE` or per artifact with
`OSE_RETRIEVAL_INDEX_CACHE_SIZE`, `OSE_FAMILY_PROFILE_CACHE_SIZE`,
`OSE_INTENT_VOCABULARY_CACHE_SIZE`, `OSE_SIGNAL_VOCABULARY_CACHE_SIZE`, and
`OSE_SEARCH_META_ARTIFACT_CACHE_SIZE`. Alias-ngram keeps the stricter default of
one active locale/source artifact and uses `OSE_ALIAS_NGRAM_CACHE_SIZE`.

Role-head equivalence for leaf safety is data-backed, not hardcoded in the pipeline. The runtime artifact is generated from ESCO search-meta leaf canonical labels and occupation aliases, then supplemented by a tracked seed:

- `src/runtime/seeds/occupation-role-head-equivalents.json`

It exports to the runtime binary contract:

- `artifacts/runtime/occupation-role-head-equivalents.binary.manifest.json`

The decoded review mirror lives outside runtime:

- `data/runtime-review/occupation-role-head-equivalents.json`

The artifact has one internal shape, not a versioned compatibility chain. If the structure needs to change, update the current structure, exporter, loader, and runtime checks together. This is an internal artifact contract, so avoid maintaining multiple schema branches unless deployment constraints make it unavoidable.

Classes are organized by concept and `termsByLocale`, so multilingual terms can map to the same occupation head concept. For example, English `worker/labourer`, Romanian `lucrător/muncitor`, Hungarian `munkás/dolgozó`, and Estonian `töötaja/tööline` can support the same role-head comparison without adding pipeline branches. Generated ESCO leaf classes give broad coverage across canonical labels and reviewed/local occupation aliases; the seed should only cover reviewed gaps that the generated source cannot infer cleanly.

The runtime loader validates the artifact once, folds terms, builds locale-scoped hash maps, and caches them. Query-time leaf safety passes the prepared query locale into this lookup and only performs bounded set lookups.

Node does not provide a portable zero-copy memory-mapped JSON parser. A memory-mapped binary/string-table format would only be worth introducing if this artifact grows enough for JSONL parsing or object allocation to show up in debug timings. The current structure keeps heavy extraction in the export step, performs bounded token/set lookups at runtime, and preserves explainable diagnostics.

If the vocabulary grows materially, prefer a generated compact artifact before adding query-time work:

- string table plus locale bucket offsets
- sorted token arrays with binary search or precomputed hash buckets
- explicit manifest validation for schema/source/counts
- optional native or platform-specific mmap only after measurements show it beats Node's cached read/parse path

## Role-First Selection

Family selection now treats role evidence as the authority signal:

- family profiles score role tokens first
- domain terms only add support after role evidence exists
- family-constrained lexical recovery uses the role query first
- leaf closeness and family-scoped fit use role-scoped tokens
- leaves without role/head grounding are not selectable
- result-side capability labels can support an already plausible leaf, but cannot promote an otherwise ungrounded weak retrieval result

After leaf recovery, families are reranked by recovered selection authority:

- role grounding
- exact alias evidence
- role-head coverage
- best recovered leaf role coverage
- best recovered leaf selection tier
- family-profile role coverage
- confidence and branch share

This is structural evidence ordering, not fractional tuning. Weight changes should be rare and should follow only after checking whether a clearer evidence channel, gate, artifact, or authority pass is missing.

## Reference Case

`Airline Compliance Auditors` should prepare as:

- role: `compliance auditors`
- head: `auditors`
- domain: `airline`

The domain can support an aviation-context match only after an auditor/compliance role is grounded. It must not select pilot, aircraft-control, or aviation-operation families by itself. If ESCO lacks a safe exact leaf for the full title, the correct behavior is a grounded broader family or dictionary-gap status with missing role terms exposed.

`LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD` should prepare as multiple occupation spans, not as one role/domain query:

- top-level decision: `multi_span`
- span 1 resolves independently for `LUCRATOR COMERCIAL`
- span 2 resolves independently for `AJUTOR BUCATAR FAST FOOD`

This case is tracked in the developing golden suite as `dev-ro-multi-role-commercial-worker-kitchen-helper`.
The gender-marker cleanup case is tracked as `dev-en-gender-marker-not-multi-span`.
