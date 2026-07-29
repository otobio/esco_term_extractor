# Occupation Search Engine

Minimal TypeScript CLI setup for the occupation search engine schema and early ESCO source exploration.

## Requirements

- Node.js 20+
- MySQL reachable with a database you can connect to

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your local env file:
   ```bash
   cp .env.example .env
   ```
3. Update `.env` with your MySQL connection settings.
4. Set `ESCO_DOWNLOADS_DIR` to the directory that contains the ESCO locale packs.

## Commands

Apply the schema from `sql/schema.sql`:

```bash
npm run db:apply-schema
```

Check database connectivity and count `ose_*` tables:

```bash
npm run db:check
```

Import ESCO source data into the `ose_source_*` tables:

```bash
npm run import:esco
```

Import only English, using the local env defaults for version and downloads path:

```bash
npm run import:esco:en
```

Audit the imported ESCO source layer with the default source name (`esco_1_2_1`) and all locales present for that source:

```bash
npm run audit:esco-source
```

Audit only selected locales or a different source name:

```bash
npm run audit:esco-source -- --source-name=esco_1_2_1 --locales=en,ro --sample-limit=10 --collection-limit=15
```

Emit the same audit as JSON for downstream scripting:

```bash
npm run audit:esco-source:json -- --locales=en
```

Override importer settings at runtime:

```bash
npm run import:esco -- --downloads-dir=/data/esco/downloads --locales=en,ro --version=1.2.1
```

Build the first occupation graph layer from the imported ESCO source data:

```bash
npm run graph:occupations
```

Build only selected locales or a specific imported source name:

```bash
npm run graph:occupations -- --source-name=esco_1_2_1 --locales=en,ro
```

Build the capability graph layer from imported ESCO occupation-to-skill relations and existing occupation graph nodes:

```bash
npm run graph:capabilities
```

Build only selected locales or a specific imported source name:

```bash
npm run graph:capabilities -- --source-name=esco_1_2_1 --locales=en,ro
```

Build the first occupation search meta layer from the occupation and capability graphs:

```bash
npm run search-meta:occupations
```

Rebuild only selected locales for locale alias bundles while still preserving English backbone aliases:

```bash
npm run search-meta:occupations -- --locales=ro
```

Skip the scoped reset if you want to append for debugging only:

```bash
npm run search-meta:occupations -- --skip-reset
```

Audit the generated occupation search meta quality:

```bash
npm run audit:search-meta
```

Emit the same search meta audit as JSON for downstream scripting:

```bash
npm run audit:search-meta:json
```

Audit a selected locale scope or adjust sample output:

```bash
npm run audit:search-meta -- --locales=en,ro --sample-limit=20 --weak-english-backbone-threshold=0.5
```

Insert conservative pending manual-review rows for obvious search meta issues:

```bash
npm run audit:search-meta -- --insert-review-queue
```

Build the runtime artifacts used by deploy/runtime resolution:

```bash
npm run runtime:artifacts-build
npm run runtime:check
npm run test:structural
```

This exports the binary search-meta graph/details artifact, binary retrieval
index, binary family-profile tables, binary alias-ngram artifacts, signal
vocabulary, intent vocabulary, and role-head equivalences. The binary-cache backend can then
resolve occupations without MySQL, OpenSearch, model inference, or network
access at query time.

When the source DB itself needs to be rebuilt before exporting artifacts, use:

```bash
npm run runtime:artifacts-rebuild-db
```

That command rebuilds capability graph links, rebuilds occupation search-meta,
then exports the full runtime artifact set from the same DB snapshot. Do not run
only one runtime exporter from a DB snapshot whose graph IDs differ from the
current runtime artifacts; rebuild the full set together so IDs remain coherent.

