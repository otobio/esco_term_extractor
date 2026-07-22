# Occupation Search Engine Checklist

This checklist is the execution order for building the engine without mixing exploration work, importer work, graph work, and resolver work together.

Related docs:

- `docs/GETTING_STARTED.md`: command sequence for building and using the engine locally.
- `docs/SEARCH_DECISION_TREE.md`: table-by-table runtime search and evaluation decision flow.
- `docs/SEARCH_MATURITY_PLAN.md`: pipeline maturity percentages and path to an 85% test-run target.
- `docs/POST_PHASE14_REFINEMENT_CHECKLIST.md`: concrete refinement steps for embeddings, evaluation expansion, OpenSearch lexical retrieval, hybrid calibration, review promotion, and API readiness.

## Phase 0. Baseline and Repo Setup

- Create `package.json`, `tsconfig.json`, and a simple `src/` layout.
- Add MySQL connection utilities.
- Add env handling for:
  - `DB_HOST`
  - `DB_PORT`
  - `DB_DATABASE`
  - `DB_USERNAME`
  - `DB_PASSWORD`
- Save the schema in `sql/schema.sql`.
- Confirm the schema can be recreated cleanly on an empty DB.

Expected outcome:

- the repo can connect to MySQL and owns a reproducible schema

## Phase 1. ESCO Source Import

- Build importer for ESCO raw/source tables:
  - `ose_import_runs`
  - `ose_source_files`
  - `ose_raw_rows`
  - `ose_source_concepts`
  - `ose_source_aliases`
  - `ose_source_relations`
  - `ose_source_memberships`
- Preserve multilingual locale rows.
- Preserve broader occupation references and relation rows.
- Preserve occupation-to-skill / knowledge links.

Expected outcome:

- ESCO is fully queryable inside MySQL in source form

Review checks:

- count concepts by `entity_kind`
- count aliases by locale
- count broader occupation relations
- count occupation-skill relations

## Phase 2. Source Audits

- Add SQL/TS audits for:
  - occupations by locale
  - aliases per occupation
  - occupations missing broader occupation
  - occupations missing aliases
  - distribution of ESCO collections / memberships
- Validate that broader occupation data is really present and usable.

Expected outcome:

- we understand the raw ESCO shape before canonical graph building

## Phase 3. Canonical Occupation Graph Build

- Build first graph materializer into:
  - `ose_graph_nodes`
  - `ose_graph_node_sources`
  - `ose_graph_aliases`
  - `ose_graph_relationships`
- Start with occupation leaf nodes first.
- Add hierarchy edges from broader occupation relations.
- Keep aliases locale-scoped.
- Mark obviously generic aliases with review flags, not deletion first.

Expected outcome:

- one canonical graph layer exists for occupations

Review checks:

- count graph nodes
- count graph aliases
- count hierarchy relationships
- count nodes with at least one parent
- sample sibling clusters

## Phase 4. Capability Graph Build

- Build capability import/materialization into:
  - `ose_capabilities`
  - `ose_graph_capability_links`
- Distinguish:
  - skill
  - knowledge
  - tool/software when possible later
- Preserve essential vs optional where source gives it.

Expected outcome:

- occupations can be supported by capabilities during disambiguation

Review checks:

- occupations with zero capability links
- occupations with strong capability coverage
- sample occupation -> capability paths

## Phase 5. Search Meta Generation

- Build generator for:
  - `ose_search_meta`
  - `ose_search_meta_aliases`
  - `ose_search_meta_ancestors`
  - `ose_search_meta_siblings`
  - `ose_search_meta_capability_hints`
- For each occupation, compute:
  - parent/family/group context
  - locale alias bundle
  - English backbone alias bundle
  - sibling and related occupation references
  - capability hints
  - `generic_risk`
  - `search_text`
  - `dense_text`

Expected outcome:

- each occupation has a search-ready profile instead of relying only on flat aliases

Review checks:

- count occupations with search meta
- count occupations with hierarchy context
- count occupations with `generic_risk=high`
- sample `search_text`
- sample `dense_text`

## Phase 6. Search Meta Quality Audits

- Add audits for:
  - missing hierarchy
  - missing locale coverage
  - alias sparsity by locale
  - high generic risk
  - empty dense text
  - poor English backbone coverage
