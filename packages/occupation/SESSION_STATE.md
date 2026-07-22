# Session State

Objective: Implement a non-OpenSearch runtime-cache retrieval backend behind the existing `OccupationRetrievalEngine` contract, without removing the OpenSearch backend. The local backend should be close enough for 1:1 comparison and preserve evidence channels/diagnostics.

Current stage:
- Runtime-cache backend implemented and wired into the main pipeline CLI plus listing-title CSV CLI.
- Golden-suite CLI now supports `--retrieval-backend=opensearch|runtime-cache`.
- Second-pass cleanup completed: removed redundant broad text postings, simplified alias fallback behavior, and consolidated repeated field metadata construction.
- Cold-start investigation completed: core artifact load is cheap, bulk detail hydration is under 1s, and remaining cold cost is runtime construction/tokenization of retrieval indexes over very large alias/capability surfaces.
- Build passes.
- Smoke tests pass structurally.
- Warm retrieval is fast after cold in-process index construction.

Files added:
- `src/retrieval/runtime-cache-retrieval-engine.ts`
- `src/retrieval/retrieval-engine-factory.ts`
- `SESSION_STATE.md`

Files updated in this stage:
- `src/cli/resolve-occupation-pipeline.ts`
- `src/cli/run-listing-title-pipeline-csv.ts`
- `src/cli/run-pipeline-golden-suite.ts`
- `src/search-pipeline/golden-suite.ts`

Runtime-cache backend behavior:
- Uses `loadOccupationSearchMetaArtifactRequired(sourceName)` and `hydrateRuntimeSearchMetaRecords(...)`.
- Caches an in-process index by `sourceName`.
- Implements `OccupationRetrievalEngine` with:
  - exact alias retrieval
  - folded alias retrieval
  - subphrase alias retrieval
  - canonical label retrieval
  - global lexical/capability text retrieval
  - family-constrained lexical/capability text retrieval
- Preserves local evidence rows/hits shaped as the existing OpenSearch retriever outputs.
- Keeps channel separation at the pipeline boundary. The pipeline still labels text evidence as `opensearch_lexical`; this is intentionally left unchanged for parity, but may be renamed later if the evidence type is generalized.

Local index details:
- Alias indexes:
  - exact alias by locale/value
  - folded alias by locale/value
  - alias token postings for subphrase lookup
  - exact/folded query variants are priority ordered; full submitted alias matches are used before lower-priority derived useful-token aliases. Derived exact aliases are fallback-only when a full exact/folded alias exists.
  - alias evidence rows now skip non-returnable `family_supporting` and `english_backbone` roles; those roles remain available in text/family support paths.
- Text indexes:
  - per-locale/per-field token postings
  - field token arrays
  - field token sets
  - field token prefix maps for strict fuzzy
  - padded field token strings for fast phrase checks
- Candidate selection:
  - prioritizes all-term title/alias field hits
  - then title/alias token unions
  - then broad `search_text`, `capability_text`, and `ancestor_text`
  - bounded to `MAX_GLOBAL_TEXT_CANDIDATES=250` and `MAX_FAMILY_TEXT_CANDIDATES=180`
- Strict fuzzy is a fallback and is skipped once a candidate has stronger all-term authority.

Important parity note:
- The current runtime search-meta artifact does not contain the exact DB/OpenSearch `meta.search_text`.
- Runtime-cache `search_text` is reconstructed from canonical label, aliases, family/group/parent labels, and ancestors.
- Exact OpenSearch parity may require adding `searchText` to the runtime search-meta artifact and exporter.

CLI usage:
```bash
npm run resolution:pipeline -- --query="software developer" --locale=en --retrieval-backend=runtime-cache --debug --no-color
npm run evaluation:listings:titles -- --index=jbng-local-listings-1 --size=10 --locale=en --run-label=runtime_cache_smoke_10 --retrieval-backend=runtime-cache
OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL=1 OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1 npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=runtime-cache
```

Backend selection:
- `--retrieval-backend=opensearch|runtime-cache` for wired CLIs.
- `OSE_RETRIEVAL_BACKEND=runtime-cache` is supported by `createRetrievalEngine(...)`, but only applies where code uses the factory.

Verification completed:
- `npm run build`: passed.
- Cold-start split:
  - `loadOccupationSearchMetaArtifactRequired`: about 62.6ms.
  - `hydrateAllRuntimeSearchMetaRecords`: about 811.3ms for 3,045 records, 821,624 aliases, and 66,817 capability labels.
  - Remaining cold cost is index construction/tokenization, not artifact I/O.
- Alias volume by role shows the scale problem:
  - `en:family_supporting`: 629,946 aliases.
  - `en:locale_supporting`: 30,878 aliases.
  - `en:english_backbone`: 33,917 aliases.
  - `ro:family_supporting`: 35,248 aliases.
- After skipping non-returnable alias roles in the alias evidence index:
  - `software developer`: leaf `software developer`, 96%, cold total about 9.5s, alias stage about 7.5s, text 31.7ms.
- Second-pass warm-process runtime-cache sample:
  - `software developer`: leaf `software developer`, 96%, cold total about 12.9s, text 25.2ms, family text 22.1ms.
  - `data analyst`: leaf `data analyst`, 93%, total 195.8ms, text 29.5ms, family text 26ms.
  - `registered nurse`: family `Nursing and midwifery professionals`, 64%, total 35.6ms, text 12.8ms.
  - `marketing manager`: leaf `marketing manager`, 95%, total 235ms, text 25.2ms.
  - `front desk receptionist`: leaf `receptionist`, 96%, total 115.2ms, text 12.1ms.
- Warm-process runtime-cache sample with ngram on and family-support on:
  - `software developer`: leaf `software developer`, 96%, cold total about 13.2s, text 20.1ms, family text 18.4ms.
  - `data analyst`: leaf `data analyst`, 93%, total 168.6ms, text 28.4ms, family text 17.9ms.
  - `registered nurse`: family `Nursing and midwifery professionals`, 64%, total 30.9ms, text 11.3ms.
  - `marketing manager`: leaf `marketing manager`, 95%, total 204.6ms, text 18.2ms.
  - `front desk receptionist`: leaf `receptionist`, 96%, total 118ms, text 14.8ms.
- Runtime-cache invariant case:
  - `Airline Compliance Auditors` returned `unresolved` with likely dictionary gap; intent split was `domain=airline`, `role=compliance,auditors`; no aviation/pilot drift.
- Runtime-cache multi-span case:
  - `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD` returned top-level `multi_span` with 2 span results.
- Listing CSV smoke:
  - `npm run evaluation:listings:titles -- --index=jbng-local-listings-1 --size=10 --locale=en --run-label=runtime_cache_smoke_10 --retrieval-backend=runtime-cache`
  - Output: `artifacts/evaluation/listing-title-pipeline/runtime_cache_smoke_10.csv`
  - 10 rows written, no command failure.