For complete local reproducibility, restore the tracked SQL dump first, then run
the DB-backed rebuild path above. Put DB snapshots under `sql/snapshots/`. If a
dump archive would exceed GitHub's per-file limit, split it into numbered chunks
under 50 MB and reconstruct the archive by concatenating the chunks in lexical
order before restore. The SQL snapshot should represent source and review state;
the deployable Lambda/runtime payload is still the generated
`artifacts/runtime/occupation-*` files plus `dist`.

Reviewed taxonomy corrections are tracked as source inputs under
`data/taxonomy-review/*-overrides.csv` and mirrored in
`src/runtime/occupation-taxonomy-family-overrides.ts`. After changing either the
SQL snapshot or these override inputs, rebuild all runtime artifacts together and
run `npm run runtime:check`.

Runtime entrypoints should boot once through `OccupationRuntimeContext.load(...)`
and create pipelines with `OccupationSearchPipeline.withRuntime(runtime)`. This
keeps artifact validation and retrieval-engine setup in one startup place while
leaving search-meta aliases and capability labels decoded only for requested
records.

Create or update the OpenSearch occupation index/template on `http://localhost:9201`:

```bash
npm run opensearch:create:occupations
```

Bulk populate the disposable OpenSearch occupation index from canonical MySQL search meta:

```bash
npm run opensearch:populate:occupations
```

Recreate the OpenSearch index before repopulating it:

```bash
npm run opensearch:populate:occupations -- --recreate-index
```

Seed the Phase 8 repeatable evaluation corpus into `ose_evaluation_queries` and `ose_evaluation_expectations`:

```bash
npm run evaluation:seed
```

Seed a selected source/set key, or conservatively reset only rows owned by that set marker before reseeding:

```bash
npm run evaluation:seed -- --source-name=esco_1_2_1 --set-key=phase8-core-v1 --reset-set
```

The seed corpus covers exact English titles, Romanian/local aliases, noisy recruiter phrasing, ambiguous generic queries, and family/group fallback cases. Expected nodes are resolved from source-scoped graph aliases/canonical labels and `ose_search_meta` hierarchy pointers, not hard-coded graph node IDs. Because the current schema has no `set_key` column, owned query rows store a JSON notes marker (`phase8_set_key`) and reset deletes only that owned set plus exact matching seeded expectations.

Retrieve occupation candidate evidence from exact alias, folded alias,
alias-ngram, lexical, and capability channels:

```bash
npm run retrieval:candidates -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10 --format=text
```

Retrieve with the portable offline binary backend:

```bash
npm run retrieval:candidates -- --query="senior data analyst SQL dashboards" --locale=en --source-name=esco_1_2_1 --retrieval-backend=binary-cache --limit=10 --format=text
```

Emit the same candidate evidence as JSON:

```bash
npm run retrieval:candidates -- --query="software developer" --locale=en --format=json
```

Run retrieval against a seeded evaluation query, loading `query_text` and `locale_code` from `ose_evaluation_queries`:

```bash
npm run retrieval:candidates -- --evaluation-query-id=1 --source-name=esco_1_2_1 --limit=10
```

This is retrieval candidate generation only. It collates per-node evidence and channel scores for inspection, but it does not resolve a winner, expand hierarchy branches, persist search runs, or create manual-review workflow rows.

Expand retrieved candidates into hierarchy branches for Phase 10 inspection:

```bash
npm run retrieval:branches -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10 --sibling-limit=5 --format=text
```

Emit the same branch expansion as JSON:

```bash
npm run retrieval:branches -- --query="software developer" --locale=en --format=json
```

Run branch expansion against a seeded evaluation query:

```bash
npm run retrieval:branches -- --evaluation-query-id=1 --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

This Phase 10 command merges retrieved candidates by canonical graph node through the Phase 9 retriever, attaches search meta, ancestors, sibling samples, and groups candidates by family/group/node branch for inspection. It does not name a winner, return a resolved occupation, persist search runs, or create manual-review workflow rows.

Resolve a query with the first Phase 11 conservative heuristic resolver:

```bash
npm run resolution:query -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10 --sibling-limit=5 --format=text
```

Emit the same resolution decision and scoring facts as JSON:

```bash
npm run resolution:query -- --query="software developer" --locale=en --format=json
```

Run resolution against a seeded evaluation query:

```bash
npm run resolution:query -- --evaluation-query-id=1 --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

