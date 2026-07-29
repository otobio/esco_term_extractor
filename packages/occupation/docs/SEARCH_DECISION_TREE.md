# Search Decision Tree

This document explains how an occupation search moves from a user query to ranked occupation matches, graph-aware broader matches, evaluation records, and review queue items. It is intended to be readable without opening the TypeScript implementation.

Status note: this file is a historical decision-flow explainer and still contains
older dense/vector retrieval discussion. For the current runtime contract, use
`docs/RETRIEVAL_ENGINE.md`, `docs/IMPLEMENTATION_DETAIL.md`, and
`AGENTS.md`: `binary-cache` is the default runtime backend, dense vector
retrieval has been removed from the runtime path, and runtime consumes generated
binary artifacts.

## Architectural Decision: Ranked Graph-Aware Matching

Search should not be optimized as a single-node "exact or unresolved" resolver. The target product behavior is ranked occupation matching:

- return the closest 2-3 occupation leaves when evidence is sufficient
- always expose the family/group/category context those leaves live in
- compute a best broader match from graph branches even when the exact leaf is uncertain
- treat the occupation graph as a ranking asset, not only as a safety fallback
- prefer a correct broader family/category result over an unsafe exact-looking leaf
- reserve full unresolved only for cases where neither leaf nor broader branch is credible

The runtime API should evolve from one `selected_node` into a result shape like:

```ts
type OccupationSearchResponse = {
  query: string;
  locale: string;
  decisionType: 'exact_leaf' | 'close_leaf' | 'broader_family' | 'uncertain';
  topOccupations: Array<{
    graphNodeId: number;
    canonicalLabel: string;
    score: number;
    confidence: number;
    familyNodeId: number | null;
    familyLabel: string | null;
    groupNodeId: number | null;
    groupLabel: string | null;
    evidence: unknown[];
  }>;
  bestBroaderMatch: null | {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: 'family' | 'group';
    score: number;
    supportingLeafIds: number[];
  };
  explanationFacts: string[];
};
```

Near-term code may still persist one selected row for backward-compatible evaluation, but Phase 17+ work should shape retrieval and resolver internals around ranked leaves plus broader branch confidence.

## Runtime Search Path

