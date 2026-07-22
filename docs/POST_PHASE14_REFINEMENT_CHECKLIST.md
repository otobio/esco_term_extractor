# Post-Phase-14 Refinement Checklist

This checklist turns the current architecture into concrete execution work toward a usable occupation search engine. It assumes there are no artificial hold bars: we can add real embeddings, expand evaluation, use OpenSearch for lexical/vector retrieval, and iterate with measured runs.

Confirmed constraints:

- Download approval is granted for dependencies and model artifacts.
- OpenSearch is available on cluster port `9201`.
- OpenSearch may be used for lexical retrieval and, if practical, embedding/vector storage.
- MySQL remains the canonical source of graph, search-meta, evaluation, review, and run-persistence state.

## Decisions From This Point

### Decision 1. Use Real Multilingual Embeddings

Decision:

- Add `@huggingface/transformers` and use a real multilingual sentence embedding model.
- Initial model candidate:

```ts
export const DEFAULT_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIM = 384;
```

Why:

- It matches the existing 384-dimensional embedding table shape.
- It supports multilingual similarity better than `local-hash-v1`.
- It can run locally and cache model artifacts.

What is stopping us:

- Nothing architectural.
- Download approval is granted.
- Implemented status:
  - `@huggingface/transformers` is installed.
  - `local-hash` and `transformers` embedding providers exist behind the same builder/retrieval interfaces.
  - the model artifact cache was verified with `OSE_MODEL_CACHE_DIR=/private/tmp/ose-model-cache`.
  - full ESCO occupation coverage was generated for `3045` rows.
  - query embeddings now use the same registered provider/model family as the stored dense vectors.

Target model key:

```text
hf-paraphrase-multilingual-minilm-l12-v2
```

Do not overwrite:

```text
local-hash-v1
```

Keep `local-hash-v1` as a deterministic smoke-test fallback.

Measured result:

```text
semantic_search_run_id=4
run_label=phase16-semantic-transformers-v1
model_key=hf-paraphrase-multilingual-minilm-l12-v2
embedding_rows=3045
dimensions=384
readiness_comparison=not_ready versus search_run_id=3
exact_leaf_hit_count_delta=0
miss_count_delta=0
pending_review_total_delta=0 after review rows were built for run 4
```

Architectural implication:

- Decision 1 is implemented as infrastructure.
- It is not yet a quality win by itself on the current 25-query smoke set.
- Next quality movement must come from expanded evaluation, channel calibration, better `dense_text`/query text strategy, and eventually OpenSearch hybrid lexical/vector retrieval.

### Decision 2. Expand Evaluation Immediately

Decision:

- Expand the seed evaluation set from 25 to at least 100 queries, then 200+.

What is stopping us:

- First expansion is implemented for `en,ro`.
- The first target size is implemented at `100` queries.
- Synthetic but realistic recruiter-style and skill/task queries are included.
- Explicit unresolved/negative expectations are not supported by the current expectation enum and require a later schema/reporting extension.

Recommended default:

```text
locales: en, ro
first expansion size: 100
source: generated from ESCO labels/aliases + hand-authored noisy patterns
expectations: exact_leaf, acceptable_leaf, family, group, unresolved
```

Implemented status:

```text
set_key: phase15-expanded-v1
owned_queries: 100
expectations: 100
seed_result_after_reset: 100 inserted, 0 reused
baseline_run_id: 5
baseline_run_label: phase15-expanded-local-hash-v1
```

Category distribution:

| Category | Count |
| --- | ---: |
| exact_english | 20 |
| english_alias | 10 |
| romanian_variant | 20 |
| diacritic_folded | 10 |
| noisy_recruiter | 15 |
| skill_enriched | 15 |
| ambiguous_generic | 3 |
| broad_family_group | 5 |
| fallback | 2 |

Architectural note:

- `phase8-core-v1` and `phase15-expanded-v1` coexist under the current schema through JSON ownership markers in `ose_evaluation_queries.notes`.
- The seeder now scopes query reuse by `source_name` and set key and uses binary query-text comparison so diacritic and folded variants do not collapse under MySQL collation.
- A future schema cleanup should add first-class `source_name`, `set_key`, `case_key`, and `category` columns instead of relying on JSON notes.

### Decision 3. Use OpenSearch For Calibrated Lexical Retrieval

Decision:

- Use OpenSearch for lexical/token/phrase retrieval rather than forcing MySQL to become a search engine.
- Use OpenSearch on port `9201`.
- Prefer OpenSearch for vector retrieval too if the cluster supports the needed vector mapping/search behavior cleanly.

Why:

- MySQL remains the canonical source of graph/search state.
- OpenSearch can handle BM25, phrase matching, fuzziness, analyzers, field boosts, and explainable text scores.
- Resolver can continue to merge evidence and enforce safety gates.

What is stopping us:

- No code in this repo currently indexes/searches OpenSearch.
- We need:
  - OpenSearch endpoint/env variables using port `9201`,
  - index naming convention,
  - mapping/analyzer decisions,
  - vector mapping decision,
  - bulk indexer,
  - retrieval adapter,
  - evaluation run comparing MySQL-only vs OpenSearch hybrid.

Default OpenSearch config:

```text
OPENSEARCH_NODE=http://localhost:9201
OPENSEARCH_USERNAME=
OPENSEARCH_PASSWORD=
OPENSEARCH_INDEX_OCCUPATIONS=ose_occupations_v1
OPENSEARCH_VECTOR_FIELD=dense_vector
```

## Target Search Architecture

```text
MySQL remains source of truth
  |
  |-- graph/search meta/evaluation/review/persistence
  |
  |-- embeddings table can store model metadata and optional vector copy
  |
  +--> OpenSearch index
        |
        |-- lexical fields:
        |     canonical_label
        |     aliases
        |     search_text
        |     capability_text
        |     ancestor_text
        |
        |-- dense vector field:
        |     dense_vector
        |
        |-- retrieval output:
              graph_node_id
              lexical score
              matched fields
              matched terms/phrases
              dense score

Application resolver
  |
  |-- merges:
  |     exact/folded aliases from MySQL
  |     lexical candidates from OpenSearch
  |     dense candidates from embedding backend
  |
  |-- expands hierarchy from MySQL
  |-- applies resolver safety gates
  |-- persists evaluation/search-run evidence
```

## Phase 15. Expanded Evaluation Set

Goal:

- Create a serious evaluation corpus before tuning the system further.

Deliverables:

- Expand `src/evaluation/seed-evaluation-set.ts` or add a second seed fixture module.
- Preserve current `phase8-core-v1` as a smoke set.
- Add new set key:

```text
phase15-expanded-v1
```

Recommended categories:

| Category | Count | Expectation style |
| --- | ---: | --- |
| Exact English labels | 20 | exact_leaf |
| English aliases/synonyms | 15 | exact_leaf or acceptable_leaf |
| Romanian labels/aliases | 20 | exact_leaf or acceptable_leaf |
| Diacritic/folded variants | 10 | exact_leaf |
| Noisy recruiter titles | 20 | exact_leaf or acceptable_leaf |
| Skill/task-enriched titles | 20 | exact_leaf or acceptable_leaf |
| Ambiguous generic queries | 10 | family/group/unresolved |
| Broad family/group queries | 10 | family/group |
| Negative/out-of-scope queries | 5 | unresolved |

Minimum first target:

```text
100 queries
```

Better target:

```text
150-200 queries
```

Implementation steps:

1. Add evaluation set fixture with category metadata in `notes`. Done.
2. Add CLI support for selecting set key if current support is insufficient. Already supported.
3. Seed `phase15-expanded-v1`. Done.
4. Run current baseline against the expanded set. Done: `search_run_id=5`.
5. Generate readiness report grouped by category. Done.

Success criteria:

- Evaluation seed is rerunnable.
- Expected nodes are resolved by labels/aliases/hierarchy pointers, not hard-coded IDs.
- Report can show hit/miss/unresolved by category. Done; `npm run evaluation:compare` now emits per-category summaries and candidate-minus-baseline category deltas in text and JSON output.

Expanded baseline summary:

```text
run_id=5
query_count=100
selected_count=71
unresolved_count=29
exact_leaf_hit_count=27
acceptable_hit_count=4
family_or_group_hit_count=1
miss_count=39
readiness_status=indeterminate
```

The expanded baseline is intentionally not a readiness claim because it has no comparable candidate run yet.

Expanded OpenSearch-hybrid candidate comparison:

```text
baseline_run_id=5
candidate_run_id=7
candidate_minus_baseline: selected_count=-2, unresolved_count=+2, exact_leaf_hit_count=-1, acceptable_hit_count=-1, family_or_group_hit_count=-1, miss_count=+1
readiness_status=not_ready
```

Category-level diagnosis:

- `exact_english`: exact_leaf_hit_count +1 and miss_count -2, but unresolved_count +1.
- `romanian_variant`: exact_leaf_hit_count -2 and miss_count +3 despite unresolved_count -1.
- `ambiguous_generic`: family_or_group_hit_count -1 and unresolved_count +2.
- `broad_family_group`: selected_count +1 and unresolved_count -1, but the new selection is a miss.
- `noisy_recruiter`: acceptable_hit_count -1 and unresolved_count +1.
- `diacritic_folded`, `english_alias`, `fallback`, and `skill_enriched` are unchanged versus the baseline.

Architectural implication:

- Treat Phase 15 tuning as category-directed. The OpenSearch lexical/dense path should not be promoted by a global score bump; the current evidence says the highest-leverage fixes are Romanian vector/lexical calibration, broad-family selection policy, and ambiguous-query abstention.

Tuned Phase 15 candidate:

```text
baseline_run_id=5
candidate_run_id=9
run_label=phase15-expanded-hybrid-lexical-override-v2
candidate_minus_baseline: selected_count=0, unresolved_count=0, exact_leaf_hit_count=+10, acceptable_hit_count=+2, family_or_group_hit_count=0, miss_count=-12
readiness_status=ready
```

Implemented resolver tuning:

- Strong exact/folded lexical leaf evidence can override branch dilution introduced by additional OpenSearch/dense competitors.
- Generic exact one-word leaf overrides require canonical-label equality with the folded query.
- Dense-only generic family fallback remains allowed for high-margin generic queries such as `developer`, but broad `role`, `roles`, `job`, and `jobs` queries abstain unless trusted lexical evidence exists.

Remaining Phase 15 risks:

- `romanian_variant` improved exact hits and unresolved count, but still has `miss_count=+1` versus baseline.
- `ambiguous_generic`, `fallback`, and `noisy_recruiter` trade some baseline selections for abstentions; this improves precision but should be revisited when the readiness rubric becomes more nuanced than the current conservative gate.
- `skill_enriched` remains entirely unresolved, so the next major quality gain depends on capability/task text retrieval rather than more resolver threshold tuning.

## Phase 16. Real Semantic Embeddings

Goal:

- Replace dense retrieval plumbing with real multilingual semantic vectors while preserving comparability.
- Store vectors in MySQL for auditability and optionally in OpenSearch for actual vector retrieval.

Dependency:

```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.3.0"
  }
}
```

Implementation steps:

1. Add dependency. Done.
2. Add semantic embedding provider module:

```text
src/embeddings/providers/transformers-provider.ts
```

3. Add model config constants. Done.

```text
model_key: hf-paraphrase-multilingual-minilm-l12-v2
model_name: Xenova/paraphrase-multilingual-MiniLM-L12-v2
dimensions: 384
provider: huggingface-transformers-js
```

4. Add a model cache policy. Done.

```text
Default: use Transformers.js local cache
Optional env: HF_HOME or OSE_MODEL_CACHE_DIR
Do not commit downloaded model artifacts unless explicitly decided.
```

5. Update embedding builder. Done.

```text
npm run embeddings:occupations -- --provider=transformers --model-key=hf-paraphrase-multilingual-minilm-l12-v2 --model-name=Xenova/paraphrase-multilingual-MiniLM-L12-v2 --dimensions=384 --cache-dir=/private/tmp/ose-model-cache
```

6. Keep `ose_embedding_models` as registry. Done.
7. Store generated vectors in `ose_node_embeddings` for audit/reproducibility. Done.
8. Add `--provider=local-hash|transformers` or infer provider from model key. Done.
9. Run embedding build on all 3045 occupations. Done.
10. Align query embedding provider with stored model provider. Done.
11. Add an OpenSearch vector indexing path for the same vectors. Done.
12. Run retrieval/evaluation with the new model key. Done on the expanded Phase 15 set.

Validation steps:

- Confirm `3045` rows for the new model.
- Confirm `3045` OpenSearch documents have `dense_vector` populated if vector indexing is enabled. Done.
- Sample nearest neighbors for known cases:
  - `software developer`
  - `data analyst`
  - `nurse`
  - `trefilator sarma`
  - `front desk receptionist hotel`
- Persist an evaluation run:

```text
run_label=phase16-expanded-transformers-hybrid-v2
search_run_id=11
```

Success criteria:

- Dense candidate quality improves versus `local-hash-v1`.
- Successful hits increase on expanded evaluation.
- Miss count does not increase.

Measured Phase 16 state:

```text
embedding_model_key=hf-paraphrase-multilingual-minilm-l12-v2
mysql_embedding_rows=3045
opensearch_documents=3045
opensearch_documents_with_dense_vector=3045
candidate_run_id=11
run_label=phase16-expanded-transformers-hybrid-v2
```

Compared with original expanded baseline run `5`:

```text
selected_count=-1
unresolved_count=+1
exact_leaf_hit_count=+10
acceptable_hit_count=+2
family_or_group_hit_count=0
miss_count=-13
readiness_status=not_ready under the current conservative unresolved gate
```

Compared with tuned Phase 15 hybrid run `9`:

```text
selected_count=-1
unresolved_count=+1
exact_leaf_hit_count=0
acceptable_hit_count=0
family_or_group_hit_count=0
miss_count=-1
```

Decision:

- Phase 16 real semantic embeddings are technically integrated, reproducible, and indexed in both MySQL and OpenSearch.
- Do not promote the Transformers semantic run over the Phase 15 tuned hybrid default yet. Run `11` is precision-improving versus run `9` only by converting the ambiguous `driver` miss into an abstention, but the current readiness rubric still treats the unresolved increase as a failure.
- The next refinement should be an abstention-aware readiness rubric and capability/task retrieval for `skill_enriched`, not further broad resolver loosening.

Risks:

- Transformers.js runtime may be slower than expected.
- First run needs model download.
- Model may not outperform lexical for short occupation titles unless `dense_text` is well formed.

## Phase 17. OpenSearch Lexical Retrieval

Goal:

- Move calibrated lexical retrieval and optional vector retrieval to OpenSearch while keeping MySQL canonical.
- Reframe retrieval as ranked graph-aware matching: return the closest 2-3 occupation leaves plus the best broader family/group branch.

Environment variables:

```text
OPENSEARCH_NODE=http://localhost:9201
OPENSEARCH_USERNAME=
OPENSEARCH_PASSWORD=
OPENSEARCH_INDEX_OCCUPATIONS=ose_occupations_v1
OPENSEARCH_VECTOR_FIELD=dense_vector
```

Index document shape:

```json
{
  "graph_node_id": 10837,
  "source_name": "esco_1_2_1",
  "node_level": "occupation",
  "canonical_label": "software developer",
  "normalized_label": "software developer",
  "locale_aliases": {
    "en": ["software developer", "..."],
    "ro": ["..."]
  },
  "search_text": "...",
  "dense_text": "...",
  "family_node_id": 7474,
  "family_label": "Software and applications developers and analysts",
  "group_node_id": 7476,
  "group_label": "Software developers",
  "generic_risk": "medium",
  "has_hierarchy": true,
  "has_capability_support": true,
  "capability_text": "...",
  "ancestor_text": "...",
  "quality_flags": []
  "dense_vector": [0.0123, -0.0456]
}
```

Mapping/analyzer requirements:

- exact keyword fields for normalized aliases,
- text fields with stemming/lowercase/asciifolding,
- phrase-capable fields for titles/aliases,
- `knn_vector` or equivalent vector field if supported by the cluster,
- field boosts:
  - canonical label highest,
  - local aliases high,
  - search text medium,
  - capability/ancestor text supporting only.

Implementation steps:

1. Add OpenSearch config/env handling and a small HTTP client. Done.
2. Add index builder:

```text
src/opensearch/occupations-index.ts
src/cli/create-opensearch-occupations-index.ts
npm run opensearch:create:occupations
```

Done.

3. Add chunked bulk population from canonical MySQL search meta:

```text
src/cli/populate-opensearch-occupations.ts
npm run opensearch:populate:occupations
```

Done.

Verified Decision 3A foundation:

```text
cluster: http://localhost:9201
opensearch_version: 3.7.0
index: ose_occupations_v1
template: ose_occupations_v1_template
docs.count: 3045
dense_vector_docs: 3045
bulk_failures: 0
vector_mapping: float array storage, not k-NN yet
```

4. Add lexical retriever. Done:

```text
src/retrieval/opensearch-occupation-retriever.ts
```

5. Add retrieval mode. Done, then simplified:

```text
The selectable `--lexical-backend=mysql|opensearch|hybrid` flag was removed after `hybrid` became the only supported runtime path. Current retrieval always combines exact/folded alias evidence with OpenSearch lexical evidence.
Runtime-facing types and CLI output now expose `retrieval_profile=occupation_hybrid_v1` instead of `lexical_backend`, because there is no longer a selectable backend.
```

6. Preserve evidence:

```json
{
  "channel": "opensearch_lexical",
  "score": 12.4,
  "matched_fields": ["canonical_label", "aliases.en"],
  "matched_terms": ["data", "analyst"]
}
```

7. Merge OpenSearch candidates by `graph_node_id` with existing MySQL exact/folded/dense candidates. Done.
8. If vector search is enabled in OpenSearch, add dense-vector retrieval mode. Pending:

```text
--dense-backend=mysql-json|opensearch
```

9. Run evaluation. Done for hybrid lexical integration:

```text
baseline_run_id=5
saturated_hybrid_run_id=6
relative_score_hybrid_run_id=7
run_label=phase15-expanded-hybrid-relative-os-v1
```

Measured result versus expanded baseline:

```text
candidate_minus_baseline:
selected_count=-2
unresolved_count=+2
exact_leaf_hit_count=-1
acceptable_hit_count=-1
family_or_group_hit_count=-1
miss_count=+1
readiness_status=not_ready
```

Decision:

- OpenSearch lexical retrieval integration is implemented and measurable.
- Current hybrid scoring is not accepted as a quality improvement.
- Proceed to Phase 18 calibration before using OpenSearch hybrid retrieval as the default.

Success criteria:

- Noisy recruiter/title cases improve.
- Exact alias cases do not regress.
- Generic broad queries do not become unsafe leaf selections.
- Top leaves include family/group context so callers can show both the occupation and the category it lives in.
- Broad family/category matches are considered valuable outputs, not just fallback implementation details.

Phase 17 structural tasks:

1. Add richer OpenSearch lexical evidence:
   - matched field class: canonical label, alias, search text, capability text, ancestor text
   - phrase versus token match classification
   - token coverage and useful-token coverage
   - query token count, matched token count, and generic-token count
   - Status: Phase 17A implemented for retrieval evidence. `opensearch_lexical` evidence now records `matched_tokens`, `phrase_match`, `field_signals`, `max_useful_token_coverage`, `query_token_count`, and `useful_query_token_count`.
2. Add `capability_task` evidence:
   - use `capability_text` and `ose_search_meta_capability_hints`
   - target `skill_enriched` and noisy recruiter queries
   - keep capability-only evidence below title/alias evidence unless graph and dense signals agree
   - Status: Phase 17C implemented for retrieval evidence. `capability_task` is now a first-class retrieval channel derived from OpenSearch `capability_text` field signals.
   - Guardrail: `capability_task` only emits when the query has at least two useful non-generic tokens, preventing broad single-concept queries such as `teacher` from being over-specialized into a narrow leaf/family.
3. Add ranked result internals:
   - top 2-3 leaf candidates after branch expansion
   - best broader family/group branch
   - supporting leaves inside that branch
   - branch score, branch margin, and evidence mix
   - Status: Phase 17D implemented as evidence-only resolver output and persisted run evidence.
4. Preserve backward compatibility:
   - continue writing current selected rows for existing readiness reports
   - also persist enough evidence JSON to reconstruct top leaves and broader branch ranking
   - Status: Phase 17D preserves selected rows and stores ranked evidence additively under `ranked_results`.
5. Run evaluation against run `9`:
   - exact-title cases must not regress
   - `skill_enriched` should show candidate/broader evidence even if not yet promoted
   - broad/generic cases should prefer correct broader branch over unsafe leaf

Phase 17A validation:

```text
retrieval_samples:
  evaluation_query_id=350 skill_enriched
  evaluation_query_id=340 noisy_recruiter
  evaluation_query_id=366 broad_family_group
build_status=passed
```

Observed structural signal:

- The evidence payload now makes weak lexical matches visible, for example generic-token matches such as `and` versus useful-token coverage.
- `skill_enriched` still needs scoring changes and capability/task evidence promotion; evidence enrichment alone is not a quality promotion.
- Next Phase 17 slice should use these field signals to downweight weak lexical matches and promote capability/task-aligned candidates when graph and dense evidence agree.

Phase 17B calibrated OpenSearch lexical scoring:

```text
run_label=phase17b-calibrated-os-lexical-v1
search_run_id=12
baseline_for_semantic_calibration=11
```

Implemented:

- OpenSearch raw BM25 remains preserved as `raw_score`.
- `normalized_raw_score` records query-relative BM25 normalization.
- `lexical_signal_score` downweights weak matches using:
  - useful-token coverage,
  - matched field class,
  - phrase-match boost.
- The effective `opensearch_lexical` score is now `normalized_raw_score * lexical_signal_score`.

Measured versus semantic run `11`:

```text
selected_count=0
unresolved_count=0
exact_leaf_hit_count=0
acceptable_hit_count=+1
family_or_group_hit_count=0
miss_count=-1
readiness_status=ready versus run 11
```

Changed query:

```text
evaluation_query_id=343
query="retail pharmacist dispensary patient counselling"
run11=selected_family:7431
run12=selected_leaf:9492
expectation=acceptable_leaf:9492
```

Decision:

- Phase 17B is accepted as a safe retrieval calibration improvement over run `11`.
- It is still not enough to replace the Phase 15 run `9` default under the current conservative readiness gate, because run `12` keeps the known ambiguous `driver` miss-to-unresolved tradeoff inherited from semantic run `11`.
- Next Phase 17 work should add first-class `capability_task` evidence and ranked broader-branch internals for `skill_enriched`.

Phase 17C first-class capability/task evidence:

```text
run_label=phase17c-capability-task-evidence-v2
search_run_id=14
baseline_for_phase17c=12
```

Implemented:

- Added `capability_task` as a first-class retrieval channel.
- Derived capability evidence from OpenSearch `capability_text` field signals.
- Weighted `capability_task` below title/alias lexical evidence and equal to dense evidence in candidate total score.
- Exposed `capability_task` scores in retrieval and branch-expansion CLI text/JSON output.
- Added non-useful token filtering for `end`, `month`, and `monthly` to avoid false capability matches from temporal phrases such as `month-end`.
- Required at least two useful query tokens before emitting `capability_task`, preventing broad single-token concepts from being over-promoted.

Measured versus Phase 17B run `12`:

```text
selected_count=0
unresolved_count=0
exact_leaf_hit_count=0
acceptable_hit_count=+1
family_or_group_hit_count=0
miss_count=-1
readiness_status=ready versus run 12
```

Changed query:

```text
evaluation_query_id=344
query="mechanical engineer CAD manufacturing NPI"
run12=selected_family:7399
run14=selected_leaf:9038
expectation=acceptable_leaf:9038
```

Measured versus stable run `9`:

```text
selected_count=-1
unresolved_count=+1
exact_leaf_hit_count=0
acceptable_hit_count=+2
family_or_group_hit_count=0
miss_count=-3
readiness_status=not_ready versus run 9 under the conservative gate
```

Decision:

- Phase 17C is accepted as a safe incremental improvement over run `12`.
- Phase 17C is not promoted as final default over run `9` because the conservative gate still penalizes the inherited selected-to-unresolved tradeoff, even though misses decrease.
- Next work should focus on ranked broader-branch internals and Phase 18 graph-aware calibration, not further ad hoc channel weighting.

Phase 17D ranked leaves and broader branch evidence:

```text
run_label=phase17d-ranked-leaves-branch-evidence-v1
search_run_id=15
baseline_for_phase17d=14
```

Implemented:

- Resolver output now includes a compact ranked answer view:
  - `ranked_results.top_leaves[]`
  - `ranked_results.best_broader_branch`
- Each top leaf includes:
  - leaf node id and label,
  - family/group branch context,
  - `retrieval_score`,
  - `resolver_score`,
  - evidence tier,
  - branch share and margin,
  - channel scores.
- The best broader branch includes:
  - branch id, label, kind, score, share, and margin,
  - evidence tier,
  - channel score mix,
  - top supporting leaves.
- Evaluation persistence stores the ranked view additively under:
  - `retrieval_sources_json.ranked_results`
  - `explanation_json.rank_summary.ranked_results`
- Readiness reporting now emits evidence-only ranked metrics without changing the conservative selected-outcome gate.

Measured versus Phase 17C run `14`:

```text
selected_count=0
unresolved_count=0
exact_leaf_hit_count=0
acceptable_hit_count=0
family_or_group_hit_count=0
miss_count=0
top3_leaf_hit_count=+75
best_broader_branch_hit_count=+1
ranked_evidence_queries=100
```

Decision:

- Phase 17D is accepted as an observability and product-shape improvement.
- It should not be interpreted as selection-quality promotion by itself.
- The key signal is that selected-outcome success remains 46/100 under the conservative gate, while top-3 leaf evidence reaches 75/100. Phase 18 should calibrate how and when ranked evidence becomes selectable output.

## Phase 18. Hybrid Retrieval Calibration

Goal:

- Combine exact alias, OpenSearch lexical, semantic dense retrieval, capability/task evidence, and graph branch evidence into calibrated ranked results.

Candidate channels:

```text
exact_alias
folded_alias
opensearch_lexical
semantic_dense
opensearch_vector
capability_task
graph_branch
```

Implementation steps:

1. Rename dense channel internally when using real embeddings:

```text
dense_embedding -> semantic_dense
```

or keep `dense_embedding` with provider/model details in evidence.

2. Add score normalization per channel.
3. Add branch-level evidence summaries by channel.
4. Add resolver thresholds by evidence tier:
   - exact alias,
   - strong lexical phrase,
   - weak lexical token overlap,
   - semantic dense,
   - mixed lexical+dense.
5. Persist channel details in search-run result JSON.
6. Add ranked-result fields:
   - top occupation leaves
   - best broader family/group
   - branch confidence
   - supporting leaves

Phase 18A calibrated hybrid lexical leaf promotion:

```text
run_label=phase18-calibrated-hybrid-lexical-leaf-v1
search_run_id=16
baseline_for_phase18a=15
```

Implemented:

- Added a conservative leaf-promotion gate after existing safe-leaf selection and before family/group fallback.
- Promotes exact/folded lexical leaves only when:
  - resolver score is strong enough,
  - retrieval score is strong enough,
  - leaf margin is at least `1.5`,
  - branch share and branch margin are strong,
  - branch has capability support,
  - candidate generic-risk penalty is bounded.
- Generic queries have a stricter exact-alias-only path requiring higher retrieval score, leaf margin, branch share, and branch margin.
- Dense-only and capability-only leaves are still evidence-only; they are not promoted to selected leaves in this slice.

Measured versus Phase 17D run `15`:

```text
selected_count=0
unresolved_count=0
exact_leaf_hit_count=+2
acceptable_hit_count=+1
family_or_group_hit_count=0
miss_count=-3
top3_leaf_hit_count=0
best_broader_branch_hit_count=0
readiness_status=ready versus run 15
```

Changed queries:

```text
evaluation_query_id=278
query="contabil"
run15=selected_family:7459
run16=selected_leaf:10794
expectation=exact_leaf:10794

evaluation_query_id=284
query="farmacist"
run15=selected_family:7431
run16=selected_leaf:9492
expectation=exact_leaf:9492

evaluation_query_id=286
query="licensed electrician for residential wiring"
run15=selected_family:7807
run16=selected_leaf:8850
expectation=acceptable_leaf:8850
```

Measured versus stable run `9`:

```text
selected_count=-1
unresolved_count=+1
exact_leaf_hit_count=+2
acceptable_hit_count=+3
family_or_group_hit_count=0
miss_count=-6
readiness_status=not_ready versus run 9 under the old conservative gate
```

Decision:

- Phase 18A is accepted as a safe hybrid calibration improvement over the ranked-evidence baseline.
- It should be treated as the current strongest selected-outcome run, but not as final 85% readiness.
- The next calibration work should target dense/capability/graph cases separately, especially `skill_enriched`, because dense-only promotion remains too risky without additional guards.

Phase 18B calibrated semantic/capability leaf promotion:

```text
run_label=phase18b-semantic-capability-leaf-v1
search_run_id=17
baseline_for_phase18b=16
```

Implemented:

- Added a dense-only semantic/capability promotion gate after lexical calibrated promotion and before family/group fallback.
- The gate is intentionally conservative:
  - non-generic queries only,
  - candidate must have `opensearch_lexical >= 0.65`,
  - candidate must have `capability_task >= 0.35`,
  - branch must have capability support,
  - dense-backed path requires dense embedding support plus branch/leaf separation,
  - lexical/capability-backed path without dense support requires higher leaf margin and sufficient branch share.
- The gate evaluates ranked retrieval strength, not resolver safety order, because semantic/capability evidence often identifies the closest leaf even when resolver safety scoring keeps another branch higher.

Measured versus Phase 18A run `16`:

```text
selected_count=+3
unresolved_count=-3
exact_leaf_hit_count=0
acceptable_hit_count=+3
family_or_group_hit_count=0
miss_count=0
readiness_status=ready versus run 16
```

Changed queries:

```text
evaluation_query_id=353
query="deploy cloud microservices and maintain CI CD pipelines"
run16=unresolved
run17=selected_leaf:9448
expectation=acceptable_leaf:9448

evaluation_query_id=358
query="dispense prescriptions and advise patients on medicines"
run16=unresolved
run17=selected_leaf:9492
expectation=acceptable_leaf:9492

evaluation_query_id=359
query="coordinate recruitment onboarding and employee relations"
run16=unresolved
run17=selected_leaf:10878
expectation=acceptable_leaf:10878
```

Measured versus stable run `9`:

```text
selected_count=+2
unresolved_count=-2
exact_leaf_hit_count=+2
acceptable_hit_count=+6
family_or_group_hit_count=0
miss_count=-6
readiness_status=ready versus run 9
```

Decision:

- Phase 18B is accepted as the current strongest selected-outcome calibration.
- It brings selected-outcome success to `52/100` and preserves ranked top-3 evidence at `75/100`.
- Remaining gap to the 85% target is primarily evaluation coverage and cautious promotion of dense/graph evidence, not lack of retrievable candidates.

Phase 18C ranked gap analysis:

```text
command=npm run evaluation:gap -- --search-run-id=17 --set-key=phase15-expanded-v1 --limit=50
search_run_id=17
```

Implemented:

- Added a read-only ranked gap diagnostic that classifies every evaluation query by selected outcome and ranked evidence.
- The report answers whether the expected leaf is already present in `ranked_results.top_leaves`, and at what rank.
- It separates clean promotion candidates from branch-only and risky retrieval gaps.
- It is intentionally diagnostic only; it does not change retrieval, resolver, evaluation, or review behavior.

Measured on run `17`:

```text
selected_success=52
selected_miss_top1_leaf_hit=12
selected_miss_top2_or_top3_leaf_hit=5
unresolved_top1_leaf_hit=6
unresolved_top2_or_top3_leaf_hit=1
selected_miss_no_top3_leaf_hit=4
unresolved_no_top3_leaf_hit=20
top1_leaf_hit_not_selected=18
top2_or_top3_leaf_hit_not_selected=6
best_branch_hit_without_top3_leaf_hit=0
```

Decision:

- The obvious clean remaining pattern is not more candidate generation for the whole set; it is conservative promotion of leaves that are already rank-1 or top-3 in ranked evidence.
- There are `24` non-selected queries where the expected leaf is already in top-3 ranked evidence, including `18` rank-1 cases.
- The risky/no-top-3 gaps are concentrated in ambiguous generic, broad family/group, fallback, and some skill-enriched cases. Those should not be solved by loosening leaf promotion alone.
- Next calibration should target rank-1 expected-leaf cases by evidence family:
  - exact/folded alias with strong OpenSearch support but weak margin,
  - dense-only Romanian/diacritic variants with strong OpenSearch label support,
  - skill-enriched dense/capability cases with weak absolute scores but correct top-ranked leaf.

Phase 18D centralized query preparation:

Implemented:

- Added `src/query/query-preparation.ts` as the single place for query normalization, folding, tokenization, useful-token filtering, generic-token policy, token expansion, and longest contiguous token matching.
- Resolver generic-shape checks, MySQL subphrase lexical rescue, OpenSearch useful-token scoring, and capability-task useful token extraction now consume the shared preparation logic.
- English singular/plural token equivalence is supported conservatively during longest-token matching.
- Locale guardrail: English generic role-tail suppression and English singular/plural expansion apply only to `locale=en`; Romanian, Hungarian, Estonian, and unknown locales do not inherit English lexical assumptions.
- The architecture now supports two duplicate token views:
  - normalized/unfolded tokens for exact language-sensitive matching,
  - folded tokens for diacritic-tolerant matching.
- Query preparation now removes conservative locale-profile function words from useful-token views for `en`, `ro`, `hu`, and `et`, while preserving the raw token list for diagnostics.
- Function words are intentionally separate from wrapper/noise phrases. For example, `people` is not a hard stop word; patterns such as `people who` should be handled later by span-level wrapper-noise logic.
- Query preparation preserves acronym surface tokens, for example `IT`, `HR`, `QA`, `UX`, so acronym handling can distinguish uppercase `IT` from lowercase pronoun `it`.
- Acronym tokens can remain useful even when their lowercase form would otherwise be a stop word.
- Query preparation now removes only safe job-level modifiers across supported locales, for example `senior`, `junior`, trainee/intern equivalents, and does not remove role-bearing terms such as `manager`, `head`, or `chief`.
- Query preparation now has locale-aware token variant expansion through `TOKEN_VARIANT_RULES_BY_LOCALE`.
- Token variants are additive and bounded; they do not replace the original token.
- English variants cover simple singular/plural forms.
- Romanian variants cover common plural and feminine/folded occupation forms such as `dezvoltatori -> dezvoltator` and `contabila -> contabil`.
- Hungarian and Estonian variants cover conservative common plural endings, for example final `k`, `ok/ek/ak/ök`, final `d`, and `id`.
- MySQL exact/folded alias lookup now consumes bounded short-query variant phrases, so aliases such as Romanian `analisti de date -> analist de date` can produce alias evidence.
- Query preparation now tracks locale-profile common title noise phrases separately from function words, for example English `looking for`, `apply as`, Romanian `cautam/căutăm`, Hungarian `keresünk`, and Estonian `otsime`.
- Common title noise is removed from useful token views but remains visible as `noiseTokens`.
- Query preparation now supports conservative compound splitting hooks, with Hungarian and Estonian parts first.
- Example Hungarian preparation: `szoftverfejlesztő` yields `szoftverfejlesztő`, `szoftver`, and `fejlesztő` useful tokens.
- Current HU/ET retrieval quality still depends on indexed locale aliases/OpenSearch locale coverage; the compound split is ready in preparation but does not by itself create missing locale data.

Decision:

- All future query preparation refinements should be added to `src/query/query-preparation.ts` first, then consumed by retrieval/resolution layers.
- Do not scatter new generic-token lists, stemming rules, or locale morphology inside retrievers.
- Next refinements can add locale-specific generic terms, stop words, acronym expansions, and morphology only when they are explicitly defined for that locale.

Phase 18D.1 acronym normalization and expansion update:

- Centralized text helpers in `src/utils/texts.ts`.
- Project-wide rule:
  - `normalizeSearchText` lowercases normal words but preserves acronym tokens.
  - `foldSearchText` strips diacritics but still preserves acronym tokens.
  - `foldSearchLookupText` lowercases everything only for OpenSearch/MySQL-style exact keyword lookup boundaries.
- Examples:
  - `HVAC engineer` -> normalized `HVAC engineer`, folded `HVAC engineer`, lookup `hvac engineer`.
  - `CNC machine operator` -> normalized/folded `CNC machine operator`, lookup `cnc machine operator`.
  - `bucătar șef` -> normalized `bucătar șef`, folded/lookup `bucatar sef`.
- Query preparation now has controlled English acronym expansion. Current expansion set:
  - `HVAC` -> `heating ventilation air conditioning`
  - `HVACR` -> `heating ventilation air conditioning refrigeration`
  - `AI` -> `artificial intelligence`
  - `UX` -> `user experience`
  - `UI` -> `user interface`
  - `QA` -> `quality assurance`
  - `HR` -> `human resources`
  - `IT` -> `information technology`
  - `CNC` -> `computer numerical control`
  - `CAD` -> `computer aided design`
- Expansion appends evidence tokens; it does not replace the acronym token.
- Acronym tokens are not plural-expanded.
- Leaf closeness treats an acronym token as represented when the candidate label contains all controlled expansion tokens.
- Leaf selection has a narrow controlled-acronym promotion rule:
  - query contains a known acronym,
  - the top family clears the family gate,
  - the top leaf has direct lexical evidence,
  - expanded useful-token coverage is complete,
  - the leaf confidence is at least the family confidence.
- This is a structural rule, not a decimal threshold tweak.
- OpenSearch alias/occupation population recomputes normalized aliases from original alias text so stale lowercase acronym values in MySQL do not leak into rebuilt indexes.

Validation after acronym update:

```text
npm run resolution:pipeline -- --query="HVAC technician" --locale=en --no-color

selected leaf:
heating, ventilation, air conditioning and refrigeration engineering technician
confidence: 60%
coverage: missing_terms=none
status: closest_available_match
```

```text
npm run evaluation:golden:pipeline
stable suite: 22/24
remaining failures unchanged:
- registered nurse: correct family, confidence threshold miss at 57% vs expected 60%
- chef: correct leaf/family, confidence threshold miss at 84% vs expected 85%

npm run evaluation:golden:pipeline:developing
developing suite: 34/51
improved case:
- HVAC technician now selects a leaf instead of family/unresolved.
remaining data/evaluator gap:
- developing expected target is refrigeration/air-conditioning mechanic under Electrical equipment installers and repairers, while current ESCO evidence selects the engineering technician leaf under Physical and engineering science technicians.
```

Phase 18E family-first pipeline prototype:

Implemented:

- Added `src/search-pipeline/occupation-search-pipeline.ts` as an additive V2 pipeline path.
- Added `npm run resolution:pipeline` for side-by-side testing without replacing the existing resolver.
- The pipeline uses a stable state shape with:
  - `candidateFamilies`
  - `candidateLeafs`
  - additive evidence records
- Current V2 stages:
  - accumulate current retrieval/graph evidence,
  - consolidate family evidence,
  - narrow leaves inside top families,
  - select leaf/family/unresolved decision.
- The first implementation reuses existing candidate retrieval and branch expansion rather than rewriting retrieval internals.

Compact architecture flow:

```text
raw query
-> prepareQuery
   - normalized text
   - folded text
   - preserved surface tokens
   - acronym tokens
   - locale-aware stop tokens
   - locale-aware common title noise tokens
   - locale-aware safe modifier tokens
   - locale-aware compound split tokens
   - locale-aware token variants
   - locale-aware useful tokens
   - locale-aware generic tokens
   - English-only singular/plural variants
-> existing retrieval adapter
   - exact alias
   - folded alias / useful-token subphrase
   - OpenSearch lexical
   - capability_task
   - dense embedding
-> graph branch expansion
   - attach each leaf to family/group/node branch
   - attach hierarchy, capability support, generic risk
-> V2 pipeline state
   candidateFamilies: Map<familyKey, familyEvidence>
   candidateLeafs: Map<graphNodeId, leafEvidence>
-> accumulate evidence
   - no stage decides alone
   - every stage adds evidence to leaf and family accumulators
-> consolidate families
   - rank families by branch concentration, evidence, supporting leaves, capability support, generic risk
-> narrow leaves inside top families
   - rank leaves only within trusted family branches
   - apply swappable leaf-closeness ranking
-> select decision
   - select exact/strong leaf if safe
   - otherwise select strong family/group
   - otherwise unresolved
```

Design intent:

- Family-first, leaf-second.
- Retrieval noise is allowed early; family agreement absorbs noise.
- Global leaf ranking is avoided for final answer because cross-family leaves can look strong from generic tails.
- A leaf should compete primarily against siblings inside a trusted family, not against every occupation globally.
- The broader result should be useful even when the exact leaf is uncertain.
- Modifier handling is a ranking concern, not an elimination concern. Specializations, seniority, domain qualifiers, and other title modifiers may still appear in the candidate list, but should not outrank a closer/general leaf unless the query asks for that modifier.
- Leaf ranking is behind a `LeafClosenessRanker` interface so it can be replaced by a better learned, locale-specific, or DB-backed ranker without rewriting retrieval or family consolidation.

Current state shape:

```text
PipelineState {
  preparedQuery
  candidateFamilies
  candidateLeafs
  rankedFamilies
  rankedLeaves
  decision
  stages
}

PipelineFamilyCandidate {
  familyKey
  familyKind
  familyNodeId
  familyLabel
  evidence[]
  supportingLeafIds
  branchShare
  branchMarginRatio
  confidence
}

PipelineLeafCandidate {
  graphNodeId
  canonicalLabel
  familyKey
  familyNodeId
  familyLabel
  genericRisk
  hasHierarchy
  hasCapabilitySupport
  evidence[]
  closeness
  confidence
}
```

Leaf closeness ranker contract:

```text
LeafClosenessRankerInput {
  preparedQuery
  canonicalLabel
}

LeafClosenessRank {
  score
  exactNormalizedLabel
  exactFoldedLabel
  usefulQueryCoverage
  titleExtraTokenRatio
  extraGenericModifierCount
  matchedUsefulTokens
  missingUsefulTokens
  extraTitleTokens
  extraGenericModifiers
}
```

Current token ranker behavior:

- Rewards candidate labels that cover all useful query tokens.
- Rewards exact normalized/folded title matches.
- Penalizes extra title tokens, especially generic occupation modifiers not present in the query.
- Keeps candidates in the list; it changes ranking and promotion safety, not retrieval membership.
- Example: for `registered nurse`, `specialist nurse` remains visible inside the nursing family but is not promoted as the selected leaf because `registered` is missing and `specialist` is an unrequested modifier.
- Example: for `senior data analyst`, `data analyst` is promotable because it covers the useful query tokens after query-side modifier handling and has no extra leaf specificity.

Family and leaf scoring refinements:

- Family ranking now separates exact alias evidence from softer lexical evidence.
- Exact alias evidence is bounded by branch leaf-fit, so a false-positive exact alias on a poor leaf does not dominate a better semantic branch.
- Family ranking now uses max leaf-fit from the same swappable `LeafClosenessRanker`; branch concentration still matters, but useful-token fit can break close family contests.
- Leaf ranking now subtracts extra canonical title specificity directly, so `front desk receptionist` prefers base `receptionist` over over-specific `front line medical receptionist`.
- Leaf tie-breaking now considers closeness score and extra title-token ratio before alphabetical order.
- Same-family leaf scoring no longer applies generic-risk penalty.
  - Rationale: once a family has been selected, a broader/encompassing canonical leaf is often safer than an over-specialized sibling.
  - Example: `Fullstack developer` now ranks `software developer` above `mobile application developer` inside `Software and applications developers and analysts`.
  - Generic risk remains available in family/branch scoring and audits; it should not distort sibling ordering inside an already plausible family.

Synonym fallback loop scaffold:

- The V2 pipeline now runs through bounded attempts rather than a single hard-coded pass.
- Attempt 1 is always the primary retrieval/pipeline path.
- Attempt 2 is reserved for synonym fallback and is limited to one attempt.
- The fallback gate opens only for unresolved decisions, weak family/group decisions below `55%`, or weak leaf confidence below the safe leaf threshold.
- The current synonym fallback planner is intentionally a no-op until DB-backed synonym selection is implemented.
- Debug output now reports attempts, for example `1:primary:used:leaf:92%` or `1:primary:used:unresolved:50% | 2:synonym_fallback:skipped:unresolved:50%`.
- Future synonym fallback should use alias DB longest-token matching, choose at most one synonym expansion, and keep synonym evidence lower authority than original and morphological variant evidence.

Evidence channels:

```text
exact_alias
folded_alias
opensearch_lexical
capability_task
dense_global
dense_folded        planned, state-supported but not a separate physical stage yet
dense_family_constrained
graph_support
```

Current stages:

```text
accumulate_current_retrieval_evidence
consolidate_families
recover_leaves_inside_top_families
narrow_leaves_within_families
select_decision
```

Important guardrails:

- Existing resolver remains intact.
- V2 is invoked explicitly via `npm run resolution:pipeline`.
- V2 currently reuses existing retrieval and graph expansion; it does not yet replace retrieval internals.
- English generic-token and singular/plural behavior must not leak into non-English locales.
- Strong family confidence must not automatically imply leaf selection.

Observed behavior:

```text
query="Fullstack developer"
selected=unresolved
top_family="Software and applications developers and analysts"#7474 confidence=38%
top_leaf_inside_family="software developer"#10837 confidence=21%
coverage=likely_dictionary_gap
leaf promotion=not selected because no leaf clears direct-evidence/safe-promotion gates
```

Current focused smoke check:

```text
command=npm run resolution:pipeline -- --query="Fullstack developer" --locale=en --debug --top-leaves-per-family=10

top_family="Software and applications developers and analysts"#7474 confidence=38%
top_leaf_inside_family="software developer"#10837 confidence=21%
family_dense_rank_1="software developer"#10837 cosine=0.249122
family_dense_rank_18="web developer"#10354 cosine=0.120099
```

Smoke-test assessment:

- Dense retrieval is not the `Fullstack developer` bottleneck: family-constrained dense correctly ranks `software developer` first.
- The remaining issue is decision calibration: the correct family and a sensible top leaf are visible, but confidence gates still choose unresolved.
- `web developer` is recovered inside the family but currently ranks lower by dense similarity; promoting it would require source-backed aliases, capabilities, reviewed enrichment, or a better semantic model, not a hardcoded runtime bridge.
- The next useful refinement category is the balance between lexical evidence, dense evidence, leaf selectability, and family fallback when a canonical leaf cannot safely represent every useful query token.

Pipeline golden suite:

```text
command=npm run evaluation:golden:pipeline
latest_result=21/24 passed
locales=en:9/12,ro:12/12
remaining_failures=Fullstack developer, registered nurse, short-form chef threshold
```

Covered query formats:

- `exact_title`: exact canonical title, for example `software developer`, `accountant`.
- `modifier_removed`: seniority/modifier query resolves to closest base occupation, for example `senior data analyst`.
- `generic_tail`: market title with generic tail returns safe family, for example `Fullstack developer`.
- `short_form`: short title prefers general leaf over specializations, for example `chef`.
- `synonym_alias`: synonym-style phrasing prefers closest base leaf, for example `front desk receptionist`.
- `descriptive`: descriptive query can select a broader family, for example `electrical wiring installer`.
- `broad_family`: broader/family-level answer is acceptable when leaf evidence is unsafe.
- `specialization_guard`: unrequested specialization does not get promoted, for example `registered nurse`.
- `multi_word_exact`: exact multi-token title remains stable, for example `primary school teacher`.
- `noisy_recruiter`: generic assistant/role wording preserves exact intent, for example `sales assistant`.
- `manager_title`: exact manager title prefers the management branch, for example `marketing manager`.
- `plural_variant`: singular/plural or gendered surface forms resolve through locale-aware token variants, for example `software developers`, `contabila`, `dezvoltatori software`.

Decision:

- This validates the family-first pattern: noisy leaf evidence can still converge into a strong broader family.
- The existing resolver remains intact while V2 is calibrated.
- Next work should compare V2 across the expanded evaluation set before replacing any production/evaluation path.

Known refinement opportunities:

- Extend `LeafClosenessRanker` to evaluate aliases, not only canonical labels.
- Move modifier vocabularies into DB/config records when they become locale-specific and large enough to maintain outside code.
- Prefer exact/common title leaves over specializations when the query is broad, while still showing specialization candidates lower in the list.
- Use alias role and alias weight more explicitly in leaf ranking.
- Split dense retrieval into separate physical stages:
  - dense original query,
  - dense folded query.
- Add locale-specific generic terms and morphology only after each locale is explicitly defined.
- Add a V2 evaluation runner before replacing persisted search-run behavior.
7. Add category-level readiness report.
8. Add graph-aware readiness metrics:
   - exact leaf hit
   - acceptable close leaf hit
   - correct broader branch hit
   - wrong branch miss
   - unsafe leaf miss
   - abstained uncertain
   - top-3 success

Success criteria:

- Expanded evaluation top-leaf or broader-branch success rate moves toward 85%.
- Miss count does not increase.
- Review debt decreases.
- Exact-title cases do not regress.
- The API/search response can return useful top occupations even when exact leaf confidence is not high enough for automatic promotion.

## Phase 19. Manual Review Promotion

Goal:

- Make review decisions affect future builds.

Implementation options:

### Option A. Add explicit reviewed override tables

Recommended.

Tables:

```text
ose_reviewed_alias_overrides
ose_reviewed_resolution_overrides
ose_reviewed_node_quality_overrides
```

### Option B. Encode approved decisions in existing queue payloads

Not recommended long-term.

Reason:

- Review queue is workflow state, not durable canonical search input.

Implementation steps:

1. Define review action types.
2. Add schema for approved overrides.
3. Add CLI to promote approved review rows.
4. Update graph/search-meta build to consume overrides.
5. Rebuild search meta.
6. Rebuild OpenSearch index.
7. Rerun evaluation.

Success criteria:

- Previously reviewed failures no longer reappear as pending review items.

## Phase 20. Runtime Search API

Goal:

- Provide an actual search interface for testing outside CLI output.

Implementation steps:

1. Define TypeScript response contract:

```ts
type OccupationSearchResponse = {
  query: string;
  locale: string;
  decisionType: 'leaf' | 'family' | 'group' | 'unresolved';
  selectedNode: null | {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
  };
  confidence: number;
  safetyScore: number;
  candidates: Array<{
    graphNodeId: number;
    canonicalLabel: string;
    score: number;
    evidence: unknown[];
  }>;
  explanationFacts: string[];
  unresolvedReason?: string;
};
```

2. Add service wrapper around resolver.
3. Add HTTP endpoint or package-level function.
4. Add contract tests.
5. Add sample requests.

Success criteria:

- Product/integration testing can call the same stable search interface repeatedly.

## Immediate Execution Order

## Phase 18 Leaf-Closeness Refinement Note

Status: implemented during hybrid calibration.

Purpose:

- Promote precise leaves when trusted local alias evidence exists.
- Keep family-level output when a local alias is genuinely ambiguous across near-tied leaves.
- Preserve the family-first safety model while improving multilingual leaf accuracy.

Implemented behavior:

1. Query preparation still strips safe modifiers/noise for useful-token matching, but exact alias retrieval now also searches the useful-token phrase.
   - Example: `senior data analyst` searches both the raw phrase and `data analyst`, preventing a weak/supporting modifier alias from dominating the base occupation.
2. Leaf closeness is scored against both canonical labels and matched local aliases.
   - Example: `contabil` can score `accountant` against the RO alias `contabil`, not only against the English canonical label.
3. Slash/comma/semicolon/pipe-delimited aliases are treated as alternative alias parts during retrieval.
   - Example: `recepționer/recepționeră` can produce folded alias evidence for the one-word query `recepționer`.
4. When multiple leaves share the same exact alias with effectively tied confidence, promotion is blocked unless the selected leaf is clearly more general by shorter canonical title.
   - Example: `front desk receptionist` can select `receptionist` over `front line medical receptionist`.
   - Example: `asistent social` stays at family because several social-work leaves share the same RO alias without a clearly safer leaf.
5. Golden expectations now distinguish safe RO leaf promotion from ambiguous family fallback.
   - Stable leaf promotions include `contabil -> accountant`, `analist de date -> data analyst`, `recepționer -> receptionist`, `farmacist -> pharmacist`, `bucătar șef -> chef`, `șofer de autobuz -> bus driver`, `inginer constructor -> civil engineer`.
   - Ambiguous fallback remains `asistent social -> Social and religious professionals`.

Validation:

```text
npm run evaluation:golden:pipeline
Historical checkpoint at this phase: Pipeline golden suite: 24/24 passed
locales=en:12/12,ro:12/12
```

Remaining refinement opportunity:

- `contabila` currently lands on the correct finance family at conservative confidence instead of promoting to `accountant`; this likely needs stronger Romanian feminine/diacritic alias normalization or reviewed alias enrichment.

## Developing Golden Suite

Status: implemented as a non-blocking edge-case suite.

Purpose:

- Track real but less common occupation titles separately from the stable regression suite.
- Keep the stable 24-case suite blocking and green.
- Give future refinement work a concrete target list, especially for locales where query preparation exists but local alias/search-meta coverage is missing.

How to run:

```text
npm run evaluation:golden:pipeline
npm run evaluation:golden:pipeline:developing
npm run evaluation:golden:pipeline -- --suite=all
```

Behavior:

- `suite=stable` is the default and remains blocking.
- `suite=developing` reports failures but does not create blocking failures by default.
- `--strict` can be used if developing failures should fail the command.

Current developing baseline:

```text
Pipeline golden suite: 10/21 passed
locales=en:5/6,ro:5/5,hu:0/5,et:0/5
blocking_failures=0
developing_failures=11
```

Developing case design:

- 6 English obscure/edge occupation titles.
- 5 Romanian obscure/edge occupation titles.
- 5 Hungarian target titles.
- 5 Estonian target titles.

Current interpretation:

- English and Romanian obscure titles are already strong: examples include `farrier`, `drone operator`, `beer sommelier`, `apicultor`, `pilot de dronă`, `îmbălsămător`, and `lăcătuș`.
- `Social Media Content Creator` is now tracked as a common English market-title failure. Current behavior is unresolved with social-work noise winning the top branch; target behavior is the `Sales, marketing and public relations professionals` family, with `online community manager` currently the most plausible ESCO leaf candidate.
- Hungarian and Estonian target cases currently fail because active search-meta aliases exist only for `en` and `ro`; these cases should remain as development targets for HU/ET alias ingestion, cross-locale canonical expansion, or translation-assisted retrieval.
- The HU/ET failures are not scoring-only failures; they expose missing locale evidence before ranking.

## Graph-Aware Pipeline Improvement TODO

Status: architectural opportunities identified; not yet implemented except family-first grouping and same-alias ambiguity handling.

Current gap:

- The graph is currently strongest after retrieval: leaves are retrieved globally, then grouped into family/group branches.
- We are not yet fully using the graph as an active retrieval structure.
- The highest-value next improvements should turn graph relationships into retrieval expansion, ambiguity control, and richer response terms.

Priority opportunities:

1. Branch-first constrained retrieval.
   - Use initial exact alias, lexical, dense, and OpenSearch signals to identify top candidate families/groups.
   - Run a second constrained pass inside those top branches.
   - Goal: if the right family is found, recover the closest leaf even when the global retriever did not rank that leaf high enough.
   - Status: first implementation added.
   - The pipeline now creates two query views:
     - global view: strips generic role terms such as `developer` to avoid false family direction.
     - family-scoped view: restores generic role terms after family selection because they become meaningful inside the selected family.
   - Example: `Fullstack developer`.
     - global view: `fullstack`.
     - family-scoped view: `fullstack developer`.
   - Top-family leaves are now recovered from `ose_search_meta` even if global retrieval missed them.
   - Recovered leaves are tagged with `graph_family_recovery`, not fake lexical evidence, so confidence remains conservative.
   - Family-constrained runtime retrieval now queries OpenSearch first with `family_node_id` as a filter.
   - OpenSearch family hits are attached as real `opensearch_lexical` evidence; MySQL graph recovery remains a fallback to keep leaves visible when OpenSearch has no hit.
   - Portable family-constrained dense retrieval is now added:
     - selected family IDs filter the MySQL vector rows,
     - query embedding uses the same registered embedding provider/model as global dense retrieval,
     - global dense evidence is attached as `dense_global`,
     - family-bounded sibling dense evidence is attached separately as `dense_family_constrained`,
     - this gives additive hybrid evidence without requiring OpenSearch kNN mapping yet.
   - Dense scoring is intentionally split:
     - `dense_global` is broad semantic recall and should help find candidate branches/families.
     - `dense_family_constrained` is bounded sibling comparison after a family is already in play.
     - Exact/phrase lexical evidence remains the highest-authority signal; dense contributes to ranking but should not override a clear lexical match.
   - No market-title bridge terms should be hardcoded in the ranker, e.g. no runtime rule such as `fullstack -> web/application/software`.
   - Result after first implementation: missing leaves such as `web developer` are recovered inside `Software and applications developers and analysts`; final ordering still needs source-backed aliases, semantic/vector search, or reviewed enrichment rather than hardcoded runtime bridges.
2. Sibling expansion as candidate recovery.
   - Use `ose_search_meta_siblings` to add same-family/same-group siblings of strong candidates into the candidate set.
   - Score these added siblings with the same leaf-closeness ranker.
   - Goal: avoid missing a better sibling leaf because only a related leaf was retrieved globally.