This Phase 11 command reuses Phase 10 branch expansion, scores candidate leaves and family/group branches with transparent conservative heuristics, and returns the safest decision type: `leaf`, `family`, `group`, or `unresolved`. Exact local alias evidence dominates, folded aliases can resolve when branch consistency is clear, and alias-ngram evidence improves deterministic recall. This is not persisted experiment tracking and it does not create manual-review workflow rows.

The resolver also emits a ranked answer view for product testing: top occupation leaves plus the best broader family/group branch. This ranked view is evidence-only; it does not change the conservative selected outcome.

Persist a fresh Phase 12 evaluation search run into `ose_search_runs` and `ose_search_run_results`:

```bash
npm run evaluation:run -- --run-label=phase12-core-semantic --source-name=esco_1_2_1 --set-key=phase8-core-v1 --limit=10 --sibling-limit=5
```

Limit the persisted run to part of the Phase 8 set or inspect without writing rows:

```bash
npm run evaluation:run -- --max-queries=5 --notes="phase12 smoke check" --dry-run
```

This Phase 12 command filters `ose_evaluation_queries` by the Phase 8 JSON notes marker, runs the existing conservative Phase 11 resolver for each matching query, creates one new `ose_search_runs` row per invocation, and persists selected/candidate graph-node outcomes into `ose_search_run_results`. It is experiment persistence only: it does not change retrieval, branch expansion, resolver scoring behavior, or write manual-review workflow rows.

Build the Phase 13 manual review queue from persisted search-run failures plus conservative search-meta gaps:

```bash
npm run review:build -- --search-run-id=2 --source-name=esco_1_2_1 --set-key=phase8-core-v1 --limit=25
```

Inspect the queue in text or JSON form:

```bash
npm run review:inspect -- --status=pending --review-type=relatedness_gap --limit=25
npm run review:inspect -- --status=pending --format=json
```

Use `--dry-run` to preview inserts without writing rows, and `--include-existing` to show already-pending duplicates instead of hiding them:

```bash
npm run review:build -- --search-run-id=2 --dry-run --include-existing --limit=20
```

This Phase 13 command reads persisted Phase 12 evaluation runs and `ose_search_meta`, enqueues `relatedness_gap` rows for unresolved/mismatched evaluation queries, adds conservative `generic_head`, `hierarchy_gap`, and `cross_locale_gap` items where useful, deduplicates pending rows, leaves reviewed rows untouched, and safely allows query-level items with `graph_node_id=NULL`.

Report bounded Phase 14 readiness evidence from one run or compare a candidate run against a baseline:

```bash
npm run evaluation:compare -- --baseline-run-id=2 --candidate-run-id=3 --source-name=esco_1_2_1 --set-key=phase8-core-v1
```

Emit machine-readable JSON or inspect a single run when no candidate/baseline pair is available yet:

```bash
npm run evaluation:compare -- --candidate-run-id=3 --format=json
npm run evaluation:compare -- --baseline-run-id=2
```

When a run contains Phase 17D ranked evidence, readiness output also reports `top3_leaf_hit_count`, `best_broader_branch_hit_count`, and `ranked_evidence_queries`. These metrics are informational and do not alter the conservative Search Machinery readiness gate.

This Phase 14 command is read-only. It classifies each query conservatively from `selected_*` rows against seeded expectation levels, reports exact/acceptable/family-group hits, unresolved and miss counts, candidate-stage and pending-review counts, and only answers the Search Machinery DoD when a comparable baseline-vs-candidate pair is provided.

Inspect ranked-evidence gaps for a persisted run:

```bash
npm run evaluation:gap -- --search-run-id=17 --set-key=phase15-expanded-v1 --limit=50
```