```text
User query
  |
  |-- Q1. Is this query coming from the evaluation set?
  |     |
  |     |-- yes -> read query_text + locale_code
  |     |          Table: ose_evaluation_queries
  |     |
  |     |-- no  -> use CLI/API query + locale inputs
  |
  |-- Q2. What normalized forms should search use?
  |     |
  |     |-- surface_query    = NFKC + whitespace collapse
  |     |-- normalized_query = surface_query + lowercase normal words, preserve acronym tokens
  |     |-- folded_query     = normalized_query + diacritic stripping, still preserve acronym tokens
  |     |-- lookup_fold      = folded_query lowercased only at exact keyword lookup boundaries
  |     |
  |     |-- examples:
  |     |   "HVAC engineer" -> normalized/folded "HVAC engineer", lookup "hvac engineer"
  |     |   "bucătar șef"   -> normalized "bucătar șef", folded/lookup "bucatar sef"
  |     |
  |     |-- controlled acronym expansion appends long-form signal tokens:
  |     |   HVAC -> heating ventilation air conditioning
  |     |   UX   -> user experience
  |     |   CNC  -> computer numerical control
  |     |
  |     |-- These are runtime values, not separate tables.
  |
  |-- Q3. Is there an exact local alias match?
  |     |
  |     |-- read local aliases only
  |     |   Table: ose_search_meta_aliases
  |     |   Join:  ose_search_meta -> ose_graph_nodes -> ose_graph_node_sources
  |     |
  |     |-- conditions:
  |     |   alias.locale_code = query locale
  |     |   alias.normalized_alias == normalized_query
  |     |   alias_role IN ('locale_primary', 'locale_supporting')
  |     |   graph node is active/searchable occupation
  |     |   graph node belongs to requested source_name
  |     |
  |     |-- evidence emitted:
  |     |   channel = exact_alias
  |     |   score ~= alias weight
  |
  |-- Q4. Is there a folded whole-alias match?
  |     |
  |     |-- read same local alias pool
  |     |   Table: ose_search_meta_aliases
  |     |
  |     |-- condition:
  |     |   lookup_fold(alias.normalized_alias) == lookup_fold(query)
  |     |   alias.normalized_alias != normalized_query
  |     |
  |     |-- evidence emitted:
  |     |   channel = folded_alias
  |     |   score ~= alias weight * 0.85
  |
  |-- Q5. Is there a safe folded subphrase alias match?
  |     |
  |     |-- read same local alias pool
  |     |   Table: ose_search_meta_aliases
  |     |
  |     |-- condition:
  |     |   folded alias phrase is contained in folded query, or query is contained in alias
  |     |   generic one-token aliases are suppressed
  |     |   phrase must contain useful non-generic signal
  |     |
  |     |-- evidence emitted:
  |     |   channel = folded_alias
  |     |   details.match_type = alias_in_query | query_in_alias
  |     |   score ~= lower than whole folded alias
  |
  |-- Q6. Is dense evidence available?
  |     |
  |     |-- find embedding model
  |     |   Table: ose_embedding_models
  |     |
  |     |-- score query vector against node dense_text vectors
  |     |   Table: ose_node_embeddings
  |     |   Join:  ose_graph_nodes -> ose_graph_node_sources
  |     |
  |     |-- conditions:
  |     |   embedding.text_role = 'dense_text'
  |     |   embedding.locale_code IS NULL
  |     |   model_key matches requested model
  |     |   graph node is active/searchable occupation
  |     |
  |     |-- evidence emitted:
  |     |   channel = dense_embedding
  |     |   score = cosine similarity
  |
  |-- Q7. How are candidate nodes merged?
  |     |
  |     |-- merge all evidence by graph_node_id
  |     |   Primary identity table: ose_graph_nodes
  |     |
  |     |-- channel priority in total score:
  |     |   exact_alias   strongest
  |     |   folded_alias  medium
  |     |   dense         weakest
  |     |
  |     |-- output:
  |     |   candidate graph node
  |     |   canonical_label
  |     |   total_score
  |     |   per-channel scores
  |     |   full evidence list
  |
  |-- Q8. What hierarchy/capability context belongs to each candidate?
  |     |
  |     |-- read candidate search profile
  |     |   Table: ose_search_meta
  |     |
  |     |-- read ancestors
  |     |   Table: ose_search_meta_ancestors
  |     |
  |     |-- read siblings
  |     |   Table: ose_search_meta_siblings
  |     |
  |     |-- capability presence is summarized on:
  |     |   Table: ose_search_meta.has_capability_support
  |     |
  |     |-- output:
  |     |   generic_risk
  |     |   has_hierarchy
  |     |   has_capability_support
  |     |   family_node_id / group_node_id / parent_node_id
  |     |   ancestor and sibling samples
  |
  |-- Q9. Which branch owns the candidate?
  |     |
  |     |-- if family_node_id exists -> branch = family
  |     |-- else if group_node_id exists -> branch = group
  |     |-- else -> branch = candidate node
  |     |
  |     |-- branch evidence summary:
  |     |   candidate_count
  |     |   max_candidate_score
  |     |   total_candidate_score
  |     |   exact/folded/dense channel presence
  |
  |-- Q10. How are branches and leaves scored?
  |     |
  |     |-- resolver inputs:
  |     |   exactness
  |     |   specificity
  |     |   hierarchy consistency
  |     |   capability support
  |     |   generic-risk suppression
  |     |   unrelated-branch penalty
  |     |
  |     |-- tables already read:
  |     |   ose_search_meta
  |     |   ose_search_meta_ancestors
  |     |   ose_search_meta_siblings
  |     |
  |     |-- dense-only evidence remains low trust.
  |
  |-- Q11. Which leaves are the closest ranked matches?
  |     |
  |     |-- rank leaves by:
  |     |   lexical fit
  |     |   semantic fit
  |     |   capability/task overlap
  |     |   graph branch support
  |     |   generic-risk suppression
  |     |
  |     |-- outcome:
  |     |   top 2-3 occupation leaves with family/group context
  |
  |-- Q12. What is the best broader graph match?
  |     |
  |     |-- score family/group branches by:
  |     |   total supporting candidate evidence
  |     |   best-leaf evidence
  |     |   branch margin versus competing branches
  |     |   taxonomy and capability consistency
  |     |
  |     |-- outcome:
  |     |   best broader family/group match, even if leaf confidence is weak
  |
  |-- Q13. Is a leaf safe enough to promote as the primary match?
  |     |
  |     |-- yes, if:
  |     |   evidence is exact_alias, folded_alias, or exceptionally strong dense
  |     |   top branch is sufficiently clear
  |     |   top leaf is sufficiently clear within branch
  |     |   generic-risk gates pass
  |     |
  |     |-- outcome:
  |     |   decision_type = exact_leaf | close_leaf
  |     |   primary node = candidate occupation node
  |     |   topOccupations still includes alternate close leaves
  |
  |-- Q14. If no leaf is safe, is a family/group broader match credible?
  |     |
  |     |-- yes, if:
  |     |   branch is family or group
  |     |   branch is clear enough
  |     |   lexical evidence is trusted, or dense-only branch is very strong
  |     |
  |     |-- outcome:
  |     |   decision_type = broader_family
  |     |   bestBroaderMatch = branch node
  |     |   topOccupations = closest supporting leaves in that branch
  |
  |-- Q15. If neither leaves nor broader branch are credible?
        |
        |-- outcome:
        |   decision_type = uncertain
        |   topOccupations may be empty or explicitly low-confidence
        |   bestBroaderMatch = NULL
```