3. Ancestor-aware matching and fallback.
   - Score query overlap against parent, family, group, and broader labels.
   - If ancestor match is strong but leaf evidence is weak, confidently return the family/group instead of a random dense leaf.
4. General graph ambiguity detection.
   - Extend the current same-alias ambiguity guard into a broader rule.
   - If multiple leaves in the same branch have equivalent alias/query fit and no clearly safer general leaf exists, return family.
   - Goal: preserve useful broader answer when the graph says the query is under-specified.
5. Capability-aware disambiguation and response.
   - Use `ose_search_meta_capability_hints` more directly in scoring descriptive queries.
   - Return top capability canonical terms alongside leaf and family terms.
   - Goal: make the API useful not only for occupation normalization but also for explaining why a match was selected.
   - Status: implemented for first-pass sibling disambiguation.
   - Family-scoped leaf ranking now loads capability hint labels for recovered leaves.
   - Ranking is tiered, not a blended confidence boost:
     - `exact`
     - `alias_aligned`
     - `capability_aligned`
     - `semantic_aligned`
     - `lexical_related`
     - `weak`
   - Current conservative behavior: the tier affects top-leaf ordering/suggestions but does not inflate leaf confidence or force unsafe leaf promotion.
   - Hardcoded market bridge ordering was explicitly rejected and removed.
   - Capability fit is now computed separately from family-scoped title/alias fit:
     - `strong`: capability labels cover all family-scoped query terms.
     - `partial`: capability labels cover some family-scoped query terms.
     - `none`: no capability-label overlap.
   - Capability fit is used as sibling-ranking evidence inside an already narrowed family.
   - Capability fit can support `capability_aligned`, but it does not override exact/folded/phrase alias authority and does not by itself force unsafe leaf promotion.
6. Cross-locale graph bridging.
   - Status: partially implemented; keep open.
   - Completed: local locale aliases, enrichment aliases scoped by ESCO graph ownership, reviewed exact crosswalk bridge, graph branch selection, and exact compound-alias scoring.
   - Remaining: multilingual embedding bridge, translation-assisted canonical expansion, graph-aware ambiguous reviewed-alias disambiguation, and more source/manual aliases for terms with no usable evidence.
   - Flow target status:

```text
non-English input                                           [done]
-> prepare local query                                      [done]
-> try local aliases                                        [done]
-> bridge reviewed exact crosswalk aliases through graph     [done]
-> identify candidate family/group                          [done]
-> promote closest leaf when exact bridge evidence is safe   [done]
-> bridge via multilingual embeddings                        [not done]
-> bridge via translation-assisted canonical expansion       [not done]
-> disambiguate ambiguous reviewed aliases by graph context  [not done]
-> return local/English canonical occupation terms           [done for safe bridge cases]
```

7. Family/group dense vectors.
   - Build dense representations for family and group nodes, not only occupation leaves.
   - Use these for branch-first retrieval, especially vague, descriptive, or non-English queries.

Cross-locale graph bridging implementation note:

Status:

- Do not cross out the full cross-locale bridge item yet.
- The first safe bridge path is complete and validated.
- Remaining bridge paths should stay on the quality roadmap because they cover different failure modes.

- Search-meta alias loading now scopes aliases by ESCO graph-node ownership instead of alias source name.
  - This allows active O*NET/EURES crosswalk aliases to participate in search meta while preserving ESCO as canonical graph owner.
  - Source-scoped graph membership remains `ose_graph_node_sources.source_name='esco_1_2_1'`.
- EURES promotion supports an explicit reviewed bridge mode:

```bash
npm run import:eures:aliases:promote -- --include-reviewed-exact-bridge
```

- Reviewed bridge rule:
  - only `candidateMode='review'`,
  - only `skos:exactMatch`,
  - only aliases with exactly one exact target among reviewed candidates,
  - inserted as active graph aliases with `needs_review=1`,
  - exposed in search meta as lower-authority `reviewed_crosswalk`.
- Ambiguous exact aliases remain excluded from the bridge.
  - Example: Estonian `lukksepp` maps exactly to multiple occupations, so it remains unresolved/review-only.
- Leaf closeness now treats exact whole-alias equality as full useful-token coverage even when compound splitting adds sub-tokens.
  - This prevents exact aliases like Hungarian `szoftverfejlesztő` and Estonian `tarkvaraarendaja` from being under-scored because they were also split into component tokens.

Cross-locale bridge validation:

```text
historical stable golden suite at this phase: 24/24
developing golden suite: 14/21
HU developing: 2/5
ET developing: 2/5
```

Improved developing cases:

- `méhész` -> `bee breeder`
- `mesinik` -> `bee breeder`
- `szoftverfejlesztő` -> `software developer`
- `tarkvaraarendaja` -> `software developer`

Remaining bridge gaps:

- `adatelemző` and `andmeanalüütik`: no usable staged EURES alias found yet; likely needs additional source aliases, translation-assisted canonical expansion, or manual reviewed aliases.
- `lakatos` and `lukksepp`: ambiguous or mismatched local occupational meaning; needs reviewed graph-aware disambiguation rather than automatic promotion.
- `drónpilóta` and `droonipiloot`: no usable EURES evidence yet; likely needs alias import expansion or translation-assisted bridge.

## O*NET ESCO Alias Enrichment Setup

Status: staged candidate importer added; conservative generated-candidate promotion command added.

Architectural decision:

- ESCO remains the canonical occupation graph and source of canonical terms.
- O*NET is used only as an English alias enrichment source through the official ESCO-to-O*NET-SOC crosswalk plus O*NET job-title datasets.
- O*NET aliases must pass through staging/review before they can become active graph aliases.

Implemented flow:

```text
download O*NET ESCO crosswalk + Job Titles + Reported Titles
-> parse XLSX files locally
-> match O*NET-SOC rows to ESCO occupation graph nodes through ESCO codes
-> normalize candidate English aliases
-> classify each candidate as generate, review, or exclude
-> write durable JSON report under artifacts/enrichment/onet
-> store latest summary/sample artifact in ose_build_artifacts
```

Candidate safeguards:

- Generic one-word aliases such as `creator`, `developer`, `operator`, and `specialist` are excluded.
- Existing alias conflicts are routed to review, not promoted.
- O*NET codes mapping to multiple ESCO targets are routed to review.
- Broad O*NET "All Other" titles are excluded.
- Exact duplicates of canonical labels or already-present aliases are excluded.

Current command:

```bash
npm run import:onet:aliases
```

Promotion command:

```bash
npm run import:onet:aliases:promote -- --dry-run
npm run import:onet:aliases:promote
```

Promotion policy:

- Only `candidateMode='generate'` records are eligible.
- Default minimum confidence is `0.9`.
- Review records are never promoted by this command.
- Promotion inserts into `ose_graph_aliases` with `alias_class='crosswalk'`, `source_name='onet_esco_bridge'`, `needs_review=0`.

Review backlog policy:

- Review cases remain in the durable JSON report and can be revisited later.
- The review set is intentionally large because many O*NET-SOC titles crosswalk to multiple ESCO occupations.
- The right future treatment for review cases is graph-aware branch/family selection, not blind alias insertion.

First promotion result:

```text
report=artifacts/enrichment/onet/onet-esco-alias-candidates-report.json
generate=2283
review=538530
exclude=64119
eligible_at_min_confidence_0.9=835
inserted=664
skipped_existing=171
```

Post-promotion validation:

```text
historical stable golden suite at this phase: 24/24
developing golden suite: 10/21
```

Observed limitation:

- `Social Media Content Creator` is still unresolved and incorrectly led by the `Social and religious professionals` family.
- O*NET does contain `Content Creator`, `Digital Content Creator`, and `Social Media Manager` evidence, but those are review cases because they crosswalk to multiple ESCO targets.
- This confirms the next improvement should use graph-aware branch selection for review aliases, especially multi-target market titles, rather than lowering the promotion threshold.

## Automated Alias Review Setup

Status: first read-only CSV workflow implemented.

Architectural decision:

- Keep raw candidate import, generated-candidate promotion, automated review, manual review, and final apply steps separate.
- Do not hide reviewed O*NET/EURES policy inside the normal `import:*:aliases:promote` commands.
- Generated candidates remain the only rows promoted by the existing O*NET promotion command.
- Reviewed candidates are first converted into auditable CSV decisions before any apply step is added.

Current command:

```bash
npm run review:aliases:auto
```

Outputs:

```text
artifacts/enrichment/review/automated-review-decisions.csv
artifacts/enrichment/review/manual-review-queue.csv
```

Implemented automated decision rules:

- `reject_already_covered`: all rows are already canonical labels or existing aliases.
- `reject_excluded_noise`: all rows were excluded by importer safety rules.
- `reject_no_family_evidence`: candidate rows have no resolvable active ESCO family; reject for now because vector-assisted rescue is needed before these can be trusted.
- `reject_onet_single_token_high_fanout`: analysis-only classifier for one-token O*NET aliases that appear across at least 10 candidate targets; do not apply this class without explicit approval because some one-token aliases can still be useful.
- `eures_review_exact_unique_leaf`: reviewed EURES rows contain exactly one high-confidence `skos:exactMatch` target.
- `eures_review_single_family_support`: reviewed EURES rows where all graph-backed targets resolve to exactly one ESCO family; these aliases are family-supporting evidence only, including weak mappings and one-target rows.
- `eures_review_two_family_dominant_support`: reviewed EURES rows where graph-backed targets resolve to exactly two ESCO families and at least 70% of those targets lean to one family; these aliases are family-supporting evidence only.
- `review_unique_leaf`: reserved for reviewed rows with one unique high-authority leaf; currently tight enough that weak EURES single-target rows do not pass.
- `review_dominant_family_lexical_leaf`: one ESCO family dominates first, then one leaf inside that family has at least 70% alias unigram coverage, compatible role/head tokens, meaningful non-generic token overlap, no unseen target-specific modifier, and no tied lexical leaf.
- `review_dominant_leaf_within_family`: one ESCO family dominates, one leaf dominates inside that family, and the alias shares a non-generic domain token with the leaf canonical label.
- `review_dominant_family`: one ESCO family dominates reviewed targets with `top_family_count >= 5` and at least `3x` the second family.
- `review_multi_target_family_support`: O*NET multi-target rows where no safe leaf is selected, but at least 70% of usable candidate targets resolve to one ESCO family; these aliases are family-supporting evidence only.
- `review_single_family_support`: O*NET multi-target rows where all graph-backed reviewed targets resolve to exactly one ESCO family, including one-token rows and cases blocked from leaf promotion by alias conflicts; these aliases are family-supporting evidence only. A small explicit skip list keeps unclear acronyms/abbreviations manual.
- `review_two_family_dominant_support`: O*NET multi-target rows where graph-backed reviewed targets resolve to exactly two ESCO families and at least 70% of those targets lean to one family; these aliases are family-supporting evidence only.

Current first-pass result:

```text
groups_reviewed=57961
automated_decisions=28086
manual_queue_items=29875
rule.eures_review_exact_unique_leaf=273
rule.eures_review_single_family_support=2353
rule.eures_review_two_family_dominant_support=156
rule.reject_already_covered=209
rule.reject_excluded_noise=6830
rule.reject_no_family_evidence=5
rule.reject_onet_single_token_high_fanout=1988
rule.review_dominant_family=13158
rule.review_dominant_family_lexical_leaf=42
rule.review_dominant_leaf_within_family=2
rule.review_multi_target_family_support=2251
rule.review_single_family_support=349
rule.review_two_family_dominant_support=470
```

Important caution:

- `review_dominant_family` is useful for reducing manual review and identifying family-level rescue opportunities, but it should not be blindly applied yet.
- Examples such as `full stack developer` look correct as family bridges, while some broad EURES category labels need policy review before insertion into runtime aliases.
- EURES family-support decisions are intentionally separated from O*NET rule IDs. They can materially help RO/HU/ET family matching, but because many are weak mappings or one-target rows, they should remain reviewable and family-only until an apply policy is approved.
- Candidate groups with no resolvable active ESCO family are rejected for now. They can be revisited only after vector-assisted family rescue exists.
- Current EURES manual queue after family-support and no-family rejection rules: total = 3,504; zero-family = 0, one-family = 3,229, two-family = 213, three-or-more-family = 62.
- Multi-target O*NET aliases often represent a capability or consumed modifier. The safe pattern is family-first: use multi-target evidence to select the dominant ESCO family, then only promote a leaf when a unique same-family leaf has strong lexical coverage and compatible role/head tokens.
- Family-supporting aliases are a safe intermediate value: for example, `x-ray nurse` should strengthen the Nursing and midwifery professionals family even when we cannot yet choose between specialist nurse, advanced nurse practitioner, or nurse responsible for general care.
- After adding single-family support and the explicit acronym/abbreviation skip list, only 9 manual O*NET multi-target rows remain where all listed candidate families collapse to one family: `a&p instructor`, `c-swhc`, `ccrn`, `e & i technician`, `leot`, `licsw`, `lisw`, `ocns`, and `r&d engineer`.
- After adding two-family dominant support, remaining manual O*NET multi-target buckets are: one family = 9 skipped acronym/abbreviation rows, two families = 3,205 rows, three or more families = 21,432 rows.
- CSV `candidate_families` summarizes all candidate rows. The two-family support rule uses graph-backed reviewed rows only, so a decision row may display more than two candidate families while the rule evidence still says "across two families".
- The 3+ family majority variant was tested and reverted for safety. It found additional plausible family signals, but broad generic titles such as `area manager` make it too risky for current automated review.
- Applied family-support aliases must remain distinguishable from leaf aliases after search-meta propagation. Search-meta now stores propagated family aliases with alias role `family_supporting`, indexes them in `family_supporting_aliases_text`, and excludes them from MySQL exact/folded leaf alias lookup and combined OpenSearch alias text. This lets aliases such as `full stack developer` support the software family without giving every software leaf exact alias evidence.
- Future leaf resolution for these family-supporting aliases should use a reusable candidate-selection tool: provide the alias as the needle, constrain the haystack to the dominant family leaves, compare with dense/lexical/capability evidence, and keep the alias family-only if no leaf clears the threshold.
- Examples like `vocational teacher` and translated equivalents can identify the teaching family, but they must not be forced into one specialized teaching leaf when multiple same-family leaves match.
- `review_dominant_leaf_within_family` is intentionally very conservative. Early broad role-token matches such as `manager`, `engineer`, and `operator` were excluded because they promoted unsafe leaves like `fleet manager -> road operations manager`.
- `risk manager -> corporate risk manager` is explicitly held out of leaf auto-promotion because the alias is broader than the ESCO leaf. It can remain family-level/manual until a better canonical treatment exists.
- The next step is an apply script that can apply only approved rule classes, likely starting with `reject_already_covered`, `reject_excluded_noise`, `eures_review_exact_unique_leaf`, and the small conservative leaf-promotion sets, while keeping dominant-family and analysis-only decisions reviewable.