This diagnostic is read-only. It shows where the expected leaf is already in `ranked_results.top_leaves`, separates clean promotion candidates from risky/no-top-3 gaps, and helps target calibration without changing resolver behavior.

Phase 14 also adds a conservative subphrase lexical rescue inside folded-alias retrieval. It only promotes phrase-containment matches after text folding, keeps generic one-token aliases suppressed, and leaves the resolver's safety gates unchanged.

Current query preparation preserves acronym tokens in normalized/folded forms and expands a controlled English acronym list during retrieval. For example, `HVAC technician` keeps `HVAC` while adding `heating ventilation air conditioning` as query signal. See `docs/SEARCH_DECISION_TREE.md` and `docs/POST_PHASE14_REFINEMENT_CHECKLIST.md` for the full rule and rebuild requirements.

The DB check command fails loudly with connection guidance if MySQL is unreachable or env values are missing.

## Notes

- [Getting started](docs/GETTING_STARTED.md) gives the practical command sequence for setup, import, graph/search-meta build, runtime artifact export, manual search, evaluation runs, review queue, and readiness comparison.
- [Search decision tree](docs/SEARCH_DECISION_TREE.md) walks through the runtime search path, resolver gates, persistence flow, manual review flow, and readiness comparison with the table responsible for each decision.
- [Search maturity plan](docs/SEARCH_MATURITY_PLAN.md) records current pipeline strength percentages, the path to an 85% test-run target, and the recommended next phases.
- [OpenSearch indexing](docs/OPENSEARCH_INDEXING.md) documents the Decision 3 OpenSearch template/index creation and bulk population foundation.
- [Post-Phase-14 refinement checklist](docs/POST_PHASE14_REFINEMENT_CHECKLIST.md) records historical refinement notes and backlog items.
- `src/cli/apply-schema.ts` reads the schema from disk and executes it as-is.
- `src/cli/check-db.ts` is intended as a quick baseline validation before importer work begins.
- `src/cli/import-esco-source.ts` imports ESCO raw/source records into `ose_import_runs`, `ose_source_files`, `ose_raw_rows`, `ose_source_concepts`, `ose_source_aliases`, `ose_source_relations`, and `ose_source_memberships`.
- `src/cli/audit-esco-source.ts` audits the imported `ose_source_*` ESCO layer, including locale coverage, alias density, broader occupation integrity, and collection membership distribution.
- `src/cli/build-occupation-graph.ts` materializes the first occupation graph layer into `ose_graph_nodes`, `ose_graph_node_sources`, `ose_graph_aliases`, and `ose_graph_relationships`.
- `src/cli/build-capability-graph.ts` materializes source-linked capabilities into `ose_capabilities` and `ose_graph_capability_links`, preserving `essential` vs `optional` relation types where ESCO provides them.
- `src/cli/build-occupation-search-meta.ts` materializes occupation search profiles into `ose_search_meta`, `ose_search_meta_aliases`, `ose_search_meta_ancestors`, `ose_search_meta_siblings`, and `ose_search_meta_capability_hints`, filtering stub UUID-like capability labels out of search text while keeping hierarchy, alias, sibling, and capability support searchable.
- `src/cli/audit-occupation-search-meta.ts` audits generated occupation search meta for hierarchy gaps, locale coverage gaps, alias sparsity, generic risk distribution, text quality, English backbone strength, and quality-flag distribution. It is read-only by default and only inserts pending `ose_manual_review_queue` rows when `--insert-review-queue` is passed.
- `src/cli/seed-evaluation-set.ts` seeds a small, explicit Phase 8 evaluation set for repeatable retrieval/resolution checks without implementing retrieval, candidate merge, or disambiguation.
- `src/cli/retrieve-occupation-candidates.ts` assembles read-only candidate evidence through the retrieval engine boundary, including exact/folded/subphrase alias evidence, alias-ngram evidence, and lexical/capability evidence.
- `src/cli/export-occupation-retrieval-index-artifact.ts` exports the binary retrieval index used by `--retrieval-backend=binary-cache`.
- `src/cli/export-occupation-alias-ngram-artifact.ts` exports binary alias-ngram artifacts for deterministic alias recall.
- `src/cli/expand-occupation-candidate-branches.ts` assembles read-only hierarchy branch context from retrieved candidates and runtime search-meta artifacts for inspection only.
- `src/cli/resolve-occupation-query.ts` assembles Phase 11 read-only resolution decisions from the Phase 10 branch expander, returning a conservative leaf/family/group/unresolved outcome with scoring facts and no persistence.
- `src/cli/run-evaluation-search.ts` assembles Phase 12 experiment persistence by replaying the existing Phase 11 resolver over Phase 8-marked evaluation queries and storing one new search run plus graph-node result rows, without writing manual-review workflow rows.
- `src/cli/build-manual-review-queue.ts` assembles Phase 13 manual-review candidates from persisted search-run failures and search-meta risk signals, then inserts only non-duplicate pending rows into `ose_manual_review_queue`.
- `src/cli/inspect-manual-review-queue.ts` reads `ose_manual_review_queue` with simple status/type filters for queue browsing in text or JSON form.
- `src/cli/report-search-readiness.ts` assembles Phase 14 read-only readiness summaries and baseline-vs-candidate comparisons from persisted search runs, seeded evaluation expectations, and pending review counts.
- The importer preserves locale-specific concept rows, broader occupation relations, and occupation-to-skill links before any later graph materialization work.
- The audit defaults to `source_name=esco_1_2_1`, prints concise review tables by default, and supports `--format=json` for machine-friendly output.
- The graph build is rerunnable: it clears and rebuilds the `bucket='occupation'` graph slice inside a transaction, preserving locale-scoped aliases and flagging generic single-token alias collisions for review instead of deleting them.
- The capability graph build is rerunnable per source: it clears and rebuilds the matching capability slice by `canonical_key` prefix inside a transaction, choosing one practical display record per canonical ESCO capability URI while keeping separate `essential` and `optional` occupation links.
- The occupation search meta build is rerunnable per source: it clears the matching search meta rows inside a transaction, rebuilds locale alias bundles plus an English backbone bundle, persists ancestor and sibling helper rows, and filters stub capability labels out of `search_text`.
- The search meta audit is rerunnable: by default it only reports quality metrics and samples. With `--insert-review-queue`, it inserts non-duplicate pending review rows for hierarchy gaps, cross-locale gaps, and high generic-risk occupations.
- The evaluation seed is rerunnable: it explicitly looks up existing matching query rows before insert, inserts missing expectations only once, and uses the notes marker to scope conservative set resets.
- The retrieval candidate CLI is read-only and rerunnable. Its `total_score` is an inspection ranking over preserved evidence channels, not a final occupation resolution decision.
- The retrieval branch CLI is read-only and rerunnable. Its branch summaries are inspection context for hierarchy consistency, not final disambiguation, search run persistence, or manual review workflow output.
- The occupation resolution CLI is read-only and rerunnable. Its confidence is a first-pass heuristic safety score, not persisted experiment tracking; Phase 12 will own search run persistence and Phase 13 will own manual-review workflow writes.
- The evaluation search run CLI is rerunnable and always creates a new run when not using `--dry-run`. It persists Phase 12 experiment tracking only; unresolved queries are counted in the summary/notes but do not get fake `ose_search_run_results` rows, and no manual-review workflow writes are performed.
- The manual review build CLI is rerunnable. By default it resolves the latest matching Phase 12 run for the selected `source_name` and `set_key`, inserts only new pending queue rows, and never overwrites reviewed queue decisions.
- The search readiness CLI is rerunnable and read-only. It never changes search runs or queue state, and it keeps readiness accounting conservative by only counting `selected_leaf` exact hits against `exact_leaf` expectations and by requiring a comparable baseline/candidate pair before answering the Search Machinery DoD.