## Table Responsibilities

| Question | Primary tables | What the table answers |
| --- | --- | --- |
| What source is this graph node from? | `ose_graph_node_sources` | Whether a node belongs to `source_name`, e.g. `esco_1_2_1`. |
| What is the canonical occupation/family/group? | `ose_graph_nodes` | Node ID, label, level, status, searchability, slug. |
| What aliases can match a query? | `ose_search_meta_aliases` | Local primary/supporting aliases and their normalized text/weights. |
| What is the occupation's search profile? | `ose_search_meta` | Generic risk, hierarchy IDs, capability support, search/dense text, quality flags. |
| What ancestors explain hierarchy? | `ose_search_meta_ancestors` | Parent/family/group/broader context for branch reasoning. |
| What siblings provide nearby context? | `ose_search_meta_siblings` | Same-family/group examples for inspection and branch context. |
| What capability signal exists? | `ose_search_meta.has_capability_support`, `ose_search_meta_capability_hints` | Whether capability hints support a candidate; detailed hints are materialized separately. |
| Which embedding model is active? | `ose_embedding_models` | Model key, dimensions, provider/family metadata. |
| What dense vectors are searched? | `ose_node_embeddings` | Dense vectors generated from `dense_text`. |
| What evaluation queries exist? | `ose_evaluation_queries` | Seeded query text, locale, query kind, and ownership notes. |
| What should evaluation accept? | `ose_evaluation_expectations` | Exact leaf, acceptable leaf, family, or group expectation per query. |
| What run was persisted? | `ose_search_runs` | Experiment label, config, code version, notes. |
| What did a run return? | `ose_search_run_results` | Selected and candidate nodes, ranks, scores, evidence JSON, explanation JSON. |
| What needs human review? | `ose_manual_review_queue` | Pending/reviewed issues: alias conflicts, generic heads, hierarchy gaps, dense candidates, relatedness gaps. |

## Evidence Channels

```text
exact_alias
  Source: ose_search_meta_aliases
  Trust: highest
  Use: exact local alias resolution
  Resolver effect: can safely select leaf if branch/leaf clarity gates pass

folded_alias
  Source: ose_search_meta_aliases + runtime folded comparison
  Trust: medium
  Use: diacritic-insensitive aliases and conservative subphrase lexical rescue
  Resolver effect: can select leaf or family/group if clarity gates pass

dense_embedding
  Source: ose_node_embeddings
  Trust: medium with current hf-paraphrase-multilingual-minilm-l12-v2 runtime model
  Use: semantic family retrieval, family-constrained leaf discovery, and recall support
  Resolver effect: can strengthen family confidence and leaf ordering, but leaf promotion still needs lexical/capability/fit support
```

Future evidence channels should distinguish stronger signals instead of collapsing them into broad buckets:

```text
strong_phrase
  Source: OpenSearch lexical / MySQL alias phrase matching
  Use: high-quality title/alias phrase overlap

weak_lexical
  Source: OpenSearch lexical token overlap
  Use: recall only unless supported by graph, capability, or dense evidence

capability_task
  Source: search-meta capability hints and capability text
  Use: skill/task-enriched queries and noisy recruiter descriptions

semantic_dense
  Source: real embedding model vectors
  Use: semantic neighborhood evidence, especially when it agrees with lexical or graph context

mixed_agreement
  Source: combined lexical + dense + graph support
  Use: promote close leaves and broader branches when channels agree
```

OpenSearch lexical evidence now carries the raw material needed to split these tiers:

```text
matched_fields
matched_tokens
phrase_match
field_signals[]
  field
  field_class
  phrase_match
  matched_tokens
  token_coverage
  useful_token_coverage
query_token_count
useful_query_token_count
max_useful_token_coverage
```

Phase 18 should use these fields to distinguish strong useful phrase evidence from weak generic-token overlap.

## Resolver Decision Tree

```text
Start with scored branches
  |
  |-- No branches?
  |     -> unresolved
  |
  |-- Top branch has top candidate?
  |     |
  |     |-- Is top candidate leaf-safe?
  |     |     |
  |     |     |-- exact_alias:
  |     |     |   require score, branch clarity, leaf clarity
  |     |     |   generic high-risk queries require stricter gates
  |     |     |
  |     |     |-- folded_alias:
  |     |     |   require score, branch clarity, leaf clarity
  |     |     |
  |     |     |-- dense_only:
  |     |         require very high score, strong branch share, strong margin, capability support
  |     |
  |     |-- yes -> return leaf
  |
  |-- Is top branch fallback-safe?
  |     |
  |     |-- branch must be family or group
  |     |-- branch must be clear enough
  |     |-- exact/folded lexical branch can pass at moderate score
  |     |-- dense-only branch requires stronger share, margin, and capability support
  |     |
  |     |-- yes -> return family or group
  |
  |-- otherwise -> unresolved
```