- Runtime-cache stable suite with ngram on:
  - Command: `OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL=1 OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1 npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=runtime-cache`
  - Result: `22/24 passed`, `blocking_failures=2`.
  - Remaining failures are shared with the OpenSearch backend under the same flags: `Fullstack developer` confidence is 58% vs expected 60%, and `electrical wiring installer` promotes leaf `electrician` where expectation currently wants the family.
  - Romanian `analist de date` is fixed in runtime-cache and selects leaf `data analyst` at 81%.
- OpenSearch stable comparison with the same flags:
  - Result: `20/24 passed`, `blocking_failures=4`.
  - Runtime-cache is not worse on this gate; it fixes two OpenSearch misses (`ro-analist-date` and `ro-plural-dezvoltatori-software`) in the latest run.
- Runtime-cache developing suite with ngram on:
  - Result: `33/53 passed`, `blocking_failures=0`.

Observed performance:
- Cold first query currently pays in-process index construction inside `candidate.alias_retrieval`, about 11-12s for the full EN source.
- Warm text retrieval is now fast, generally 10-30ms for the sample.
- Warm total query time depends on other stages and ngram/family-profile work but is no longer dominated by local text retrieval.

Remaining recommended work:
1. Run side-by-side 100-title EN/RO CSV comparison: OpenSearch backend vs runtime-cache backend.
2. Export a generated per-source/per-locale runtime retrieval-index artifact to remove the remaining 9-10s cold index construction cost. This should precompute normalized tokens, token ids, alias maps, field postings, and compact record references. A later binary/mmap-style layout is preferable for startup speed.
3. Consider adding exact `searchText` to the runtime search-meta artifact for closer OpenSearch parity.
4. Decide whether the two shared stable failures are expected-baseline issues or should be handled by structural evidence improvements.

Binary retrieval-index implementation stage:
- Goal: replace runtime construction of retrieval maps/postings with immutable generated binary search segments.
- Keep OpenSearch and the current runtime-cache backend intact.
- Use sorted binary structures and postings lists rather than runtime JS hash maps in hot lookup paths.
- Implemented format:
  - `occupation-retrieval-index.<source>.manifest.json`
  - `occupation-retrieval-index.<source>.strings.bin`: sorted UTF-8 string table.
  - `occupation-retrieval-index.<source>.alias-rows.bin`: fixed-width alias evidence rows.
  - `occupation-retrieval-index.<source>.text-records.bin`: fixed-width text/canonical/family records.
  - `occupation-retrieval-index.<source>.alias-exact.idx`: sorted `(localeId,keyStringId)->aliasRowRange`.
  - `occupation-retrieval-index.<source>.alias-exact-rows.bin`: exact alias row postings.
  - `occupation-retrieval-index.<source>.alias-folded.idx`: sorted `(localeId,keyStringId)->aliasRowRange`.
  - `occupation-retrieval-index.<source>.alias-folded-rows.bin`: folded alias row postings.
  - `occupation-retrieval-index.<source>.canonical.idx`: sorted `(localeId,keyStringId)->textRecordRange`.
  - `occupation-retrieval-index.<source>.canonical-rows.bin`: canonical text-record postings.
  - `occupation-retrieval-index.<source>.field-postings.idx`: sorted `(localeId,fieldId,tokenStringId)->textRecordRange`.
  - `occupation-retrieval-index.<source>.alias-token-postings.idx`: sorted `(localeId,tokenStringId)->aliasRowRange`.
  - `occupation-retrieval-index.<source>.alias-token-rows.bin`: alias token postings.
  - range payload files store sorted `uint32` row ids.
- Runtime comparisons should mostly be:
  - binary search string table for query/key/token ids.
  - binary search key indexes.
  - sorted postings range scans/intersections.
  - fixed-width row reads for ranking metadata.
- Added `src/runtime/occupation-retrieval-index-artifact.ts`.
- Added `src/cli/export-occupation-retrieval-index-artifact.ts`.
- Added `src/retrieval/binary-retrieval-engine.ts`.
- Added package script `npm run retrieval:index:export`.
- `runtime:artifacts-build` now exports the binary retrieval index after search-meta runtime export.
- `runtime:check` now validates the binary retrieval-index artifact.
- `createRetrievalEngine(...)` supports `binary-cache`; CLIs that use the factory accept `--retrieval-backend=binary-cache`.
- Current generated artifact:
  - `strings=161,931`
  - `aliases=57,234`
  - `records=3,045`
  - `exact_keys=55,053`
  - `folded_keys=54,969`
  - `field_posting_keys=191,161`
- Binary export time is about 10-11s offline.
- Binary-cache warm-process sample with ngram enabled:
  - `software developer`: leaf `software developer`, 96%, first total about 2.1s, binary alias 70.5ms, text 25ms, ngram JSON load 1.3s.
  - `data analyst`: leaf `data analyst`, 93%, total 164.1ms, alias 1.6ms, text 24.6ms.
  - `registered nurse`: family `Nursing and midwifery professionals`, 64%, total 38.1ms, alias 0.1ms, text 14ms.
  - `marketing manager`: leaf `marketing manager`, 95%, total 171.2ms, alias 1.6ms, text 24.2ms.
  - `front desk receptionist`: leaf `receptionist`, 96%, total 110.2ms, alias 0.4ms, text 15.9ms.
- Sensitive binary-cache checks:
  - `analist de date` selects leaf `data analyst` at 81%.
  - `Airline Compliance Auditors` remains unresolved/dictionary-gap and keeps `airline` as domain context, with no aviation/pilot drift.
- Binary-cache stable suite with ngram on:
  - `21/24 passed`, `blocking_failures=3`.
  - Shared with OpenSearch under same flags: `Fullstack developer` at 58% vs expected 60%, `electrical wiring installer` promotes `electrician`.
  - Also matches OpenSearch on `ro-plural-dezvoltatori-software` confidence at 82% vs expected 85%; runtime-cache scored this one higher.
- Important caveat:
  - Binary backend currently omits strict fuzzy authority from the text scorer. Typo tolerance still comes from alias-ngram retrieval. If we want binary-native fuzzy, add a deletion index/BK-tree/FST-style artifact instead of runtime edit-distance scans.

Binary alias-ngram follow-up stage:
- Objective: remove the remaining first-query alias-ngram JSON load cost by adding a binary alias-ngram artifact path.
- Current measured bottleneck after binary retrieval index:
  - `candidate.alias_ngram_index_load` is about 1.2-1.3s on first EN query.
  - Binary retrieval itself is already in the low milliseconds after load.