- Add review queue inserts into `ose_manual_review_queue` for obvious problems.

Expected outcome:

- search meta quality becomes measurable
- graph/search-meta runtime metadata can be exported after rebuild:
  - `npm run search-meta:export-runtime`
  - DB-backed full rebuild: `npm run runtime:artifacts-rebuild-db`
  - default manifest: `artifacts/runtime/occupation-search-meta.esco_1_2_1.manifest.json`
  - default binary tables: `artifacts/runtime/occupation-search-meta.esco_1_2_1.*.bin`
  - default range indexes: `artifacts/runtime/occupation-search-meta.esco_1_2_1.*.idx`
  - startup validation: `npm run runtime:check`
  - `runtime:artifacts-rebuild-db` must run capability graph build before occupation search-meta so `ose_search_meta_capability_hints` is populated before export.

## Phase 7. Embedding Layer

- Register embedding models in `ose_embedding_models`.
- Generate embeddings for:
  - occupation `dense_text`
  - optionally alias bundles
- Store embeddings in:
  - `ose_node_embeddings`
  - `ose_alias_embedding_candidates`
- Store durable embeddings in MySQL, then export runtime vectors to a local manifest, metadata JSONL, and binary vector sidecar:
  - `npm run embeddings:export-runtime`
  - default model: `hf-paraphrase-multilingual-minilm-l12-v2`
  - default manifest: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.manifest.json`
  - default metadata: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.metadata.jsonl`
  - default vectors: `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.vectors.f32`
  - runtime dense retrieval requires this artifact.
  - app/API startup should run `npm run runtime:check` or equivalent validation.

Expected outcome:

- dense retrieval can be tested without premature optimization
- runtime dense scoring does not pull embedding vectors from MySQL

Review checks:

- count embeddings by model
- count missing embeddings
- sample cosine neighbors for known occupations
- verify debug traces show artifact vector count under `dense embeddings`

## Phase 8. Evaluation Set

- Build seed evaluation queries in:
  - `ose_evaluation_queries`
  - `ose_evaluation_expectations`
- Include:
  - exact job titles
  - multilingual variants
  - noisy recruiter phrasing
  - ambiguous cases
  - family-level fallback cases
- Resolve expected graph nodes by source-scoped canonical labels, aliases, or search-meta hierarchy pointers, never hard-coded IDs.
- Keep the seed rerunnable and set-scoped through a conservative notes marker until the schema grows a first-class `set_key`.

Expected outcome:

- retrieval and resolution quality can be measured repeatably

Review checks:

- run `npm run evaluation:seed`
- rerun with `--reset-set` and confirm owned row counts remain stable
- spot-check seeded queries by category and expectation level

## Phase 9. Retrieval Machinery

- Implement retrieval stages in code:
  1. exact local alias retrieval
  2. folded local alias retrieval
  3. dense retrieval over search meta / embeddings
- Preserve evidence source for every candidate.
- Do not decide final winner in SQL alone.

Expected outcome:

- the engine can assemble a candidate pool from multiple evidence channels

Review checks:

- examples where exact works
- examples where folded rescues
- examples where dense adds useful recall

## Phase 10. Candidate Merge and Hierarchy Expansion

- Merge retrieved candidates by canonical node.
- Attach search meta.
- Expand ancestors and siblings.
- Group candidates into hierarchy branches.

Expected outcome:

- the engine can reason about branch consistency instead of isolated candidates

Review checks:

- sample candidate merge output
- sample family/group clustering output

## Phase 11. Disambiguation Layer

- Score candidates using:
  - exactness
  - specificity
  - hierarchy consistency
  - capability support
  - generic-head suppression
  - unrelated-branch penalties
- Allow three outcomes:
  - exact leaf
  - safer family/group
  - unresolved

Expected outcome:

- fewer false positives from flat alias collisions

## Phase 12. Search Run Tracking

- Persist experiment results into:
  - `ose_search_runs`
  - `ose_search_run_results`
- Record:
  - config
  - rank output
  - explanation payload
  - decision stage

Expected outcome:

- every ranking change can be compared against previous runs

Architectural note from Phase 11:

- The first resolver is intentionally conservative. Exact and folded lexical evidence may resolve leaves when hierarchy evidence is clear, while dense-only evidence should generally fall back to a safe family/group or remain unresolved.
- Current `local-hash-v1` embeddings are plumbing-grade, not production semantic embeddings. Do not weaken resolver safety gates just to make dense-only noisy recruiter queries resolve.
- Example known limitation: `senior data analyst - SQL dashboards` currently remains unresolved because Phase 9 lacks token/subphrase lexical retrieval and the local hash embedding is not semantically reliable enough for leaf resolution.
- Future improvement should address this in retrieval, for example token/subphrase lexical channels, better semantic embeddings, or evaluated alias enrichment, then compare results through persisted search runs.

## Phase 13. Manual Review Loop

- Implemented Phase 13 queue tooling:
  - `src/cli/build-manual-review-queue.ts`
  - `src/cli/inspect-manual-review-queue.ts`
- Use `ose_manual_review_queue` for:
  - generic alias conflicts
  - hierarchy gaps
  - cross-locale gaps
  - evaluation selected-result mismatches
  - unresolved evaluation queries
  - dense-only suspicious candidates
- The builder reads persisted Phase 12 search runs plus conservative search-meta signals, inserts only non-duplicate pending rows, leaves reviewed rows untouched, and supports query-level items with `graph_node_id = NULL`.
- Phase 13 does not automatically change graph/search-meta/retrieval/resolver behavior.

Remaining follow-up:

- Promote reviewed decisions back into graph/search meta build logic once a review policy is defined.

Expected outcome:

- quality improvements feed the graph rather than living as one-off patches

## Phase 14. Readiness Comparison

- Add conservative subphrase lexical rescue to folded-alias retrieval:
  - phrase-containment matches only after normalization/folding
  - generic one-token aliases remain suppressed
  - resolver safety gates remain unchanged
- Implement read-only readiness reporting in:
  - `src/cli/report-search-readiness.ts`
  - `src/search-readiness/report-search-readiness.ts`
- Compare one run or a baseline/candidate pair against `ose_evaluation_expectations`.
- Keep scoring conservative:
  - count exact-leaf success only when `selected_leaf` matches an `exact_leaf` expectation
  - count acceptable-leaf success separately
  - count family/group fallback separately from leaf wins
  - treat unresolved or mismatched selections as unresolved/miss, not soft success
- Report:
  - query, selected, unresolved, miss, and hit counts
  - selected-stage and candidate-stage counts
  - pending manual-review counts by type when linked to the run
  - candidate-vs-baseline deltas when both runs cover the same evaluation query IDs
- State explicitly whether Search Machinery DoD can be answered from the available evidence and what still remains.

Expected outcome:

- readiness claims are backed by bounded, repeatable baseline comparisons instead of anecdotal samples

Measured Phase 14 state:

- Baseline run: `search_run_id=2` (`phase12-core-v1`)
- Candidate run: `search_run_id=3` (`phase14-subphrase-v1`)
- Candidate run improved selected coverage from 18/25 to 22/25 and reduced unresolved queries from 7 to 3.
- Candidate run did not clear readiness because conservative misses increased from 8 to 12 and pending review debt increased from 21 to 23 after building review rows for run 3.
- Current answer to Search Machinery DoD: evidence is sufficient to answer, and the answer is not ready yet.

## Phase 15. Expanded Evaluation and Tuned Hybrid Readiness

- Seeded the expanded evaluation set `phase15-expanded-v1` with 100 expectation-resolved queries.
- Added category-level readiness summaries and candidate-minus-baseline category deltas.
- Added OpenSearch occupation lexical retrieval as a selectable/hybrid retrieval backend.
- Tuned resolver behavior to preserve strong exact/folded lexical leaf evidence when OpenSearch/dense candidates dilute branch share.
- Kept dense-only generic family fallback conservative:
  - high-margin generic family fallback can resolve, for example `developer`
  - broad `role`, `roles`, `job`, and `jobs` queries abstain unless trusted lexical evidence exists
  - generic exact one-word leaf overrides require canonical-label equality

Measured Phase 15 state:

- Expanded baseline run: `search_run_id=5` (`phase15-expanded-local-hash-v1`)
- Tuned hybrid candidate run: `search_run_id=9` (`phase15-expanded-hybrid-lexical-override-v2`)
- Candidate-vs-baseline deltas:
  - `selected_count=0`
  - `unresolved_count=0`
  - `exact_leaf_hit_count=+10`
  - `acceptable_hit_count=+2`
  - `family_or_group_hit_count=0`
  - `miss_count=-12`
- Current answer to Search Machinery DoD: evidence is sufficient to answer, and the tuned hybrid candidate is ready under the conservative Phase 15 readiness gate.

Remaining follow-up:

- `skill_enriched` remains fully unresolved, so the next quality step should improve capability/task retrieval rather than loosen resolver thresholds.
- `romanian_variant` improved exact hits and unresolved count, but still has one additional miss versus baseline.
- Ambiguous and fallback categories still require a richer abstention-aware rubric before optimizing beyond the current conservative gate.

## Phase 16. Real Semantic Embeddings

- Integrated Transformers.js semantic embeddings with model:
  - `model_key=hf-paraphrase-multilingual-minilm-l12-v2`
  - `model_name=Xenova/paraphrase-multilingual-MiniLM-L12-v2`
  - `dimensions=384`
  - `provider=huggingface-transformers-js`
- Stored semantic vectors in MySQL `ose_node_embeddings` for auditability.
- Populated OpenSearch `dense_vector` for all indexed occupation documents.
- Aligned dense query embedding with the stored model provider.
- Preserved the Phase 15 resolver safety posture with a small lexical-leaf margin adjustment for semantic dense competitors.

Measured Phase 16 state:

- MySQL semantic embedding rows: `3045`
- OpenSearch occupation docs: `3045`
- OpenSearch docs with `dense_vector`: `3045`
- Semantic candidate run: `search_run_id=11` (`phase16-expanded-transformers-hybrid-v2`)
- Compared with expanded baseline run `5`:
  - `exact_leaf_hit_count=+10`
  - `acceptable_hit_count=+2`
  - `miss_count=-13`
  - `unresolved_count=+1`
- Compared with tuned Phase 15 run `9`:
  - `exact_leaf_hit_count=0`
  - `acceptable_hit_count=0`
  - `miss_count=-1`
  - `unresolved_count=+1`

Decision:

- Phase 16 is technically integrated and measured.
- The current default candidate should remain Phase 15 run `9` until readiness scoring becomes abstention-aware or semantic retrieval produces a strict improvement without unresolved regression.
- Run `11` demonstrates a precision-improving abstention on `driver`, but the conservative readiness gate still marks it `not_ready`.

Remaining follow-up:

- Add an abstention-aware readiness metric that distinguishes miss-to-unresolved precision improvements from true recall loss.
- Add capability/task retrieval for `skill_enriched`; the semantic model alone does not resolve that category.
- Consider OpenSearch KNN query support later; the current OpenSearch vector path stores vectors as portable float arrays.

## Phase 17. Graph-Aware Ranked Retrieval

Architectural decision:

- The engine should return the closest 2-3 occupation leaves with family/group context, not only one selected node.
- The graph should be used to produce a credible broader match when exact leaf confidence is weak.
- A correct broader family/category match is valuable product output and should be measured directly.
- Full unresolved should be reserved for cases where both leaf and broader branch evidence are weak.

Deliverables:

- Enrich retrieval evidence so leaves can be ranked by combined lexical, dense, capability/task, and graph support.
- Add first-class capability/task evidence for skill-enriched and noisy recruiter queries.
- Add branch-level ranked result data:
  - best broader family/group
  - supporting leaf IDs
  - branch score and margin
  - top 2-3 leaves with family/group labels
- Preserve backward-compatible selected rows for current evaluation while preparing the runtime response shape.

Acceptance gates:

- Exact-title cases do not regress versus run `9`.
- `skill_enriched` begins producing credible candidate leaves or broader branches instead of 15/15 empty unresolved.
- Broad/family queries return a correct broader branch more often, even when a leaf is not promoted.
- Result payloads explain why each top leaf and broader branch was ranked.

Phase 17A completed:

- OpenSearch lexical hits now include structured field signals:
  - field class
  - phrase match flag
  - matched tokens
  - useful-token coverage
  - query/useful query token counts