## EURES ESCO Alias Enrichment Setup

Status: staged candidate importer added; conservative generated-candidate promotion command added.

Architectural decision:

- ESCO remains the canonical graph.
- EURES country mappings are used as locale alias enrichment for RO/HU/ET through ESCO occupation URIs.
- EURES aliases must pass through staging/review before becoming active graph aliases.

Implemented flow:

```text
download EURES country occupation mapping CSVs for EE/HU/RO
-> parse mapping rows
-> match Classification 1 ESCO occupation URI to existing ESCO graph node
-> split national labels on commas outside parentheses
-> normalize locale alias
-> classify each candidate as generate, review, or exclude
-> write durable JSON report under artifacts/enrichment/eures
-> store latest summary/sample artifact in ose_build_artifacts
```

Current commands:

```bash
npm run import:eures:aliases
npm run import:eures:aliases:promote -- --dry-run
npm run import:eures:aliases:promote
```

First staging result:

```text
report=artifacts/enrichment/eures/eures-esco-alias-candidates-report.json
mapping_rows=15089
unique_aliases=18524
generate=3233
review=12807
exclude=2484
```

First promotion result:

```text
eligible_at_min_confidence_0.9=867
inserted=743
skipped_existing=124
```

Post-promotion validation:

```text
historical stable golden suite at this phase: 24/24
developing golden suite: 10/21
```

Observed limitation:

- The conservative EURES batch did not improve HU/ET developing cases yet.
- The likely next issue is not only missing aliases, but graph-aware use of reviewed/conflicting EURES mappings plus better local compound/token normalization for target terms such as `szoftverfejlesztő`, `adatelemző`, `tarkvaraarendaja`, and `andmeanalüütik`.

## Search Meta Rebuild Safety Guard

Status: implemented.

Problem:

- `ose_search_meta` is per graph node, not per locale.
- Running `build-occupation-search-meta --locales=en` with reset deletes the full occupation search-meta slice and rebuilds only English aliases.
- This temporarily removes RO/HU/ET searchable alias coverage and can create false regressions.

Implemented guard:

- Reset plus explicit `--locales=...` is now refused.
- Full rebuild remains:

```bash
npm run search-meta:occupations
```

- Partial-locale rebuild is allowed only with `--skip-reset` for diagnostics/append-only experiments.

## Quality TODO: Alias Enrichment And Search Meta

Priority items:

1. Preserve the search-meta rebuild guard.
   - Do not re-enable reset plus explicit `--locales=...`.
   - Treat full all-locale rebuild as the only safe production rebuild path.
2. Keep O*NET and EURES review reports durable.
   - O*NET report: `artifacts/enrichment/onet/onet-esco-alias-candidates-report.json`.
   - EURES report: `artifacts/enrichment/eures/eures-esco-alias-candidates-report.json`.
   - Review cases are backlog data, not discarded failures.
3. Build graph-aware reviewed-alias selection.
   - Needed for multi-target O*NET/EURES aliases where blind promotion is unsafe.
   - Key example: `Social Media Content Creator` should use reviewed `Content Creator` / `Social Media Manager` evidence to prefer the sales/marketing/public-relations branch over social-work noise.
   - Longest phrase scoring correction is implemented: multi-token subphrase alias matches now outrank single-token matches even when the single-token alias is primary.
   - Remaining issue for `Social Media Content Creator`: branch aggregation still lets many weak one-token social-work matches outweigh fewer stronger marketing/media candidates.
4. Improve HU/ET after EURES import.
   - Cross-locale bridge lifted HU/ET developing coverage from `0/10` to `4/10`.
   - Next work should focus on the remaining terms that lack usable source aliases or are genuinely ambiguous.
5. Strengthen compound/token preparation for HU/ET.
   - Target examples: `szoftverfejlesztő`, `adatelemző`, `tarkvaraarendaja`, `andmeanalüütik`.
   - Exact whole-alias equality is now scored correctly even when compound splitting adds sub-tokens.
   - Remaining goal is to recover useful tokens or bridge aliases for terms that are still absent from staged evidence.
6. Re-run required validation after any alias promotion.
   - `npm run search-meta:occupations`
   - `npm run evaluation:golden:pipeline`
   - `npm run evaluation:golden:pipeline:developing`

Next decision:

- Review the impact of promoted generated aliases on golden/developing tests, then decide whether to design a graph-aware selector for review cases such as `Content Creator`.

API direction:

- Public API should hide experimental retrieval details such as `lexical_backend`.
- Public shape should be simple:

```ts
getCanonicalTerm({
  input: 'senior data analyst',
  locale: 'en'
})
```

- Response should include:
  - top leaf canonical occupation terms with confidence,
  - top family/group canonical terms with confidence,
  - top capability canonical terms with confidence.
  - coverage status summary:
    - `exact_canonical_match`: query matched an available canonical occupation leaf exactly.
    - `closest_available_match`: graph has a plausible closest canonical match, but not an exact canonical occupation match.
    - `likely_dictionary_gap`: broader/closest match exists, but the best leaf does not represent all useful query terms.
    - `insufficient_evidence`: no reliable family or leaf candidate was found.
  - Coverage status should expose useful signals such as top leaf, top family, matched label, matched useful tokens, and missing useful tokens.
- The public CLI/API no longer accepts `--lexical-backend`; the combined lexical path is the single supported runtime path. Runtime-facing output now uses `retrieval_profile=occupation_hybrid_v1`. Historical persisted configs may retain `legacy_lexical_backend=hybrid` only for backward comparability.

Recommended order from here:

1. **Phase 15A: Expand evaluation set to 100 queries.**
2. **Phase 16A: Add Transformers.js embedding provider and model cache.**
3. **Phase 16B: Generate semantic embeddings and run `phase16-semantic-v1`.**
4. **Phase 17A: Add OpenSearch indexing from `ose_search_meta`.**
5. **Phase 17B: Add OpenSearch lexical retrieval mode and run `phase17-opensearch-lexical-v1`.**
6. **Phase 18: Calibrate hybrid scoring and resolver gates using expanded evaluation.**
7. **Phase 19: Promote manual review decisions into durable override inputs.**
8. **Phase 20: Add runtime search API contract.**

## What I Need To Start

Minimum decisions needed:

1. Confirm locales for expanded evaluation:

```text
Recommended: en, ro
```

2. Confirm first expanded evaluation size:

```text
Recommended: 100
```

3. Confirm synthetic realistic query generation is acceptable:

```text
Recommended: yes, but category-labeled and expectation-resolved from graph/search-meta.
```

4. Confirm model dependency:

```text
@huggingface/transformers
model: Xenova/paraphrase-multilingual-MiniLM-L12-v2
model key: hf-paraphrase-multilingual-minilm-l12-v2
```

Status: confirmed; download approval granted.

5. Confirm model cache policy:

```text
Recommended: local cache outside git; do not commit model artifacts.
```

6. Provide or confirm OpenSearch connection:

```text
OPENSEARCH_NODE=http://localhost:9201
OPENSEARCH_USERNAME=
OPENSEARCH_PASSWORD=
OPENSEARCH_INDEX_OCCUPATIONS=ose_occupations_v1
OPENSEARCH_VECTOR_FIELD=dense_vector
```

Status: cluster port confirmed as `9201`; credentials still need to be provided if required.

If these are confirmed, implementation can proceed without more architectural debate.

## OpenSearch As Lexical Control Layer

Status: initial implementation started; authority-tiered retrieval adopted.

Architectural decision:

- MySQL remains the canonical source of truth for ESCO graph nodes, aliases, source provenance, review flags, family/group relationships, capabilities, and rebuildable search metadata.
- OpenSearch should become the primary lexical retrieval and lexical scoring control surface.
- The pipeline remains the final graph-aware decision layer: it groups retrieved leaves by family/group, scores branch quality, narrows leaves inside the selected branch, and applies selection gates.

Implemented refinement:

- OpenSearch occupation documents now carry role-separated alias fields in addition to the legacy flattened `aliases_text` field:
  - `locale_primary_aliases_text`
  - `locale_supporting_aliases_text`
  - `reviewed_crosswalk_aliases_text`
  - `english_backbone_aliases_text`
- OpenSearch retrieval now queries role-separated aliases with explicit boosts:
  - phrase query first,
  - best-fields query second,
  - lower-weight fuzzy query for typo tolerance.
- OpenSearch retrieval now uses authority-tiered `dis_max` clauses with constant scores instead of relying on opaque BM25 score accumulation.
  - Tier `1000`: prepared useful query phrase in `locale_primary_aliases_text`.
  - Tier `900`: prepared useful query phrase in `canonical_label`.
  - Tier `800`: prepared useful query phrase in `locale_supporting_aliases_text`.
  - Tier `700`: prepared useful query phrase in `reviewed_crosswalk_aliases_text`.
  - Tier `600`: prepared useful query phrase in `english_backbone_aliases_text`.
  - Tier `500`: raw query phrase in primary/canonical fields.
  - Tier `400`: raw query phrase in supporting/reviewed/backbone fields.
  - Tier `250`: prepared all-term non-phrase match.
  - Tier `80`: strict fuzzy typo fallback.
  - Tier `60`: raw all-term broad fallback.
- Prepared useful query phrase matching now uses contiguous phrase windows, longest-first, instead of only the full prepared query.
  - Example query: `social media content creator`.
  - Generated windows include `social media content creator`, `social media content`, `media content creator`, `social media`, `media content`, and `content creator`.
  - Single-token windows are not promoted into the phrase-authority tiers for multi-token queries.
- Phrase-window authority is length-aware inside the same alias role:
  - each phrase token adds `+10` authority points,
  - the bonus is capped at `+90`,
  - the cap preserves role order, so a long supporting phrase cannot outrank a primary alias phrase.
  - Example: a two-token supporting alias phrase scores `820`, while a three-token supporting alias phrase scores `830`.
- This makes OpenSearch candidate ordering explicit and predictable:
  - a supporting raw/decorated alias cannot outrank a primary prepared-title match,
  - fuzzy evidence cannot outrank exact/phrase evidence,
  - longer phrase windows outrank shorter phrase windows inside the same alias role,
  - broad all-term matches remain recall-only evidence.
- OpenSearch field signals now expose alias-role metadata in debug/evidence output.
- Retrieval CLI output now exposes OpenSearch `matched_queries`, making the matched phrase-window tier auditable from text output.
- Existing indices receive mapping updates during create/populate; strict dynamic mapping no longer requires a full index recreation for these additive fields.
- OpenSearch was repopulated successfully with `3045` occupation documents and vectors.

Validation notes:

- `Social Media Content Creator` now routes to the correct broader family under `hybrid`:
  - top family: `Sales, marketing and public relations professionals`
  - top leaf: `online community manager`
  - previous incorrect family: `Social and religious professionals`
- Candidate retrieval for that query is now leaf-correct before graph decision:
  - `online community manager` and `digital marketing manager` rank above social-worker leaves.
- Remaining issue is calibration, not alias availability:
  - candidates sharing the same phrase-window authority still need a structural role-fit discriminator.
  - example: `online community manager`, `digital marketing manager`, `online marketer`, and `communication manager` can all match the `social media` window; final selection needs graph/capability/leaf-fit evidence to distinguish them.
  - OpenSearch fuzziness can over-recall unrelated documents, e.g. `registered nurse` temporarily favored unrelated health titles under `hybrid`.
- Conservative phrase-window family fallback is implemented:
  - if the top leaf in the top family has prepared multi-token phrase-window evidence,
  - and the leaf itself does not clear safe leaf-promotion gates,
  - return the broader family instead of unresolved.
  - This is a gate, not a score boost; confidence is not inflated.
  - Example: `Social Media Content Creator` now returns family `Sales, marketing and public relations professionals` at `38%`, with `online community manager` as the top leaf inside that family.
- Fuzziness was tightened after validation:
  - fuzzy clause now requires `operator: and`,
  - edit distance is capped at `1`,
  - prefix length is `3`,
  - expansions are capped at `8`.
- Short two-token non-phrase matches are capped as weak lexical evidence.
  - This prevents scattered-token matches such as `registered` + `nurse` from outranking the intended occupation family.
- English credential/status modifiers now include `registered`, `licensed`, and `certified`.
  - Example: `registered nurse` prepares as useful token `nurse`, which correctly returns the `Nursing and midwifery professionals` family instead of promoting a specialist leaf.
- Example authority correction:
  - `senior data analyst` prepares as `data analyst`.
  - `data analyst` receives OpenSearch authority tier `1000` from a primary prepared-title match.
  - `call centre analyst` receives tier `800` from a supporting alias match.
  - The pipeline now selects `data analyst` instead of being surprised by OpenSearch raw score.
- Current hybrid stable validation after authority-tiered `dis_max`:
  - `20/24` passing after phrase-window authority implementation.
  - Historical remaining failures at this point included `Fullstack developer`, `registered nurse`, `electrical wiring installer`, and `ro-feminine-contabila`.
  - Later leaf evidence-tier gating resolved `electrical wiring installer` by returning the broader family instead of over-promoting `electrician`.

End-of-day status after family-constrained dense and same-family leaf cleanup:

- Hybrid stable validation remains `20/24`; no pass/fail regression was introduced by removing same-family generic-risk leaf penalty.
- Runtime dense vectors are now exportable to local manifest + metadata JSONL + binary sidecar artifacts.
  - Command: `npm run embeddings:export-runtime`.
  - Default model is now `hf-paraphrase-multilingual-minilm-l12-v2`; `local-hash-v1` is explicit smoke-test only.
  - Default manifest: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.manifest.json`.
  - Default metadata: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.metadata.jsonl`.
  - Default vectors: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.vectors.f32`.
  - Global dense and family-constrained dense retrieval require these files; there is no MySQL vector fallback in runtime retrieval.
  - Startup guard: `npm run runtime:check`.
  - MySQL remains the source-of-truth/rebuild store for embeddings.
  - Runtime is now moving toward `OpenSearch + local files`; graph/search-meta/alias/capability metadata still needs a separate runtime export before MySQL can be removed from query-time entirely.
- Next runtime artifact scope: graph/search-meta.
  - Status: binary export, startup validation, branch expansion, accessor-backed details, and family leaf recovery integration added.
  - Command: `npm run search-meta:export-runtime`.
  - DB-backed rebuild command: `npm run runtime:artifacts-rebuild-db`.
  - Default manifest: `artifacts/runtime/occupation-search-meta.esco_1_2_1.manifest.json`.
  - Default binary tables: `artifacts/runtime/occupation-search-meta.esco_1_2_1.*.bin`.
  - Default range indexes: `artifacts/runtime/occupation-search-meta.esco_1_2_1.*.idx`.
  - Current export count: `3045` occupation search-meta records.
  - Current binary search-meta size is about `29 MB`; full runtime artifact directory is about `154 MB`.
  - Core rows contain `graphNodeId`, canonical label, generic risk, hierarchy flags, family/group/parent IDs and labels, and ancestor/sibling ranges.
  - Detail rows point into alias and capability row tables; runtime decodes aliases/capability labels only for requested records.
  - `OccupationCandidateBranchExpander` reads search-meta, ancestors, siblings, and family leaf grouping from binary accessors.
  - Family leaf recovery hydrates aliases and capability hint labels only for recovered leaves inside selected families.
  - DB-backed rebuild must run capability graph build before occupation search-meta; otherwise `ose_search_meta_capability_hints` exports as empty.
  - MySQL SQL loaders are rebuild/reference infrastructure only; runtime search-meta behavior should use the artifact and fail clearly when it is missing.
  - Remaining MySQL runtime usage is lexical/evaluation/review infrastructure, not dense vectors or graph/search-meta expansion.
  - Validation after plugging artifact:
    - `npm run build`: pass.
    - `npm run runtime:check`: pass.
    - `npm run test:structural`: pass, `21/21`.
    - `npm run evaluation:golden:pipeline -- --suite=stable`: `21/24`, 3 known stable ranking/threshold failures.
    - `npm run evaluation:golden:pipeline:developing`: `34/54`, `blocking_failures=0`.
- `Fullstack developer` is now diagnostically clearer:
  - `dense_global` finds the correct software/application family.
  - `dense_family_constrained` ranks `software developer` first inside that family.
  - `web developer` is recovered but only dense rank `18`, so current evidence does not justify forcing it above `software developer`.
  - selected result remains unresolved because family confidence is below the current family gate and no leaf has safe direct evidence.
- Same-family generic risk should remain removed from leaf scoring.
  - Generic/encompassing leaves are often safer than specialized siblings once the family is correct.
  - Generic risk can still be used for family scoring, broad-query safety, audits, and review queues.
- The next structural decision is not another hidden weight tweak.
  - Add a named branch-confidence/family fallback rule for cases where the correct family is clear but no leaf is safe.
  - Current candidate cases: `Fullstack developer`, `registered nurse`, `ro-feminine-contabila`.
  - Resolved example: `electrical wiring installer` now returns the safe broader family through leaf evidence-tier gating.
- The semantic/lexical balance inside leaf ranking should be refined over time.
  - Exact/primary lexical remains king.
  - Family-constrained dense should preserve dense order when lexical evidence is absent and all candidates share the same weak family-scoped fit tier.
  - Capability overlap and reviewed aliases should be preferred over hardcoded market-title bridges.

Next refinement checklist:

1. Done: make the combined lexical path the only supported runtime path; remove the public `--lexical-backend` selector so default evaluation cannot accidentally run weaker modes.
2. Add an OpenSearch lexical-quality gate that discounts fuzzy-only or one-token-only hits unless supported by dense/alias/graph evidence.
3. Done: add phrase-window evidence to OpenSearch debug output so branch scoring can distinguish `social media` from `social`.
4. Done: add conservative phrase-window family fallback and leaf-level evidence-tier gating so broader matches can return family when leaf evidence is unsafe.
5. Re-run stable and developing suites after each calibration step.
6. Done: replace runtime-facing `lexical_backend=hybrid` metadata with `retrieval_profile=occupation_hybrid_v1`; keep `legacy_lexical_backend=hybrid` only in historical persisted config context.
7. Next: add family evidence-tier confidence so strong family signals are represented without relaxing leaf promotion.
8. Done: implement first cross-locale-to-English family bridge for non-English ambiguous exact/variant evidence.

## Explicit Scoring Policy Module

Status: implemented as a readability/refinement foundation.

Problem:

- Scoring logic had many inline fractional weights such as `0.34`, `0.35`, `0.12`, and `1.25`.
- These numbers made it difficult to see whether one evidence source was intentionally ranked above another or merely winning through accumulated arithmetic.
- Future tuning risk was high because a small local weight change could accidentally change global behavior.

Implemented rule:

- Centralize scoring numbers in `src/scoring/scoring-policy.ts`.
- Rankers and retrievers should read named policy constants instead of embedding numeric weights inline.
- New scoring work should add or modify named policy entries first, then use those names in the scoring code.

Policy groups now include:

- OpenSearch authority scores.
- OpenSearch lexical signal policy.
- Field strength policy.
- Retrieval candidate channel weights.
- Alias/subphrase matching policy.
- Capability task alignment policy.
- Pipeline decision gates.
- Family scoring policy.
- Leaf quality and leaf scoring policy.
- Evidence normalization policy.
- Generic-risk penalties.
- Branch margin policy.

Validation after extraction:

```text
npm run build
npm run evaluation:golden:pipeline

current stable after later family-constrained dense and leaf cleanup: 20/24
```

This refactor is intended to be behavior-preserving; the main gain is that future tuning is explicit and auditable.

## Leaf Evidence Tier Promotion Gate

Status: implemented as a structural resolver refinement.

Problem:

- Leaf promotion was still primarily controlled by blended confidence plus direct evidence thresholds.
- That allowed a leaf with capability-aligned evidence and high blended score to beat the safer family answer even when the leaf label/alias did not cover all useful query terms.
- Example: `electrical wiring installer` selected `electrician` even though the top leaf matched `electrical installer` and missed `wiring`.

Implemented rule:

- Add `LeafSelectionEvidenceRanker` as an explicit leaf authority classifier.
- Leaf evidence tiers are now:
  - `exact_alias`
  - `folded_alias`
  - `strong_phrase`
  - `alias_aligned`
  - `capability_aligned`
  - `semantic_aligned`
  - `dense_only`
  - `weak`
- Leaf sorting uses this selection tier before blended confidence.
- Leaf promotion is allowed for exact, folded, strong phrase, and alias-aligned evidence.
- Capability-aligned leaves may promote only when the selected label/alias covers all useful query terms.
- Semantic-aligned and dense-only leaves remain useful for ordering closest leaves inside a family, but they do not independently promote a leaf over a safe broader family result.

Validation:

```text
npm run build
npm run resolution:pipeline -- --query="electrical wiring installer" --locale=en --no-color --debug
npm run resolution:pipeline -- --query="Fullstack developer" --locale=en --no-color --debug
npm run evaluation:golden:pipeline

stable suite: 20/24
previous stable baseline before this gate: 19/24
improved case: descriptive-people-who-install-wiring now returns family "Electrical equipment installers and repairers"
remaining stable failures: Fullstack developer, registered nurse, short-form chef threshold, ro-feminine-contabila
```

Architectural note:

- This is intentionally not a score tweak.
- It separates "this leaf scored highly" from "this leaf has the right kind of evidence to be selected."
- Future resolver work should add new evidence tiers or tier gates here rather than hiding promotion behavior inside blended confidence arithmetic.

## Capability Fit For Leaf Disambiguation

Status: implemented as a sibling-ranking refinement.

Problem:

- Capability hints existed in search-meta and API responses, but the pipeline had no separate view of how well a leaf's capability labels covered the query.
- Capability overlap was mixed into `familyScopedFit`, making it harder to use capabilities for leaf ordering without accidentally turning them into broad rescue evidence.

Implemented rule:

- Add `CapabilityFitRanker`.
- Capability fit is computed only from the family-scoped prepared query and the recovered capability labels for each leaf.
- Capability fit tiers:
  - `strong`: capability labels cover all family-scoped query terms.
  - `partial`: capability labels cover some family-scoped query terms.
  - `none`: no capability-label overlap.
- Leaf ordering uses capability fit inside the already narrowed family.
- Capability fit is exposed in `resolution:pipeline` output as `capability_fit=<tier>:<coverage>`.
- Capability fit can help classify a leaf as `capability_aligned`, but it does not override exact/folded/phrase alias authority.
- Capability-aligned promotion remains gated by full useful-query label/alias coverage, so capability evidence helps sibling choice but does not force unsafe leaf selection.

Validation:

```text
npm run build
npm run resolution:pipeline -- --query="social media content creator" --locale=en --no-color --debug
npm run evaluation:golden:pipeline

stable suite: 20/24
observed case: social media content creator exposes capability_fit differences across online community manager, online marketer, and related marketing leaves while preserving safer family output.
```

## Family Confidence Refinement Opportunities

Status: family evidence tier is implemented as observability and ordering metadata; confidence recalibration is still pending.

Current gap:

- Some queries already identify the correct family, but family confidence stays below the desired acceptance/readiness threshold.
- Examples:
  - `Fullstack developer` finds `Software and applications developers and analysts`, but confidence is still below the stable case expectation.
  - `registered nurse` finds `Nursing and midwifery professionals`, but confidence is still slightly below expectation.
- This should not be fixed by promoting unsafe leaves or adding hidden blended-score bumps.

Recommended structure:

1. Add a family evidence-tier ranker.
   - Status: first implementation added.
   - Proposed family tiers:
     - `local_exact`
     - `cross_locale_backbone`
     - `folded_alias`
     - `strong_phrase`
     - `dense`
     - `graph_only`
   - Family tier should answer "what authority says this family is correct?"
   - Numeric confidence should only compare families inside comparable authority bands.
   - The tier is now exposed on ranked families and API family terms.

2. Use top-family margin explicitly.
   - `branchShare` and `branchMarginRatio` already exist.
   - If the top family strongly dominates the next family, confidence should reflect that family-level certainty even when no leaf is safe.
   - Example: `Fullstack developer` can have high family margin while still returning `likely_dictionary_gap` for the leaf.

3. Use supporting leaf cluster agreement.
   - If many sibling leaves inside the same family are plausible, that strengthens the family.
   - This is different from leaf promotion: it says the family cluster is coherent, not that one leaf is exact.

4. Use family-constrained dense agreement.
   - If global dense finds the family and family-constrained dense finds plausible leaves inside the same family, family confidence should increase.
   - This is especially useful for market titles and descriptive titles.

5. Use aggregated capability coverage at family level.
   - Aggregate the best capability fit across top family leaves.
   - Capability support should strengthen family confidence for descriptive queries without forcing a leaf.

6. Keep coverage status separate.
   - Strong family confidence can coexist with weak leaf coverage.
   - Desired output shape:

```text
family_match=strong
leaf_match=approximate
coverage_status=likely_dictionary_gap
```

Guardrail:

- Family confidence refinement must not imply automatic leaf selection.
- The leaf evidence-tier promotion gate remains the authority for selecting a leaf.
- Remaining work: use the explicit family tier for confidence calibration, especially `Fullstack developer` and `registered nurse`.

## Cross-Locale To English Refinement

Status: first implementation added for family-level English backbone support.

Why this matters:

- Non-English quality is now the most important weak point after the recent English structural refinements.
- Romanian remains the first practical target, and HU/ET developing failures show that missing locale evidence is a retrieval problem before it is a scoring problem.
- ESCO's English backbone is much richer than some local alias sets, so controlled bridging to English can improve family discovery and leaf disambiguation.

Implemented first pass:

- Non-English pipeline runs can attach `cross_locale_english_backbone` evidence to a family.
- The evidence is created only when a candidate has exact local alias evidence and the same graph node has English canonical/alias terms in the runtime search-meta artifact.
- Cross-locale English backbone evidence is attached to family evidence, not leaf evidence.
- Family ordering now uses a family authority tier before blended confidence:
  - local exact alias evidence
  - cross-locale English backbone support
  - folded alias evidence
  - prepared phrase-window evidence
  - dense evidence
  - graph-only evidence
- Leaf promotion remains conservative:
  - direct local exact aliases can still promote leaves, e.g. `contabil` -> `accountant`.
  - variant/folded local evidence inside a cross-locale-backed family does not promote a leaf when another family has competing exact/folded alias evidence, e.g. `contabila` returns family `Finance professionals` with `accountant` as top leaf.
- Coverage status now exposes cross-locale behavior:
  - `cross_locale_family_only`: English backbone/local evidence support the family, but leaf evidence is not safe enough.
  - `english_backbone_supported`: selected result is supported by local evidence plus English backbone support.
  - `locale_gap`: a broader result exists through cross-locale support, but local leaf coverage is incomplete.
- Pipeline CLI now prints:
  - `cross_locale=<yes/no>`
  - `family_only=<yes/no>`
  - `family_evidence=<tier>`

Validation:

```text
npm run build
npm run resolution:pipeline -- --query="contabila" --locale=ro --no-color
npm run resolution:pipeline -- --query="dezvoltatori software" --locale=ro --no-color
npm run evaluation:golden:pipeline

stable suite: 21/24
Romanian stable: 12/12
improved case: ro-feminine-contabila now returns family "Finance professionals"
non-regression check: ro-plural-dezvoltatori-software still promotes leaf "software developer"
remaining stable failures: Fullstack developer, registered nurse, short-form chef threshold
```

Expanded developing suite update:

```text
npm run evaluation:golden:pipeline:developing

developing suite: 33/51
en: 20/31
ro: 9/10
hu: 2/5
et: 2/5
```

Added English ambiguity targets:

- `risk manager`: currently over-promotes `corporate risk manager`; desired behavior is broader/safer family until a broad `risk manager` leaf exists.
- `content creator`: currently passes with family `Authors, journalists and linguists`.
- `community manager`: currently lands in the correct marketing/public-relations family but does not promote `online community manager`.
- `medical assistant`: currently over-promotes `doctors' surgery assistant`; desired behavior is safer health-support family handling.
- `UX designer`: currently selects `web designer`; target remains `user interface designer` in the software/application family.
- `DevOps engineer`: passes as leaf `cloud DevOps engineer`.
- `cybersecurity analyst`: currently selects `digital forensics expert`; target remains broader cybersecurity/software-network handling.
- `SEO specialist`: passes as leaf `search engine optimisation expert`.
- `podcast producer`: passes as leaf `podcast producer`.

Added English blue-collar / operational targets:

- `solar panel installer`: passes as leaf `solar energy technician`.
- `HVAC technician`: acronym expansion now selects a closest available HVAC engineering-technician leaf; remaining issue is data/evaluator alignment with the desired refrigeration/air-conditioning mechanic or installation/repair family target.
- `CNC machine operator`: passes as leaf `computer numerical control machine operator`.
- `forklift operator`: passes as leaf `forklift operator`.
- `welder fabricator`: currently over-promotes `spot welder`; desired behavior is safer welding/sheet-metal family handling.
- `warehouse picker`: passes as leaf `warehouse worker`.