- Plan:
  1. Inspect current `RuntimeAliasNgramRecord` and `retrieveAliasNgramHits(...)` contract.
  2. Add binary alias-ngram manifest/files that preserve weighted features, row metadata, and enough strings for diagnostics.
  3. Export existing JSON alias-ngram records into fixed-width rows plus feature postings/ranges.
  4. Make the alias-ngram loader prefer binary artifacts when available and fall back to JSON only during migration.
  5. Re-run `runtime:check`, binary-cache warm/cold sample, and golden stable/developing checks.

Binary alias-ngram implementation result:
- Added binary alias-ngram artifacts:
  - `occupation-alias-ngrams.<source>.<locale>.<family|leaf>.binary.manifest.json`
  - `.strings.bin`
  - `.rows.bin`
  - `.feature-values.bin`
  - `.feature-postings.idx`
  - `.feature-posting-rows.bin`
- Binary ngram row layout keeps canonical/family/alias strings, alias role/weight, folded/useful tokens, norm, and a fixed feature slice.
- Feature lookup uses sorted string ids and feature postings; candidate scoring scans each candidate row's feature slice once against the small query feature-id map.
- `export-occupation-alias-ngram-artifact` now emits binary artifacts only.
- Runtime candidate retrieval requires the binary alias-ngram artifact when the ngram channel is enabled.
- `runtime:check` validates the binary ngram manifests for EN/RO/HU/ET.
- Generated artifact counts:
  - EN family: `count=53170`, `strings=232565`, `feature_keys=115229`.
  - RO family: `count=23209`, `strings=119900`, `feature_keys=62462`.
  - HU family: `count=1030`, `strings=12509`, `feature_keys=9253`.
  - ET family: `count=1604`, `strings=13829`, `feature_keys=10677`.
- Binary-cache + binary ngram timing sample:
  - `software developer`: leaf `software developer`, 96%, first total `721.7ms`, alias `33.8ms`, text `26.1ms`, family text `14.5ms`, ngram load `20.2ms`, ngram score `32ms`.
  - `data analyst`: leaf `data analyst`, 93%, total `180.3ms`, alias `0.7ms`, text `31.7ms`, family text `20.4ms`, ngram load `0ms`, ngram score `39.5ms`.
  - `registered nurse`: family `Nursing and midwifery professionals`, 64%, total `35.8ms`, alias `0.1ms`, text `11.9ms`, family text `3.1ms`, ngram score `3.9ms`.
  - `marketing manager`: leaf `marketing manager`, 95%, total `194.9ms`, alias `2.3ms`, text `20.6ms`, family text `23.5ms`, ngram score `40.5ms`.
  - `front desk receptionist`: leaf `receptionist`, 96%, total `118.5ms`, alias `0.3ms`, text `16.6ms`, family text `6.6ms`, ngram score `51.7ms`.
- Validation:
  - `npm run build`: passed.
  - `npm run runtime:check`: passed.
  - `OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL=1 OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1 npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: `21/24 passed`, `blocking_failures=3`.
  - Stable failures: `Fullstack developer` confidence `58%` vs expected `60%`; `electrical wiring installer` promotes `electrician`; `dezvoltatori software` confidence `82%` vs expected `85%`.
  - `OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL=1 OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1 npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: `33/53 passed`, `blocking_failures=0`.
  - `Airline Compliance Auditors` on `binary-cache`: unresolved/dictionary gap at `47%`; intent remains `role=compliance,auditors`, `domain=airline`; no aviation/pilot drift.
  - `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD` on `binary-cache`: top-level `multi_span`, `spans=2`; span 1 resolves family `Transport and storage labourers`, span 2 resolves leaf `kitchen assistant`; no pooled top-level family/leaf ranking.
- Remaining recommended work:
  1. Decide if the three stable failures are expected-baseline changes for ngram/binary-cache or need structural ranking fixes.
  2. Add binary-native fuzzy/deletion index if we want typo tolerance in the binary backend itself instead of relying mostly on alias-ngram.
  3. Consider replacing the small query feature `Map` in binary ngram scoring with sorted feature-id arrays if profiling shows it matters; current measured scoring is already in the tens of milliseconds.

Default alias-ngram activation:
- Runtime alias-ngram retrieval now defaults on.
- Family-supporting ngram artifacts also default on because the generated runtime artifacts are `.family` artifacts.
- Explicit escape hatches:
  - `OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL=1` disables ngram retrieval.
  - `OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1` forces leaf-only ngram artifacts.
  - Legacy `OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL=0|false|no` and `OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT=0|false|no` also disable their respective defaults.
- Verified with no ngram env vars:
  - `npm run resolution:pipeline -- --query="Fullstack developer" --locale=en --retrieval-backend=binary-cache --debug --no-color --top-leaves-per-family=5`
  - Result still selects family at `58%`, but ngram evidence is present by default: `evidence=family_profile:1,graph_support:1,ngram_alias:15`, `candidate.alias_ngram_index_load=20.311ms`, `candidate.alias_ngram_retrieval=21.209ms`.

Documentation refresh:
- Updated live operator/runtime docs for the current artifact-backed architecture.
- `docs/GETTING_STARTED.md` now documents `npm run runtime:artifacts-build` as the deploy artifact command and lists binary retrieval/alias-ngram outputs.
- `docs/GETTING_STARTED.md` now documents dense retrieval as optional/default-off and shows `--retrieval-backend=binary-cache` for offline runtime checks.
- `docs/RETRIEVAL_ENGINE.md` now documents `opensearch`, `runtime-cache`, and `binary-cache`, including offline guarantees and regression checks before default switching.
- `docs/IMPLEMENTATION_DETAIL.md` now records the binary retrieval-index structure, binary alias-ngram structure, default ngram behavior, and no-query-time-index-construction invariant.
- `docs/OPENSEARCH_INDEXING.md` now describes OpenSearch as default/selected backend and `binary-cache` as the generated-artifact portable backend.
- `README.md` now includes `runtime:artifacts-build`, `runtime:check`, binary-cache examples, and updated CLI summaries for binary retrieval and alias-ngram exporters.
- Stale-text scan over live docs found no remaining key outdated phrases for old ngram enablement, dense default, or OpenSearch-only alias lookup.
- `npm run build`: passed after documentation updates.

Dense/vector package cleanup:
- Removed normal package scripts:
  - `embeddings:occupations`
  - `embeddings:export-runtime`
- Removed `embeddings:export-runtime` from `runtime:artifacts-build`.
- Removed `@huggingface/transformers` from `package.json` and `package-lock.json`.
- Made `src/embeddings/providers/transformers-provider.ts` load Transformers with an optional runtime dynamic import so the experimental source can still compile without the package dependency installed.
- Updated `runtime:check` so runtime artifact validation no longer requires occupation vector artifacts or accepts `--model-key`.
- Removed dense embedding build/vector artifact sections from live docs (`README.md`, `docs/GETTING_STARTED.md`, `docs/IMPLEMENTATION_DETAIL.md`).
- Verified no remaining package/live-doc references to embedding scripts, HuggingFace dependency, vector artifacts, or dense enablement env vars.
- `npm run build`: passed.
- `npm run runtime:check`: passed without vector artifact validation.

