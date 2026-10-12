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
```

This exports the binary search-meta graph/details artifact, binary retrieval
index, binary family-profile tables, binary family-token relevance tables,
binary alias-ngram artifacts, signal vocabulary, intent vocabulary, and role-head equivalences. The binary-cache backend can then
resolve occupations without MySQL, OpenSearch, model inference, or network
access at query time.

Recent binary compactions:
- `esco-related-terms` was standardized to manifest-relative output and moved to a pooled binary layout:
  hot term strings stay in one compact string table, cold example strings live in a separate file-backed table, and normalized example-form duplicates are deduplicated through pooled example lists.
- `occupation-retrieval-index` was compacted from duplicated token-phrase strings to pooled token-id lists.
  The runtime now evaluates phrase and all-term matches directly on pooled token spans instead of storing repeated `" token token "` strings per alias and per text field.
  On the current `esco_1_2_1` artifact set this reduced the retrieval-index payload from about `50.2 MB` to `33.7 MB` (`-32.8%`).
- `binary-table` now supports file-backed string-table reads as well as file-backed uint32 rows, so colder binary payloads can stay off the hot in-memory path when the runtime only needs bounded lookups.

Operational note:
- `npm run skills:esco:related-terms:inspect` needs npm's argument separator before tool arguments, for example:
  `npm run skills:esco:related-terms:inspect -- --verb=monitor`

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

Runtime entrypoints should boot once through `OccupationRuntimeContext.load(...)`.
This keeps artifact validation and retrieval-engine setup in one startup place
while leaving search-meta aliases and capability labels decoded only for
requested records.

## Classifiers

- **v2** (`src/occupation-classifier`, default): resolves a title against the runtime artifacts (query preparation, retrieval, specialization extraction, family and leaf decisions).
- **v3** (`src/occupation-esco-api-classifier`): resolves a title through the ESCO REST API.

```bash
npm run classification:occupation -- --query="Airline Compliance Auditors" --locale=en --debug --no-color
npm run classification:occupation:esco-api -- --query="software developer" --locale=en
npm run test:classifier
npm run test:esco-api-classifier
```

`getCanonicalTerm` (`src/api/canonical-term.ts`) takes `mode: 'v2' | 'v3'` and defaults to `v2`.
The retired v1 pipeline is kept locally under the git-ignored `archive/` folder.

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

The DB check command fails loudly with connection guidance if MySQL is unreachable or env values are missing.

## Notes

- [Job title enrichment workflow](docs/JOB_TITLE_ENRICHMENT_WORKFLOW.md) documents the resumable locale chunk cycle for replay, direct LLM review, proposal aggregation, seed shaping, promotion, and validation.
- [OpenSearch indexing](docs/OPENSEARCH_INDEXING.md) documents the Decision 3 OpenSearch template/index creation and bulk population foundation.
- `src/cli/apply-schema.ts` reads the schema from disk and executes it as-is.
- `src/cli/check-db.ts` is intended as a quick baseline validation before importer work begins.
- `src/cli/import-esco-source.ts` imports ESCO raw/source records into `ose_import_runs`, `ose_source_files`, `ose_raw_rows`, `ose_source_concepts`, `ose_source_aliases`, `ose_source_relations`, and `ose_source_memberships`.
- `src/cli/audit-esco-source.ts` audits the imported `ose_source_*` ESCO layer, including locale coverage, alias density, broader occupation integrity, and collection membership distribution.
- `src/cli/build-occupation-graph.ts` materializes the first occupation graph layer into `ose_graph_nodes`, `ose_graph_node_sources`, `ose_graph_aliases`, and `ose_graph_relationships`.
- `src/cli/build-capability-graph.ts` materializes source-linked capabilities into `ose_capabilities` and `ose_graph_capability_links`, preserving `essential` vs `optional` relation types where ESCO provides them.
- `src/cli/build-occupation-search-meta.ts` materializes occupation search profiles into `ose_search_meta`, `ose_search_meta_aliases`, `ose_search_meta_ancestors`, `ose_search_meta_siblings`, and `ose_search_meta_capability_hints`, filtering stub UUID-like capability labels out of search text while keeping hierarchy, alias, sibling, and capability support searchable.
- `src/cli/audit-occupation-search-meta.ts` audits generated occupation search meta for hierarchy gaps, locale coverage gaps, alias sparsity, generic risk distribution, text quality, English backbone strength, and quality-flag distribution. It is read-only by default and only inserts pending `ose_manual_review_queue` rows when `--insert-review-queue` is passed.
- `src/cli/export-occupation-retrieval-index-artifact.ts` exports the binary retrieval index used by `--retrieval-backend=binary-cache`.
- `src/cli/export-occupation-alias-ngram-artifact.ts` exports binary alias-ngram artifacts for deterministic alias recall.
- The importer preserves locale-specific concept rows, broader occupation relations, and occupation-to-skill links before any later graph materialization work.
- The audit defaults to `source_name=esco_1_2_1`, prints concise review tables by default, and supports `--format=json` for machine-friendly output.
- The graph build is rerunnable: it clears and rebuilds the `bucket='occupation'` graph slice inside a transaction, preserving locale-scoped aliases and flagging generic single-token alias collisions for review instead of deleting them.
- The capability graph build is rerunnable per source: it clears and rebuilds the matching capability slice by `canonical_key` prefix inside a transaction, choosing one practical display record per canonical ESCO capability URI while keeping separate `essential` and `optional` occupation links.
- The occupation search meta build is rerunnable per source: it clears the matching search meta rows inside a transaction, rebuilds locale alias bundles plus an English backbone bundle, persists ancestor and sibling helper rows, and filters stub capability labels out of `search_text`.
- The search meta audit is rerunnable: by default it only reports quality metrics and samples. With `--insert-review-queue`, it inserts non-duplicate pending review rows for hierarchy gaps, cross-locale gaps, and high generic-risk occupations.