- Retrieval CLI text output exposes the key OpenSearch evidence fields.
- This is an evidence-foundation slice only; it does not promote a new default run or change resolver thresholds.

Next Phase 17 slice:

- Use the enriched field signals to downweight weak generic-token matches.
- Add capability/task evidence as a first-class retrieval channel for `skill_enriched`.
- Start emitting ranked top leaves plus best broader branch internals.

Phase 17B completed:

- OpenSearch lexical scoring now combines normalized BM25 with a `lexical_signal_score`.
- `lexical_signal_score` uses useful-token coverage, matched field class, and phrase-match evidence.
- Raw OpenSearch score is still preserved for audit.
- Evaluation run `12` (`phase17b-calibrated-os-lexical-v1`) improved over run `11`:
  - `acceptable_hit_count=+1`
  - `miss_count=-1`
  - no selected/unresolved regression
- The concrete improvement was query `343`, moving `retail pharmacist dispensary patient counselling` from a wrong family selection to acceptable leaf `9492`.

Next Phase 17 slice:

- Add `capability_task` evidence as a first-class channel. Status: completed in Phase 17C.
- Use capability/task evidence to create credible ranked candidates for `skill_enriched` and noisy recruiter queries. Status: partially completed; run `14` improved noisy recruiter query `344`, while `skill_enriched` still needs graph-aware ranked output and resolver calibration before promotion.
- Add ranked top leaves plus best broader branch internals. Status: completed in Phase 17D as evidence-only output.

Phase 17C completed:

- `capability_task` now derives from OpenSearch `capability_text` field signals.
- Capability evidence is suppressed for broad single-useful-token queries.
- Retrieval and branch CLIs expose `capability_task` channel scores.
- Evaluation run `14` (`phase17c-capability-task-evidence-v2`) improved over run `12`:
  - `acceptable_hit_count=+1`
  - `miss_count=-1`
  - no selected/unresolved/exact-leaf regression
- Against stable run `9`, run `14` has `acceptable_hit_count=+2` and `miss_count=-3`, but remains below the conservative promotion gate because it inherits one selected-to-unresolved tradeoff.

Phase 17D completed:

- Resolver output now includes `ranked_results.top_leaves[]` and `ranked_results.best_broader_branch`.
- Ranked leaves carry both `retrieval_score` and `resolver_score`; top-leaf ordering uses retrieval strength first so closest matches are visible even when conservative safety scoring keeps the query unresolved.
- Evaluation persistence mirrors ranked evidence under `retrieval_sources_json.ranked_results` and `explanation_json.rank_summary.ranked_results`.
- Readiness reporting now exposes evidence-only metrics:
  - `top3_leaf_hit_count`
  - `best_broader_branch_hit_count`
  - `ranked_evidence_queries`
- Evaluation run `15` (`phase17d-ranked-leaves-branch-evidence-v1`) preserved selected-outcome behavior versus run `14`:
  - `selected_count=0`
  - `unresolved_count=0`
  - `exact_leaf_hit_count=0`
  - `acceptable_hit_count=0`
  - `miss_count=0`
- Ranked evidence in run `15`:
  - `ranked_evidence_queries=100`
  - `top3_leaf_hit_count=75`
  - `best_broader_branch_hit_count=1`
- Decision: Phase 17D is accepted as an evidence/observability improvement only. It does not change resolver selection or the conservative readiness gate.

## Phase 18. Graph-Aware Calibration and Readiness

Goal:

- Calibrate ranked leaves and broader branch confidence rather than only tuning single selected-node thresholds.

Metric changes:

- Track `exact_leaf_hit`.
- Track `acceptable_close_leaf_hit`.
- Track `correct_broader_branch_hit`.
- Track `wrong_branch_miss`.
- Track `unsafe_leaf_miss`.
- Track `abstained_uncertain`.
- Treat miss-to-uncertain as a precision improvement, not a simple failure, when the previous selected branch was wrong.

Acceptance gates:

- Top-3 leaf or broader-branch success moves toward the 85% target on the expanded set.
- Exact-title success does not regress.
- Wrong-branch and unsafe-leaf misses decrease versus run `9`.
- The system can explain both the closest leaves and the broader match for product testing.

Phase 18A completed:

- Added calibrated hybrid leaf promotion after the existing safe-leaf gate and before family/group fallback.
- Scope is intentionally narrow:
  - exact/folded lexical evidence only,
  - strong retrieval score,
  - strong leaf margin,
  - strong branch share and branch margin,
  - capability-supported branch,
  - dense-only evidence is not promoted.
- Generic one-token queries only promote when they have exact-alias evidence and much stronger separation, preventing broad queries such as `developer` from over-selecting a leaf.
- Evaluation run `16` (`phase18-calibrated-hybrid-lexical-leaf-v1`) improved over run `15`:
  - `exact_leaf_hit_count=+2`
  - `acceptable_hit_count=+1`
  - `miss_count=-3`
  - no selected/unresolved regression
  - no exact-title regression
- Changed queries:
  - `278` `contabil`: family `7459` -> leaf `10794`
  - `284` `farmacist`: family `7431` -> leaf `9492`
  - `286` `licensed electrician for residential wiring`: family `7807` -> leaf `8850`
- Against stable run `9`, run `16` has `exact_leaf_hit_count=+2`, `acceptable_hit_count=+3`, and `miss_count=-6`, but still inherits one selected-to-unresolved tradeoff from earlier semantic calibration.

Phase 18B completed:

- Added calibrated semantic/capability leaf promotion for dense-only evidence.
- Scope is intentionally narrower than the ranked evidence:
  - non-generic queries only,
  - top evidence must include OpenSearch lexical and `capability_task`,
  - dense-backed candidates require dense embedding support, strong branch share, branch margin, and leaf margin,
  - lexical/capability-backed candidates without dense support require high leaf margin and enough branch share,
  - generic broad queries remain excluded.
- Evaluation run `17` (`phase18b-semantic-capability-leaf-v1`) improved over run `16`:
  - `selected_count=+3`
  - `unresolved_count=-3`
  - `acceptable_hit_count=+3`
  - `miss_count=0`
  - no exact-leaf regression
- Changed queries:
  - `353` `deploy cloud microservices and maintain CI CD pipelines`: unresolved -> leaf `9448`
  - `358` `dispense prescriptions and advise patients on medicines`: unresolved -> leaf `9492`
  - `359` `coordinate recruitment onboarding and employee relations`: unresolved -> leaf `10878`
- Against stable run `9`, run `17` has:
  - `selected_count=+2`
  - `unresolved_count=-2`
  - `exact_leaf_hit_count=+2`
  - `acceptable_hit_count=+6`
  - `miss_count=-6`
  - readiness status `ready`
- Current selected-outcome success is `52/100`; ranked top-3 evidence remains `75/100`.

Phase 18C completed:

- Added `npm run evaluation:gap` as a read-only ranked evidence diagnostic.
- The command identifies where the expected leaf is already present in `ranked_results.top_leaves` but the selected outcome is still a miss, family/group fallback, or unresolved.
- Run `17` gap analysis shows:
  - `18` non-selected queries have the expected leaf at rank 1,
  - `6` more have it at rank 2 or 3,
  - `24` total clean promotion candidates remain,
  - `24` risky/no-top-3 gaps remain,
  - no branch-only candidates were found.
- Architectural conclusion: the next obvious gains are calibrated promotion of already-ranked leaves, not broad loosening of retrieval. Ambiguous generic, broad family/group, fallback, and no-top-3 skill-enriched cases need separate retrieval/evaluation treatment.

## Definition of Done for Search Meta

Search meta is considered ready when:

- every active occupation node has one `ose_search_meta` row
- most occupations have hierarchy context or are explicitly flagged as missing it
- most occupations have capability hints where expected
- `search_text` and `dense_text` are visibly sane in samples
- generic-risk flags are populated

## Definition of Done for Search Machinery

See `docs/SEARCH_DECISION_TREE.md` for the table-by-table runtime decision path and readiness comparison flow.

Search machinery is considered ready when:

- retrieval supports exact, folded, and dense channels
- merged candidates keep source evidence
- hierarchy expansion works
- disambiguation can return ranked leaves, a broader family/group match, or an explicit uncertain result
- evaluation runs show measurable top-leaf or broader-branch improvement without major precision collapse
- readiness reports can compare candidate runs to a persisted baseline without overstating exact-leaf success