Runtime context boot layer:
- Added `src/runtime/occupation-runtime-context.ts`.
- `OccupationRuntimeContext.load(...)` centralizes runtime startup:
  - validates search-meta artifact
  - validates binary retrieval index when `retrievalBackend='binary-cache'`
  - validates signal vocabulary, family profiles, intent vocabulary, and role-head equivalences
  - validates binary alias-ngram artifacts for configured locales when ngram retrieval is enabled
  - constructs the retrieval engine instance
- Normal boot keeps large search-meta details lazy and requires binary alias-ngram artifacts; JSON alias-ngram fallback records are no longer part of the runtime contract.
- `runtime:check` uses the runtime context with `retrievalBackend='binary-cache'`, then prints detailed artifact information for the binary/cache runtime artifacts.
- Added `OccupationSearchPipeline.withRuntime(runtime)`.
- Wired runtime context startup into:
  - `src/cli/resolve-occupation-pipeline.ts`
  - `src/cli/run-listing-title-pipeline-csv.ts`
  - `src/cli/run-pipeline-golden-suite.ts`
  - `src/api/canonical-term.ts` with a cached runtime-backed pipeline per source.
- Documentation now points new runtime entrypoints to `OccupationRuntimeContext.load(...)`.
- Validation:
  - `npm run build`: passed.
  - `npm run runtime:check`: passed and reports `runtime_context=loaded source=esco_1_2_1 retrieval_backend=binary-cache alias_ngram_locales=en,et,hu,ro`.
  - `npm run resolution:pipeline -- --query="software developer" --locale=en --retrieval-backend=binary-cache --no-color`: selected leaf `software developer` at `96%`.

Structural test suite:
- Added `npm run test:structural`.
- Test files:
  - `src/tests/structural/artifact-contracts.test.ts`
  - `src/tests/structural/pipeline-invariants.test.ts`
  - `src/tests/structural/query-preparation.test.ts`
  - `src/tests/structural/retrieval-evidence.test.ts`
  - `src/tests/structural/runtime-contract.test.ts`
- Coverage:
  - package deploy artifact script excludes dense embedding/vector workflow and includes binary retrieval/alias-ngram export.
  - alias-ngram retrieval and family support default on, with explicit disable env vars honored.
  - `OccupationRuntimeContext.load({ retrievalBackend: 'binary-cache' })` boots deterministic runtime artifacts centrally.
  - offline runtime pipeline resolves `software developer` through `binary-cache` with no dense embeddings scanned and ngram evidence present.
  - runtime alias-ngram locales and binary artifact manifests are present/consistent.
  - binary retrieval index manifest matches search-meta source/count expectations.
  - query preparation preserves Romanian slash-separated spans as independent contexts.
  - query intent keeps role terms ahead of domain terms for `Airline Compliance Auditors`.
  - acronym expansion preserves `HVAC` and adds controlled long-form role terms.
  - job-level modifiers such as `senior` are excluded from useful role tokens.
  - binary retrieval keeps exact/folded evidence separate and honors family constraints.
  - binary alias-ngram retrieves family-supporting market titles without converting them into direct leaf authority.
  - pipeline exact canonical, market-title family fallback, domain-drift guard, multi-span, and localized alias/backbone invariants.
- Added `test:structural` to runtime preflight docs in `README.md`, `docs/GETTING_STARTED.md`, and `docs/RETRIEVAL_ENGINE.md`.
- Validation:
  - `npm run build`: passed.
  - `npm run test:structural`: passed, 19/19.

Runtime artifact cleanup:
- `artifacts/` now contains only `artifacts/runtime`.
- `.gitignore` unignores `artifacts/runtime/**` so the package-ready runtime artifacts can be pushed while evaluation/enrichment output remains ignored.
- Removed non-runtime artifact folders/files:
  - `artifacts/enrichment`
  - `artifacts/evaluation`
  - `artifacts/.DS_Store`
- Removed stale/duplicate runtime artifacts:
  - JSON alias-ngram fallback manifests and records
  - occupation vector artifacts
  - duplicate `occupation-role-head-equivalents.v1.json`
- Alias-ngram runtime/build contract is now binary-only:
  - `runtime:check` validates binary alias-ngram artifacts only.
  - `OccupationCandidateRetriever` requires binary alias-ngram artifacts when the ngram channel is enabled.
  - `retrieval:aliases:ngram:export` emits binary alias-ngram artifacts only.
- Final runtime artifact set: 55 files, about 280 MB.
- Validation:
  - `npm run build`: passed.
  - `npm run runtime:check`: passed.
  - `npm run test:structural`: passed, 19/19.

Search-meta details shard fix:
- `occupation-search-meta.esco_1_2_1.details.jsonl` was still required for lazy hydration of aliases and capability labels, but the single file was too large for GitHub.
- Replaced the single details sidecar with sharded details files:
  - `occupation-search-meta.esco_1_2_1.details.000.jsonl`
  - `occupation-search-meta.esco_1_2_1.details.001.jsonl`
  - `occupation-search-meta.esco_1_2_1.details.002.jsonl`
  - `occupation-search-meta.esco_1_2_1.details.003.jsonl`
- Search-meta core records now store `detailsFileIndex`, `detailsOffset`, and `detailsByteLength`.
- Search-meta manifest now stores `detailsPaths`; loader remains backward-compatible with the older single `detailsPath`.
- `search-meta:export-runtime` now writes sharded details sidecars by default, capped at about 48 MB per shard.

Search-meta binary migration in progress:
- User requested full integration with no backward compatibility requirement; all search-meta runtime consumption is internal.
- Probe result from `scripts/probe-search-meta-details-binary.mjs`:
  - all details JSONL shards: 153.14 MiB
  - no-compression binary dictionary output: 17.36 MiB
  - largest output file: 13.59 MiB
  - parity: ok
- Migration direction:
  - Replace search-meta JSONL runtime contract with binary accessor API.
  - Extract shared binary table primitives to `src/utils/binary-table.ts`.
  - Rewrite `occupation-search-meta-artifact.ts` as a binary index with accessors, not hydration-oriented `artifact.records`.
  - Replace `search-meta:export-runtime` output with binary tables for core rows, ancestors, siblings, family leaf postings, detail rows, alias rows, and capability rows.
  - Update runtime consumers to use `getCoreRecord`, `getAncestors`, `getSiblings`, `getDetails`, `getLeafCoreRecordsForFamilies`, and build-time iterators.
  - Update tests/contracts and run the retrieval/ranking regression gate.
