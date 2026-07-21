# Search Machinery Maturity Plan

This document gives a big-picture readiness assessment for the occupation search pipeline and identifies the structural work required to reach an 85% test-run target without weakening precision/safety.

## Core Product Direction

The search engine should optimize for graph-aware ranked occupation matching, not only single-node exact resolution.

Target behavior:

- return the closest 2-3 occupation leaves
- always show the family/group/category context for each returned leaf
- compute a best broader family/group match when the exact leaf is uncertain
- use dense, lexical, capability/task, and graph relationship evidence together
- treat a correct broader branch as useful output, especially for broad or ambiguous queries
- only return fully uncertain when neither leaf nor broader branch evidence is credible

This changes the refinement target. The goal is not endless threshold tuning for one selected row; the goal is a structured result that gives the caller the best leaves and the broader category they live in.

For concrete execution tasks after Phase 14, see `docs/POST_PHASE14_REFINEMENT_CHECKLIST.md`.

## Current Pipeline Strength

These percentages are architectural/readiness estimates, not product-quality guarantees. They combine implemented functionality, measured Phase 14 results, known risks, and how much confidence the current evaluation evidence supports.

| Pipeline step | Current strength | Why | Main work needed |
| --- | ---: | --- | --- |
| Source import and canonical graph | 90% | ESCO raw/source records, graph nodes, aliases, relationships, and source mappings are materialized and rerunnable. | Resolve or quarantine the six UUID-like stub occupations; keep import audits in CI-like workflow. |
| Search meta profile generation | 82% | 3045/3045 occupation nodes have search meta; 3039/3045 have hierarchy, capability support, English backbone, and locale coverage. | Clean stub rows; enrich weak/generic aliases; turn review outcomes into build inputs. |
| Exact alias retrieval | 88% | Exact local aliases are source/locale-scoped and dominate safe leaf resolution. | Add conflict policy for generic aliases and reviewed alias overrides. |
| Folded alias retrieval | 72% | Diacritic-insensitive matching works and Phase 14 added conservative subphrase lexical rescue. | Add token/phrase scoring with stronger precision controls and better alias normalization. |
| Dense retrieval | 55% | Real multilingual Transformers.js embeddings now cover all 3045 ESCO occupations and query embedding uses the same registered provider as stored vectors. Similarity is still brute-force JSON-vector cosine in TypeScript, and current evaluation metrics did not improve versus Phase 14. | Calibrate dense weighting/text strategy against expanded evaluation, then use OpenSearch on port `9201` for vector retrieval if cluster capabilities support it cleanly. |
| Candidate merge and evidence preservation | 85% | Candidates merge by graph node and keep per-channel evidence. | Add richer evidence provenance, negative evidence, and channel calibration. |
| Hierarchy expansion and branch grouping | 84% | Candidates are grouped by family/group/node with search-meta context, ancestors, siblings, and capability support. | Improve branch scoring using capability overlap and taxonomy distance, not only aggregate candidate score. |
| Resolver safety gates | 68% | Resolver returns leaf/family/group/unresolved conservatively and avoids dense-only overreach. | Calibrate thresholds against larger evaluation sets; reduce false family selections without increasing unsafe leaf wins. |
| Evaluation set and metrics | 55% | Phase 8 has 25 seed cases and Phase 14 reports conservative run comparisons. | Expand to 100-200+ representative queries with category-balanced precision/recall metrics. |
| Search-run persistence | 82% | Runs and result rows persist configs, stages, evidence, and explanations. | Add first-class evaluation set key/schema fields and richer aggregate metric artifacts. |
| Manual review loop | 58% | Review rows are generated and inspectable; reviewed rows are not overwritten. | Define review policy and promote approved review decisions back into graph/search-meta/retrieval inputs. |
| Operational usage surface | 45% | CLIs exist and are documented; no API/service wrapper exists yet. | Add a stable API/search service contract, response schema, and deployment path. |

Overall current search machinery strength: **~68%**.