Added common European occupation targets:

- `care assistant`: currently unresolved/wrong family; target is personal-care health services.
- `elderly care worker`: passes as family `Personal care workers in health services`.
- `kitchen assistant`: passes as leaf `kitchen assistant`.
- `hotel housekeeper`: currently lands in `Building and housekeeping supervisors`; target is hotel/domestic cleaning and helper work.
- `construction labourer`: passes as leaf `building construction worker`.
- `bricklayer`: passes as leaf `bricklayer`.
- `roofer`: passes as leaf `roofer`.
- `truck driver`: passes as leaf `cargo vehicle driver` in the heavy-truck/bus family.
- `farm worker`: passes as leaf `crop production worker`.
- `cleaner`: currently over-promotes `amusement park cleaner`; target is safer general cleaning-family handling.

Added Romanian ambiguity/cross-locale targets:

- `contabile`: passes as family `Finance professionals`.
- `analistă de date`: passes as leaf `data analyst`.
- `dezvoltatoare software`: currently lands in the correct software family but does not promote `software developer`.
- `asistentă medicală`: passes as family `Nursing and midwifery professionals`.
- `creator de conținut social media`: passes as family `Sales, marketing and public relations professionals`.

Recommended next structure:

1. Detect weak local evidence.
   - Trigger cross-locale expansion only when local exact/folded/phrase evidence is weak, conflicting, or missing.
   - Do not run English expansion when a strong local exact/folded alias already exists.

2. Build an English backbone query view.
   - Use graph-owned aliases, reviewed crosswalk aliases, and canonical English labels for the same ESCO graph.
   - Candidate sources:
     - exact local alias -> graph node -> English aliases/canonical labels
     - local family-support alias -> family -> English family aliases/leaves
     - reviewed EURES/O*NET mappings where the target ESCO URI is known

3. Keep provenance explicit.
   - Cross-locale evidence must be tagged separately, for example:

```text
cross_locale_exact_bridge
cross_locale_family_bridge
cross_locale_english_backbone
```

4. Lower authority than local exact evidence.
   - Local exact/folded alias remains king.
   - Cross-locale English evidence can strengthen family confidence and help sibling ranking, but should not outrank a trusted local exact match.

5. Family-first, leaf-conservative behavior.
   - Use English bridge evidence first to improve family discovery.
   - Promote a leaf only when the local query, English bridge, and same-family leaf evidence agree.
   - Otherwise return the stronger family with `locale_gap` or `likely_dictionary_gap` coverage status.

6. Romanian next refinements.
   - Expand tests for similar gender/folded/ambiguous Romanian forms.
   - Goal: ensure local ambiguity prefers the correct family without suppressing safe exact local leaf matches.

7. HU/ET later with the same pattern.
   - HU/ET compound splitting is prepared, but missing local aliases still block quality.
   - Cross-locale bridge should help family discovery before full local alias coverage exists.

Open design questions:

- Whether cross-locale bridge should run as a candidate retrieval stage or as a fallback attempt after primary local retrieval.
- Whether translated/cross-locale evidence should be stored in OpenSearch alias docs, runtime artifacts, or both.
- How to expose coverage status:

```text
locale_gap
english_backbone_supported
cross_locale_family_only
```

Recommendation:

- Implement as a bounded fallback stage first.
- Keep all bridge evidence explicit and lower authority than local exact/folded alias evidence.
- Measure against Romanian stable/developing cases before expanding to HU/ET.

## Family Profile Retrieval Implementation

Status: implemented as a structural family-selection evidence channel.

Purpose:

- Improve the first major barrier: selecting the right broader occupation family before attempting leaf promotion.
- Use the graph/search-meta structure directly instead of treating every lexical hit as an equally precise leaf signal.
- Let family labels, family-support aliases, leaf labels, and capability labels contribute to family discovery while preserving alias-role provenance.

Runtime flow:

```text
prepared job-title signal
  -> normal query preparation for leaf/candidate retrieval
  -> family-scoped query preparation for family selection
     - keeps safe role words such as developer/assistant/technician when judging families
     - keeps acronyms such as UX even when token length is below the normal minimum

candidate retrieval
  -> OpenSearch exact/folded/phrase evidence
  -> dense global evidence
  -> branch expansion

family profile retrieval
  -> load required runtime search-meta artifact
  -> read cached leafRecordsByFamilyNodeId
  -> build/cache tokenized family profiles once per artifact map
  -> score each family profile against family-scoped tokens
  -> emit explicit family_profile evidence

family consolidation
  -> combine graph, lexical, dense, cross-locale, and family_profile evidence
  -> family_profile + dense evidence is tagged as family_profile_dense
  -> recover and rank leaves only inside selected/top families
```

Family profile contents:

- Family label.
- Locale-specific aliases plus English aliases.
- Leaf canonical labels under the family.
- Capability labels under the family.
- Alias role metadata from `ose_search_meta_aliases`, including `locale_primary`, `locale_supporting`, `reviewed_crosswalk`, `english_backbone`, and `family_supporting`.

Important guardrails:

- `family_supporting` aliases are allowed to strengthen family profiles.
- `family_supporting` aliases are not treated as leaf aliases during recovered leaf ranking.
- Family profile scoring uses named policy bands in `FAMILY_PROFILE_SCORING_POLICY`; avoid ad-hoc numeric tweaks outside that policy.
- Local exact/folded evidence still has higher authority than profile evidence. This is deliberate, but it means some wrong-family failures now indicate alias/data conflicts rather than missing profile retrieval.

Validation after implementation:

```text
npm run evaluation:golden:pipeline
stable suite: 22/24
remaining failures:
- registered nurse: correct family, confidence threshold miss at 57% vs expected 60%
- chef: correct leaf/family, confidence threshold miss at 84% vs expected 85%

npm run evaluation:golden:pipeline:developing
developing suite: 33/51
community manager: now selects the correct family Sales, marketing and public relations professionals
family-correct developing coverage: approximately 40/51 after the community-manager family correction
```

Remaining family-selection risks:

- Exact-alias/data conflicts still dominate several wrong-family cases: `UX designer`, `cybersecurity analyst`, `medical assistant`, and `risk manager`.
- Broad single-token English titles now use a structural authority rule: lexical hits can retrieve specific leaves, but a specialized leaf is not promoted unless the query has broad leaf authority. This fixed `cleaner`, which now returns `Domestic, hotel and office cleaners and helpers` instead of over-promoting `amusement park cleaner`.
- Some expected targets appear under-supported by ESCO aliases/capabilities and should be handled through data enrichment/review, not scoring hacks: `hotel housekeeper` and parts of `care assistant`. `HVAC technician` now has correct acronym expansion and closest-leaf selection, but still needs data/evaluator alignment for the preferred mechanic/installer target.
- Cross-locale weak cases remain mostly alias/vocabulary gaps; family profile helps only when local or English profile terms are already reachable.

Broad-role selection authority note:

- Current scope: English only.
- Trigger: one useful folded token with generic query shape.
- Family ordering: for this narrow class, family selection authority is based on family-profile coverage, semantic support presence, representative leaf specificity, and profile breadth. Dense magnitude is deliberately not used as a decimal tie-breaker.
- Leaf promotion: exact broad canonical leaves like `chef`, `farrier`, and `bricklayer` can still promote. Specialized leaves like `amusement park cleaner` cannot promote for the broad query `cleaner`.
- Validation:

```text
npm run evaluation:golden:pipeline
stable suite: 22/24

npm run evaluation:golden:pipeline:developing
developing suite: 34/51
improved case: dev-en-cleaner now passes
```

## Idea Backlog: Controlled Occupation Synonym Expansion

Status: proposed.

Idea:

- Add a generated occupation synonym/expansion layer for query role terms.
- Build it from existing ESCO canonical labels, locale aliases, reviewed crosswalk aliases, family-supporting aliases, role-head equivalence classes, and a small reviewed seed file.
- Add an explicit locale-to-English occupation bridge for locales where ESCO/local aliases are sparse. The bridge can be generated from trusted locale aliases where available, then completed with reviewed seeds for high-value occupation heads, modifiers, and compounds.
- Expand only role/head intent, not domain/context terms.
- Keep expansion evidence as a distinct channel, for example `expanded_alias`, rather than merging it into exact/folded/ngram evidence.

Why:

- Dense retrieval is useful but expensive and sometimes drifts.
- The system already contains a large occupation vocabulary that can produce deterministic synonym-like bridges.
- For HU/ET dictionary gaps, splitting a local compound often produces valid local parts but not English retrieval terms. Without a locale-to-English bridge, `adat + elemző` still cannot become `data analyst`, and `drón + pilóta` still cannot become `drone pilot`.
- This could help titles such as `Fuel Validation Officer`, `HR Business Partner`, `Sustainability Lead`, `ESG Officer`, `content creator`, and QA/compliance/validation variants.
- The same layer should carry reviewed occupation sub-type distinctions when a broad role phrase is otherwise ambiguous. Example: `care assistant` currently has strong social-care aliases such as `social care assistant`, `care home assistant`, and `disability care assistant`, while the target family is `Personal care workers in health services`. A similarity dictionary should distinguish personal/health/home/nursing/elderly care from social/foster/disability/community care so repeated alias evidence is interpreted in the correct occupational subtype.
- Locale compounds such as Hungarian `drónpilóta` and Estonian `droonipiloot` need deterministic role bridges to `drone pilot` before retrieval. Without a bridge, exact/lexical retrieval sees an opaque token and weak ngram noise can surface unrelated diagnostic families.
- Compound splitting should be generated from locale occupation vocabulary plus reviewed bridges, not expanded as one-off query rules. Current Hungarian artifacts do not contain `pilota`, `pilóta`, `dron`, or `drón` as role heads, modifiers, phrases, or aliases for `drone pilot`, so splitting `drónpilóta` into `drón pilóta` is necessary but not sufficient until a reviewed `drón/pilóta -> drone/pilot` bridge exists.
- `adatelemzo` / `adatelemző` is a related but clearer pattern: current HU compound splitting already produces `adat + elemzo`, and `elemzo` exists as a HU role head, but neither the compact nor split form has a HU search-meta alias for `data analyst`. This should be solved by a reviewed locale bridge such as `adat elemző` / `adatelemző -> data analyst`, then generated into alias/intent artifacts.
- Dictionary/compound-gap pattern: unresolved locale compounds with no exact, lexical, or dense evidence should be counted separately from wrong-family selections. Current examples include `drónpilóta`, `droonipiloot`, `adatelemző`, `andmeanalüütik`, `lakatos`, and `lukksepp`. These should drive alias expansion, compound splitting, or reviewed locale bridge work rather than score tuning.

Guardrails:

- Original query evidence must outrank expanded evidence.
- Expanded evidence should rank below direct `ngram_alias` but above weak family-profile-only matches.
- Expansion must expose diagnostics such as `validation -> compliance` or `officer -> administrator`.
- Domain terms must not create role expansions.
- Result-side capabilities must not be used to derive query intent.

Evaluation path:

- Compare `evaluation:listings:titles` CSV runs with labels such as `before`, `after_synonym_seed`, and `after_synonym_artifact`.
- Track changes in `decision_type`, selected family/leaf, confidence, missing role terms, and expansion evidence count.

## Idea Backlog: Finite Job-Level Modifier Peeling

Status: proposed.

Idea:

- Add a finite, locale-aware list of job-level and title-prefix modifiers that can be peeled from the query before occupation matching.
- Examples include seniority and responsibility markers such as `junior`, `senior`, `lead`, `principal`, `head of`, `chief`, `director`, `intern`, `trainee`, and local-language equivalents.
- Preserve the peeled terms as diagnostics rather than deleting them silently.
- Use the peeled boundary as a hint for where the strong occupation span starts.

Why:

- Job titles often include level/seniority words that are not part of the ESCO occupation.
- Removing these terms can make deterministic alias/ngram retrieval cleaner.
- The boundary can help distinguish level/context from the actual role in titles such as `Senior Java Backend Engineer`, `Head of Business Development`, or `Junior Compliance Analyst`.

Guardrails:

- The list must be finite and reviewed; avoid open-ended stripping.
- Do not remove role-bearing terms when they are the occupation head. For example, `manager`, `director`, `chief`, and `head` can be real occupations in some titles.
- Peeling should happen before scoring but remain visible in diagnostics and CSV output.
- Domain/context terms should not be treated as job-level modifiers.
- Changes should be evaluated with `evaluation:listings:titles` before and after, tracking missing role terms and decision changes.

## Idea Backlog: Dense-Free Runtime Cleanup

Status: proposed.

Idea:

- Remove dense vector retrieval from the default runtime path and simplify the pipeline around deterministic lexical, alias, ngram, family-profile, graph, and future synonym-expansion evidence.
- Keep any dense tooling only as offline analysis or an optional experiment if still useful.

Why:

- Dense retrieval is expensive, operationally heavier, and has shown mixed quality for job-title resolution.
- Ngram alias retrieval plus controlled vocabulary expansion can cover many useful semantic bridges while staying explainable and portable.
- Removing dense from the core runtime would reduce artifact size, startup complexity, and scoring ambiguity.

Guardrails:

- Do not delete dense code until the current dense-off CSV/golden baselines are accepted.
- Preserve before/after metrics from `evaluation:listings:titles` and golden suites.
- Remove dense evidence channels, vector artifact checks, family dense recovery, and env flags together when the cleanup is approved.

## Idea Backlog: File-Backed Non-OpenSearch Retriever

Status: proposed.

Idea:

- Implement a non-OpenSearch retrieval backend behind the existing `OccupationRetrievalEngine` interface.
- Build generated runtime artifacts for exact aliases, folded aliases, phrase/subphrase lookup, family-constrained lookup, and capability/task labels.
- Use sorted arrays, hash maps, compact postings, or binary/string-table artifacts to keep query-time work bounded and cache-friendly.

Why:

- OpenSearch is useful but can dominate per-query latency and operational complexity for embedded/library use.
- This library already has a retrieval boundary that can be cleanly replaced.
- A file-backed retriever would make the resolver easier to run on any system, similar to the alias-ngram artifact path.

Guardrails:

- Preserve separate evidence channels: exact alias, folded alias, subphrase alias, canonical label, lexical, capability/task, and family-constrained retrieval.
- Do not add direct OpenSearch calls inside pipeline stages; replacement must stay behind `OccupationRetrievalEngine`.
- Runtime must load generated artifacts and fail clearly when missing.
- Benchmark against OpenSearch with the listing CSV runner and pipeline debug timings before switching defaults.