## Persisted Evaluation Flow

```text
npm run evaluation:run
  |
  |-- Q1. Which queries are in scope?
  |     Table: ose_evaluation_queries
  |     Filter: notes JSON phase8_owned_by + phase8_set_key + source_name
  |
  |-- Q2. Resolve each query using normal runtime path
  |     Modules:
  |       retrieval -> branch expansion -> resolver
  |
  |-- Q3. Create a run record
  |     Table: ose_search_runs
  |     Stores: run_label, code_version, config_json, notes
  |
  |-- Q4. Persist selected/candidate graph nodes
        Table: ose_search_run_results
        Stores:
          selected_leaf/family/group rows when selected
          candidate_leaf/family/group rows for ranked evidence
          retrieval_sources_json
          explanation_json

Important:
- unresolved queries do not get fake selected rows
- run persistence does not change retrieval or resolver behavior
```

## Manual Review Flow

```text
npm run review:build
  |
  |-- Q1. What search run should be reviewed?
  |     Table: ose_search_runs
  |
  |-- Q2. Which evaluation queries failed or remained unresolved?
  |     Tables:
  |       ose_evaluation_queries
  |       ose_evaluation_expectations
  |       ose_search_run_results
  |
  |-- Q3. What type of issue is it?
  |     |
  |     |-- selected result mismatches expectation
  |     |     -> relatedness_gap
  |     |
  |     |-- unresolved or dense-only suspicious result
  |     |     -> dense_candidate
  |     |
  |     |-- multiple lexical candidates conflict
  |     |     -> alias_conflict
  |
  |-- Q4. Are there search-meta quality issues?
  |     Table: ose_search_meta
  |     |
  |     |-- high generic risk
  |     |     -> generic_head review/audit signal
  |     |
  |     |-- missing parent/family/group
  |     |     -> hierarchy_gap
  |     |
  |     |-- missing locale coverage
  |           -> cross_locale_gap
  |
  |-- Q5. Is a matching pending review row already present?
  |     Table: ose_manual_review_queue
  |     |
  |     |-- yes -> skip
  |     |-- no  -> insert pending row

Important:
- reviewed rows are not overwritten
- query-level items can have graph_node_id = NULL
- review rows do not automatically mutate graph/search-meta/retrieval/resolver behavior
```

## Readiness Comparison Flow

```text
npm run evaluation:compare
  |
  |-- Q1. Which run(s) should be reported?
  |     Table: ose_search_runs
  |
  |-- Q2. Which expectations define success?
  |     Tables:
  |       ose_evaluation_queries
  |       ose_evaluation_expectations
  |
  |-- Q3. What did each run select?
  |     Table: ose_search_run_results
  |     Rows: decision_stage LIKE 'selected_%'
  |
  |-- Q4. How is each query classified?
  |     |
  |     |-- selected_leaf matches exact_leaf expectation
  |     |     -> exact_leaf_hit
  |     |
  |     |-- selected_leaf matches acceptable_leaf expectation
  |     |     -> acceptable_hit
  |     |
  |     |-- selected_family/group matches family/group expectation
  |     |     -> family_or_group_hit
  |     |
  |     |-- no selected row
  |     |     -> unresolved
  |     |
  |     |-- selected row does not match expectation
  |           -> miss
  |
  |-- Q5. Are baseline and candidate comparable?
  |     |
  |     |-- same evaluation query IDs?
  |     |     yes -> compute deltas
  |     |     no  -> not comparable
  |
  |-- Q6. Can Search Machinery DoD be answered?
        |
        |-- requires:
        |   exact/folded/dense evidence observed
        |   hierarchy candidate rows observed
        |   selected outcomes observed
        |   comparable baseline + candidate
        |
        |-- ready only if:
            successful hits improve
            exact leaf hits do not regress
            misses do not increase
            unresolved does not increase
```

## Current Measured State

```text
Baseline run:  search_run_id=2, phase12-core-v1
Candidate run: search_run_id=3, phase14-subphrase-v1

Candidate vs baseline:
  selected_count:        +4
  unresolved_count:      -4
  exact_leaf_hit_count:   0
  family/group hits:      0
  miss_count:            +4
  pending_review_total:  +2

Conclusion:
  Search Machinery DoD can be answered from current evidence.
  Current answer: not ready.

Reason:
  Phase 14 improves coverage by resolving more queries, but those extra selected
  outcomes are not yet expectation hits. Conservative miss count and review debt
  increased, so the system has not cleared the precision/safety bar.
```