Reasoning:

- The data pipeline and explainability foundations are strong.
- The search engine is already measurable and conservative.
- The biggest quality gap is not table plumbing; it is semantic retrieval quality, evaluation breadth, and closing the review feedback loop.

## Current Measured Readiness

Baseline and candidate runs:

```text
Baseline:  search_run_id=2, phase12-core-v1
Candidate: search_run_id=3, phase14-subphrase-v1
Semantic:  search_run_id=4, phase16-semantic-transformers-v1
```

Candidate run compared to baseline:

```text
selected_count:        +4
unresolved_count:      -4
exact_leaf_hit_count:   0
family/group hits:      0
miss_count:            +4
pending_review_total:  +2
```

Decision:

```text
Search Machinery DoD can be answered.
Current answer: not ready.
```

The candidate retrieves/resolves more queries, but the extra selected outcomes do not become expectation hits. This is recall-like movement without precision improvement, so it should not be accepted as readiness.

Semantic run compared to Phase 14:

```text
selected_count:          0
unresolved_count:        0
exact_leaf_hit_count:    0
family/group hits:       0
miss_count:              0
pending_review_total:    0
```

Decision:

```text
Decision Point 1 semantic infrastructure is implemented.
Current answer remains: not ready.
```

The semantic model is now correctly wired and produces meaningful dense candidate evidence, but the resolver/scoring stack does not yet convert that evidence into better expectation hits on the current 25-query set.

## What 85% Should Mean

For the near-term test run, define "85%" as a practical internal readiness target:

```text
top_leaf_or_broader_branch_success_rate >= 85% on the agreed evaluation set
exact_leaf_hit_count does not regress
wrong_branch_miss_count does not increase versus baseline
unsafe_leaf_miss_count does not increase versus baseline
pending review debt does not increase
critical exact/local alias cases remain stable
```

Where:

```text
successful_hit =
  exact_leaf_hit
  + acceptable_close_leaf_hit
  + correct_broader_branch_hit
```

Top-3 occupation success should be measured separately from the primary selected row. A query can be useful if the exact leaf is not promoted but the correct occupation appears in the top 2-3 leaves or the correct broader family/group is returned.

This target should only be claimed on an expanded evaluation set. The current 25-query set is useful for smoke/regression, but too small to claim broad quality.

## Structural Work To Reach 85%

### 1. Expand The Evaluation Set

Goal:

- Move from 25 seed queries to at least 100-200 queries before claiming 85%.

Required categories:

- Exact English occupation titles.
- Romanian/localized aliases.
- Diacritic and spelling variants.
- Noisy recruiter titles.
- Skill/task-enriched titles.
- Seniority modifiers.
- Ambiguous generic heads.
- Family/group fallback cases.
- Negative/unresolvable queries.

Why:

- The current system can be tuned to 25 cases too easily.
- The search machinery needs category-level pass/fail visibility, not only aggregate selected/unresolved counts.

### 2. Semantic Embedding Runtime

Goal:

- Keep `local-hash-v1` only as a deterministic smoke-test model.
- Use `hf-paraphrase-multilingual-minilm-l12-v2` as the default runtime semantic model.

Current status:

- True multilingual dense vectors exist in `ose_node_embeddings`.
- Runtime dense vectors are exported to `artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.*`.
- Retrieval/API/CLI defaults now use the HF model unless another `--model-key` is explicitly supplied.
- Similarity is still brute-force JSONL cosine in TypeScript; OpenSearch vector retrieval remains an optimization option after quality stabilizes.

Why:

- Dense retrieval is currently the weakest major step.
- Brute-force JSON cosine is acceptable at 3k nodes, but not the long-term architecture.

### 3. Add Calibrated Lexical Retrieval

Goal:

- Improve noisy-title recall without turning every subphrase into a false positive.

Required changes:

- Token/phrase matching with stopword/generic-head suppression.
- Field-aware weights: exact title > alias > capability > ancestor/sibling text.
- Support multi-token phrase overlap, not only phrase containment.
- Persist or explain token-level evidence in `retrieval_sources_json`.
- Classify lexical evidence as strong phrase, weak token overlap, capability/task support, or ancestor/context support.
- Feed this evidence into top-3 leaf ranking and broader branch scoring.

Why:

- Phase 14 subphrase rescue helped coverage but increased misses.
- Lexical improvements need stronger scoring and resolver calibration, not broader matching alone.

### 4. Improve Graph-Aware Ranking And Resolver Calibration

Goal:

- Convert more correct candidates into ranked top leaves and correct broader matches while preventing questionable family selections.

Required changes:

- Score top 2-3 leaves, not only the primary selected leaf.
- Score best broader family/group as a first-class result.
- Tune thresholds by query category.
- Separate "safe broad match" from "wrong broad family".
- Penalize selected families that do not match expected branch/hierarchy.
- Add stronger use of capability overlap and taxonomy distance.
- Add abstention-aware scoring so miss-to-uncertain can be counted as a precision improvement.

Why:

- The current resolver is intentionally conservative and transparent.
- Readiness requires calibration evidence, not weaker gates.

### 5. Close The Manual Review Feedback Loop

Goal:

- Make reviewed decisions durable inputs to graph/search-meta/retrieval.

Required changes:

- Define review decision policy:
  - approved alias
  - blocked alias
  - preferred occupation override
  - hierarchy correction
  - dense false-positive note
- Add tables or conventions for reviewed overrides.
- Teach search-meta build to consume approved review decisions.

Why:

- Phase 13 currently creates review work but does not improve future builds.
- Without promotion, quality fixes remain operational notes rather than system behavior.

### 6. Add A Stable Search Service Contract

Goal:

- Move from CLI-only inspection to a predictable runtime interface.

Required response fields:

- `query`
- `locale`
- `decision_type`
- `selected_node`
- `confidence`
- `safety_score`
- `candidates`
- `evidence`
- `explanation_facts`
- `unresolved_reason`

Why:

- The engine cannot be product-tested properly until callers use the same response shape repeatedly.

## Recommended Next Phases

### Phase 15. Evaluation Expansion

Deliverable:

- Expand evaluation seeds to 100+ queries.
- Add category-level readiness reporting.

Success condition:

- The current baseline/candidate behavior can be judged by category, not only aggregate.

### Phase 16. Semantic Embedding Backend

Deliverable:

- Add real semantic embedding generation and retrieval behind a new `model_key`.

Success condition:

- Dense channel improves successful hits without increasing misses on the expanded evaluation set.

### Phase 17. Graph-Aware Ranked Retrieval

Deliverable:

- Replace Phase 14's simple subphrase rescue with token/phrase retrieval, capability/task evidence, and ranked leaf plus broader-branch result construction.

Success condition:

- Noisy recruiter/title and skill-enriched cases produce better top leaves or broader branches while exact-title cases do not regress.

### Phase 18. Hybrid Calibration And Readiness Metrics

Deliverable:

- Calibrate exact, folded, OpenSearch lexical, semantic dense, capability/task, and graph branch evidence into top-3 leaf and broader-branch scores.
- Add graph-aware readiness metrics.

Success condition:

- Top-leaf or broader-branch success moves toward 85% without increasing wrong-branch or unsafe-leaf misses.

### Phase 19. Review Promotion

Deliverable:

- Approved manual review decisions affect future graph/search-meta/retrieval builds.

Success condition:

- Rebuilding the system incorporates approved review fixes and reduces repeat review debt.

### Phase 20. Search API Contract

Deliverable:

- Provide a stable runtime search interface and response schema.

Success condition:

- Test consumers can call search without depending on CLI output.

## No-Shortcut Principle

Do not mark Search Machinery ready just because selected count increases. The readiness bar must require:

- successful hits improve,
- exact leaf hits do not regress,
- misses do not increase,
- review debt does not increase,
- and improvements are measured on a representative evaluation set.