- Progress:
  - Initial code inspection complete.
  - Key current consumers identified:
    - branch expansion needs core/ancestor/sibling access only.
    - pipeline cross-locale needs selected candidate details only.
    - family recovery needs family leaf core records plus aliases/capabilities for recovered leaves.
    - offline exporters currently call `loadOccupationSearchMetaArtifactWithDetailsRequired` or `hydrateAllRuntimeSearchMetaRecords`; these should move to build-time iterator helpers.
  - Stage 1 started/completed:
    - Added `src/utils/binary-table.ts` with shared binary primitives.
    - `src/runtime/occupation-retrieval-index-artifact.ts` imports primitives from the utility and re-exports them for existing callers.
    - `src/runtime/occupation-alias-ngram-binary-artifact.ts` imports primitives directly from `../utils/binary-table.js`.
  - Stage 2/3 implementation checkpoint:
    - Replaced `src/runtime/occupation-search-meta-artifact.ts` with a binary-table-backed loader.
    - Added accessor methods: `getCoreRecord`, `getCoreRecordByRowId`, `getDetails`, `getAliases`, `getCapabilityLabels`, `getAncestors`, `getSiblings`, `getLeafCoreRecordsForFamilies`, `getAllCoreRecords`, `getAllRecordsWithDetails`.
    - Added `buildOccupationSearchMetaBinaryFiles(...)` for exporter use.
    - Updated `src/cli/export-occupation-search-meta-artifact.ts` to emit binary files only.
    - Updated runtime consumers in branch expansion, pipeline family recovery/cross-locale evidence, canonical-term helper, runtime cache, alias-ngram builder, and artifact exporters.
    - `npm run build`: passed after these changes.
  - Artifact generation/validation checkpoint:
    - `npm run search-meta:export-runtime` works with the new binary exporter, but the current local DB search-meta rebuild produced a different graph ID set and zero capability hints. That made runtime artifacts inconsistent with the existing binary retrieval/alias/family artifacts.
    - To preserve the existing runtime graph ID set, generated the binary search-meta artifact from the previous runtime JSONL search-meta files before deleting those JSONL files.
    - Binary search-meta output from the preserved runtime source:
      - total binary bytes: 28,949,718
      - stringCount: 99,729
      - aliasCount: 821,624
      - capabilityCount: 66,817
    - Removed stale search-meta JSONL runtime files:
      - `occupation-search-meta.esco_1_2_1.records.jsonl`
      - `occupation-search-meta.esco_1_2_1.details.000.jsonl`
      - `occupation-search-meta.esco_1_2_1.details.001.jsonl`
      - `occupation-search-meta.esco_1_2_1.details.002.jsonl`
      - `occupation-search-meta.esco_1_2_1.details.003.jsonl`
    - Runtime folder size after removal: 145 MiB.
    - `npm run runtime:check`: passed and reports binary search-meta counts with 66,817 capabilities.
    - `npm run test:structural`: passed, 20/20.
    - `npm run evaluation:golden:pipeline:developing`: completed with `blocking_failures=0` and `34/54` developing cases passing.
    - `npm run evaluation:golden:pipeline -- --suite=stable`: failed 3 blocking cases:
      - `generic-tail-fullstack-developer`: selected expected family but confidence was 58%, expected >=60%.
      - `descriptive-people-who-install-wiring`: selected leaf `electrician`, expected family `Electrical equipment installers and repairers`.
      - `ro-plural-dezvoltatori-software`: selected expected leaf but confidence was 82%, expected >=85%.
    - Debug checks for the stable failures show binary search-meta details/capabilities decode correctly; failures appear to be ranking threshold/selection drift, not missing binary data.
  - DB rebuild caveat and command:
    - `runtime:artifacts-build` already includes the new binary search-meta exporter through `npm run search-meta:export-runtime`.
    - Added `runtime:artifacts-rebuild-db` for the DB-backed full rebuild path:
      - `npm run graph:capabilities && npm run search-meta:occupations && npm run runtime:artifacts-build`
    - Do not run only `search-meta:export-runtime` from a DB snapshot whose graph IDs differ from the existing retrieval/alias/family runtime artifacts.
    - Current local DB check after the accidental rebuild showed `ose_graph_capability_links=0` and `ose_search_meta_capability_hints=0`; running `graph:capabilities` before `search-meta:occupations` is required to restore DB-backed capability hints.
    - To reproduce the exact current checked-in graph ID set, restore/use the DB snapshot that produced the existing runtime artifacts, or rebuild all runtime artifacts together from the same clean DB source sequence.
  - DB-backed rebuild command test:
    - Ran `npm run runtime:artifacts-rebuild-db`; it initially failed inside sandbox with `connect EPERM 127.0.0.1:3306`, then succeeded with escalated local MySQL access.
    - Command completed all phases:
      - `graph:capabilities`
      - `search-meta:occupations`
      - `runtime:artifacts-build`
    - DB counts after command:
      - `ose_graph_capability_links`: 126,051
      - `ose_search_meta_capability_hints`: 66,817
      - `ose_search_meta` rows with capability support: 3,039
    - Runtime artifact size after full DB-backed rebuild: 154 MiB; no files over 45 MiB.
    - `npm run runtime:check`: passed.
    - `npm run test:structural`: passed, 21/21 after updating structural tests to derive graph/family IDs by label instead of hardcoding old DB snapshot IDs.
    - `npm run evaluation:golden:pipeline:developing`: completed with `blocking_failures=0` and `34/54` developing cases passing.
    - `npm run evaluation:golden:pipeline -- --suite=stable`: still fails the same 3 blocking ranking/threshold cases:
      - `generic-tail-fullstack-developer`: selected expected family but confidence was 58%, expected >=60%.
      - `descriptive-people-who-install-wiring`: selected leaf `electrician`, expected family `Electrical equipment installers and repairers`.
      - `ro-plural-dezvoltatori-software`: selected expected leaf but confidence was 82%, expected >=85%.
  - Documentation update checkpoint:
    - Updated `README.md` and `docs/GETTING_STARTED.md` to describe binary search-meta runtime artifacts and the `runtime:artifacts-rebuild-db` command.
    - Updated `docs/RETRIEVAL_ENGINE.md` to note that binary-cache uses binary search-meta accessors and that DB-backed rebuilds must export all runtime artifacts from one graph ID snapshot.
    - Updated `docs/IMPLEMENTATION_DETAIL.md` with search-meta binary table layout and accessor/memory contract.
    - Updated `docs/IMPLEMENTATION_CHECKLIST.md` and `docs/POST_PHASE14_REFINEMENT_CHECKLIST.md` with the rebuild command, capability graph prerequisite, current artifact size, and validation status.
  - Runtime dense-removal checkpoint:
    - User asked whether dense retrieval can be removed entirely now that runtime no longer ships/uses dense vectors.
    - Started implementation by removing global dense artifact loading/query embedding/scoring from `src/retrieval/occupation-candidates.ts`.
    - `OccupationCandidateRetriever` now returns `modelDimensions=null` and `scannedDenseEmbeddingCount=0`; `DEFAULT_MODEL_KEY` is now `none`.
    - Removed family-constrained dense recovery from `src/search-pipeline/occupation-search-pipeline.ts`; family recovery now uses only lexical family hits plus graph recovery fallback.
    - Deleted the unused runtime `src/retrieval/family-dense-retriever.ts` path so it cannot silently reintroduce `occupation-vector-artifact` loading.
    - `npm run build`: passed after dense runtime removal.
    - Deleted stale compiled `dist/retrieval/family-dense-retriever.{js,d.ts}` because `tsc` does not remove outputs for deleted source files.
    - `npm run runtime:check`: passed; runtime context loads binary-cache artifacts and reports no vector artifact dependency.
    - `npm run test:structural`: passed 21/21.
    - `npm run evaluation:golden:pipeline:developing`: completed with `blocking_failures=0`, model reported as `none`.
    - `npm run evaluation:golden:pipeline -- --suite=stable`: still fails the same 3 known blocking ranking/threshold cases as before this dense cleanup:
      - `generic-tail-fullstack-developer`: selected expected family but confidence was 58%, expected >=60%.
      - `descriptive-people-who-install-wiring`: selected leaf `electrician`, expected family `Electrical equipment installers and repairers`.
      - `ro-plural-dezvoltatori-software`: selected expected leaf but confidence was 82%, expected >=85%.
    - Invariant debug checks:
      - `Airline Compliance Auditors`: unresolved dictionary-gap style result, role/domain split stayed correct, `scanned dense embeddings=0`.
      - `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD`: top-level `multi_span` result with two span results, `scanned dense embeddings=0`.
    - Smoke with `OSE_ENABLE_DENSE_RETRIEVAL=1 npm run retrieval:candidates -- --query="software developer" --locale=en --format=json` succeeded with `model_key=none`, `model_dimensions=null`, and `scanned_dense_embedding_count=0`; the old env flag no longer triggers vector artifact loading.
    - Stronger cleanup:
      - Deleted old dense build/export source and compiled outputs:
        - `src/cli/build-occupation-embeddings.ts`
        - `src/cli/export-occupation-vector-artifact.ts`
        - `src/runtime/occupation-vector-artifact.ts`
        - `src/runtime/query-embedding.ts`
        - `src/embeddings/**`
        - matching `dist/**` outputs
      - `npm run build`: passed after deleting these files, confirming no live runtime/import path depends on dense vector utilities.
      - Re-ran validation after stronger cleanup:
        - `npm run runtime:check`: passed.
        - `npm run test:structural`: passed 21/21.
        - `npm run evaluation:golden:pipeline:developing`: `blocking_failures=0`, 34/54 developing cases passing.
        - `npm run evaluation:golden:pipeline -- --suite=stable`: same 3 existing blocking ranking/threshold failures as above.
        - `npm pack --dry-run`: package has 300 files, 38.0 MB packed, 153.8 MB unpacked; no `dist/embeddings`, vector artifact loader, query embedding, or family dense retriever files are included.
    - Second pass cleanup before commit:
      - Removed dead dense evidence channels/counters from retrieval results, branch summaries, pipeline evidence tiers, old resolver reporting, CSV output, evaluation run summaries, readiness reports, manual-review review types, and CLI text/JSON output.
      - Renamed the old resolver's misleading `dense_only` weak evidence tier to `weak_signal`.
      - Removed OpenSearch vector indexing support: no vector config/env, no vector create/populate flags, no embedding table reads, no vector mapping, no vector document fields.
      - Updated `README.md`, `docs/GETTING_STARTED.md`, `docs/RETRIEVAL_ENGINE.md`, and `docs/OPENSEARCH_INDEXING.md` to remove stale dense/vector runtime instructions.
      - Strict sweep is clean for live source/operator docs:
        - no `dense_embedding`, `dense_global`, `dense_family_constrained`, `family_dense`, `scanned_dense`, `occupation-vector`, `query-embedding`, dense env flags, or OpenSearch vector names in `src`, `package.json`, README, or active docs.
        - no `embedding`, `vector`, or `family-dense` filenames under `src` or `dist` except alias-ngram vector math identifiers are intentionally kept out of filename sweep.
      - `npm run build`: passed after second pass.
    - Lint/format inspection:
      - `package.json` has no `lint`, `format`, or `format:check` scripts.
      - No ESLint, Prettier, Biome/Rome, or `.editorconfig` config files were found.
      - Existing `check` script is `npm run db:check`, so do not reuse that name for formatting without an intentional migration.
    - Final second-pass validation before commit:
      - `npm run evaluation:golden:pipeline:developing`: passed with `blocking_failures=0` and 34/54 developing cases passing.
      - `npm run evaluation:golden:pipeline -- --suite=stable`: unchanged known ranking baseline, 21/24 passing with the same three blocking cases:
        - `generic-tail-fullstack-developer`: selected expected family but confidence was 58%, expected >=60%.
        - `descriptive-people-who-install-wiring`: selected leaf `electrician`, expected family `Electrical equipment installers and repairers`.
        - `ro-plural-dezvoltatori-software`: selected expected leaf but confidence was 82%, expected >=85%.
      - `npm pack --dry-run`: package contains `dist` plus `artifacts/runtime/occupation-*`, 300 files, 38.0 MB packed, 153.8 MB unpacked.
      - Pack contents include no removed dense/vector runtime modules or artifact loaders.
      - Live runtime/source/package docs are clean for removed dense channel/env/artifact identifiers. Historical phase-planning docs still contain old dense/vector notes as archive context and were not rewritten in this cleanup commit.
    - Lambda memory/OOM diagnostic:
      - Measured with `node --expose-gc` against compiled `dist` loaders.
      - Loading artifacts individually:
        - start RSS: ~41.5 MB.
        - search-meta binary: ~81.8 MB RSS, ~27.6 MB array buffers.
        - retrieval index binary: ~114.0 MB RSS, ~60.0 MB array buffers.
        - signal vocabulary: ~116.1 MB RSS.
        - family profiles JSONL: ~228.8 MB RSS, ~90.6 MB heap used.
        - intent vocabulary/role-head equivalence: ~232.8 MB RSS.
        - alias ngram `en`: ~266.8 MB RSS.
        - alias ngram `ro/hu/et` together: ~286.5 MB RSS.
      - `OccupationRuntimeContext.load({ sourceName, retrievalBackend: 'binary-cache' })` with current defaults reaches ~298.9 MB RSS because it eagerly loads family profiles and all default alias-ngram locales.
      - Full simple pipeline query `software developer` with current defaults reaches ~329.3 MB RSS.
      - With `OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL=1`, context load drops to ~236.9 MB RSS, but one query still reaches ~273.9 MB RSS.
      - Primary OOM causes under a 250 MB Lambda limit:
        - `src/runtime/occupation-runtime-context.ts` eagerly loads `loadOccupationFamilyProfileArtifactRequired` plus all default alias ngram artifacts.
        - `src/runtime/occupation-family-profile-artifact.ts` reads the 27 MB JSONL family-profile file into a string, splits it, parses all records, and retains a large JS object graph (~86 MB heap delta).
        - Alias ngram binary buffers add ~34 MB for English and ~54 MB for all four locales.
      - Immediate mitigation: disabling alias ngram retrieval is not sufficient for a 250 MB Lambda once a query runs; family profiles need a compact/lazy runtime representation or the Lambda memory limit must increase.
    - Binary family-profile migration:
      - Converted `occupation-family-profiles.esco_1_2_1.records.jsonl` to schema v2 binary tables:
        - `*.strings.bin`
        - `*.profile-rows.bin`
        - `*.locale-rows.bin`
        - `*.source-rows.bin`
        - `*.token-rows.bin`
        - `*.phrase-rows.bin`
        - `*.leaf-token.idx`
        - `*.leaf-id-rows.bin`
      - Removed the old 27 MB JSONL family-profile runtime artifact.
      - Runtime family-profile loader now keeps compact binary buffers and exposes direct accessors; `FamilyProfileRetriever` scores by token/string IDs and leaf-token ranges instead of reading `artifact.records`.
      - `OccupationRuntimeContext.load()` no longer preloads family profiles or alias-ngram locale artifacts. Alias-ngram remains enabled, but loads only the requested locale on demand.
      - Family-profile retrieval is enabled by default again; emergency disable switch is `OSE_DISABLE_FAMILY_PROFILE_RETRIEVAL=1`.
      - Memory after binary conversion:
        - context load: ~127 MB RSS.
        - `software developer` English query: ~233.5 MB RSS.
        - Romanian multi-span query: ~240.0 MB RSS.
      - Artifact/package size after binary family profiles:
        - family-profile runtime files total about 14.5 MB instead of 27 MB JSONL.
        - `npm pack --dry-run`: package size 36.2 MB, unpacked size 141.7 MB.
      - Validation:
        - `npm run runtime:check`: passed.
        - `npm run test:structural`: passed 21/21 after adding a binary family-profile structural assertion.
        - `npm run evaluation:golden:pipeline:developing`: completed with `blocking_failures=0`, 34/54 developing cases passing.
        - `npm run evaluation:golden:pipeline -- --suite=stable`: unchanged known 3 blocking ranking/threshold cases.
    - Deep Lambda memory pass after binary family profiles:
      - Confirmed `artifacts/runtime/occupation-*` is about 139 MB on disk, under the 200 MB Lambda layer target.
      - Remaining large runtime files are search-meta alias rows (~23 MB), alias-ngram locale artifacts (~34 MB for English and ~18 MB for Romanian), retrieval-index strings/text postings, and binary family profiles (~14.5 MB).
      - Tightened `src/runtime/occupation-search-meta-artifact.ts` so search-meta `aliasRows` and `capabilityRows` are synchronous lazy getters instead of eager buffers. Runtime context now loads core/hierarchy/detail indexes up front, and reads the ~25 MB detail-heavy buffers only when a query hydrates aliases/capabilities.
      - Added `readFixedTableSync` to `src/utils/binary-table.ts` for lazy binary table hydration without changing the accessor API.
      - `npm run build`: passed after the lazy search-meta detail-buffer change.
      - Rejected the experimental leaf-only/no-cache alias-ngram default direction because it weakens family-selection evidence. Restored family-supporting alias-ngram artifacts as the default in code, package artifact build script, runtime check, structural tests, and docs.
      - Current diagnosis: alias-ngram is binary and avoids full JS row-object hydration, but it is not file-backed. `src/runtime/occupation-alias-ngram-binary-artifact.ts` reads every sidecar with `fs.readFile`, so the whole `strings`, `rows`, `feature-values`, `feature-postings`, and `feature-posting-rows` buffers become resident external/ArrayBuffer memory for the active locale. The correct next optimization is bounded range/file-backed access for the largest ngram tables, not disabling family-supporting ngram evidence.
      - Added project invariant to `AGENTS.md`: do not preload huge runtime artifacts or sidecar files when bounded file-backed/range reads can preserve behavior.
      - Implemented file-backed/range-read binary primitives in `src/utils/binary-table.ts`.
      - Switched alias-ngram `feature-values` and `feature-posting-rows` to range-backed reads while keeping family-supporting ngram behavior enabled by default.
      - Switched retrieval-index `textPostingRows` to range-backed reads.
      - Switched family-profile `tokenRows`, `phraseRows`, `leafTokenIndex`, and `leafIdRows` to range-backed reads.
      - Validation after range-backed storage changes:
        - `npm run build`: passed.
        - `npm run test:structural`: passed 22/22, including family-supporting ngram and Romanian multi-span cases.
      - Memory after range-backed storage changes with family-supporting ngram still enabled:
        - context load: ~116-117 MB RSS, down from ~127 MB.
        - single `software developer`: ~171 MB RSS.
        - single `Fullstack developer`: ~177 MB RSS.
        - single Romanian multi-span: ~228 MB RSS.
        - mixed warm sequence (`software developer`, `dezvoltator software`, `Fullstack developer`, Romanian multi-span): peaked ~285 MB RSS even though live heap/external stayed much lower; remaining risk is allocator/RSS high-water from repeated full pipeline result construction and multi-locale work in one warm process.
      - Added runtime debug gating:
        - `OccupationSearchPipelineOptions.debug` is false by default.
        - `debug.rawBranchExpansion` is now `null` unless debug is explicitly enabled.
        - stage collection is a no-op unless debug is enabled.
        - production result breadth is capped at 3 families x 3 leaves even if a caller passes larger `topFamilyLimit`/`topLeavesPerFamily`; larger breadth is debug-only.
        - CLI `--debug` continues to opt into the larger diagnostic result.
      - Memory after debug gating and 3x3 production cap:
        - mixed sequence: context ~117 MB, `software developer` ~171 MB, `dezvoltator software` ~191 MB, `Fullstack developer` ~228 MB, Romanian multi-span ~278 MB.
        - This improved intermediate warm-container memory by avoiding retained raw branch expansion and excess ranked output, but the final Romanian multi-span still creates a high RSS watermark.
      - Validation after debug gating:
        - `npm run build`: passed.
        - `npm run test:structural`: passed 23/23, including the new debug/cap contract.
      - Removed the memory-heavy `runtime-cache` retrieval backend:
        - Deleted `src/retrieval/runtime-cache-retrieval-engine.ts` and stale compiled `dist/retrieval/runtime-cache-retrieval-engine.{js,d.ts}`.
        - `src/retrieval/retrieval-engine-factory.ts` now supports only `binary-cache` and explicit `opensearch`.
        - CLI help and `docs/RETRIEVAL_ENGINE.md` no longer advertise `runtime-cache`; docs note it was removed because it decoded the corpus and duplicated generated indexes in JS memory.
        - Added a structural test proving `parseRetrievalBackend('runtime-cache')` is rejected.
        - `npm run test:structural`: passed 24/24 after removal.
      - Family-profile query-time scan reduction:
        - Upgraded the binary family-profile artifact to schema v3 with `profile-token.idx` and `profile-token-rows.bin`.
        - `FamilyProfileRetriever` now prefilters candidate family profiles through locale/token postings before scoring, instead of scoring every profile for every query.
        - `binary-retrieval-engine` no longer allocates full-corpus `Uint8Array` bitmaps per request; candidate alias/text row tracking now uses result-sized `Set<number>` state.
        - Validation after this pass:
          - `npm run runtime:check`: passed.
          - `npm run test:structural`: passed 24/24.
          - `npm run evaluation:golden:pipeline:developing`: completed with `blocking_failures=0`, 33/54 developing cases passing.
          - `npm run evaluation:golden:pipeline -- --suite=stable`: unchanged known 3 blocking ranking/threshold cases.
        - Runtime artifact footprint is about 145 MB for `artifacts/runtime/occupation-*`, still below the 200 MB Lambda layer target.
        - Remaining Lambda risk is not retained `PipelineState`; `runPipelineAttempt` creates fresh per-call maps and arrays. The current high-water is temporary per-request allocation during branch expansion, family recovery, ngram scoring, and result shaping, especially for warm multi-locale/multi-span calls. Next optimization should reduce hydration/scoring breadth structurally without disabling ngram or weakening family-selection logic.
      - Runtime artifact cache policy cleanup:
        - Added `src/utils/runtime-artifact-cache.ts` with bounded LRU, manifest size/mtime invalidation, and failed-load eviction.
        - Replaced unbounded module-level artifact caches in retrieval-index, family-profile, intent-vocabulary, signal-vocabulary, search-meta, and alias-ngram binary loaders.
        - Source-scoped runtime artifact caches default to 2 entries and can be tuned globally with `OSE_RUNTIME_ARTIFACT_CACHE_SIZE` or specifically with `OSE_RETRIEVAL_INDEX_CACHE_SIZE`, `OSE_FAMILY_PROFILE_CACHE_SIZE`, `OSE_INTENT_VOCABULARY_CACHE_SIZE`, `OSE_SIGNAL_VOCABULARY_CACHE_SIZE`, and `OSE_SEARCH_META_ARTIFACT_CACHE_SIZE`.
        - Alias-ngram binary keeps its previous default of 1 entry and `OSE_ALIAS_NGRAM_CACHE_SIZE` override.
        - Added a structural test proving the shared cache reuses the same manifest version, reloads after manifest changes, and evicts the oldest entry when over capacity.
        - Validation after cache cleanup:
          - `npm run build`: passed.
          - `npm run test:structural`: passed 25/25.
          - `npm run runtime:check`: passed.
          - `npm run evaluation:golden:pipeline:developing`: `blocking_failures=0`, 33/54 developing cases passing.
          - `npm run evaluation:golden:pipeline -- --suite=stable`: unchanged known 3 blocking ranking/threshold cases.
          - `npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: `blocking_failures=0`, 33/54 developing cases passing.
          - `npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: unchanged known 3 blocking ranking/threshold cases.
        - Memory after cache cleanup:
          - Isolated cold process context load: ~116-118 MB RSS, ~9.4 MB heap, ~51.5 MB ArrayBuffers.
          - Isolated `software developer` EN query: ~166 MB RSS.
          - Isolated `dezvoltator software` RO query: ~180 MB RSS.
          - Isolated `Fullstack developer` EN query: ~175 MB RSS.
          - Isolated Romanian multi-span query: ~257-258 MB RSS, ~40 MB heap, ~63 MB ArrayBuffers after explicit GC.
          - Warm mixed sequence in one process still climbs to ~290 MB RSS after EN + RO + multi-span. The bounded cache change prevents unbounded source/artifact growth but does not materially reduce same-source single-artifact memory.
          - Setting the multi-span result to `null` and forcing GC did not reduce RSS, which suggests allocator/high-water/native-buffer behavior more than retained returned result objects.
      - Final pre-commit cleanup pass:
        - Re-reviewed the business-facing diffs. Family-profile scoring still uses the same scoring function and evidence semantics; it now limits scored profiles via generated locale/token postings. Binary retrieval still preserves channel separation and boundaries; corpus-sized request bitmaps were replaced with result-sized sets. Runtime-cache was removed rather than kept as a memory-heavy selectable backend.
        - File-backed binary tables no longer keep persistent file descriptors. Page misses now open/read/close synchronously and retain only bounded in-memory page caches, avoiding FD leaks and avoiding use-after-close if a bounded artifact cache evicts an entry while another request still holds it.
        - Removed incidental generated files from the working tree: `artifacts/runtime/.DS_Store` and `occupation-search-engine-0.1.0.tgz`.
        - `git diff --check`: passed.
        - `npm pack --dry-run`: package size 36.8 MB, unpacked size 144.1 MB; package files are still only `dist` and `artifacts/runtime/occupation-*`.
        - `artifacts/runtime/occupation-*`: about 145 MB on disk.
        - Final gate:
          - `npm run build`: passed.
          - `npm run test:structural`: passed 25/25.
          - `npm run runtime:check`: passed.
          - `npm run evaluation:golden:pipeline:developing`: `blocking_failures=0`, 33/54 developing cases passing.
          - `npm run evaluation:golden:pipeline -- --suite=stable`: unchanged known 3 blocking ranking/threshold cases.
          - `npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: `blocking_failures=0`, 33/54 developing cases passing.
          - `npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: unchanged known 3 blocking ranking/threshold cases.
          - Exploratory `Airline Compliance Auditors`: still unresolved/likely dictionary gap, with `airline` as domain and `compliance,auditors` as role/head; no aviation/pilot drift.
          - Exploratory Romanian slash title: still top-level `multi_span` with two independent span results and no pooled top-level family/leaf.
        - Latest mixed warm memory sample after safe file reads: context ~120 MB RSS; `software developer` ~172 MB; `dezvoltator software` ~230 MB; `Fullstack developer` ~261 MB; Romanian multi-span ~289 MB.
