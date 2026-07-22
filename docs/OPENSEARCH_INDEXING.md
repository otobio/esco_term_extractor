# OpenSearch Indexing

Decision 3 adds a disposable OpenSearch index layer on top of canonical MySQL data. MySQL remains the source of truth for graph state, search meta, evaluation, review, and run persistence.

## Environment

Default env keys:

```text
OPENSEARCH_NODE=http://127.0.0.1:9201
OPENSEARCH_USERNAME=
OPENSEARCH_PASSWORD=
OPENSEARCH_INDEX_OCCUPATIONS=ose_occupations_v1
OPENSEARCH_INDEX_OCCUPATION_ALIASES=ose_occupation_aliases_v1
```

`OPENSEARCH_USERNAME` and `OPENSEARCH_PASSWORD` are optional. The scripts do not hard-code credentials.

## Create Or Recreate The Index

Create or update the composable template and ensure the index exists:

```bash
npm run opensearch:create:occupations
```

Delete and recreate the target index explicitly:

```bash
npm run opensearch:create:occupations -- --recreate
```

## Populate From MySQL

Bulk index canonical occupation documents from `ose_search_meta` and related canonical tables:

```bash
npm run opensearch:populate:occupations
```

Recreate the index first, then repopulate it in one command:

```bash
npm run opensearch:populate:occupations -- --recreate-index
```

Use a smaller batch for smoke checks:

```bash
npm run opensearch:populate:occupations -- --chunk-size=100 --limit=250
```

## Occupation Alias Index

The alias index is the structural replacement target for runtime MySQL alias lookup. It stores one document per search-meta alias, preserving the fields needed for deterministic scoring:

- `source_name`, `graph_node_id`, `canonical_label`
- `locale_code`
- `alias`, `normalized_alias_exact`, `normalized_alias`, `alias_text`
- `alias_token_count`
- `alias_role`: `locale_primary`, `locale_supporting`, `reviewed_crosswalk`, `family_supporting`, or `english_backbone`
- `alias_role_rank`, `alias_weight`, `alias_authority_score`
- `family_node_id`, `family_label`, `group_node_id`, `group_label`
- `generic_risk`, `has_capability_support`

Create or update the alias index:

```bash
npm run opensearch:create:occupation-aliases
```

Recreate and populate it:

```bash
npm run opensearch:populate:occupation-aliases -- --recreate-index
```

Smoke-populate a limited slice:

```bash
npm run opensearch:populate:occupation-aliases -- --chunk-size=500 --limit=5000
```

The default alias populate chunk size is `10000`, which is intended for full local rebuilds. Use a lower `--chunk-size` only for smoke checks or constrained machines.

The exact alias path queries `normalized_alias_exact` as an unfolded keyword. `normalized_alias_exact` preserves acronym tokens, for example `HVAC engineer`, while lowercasing normal words. The folded alias path queries `normalized_alias` as a keyword with the `ose_keyword` normalizer. Runtime sends a lowercase lookup-fold key only for this keyword lookup boundary; the canonical normalized/folded forms still preserve acronyms. Subphrase alias retrieval uses `constant_score` filtered `match_phrase` queries over analyzed `alias_text`, then TypeScript validates the token relationship. This gives token-position phrase containment without letting BM25 ranking decide alias authority.

Important acronym rule:

- Do not lowercase acronyms in normalized or folded source fields.
- Do use lowercase lookup keys when querying OpenSearch keyword fields that have lowercase/asciifolding normalizers.
- Controlled acronym expansion happens in query preparation, not in the OpenSearch index. Current English expansions include `HVAC`, `HVACR`, `AI`, `UX`, `UI`, `QA`, `HR`, `IT`, `CNC`, and `CAD`.

Alias candidate ordering is index-time structured:

- `alias_role_rank`: `locale_primary` > `reviewed_crosswalk` > `locale_supporting` > `family_supporting` > `english_backbone`
- `alias_authority_score`: role rank plus alias weight
- `alias_token_count`: shorter aliases break phrase-containment ties

Do not use occupation-level `normalized_aliases` as a scoring authority source; it does not preserve alias role or weight.

## Indexed Fields

Each occupation document includes:

- `graph_node_id`, `source_name`, `node_level`
- `canonical_label`, `normalized_label`
- `locale_aliases`, `locale_codes`, `aliases_text`, `normalized_aliases`
- `search_text`
- `family_node_id`, `family_label`, `group_node_id`, `group_label`
- `generic_risk`, `has_hierarchy`, `has_capability_support`
- `capability_text`, `ancestor_text`, `quality_flags`

## Retrieval Integration

Decision 3B adds OpenSearch lexical retrieval over the disposable occupation index. Runtime candidate selection now uses OpenSearch for exact alias, folded alias, safe subphrase alias, broader lexical, and capability evidence.

```bash
npm run retrieval:candidates -- --query="software developer" --locale=en
npm run evaluation:run -- --set-key=phase15-expanded-v1
```

OpenSearch occupation retrieval queries `canonical_label`, `aliases_text`, `search_text`, `capability_text`, and `ancestor_text`. OpenSearch alias retrieval queries the dedicated alias index and returns only bounded matching alias documents with role/weight provenance.

Current measured runs:

```text
baseline_run_id=5
hybrid_saturated_run_id=6
hybrid_relative_score_run_id=7
tuned_hybrid_run_id=9
semantic_transformers_hybrid_run_id=11
```

Run `7` uses query-relative OpenSearch score normalization. It is technically integrated but not ready versus baseline run `5`, because successful hits regress and misses increase.

Run `9` is the current tuned hybrid default and clears the conservative readiness gate against baseline run `5`.

## Current Boundaries

- MySQL remains canonical for graph state, aliases, evaluation rows, and persisted search runs.
- MySQL remains canonical rebuild storage, but deploy/runtime resolution can use generated runtime artifacts instead of MySQL.
- OpenSearch remains the default retrieval backend and provides exact/folded/subphrase alias lookup plus lexical/capability evidence when selected.
- The portable `binary-cache` backend provides the same retrieval boundary from generated binary artifacts for offline/package-local use.
- The OpenSearch index is disposable. Rebuild it from MySQL whenever canonical data changes.
