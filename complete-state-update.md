# Complete State Update

## 1. Executive Summary

### Overall Project Objective
Build a high-quality occupation search engine in `/Users/otobio/repo/occupation-search-engine` using MySQL as the initial exploration and build substrate, TypeScript/Node.js for implementation, and a staged architecture that evolves from raw ESCO ingestion into:

- a canonical occupation graph
- a capability graph
- precomputed occupation search meta
- then later retrieval machinery, evaluation, and disambiguation

The broader strategic goal is to create a hierarchy-aware, multilingual occupation retrieval system where:

- ESCO is the canonical backbone
- English acts as the semantic backbone for richer aliasing and later boosting across locales
- local-language aliases remain first-class and exact matches remain dominant
- hierarchy and capability evidence help resolve ambiguity safely
- search meta makes occupations directly usable by future lexical and dense retrieval layers

### Current Project Status
The project has progressed from planning into concrete implementation. The following are already built and accepted:

- MySQL schema for the new occupation search engine
- Phase 0 repo scaffolding and DB utility layer
- Phase 1 ESCO source importer
- Phase 2 ESCO source audit tooling
- Phase 3 occupation graph materialization
- Phase 4 capability graph materialization
- Phase 5 occupation search meta generation

The next planned step is **Phase 6: search meta quality audits**, but this has not been implemented yet in this conversation because the sub-agent system hit a thread/agent limit.

### Current Phase
Current logical phase:

- **Phase 5 completed and accepted**
- **Phase 6 not started**

### What Has Been Completed
Completed and accepted:

1. Project schema and repo baseline
2. ESCO raw/source ingestion into `ose_source_*`
3. ESCO source audit CLI
4. Occupation graph build into `ose_graph_*`
5. Capability graph build into `ose_capabilities` and `ose_graph_capability_links`
6. Occupation search meta generation into `ose_search_meta*`

### What Remains To Be Done
Remaining high-priority work:

1. Phase 6: search meta quality audits
2. Phase 7: embedding layer
3. Phase 8: evaluation set
4. Phase 9: retrieval machinery
5. Phase 10: candidate merge and hierarchy expansion
6. Phase 11: disambiguation layer
7. Phase 12: search run tracking
8. Phase 13: manual review loop tightening

---

## 2. Original Requirements

### Project Requirements
The user wanted a brand-new project in:

- `/Users/otobio/repo/occupation-search-engine`

The system must:

- use MySQL first as the main exploration and joining substrate
- use TypeScript/JavaScript for implementation
- remain exploration-friendly before optimization
- support ESCO-based occupation modeling
- eventually support ONNX transformer embeddings / dense search later
- be built in phases with review gates

### Workflow Requirements
The user explicitly asked that the assistant act as:

- orchestrator
- reviewer
- quality evaluator
- builder-owner through sub-agents

The execution model requested by the user:

- all implementation work should be done in sub-agents where possible
- the main assistant should write the sub-agent prompt
- the main assistant should review and rerun critical commands itself
- accepted work becomes the baseline for the next phase

### Architectural Requirements
The user established a staged system with these conceptual layers:

1. source import layer
2. canonical occupation graph layer
3. capability graph layer
4. occupation search meta layer
5. retrieval layer
6. hierarchy-aware resolution layer

### Search Requirements
The intended search flow later is:

1. exact local alias retrieval
2. normalized/folded local alias retrieval
3. dense retrieval over occupation texts
4. candidate clustering by hierarchy
5. disambiguation using:
   - specificity
   - capability evidence
   - family consistency
   - generic-head suppression
6. final resolution at safest level:
   - leaf occupation if strong
   - family/group if not strong enough
   - unresolved if still unsafe

### Key Constraints
- Do not optimize too early.
- Keep canonical/search structures clean and explainable.
- Preserve ESCO structural richness rather than flattening too aggressively.
- English should enrich canonical nodes, not override clean locale-specific exact matches.
- Generic aliases should be flagged/reviewed first, not blindly deleted.
- Dense retrieval should support recall later, not replace trusted lexical resolution.

### Success Criteria
The conversation established success criteria by phase. The big ones are:

- every phase must build on the previous accepted state
- code must be rerunnable
- every phase must have verification queries or commands
- future retrieval must be powered by high-quality search meta
- hierarchy and capability information must survive into search-time structures

---

## 3. Architecture / Design Decisions

This section captures major design decisions already made and should not be casually revisited.

### Decision A: MySQL-first exploration architecture

**Chosen approach**
Use MySQL as the initial system of record for:

- raw/source ESCO ingestion
- canonical occupation graph
- capability graph
- search meta
- evaluation and review tables

**Rationale**
The user explicitly wanted MySQL first because it is easier for exploratory joins, audits, and data-shape validation before worrying about serving optimization.

**Alternatives considered**
- Jump straight to OpenSearch documents
- Build only JSON artifacts on disk first
- Use SQLite or file-based stores

**Why chosen**
MySQL supports the iterative source/graph/meta validation loops needed at this stage.

**Trade-offs**
- Not optimal for eventual production vector serving
- Some JSON-heavy storage is intentionally inefficient
- But excellent for traceability and inspection

### Decision B: ESCO is the canonical backbone

**Chosen approach**
ESCO remains the canonical occupation authority.

**Rationale**
Earlier in the conversation, ESCO was already established as the canonical occupation system. O*NET and others are enrichment sources, not replacements.

**Alternatives considered**
- O*NET as canonical
- blended ESCO/O*NET canonical ownership

**Why chosen**
ESCO already aligns better with multilingual support and the user’s existing work.

**Trade-offs**
- ESCO alias coverage can be weaker for some modern English titles
- Requires later English enrichment and search meta boosting

### Decision C: English as semantic backbone, locale aliases as first-class retrieval surface

**Chosen approach**
- exact local aliases remain top retrieval signal
- English provides richer backbone aliases and later dense support

**Rationale**
The user wanted better multilingual retrieval while still using English to strengthen the system. The right model is canonical occupation nodes with locale entry points, not searching local text directly against English aliases as equal peers.

**Alternatives considered**
- English-only dictionary
- locale-only independent taxonomies

**Why chosen**
This keeps exact local resolution strong while allowing English semantic support later.

**Trade-offs**
- More build complexity in search meta
- Need careful role separation between locale aliases and English backbone aliases

### Decision D: Build occupation graph before search meta

**Chosen approach**
The system must first materialize:

- occupation nodes
- hierarchy relationships
- aliases

then capability graph, then search meta.

**Rationale**
Search meta depends on a trustworthy graph. Without the graph, search meta is just a flat alias projection.

**Alternatives considered**
- Build search meta directly from source tables
- Skip graph and operate only on source + aliases

**Why chosen**
Hierarchy and capability reasoning were explicit goals, so graph-first was required.

**Trade-offs**
- More upfront build steps
- But avoids fragile search meta derived from incomplete structures

### Decision E: Use ESCO broader relations, not concept.broader field, as the real hierarchy driver

**Chosen approach**
Use `ose_source_relations.relation_kind='broader_occupation'` as the primary hierarchy source.

**Rationale**
Audit results showed `broader_external_uri` coverage on concepts was very sparse, while broader occupation relations were present for almost all occupations.

**Alternatives considered**
- trust concept `broader_external_uri`
- ignore hierarchy until later

**Why chosen**
The relation table is structurally far stronger.

**Trade-offs**
- Parent branches can be literal and sometimes broad
- But preserves structure better for future reasoning

### Decision F: Search meta as a first-class build layer

**Chosen approach**
Materialize:

- `ose_search_meta`
- `ose_search_meta_aliases`
- `ose_search_meta_ancestors`
- `ose_search_meta_siblings`
- `ose_search_meta_capability_hints`

**Rationale**
This was identified as the missing glue layer between taxonomy and retrieval.

**Alternatives considered**
- derive everything live during retrieval
- one giant denormalized OpenSearch document first

**Why chosen**
Search meta makes the next retrieval layer tractable and inspectable.

**Trade-offs**
- more build complexity
- more tables to keep in sync

### Decision G: Generic aliases are flagged before suppression

**Chosen approach**
Flag obviously generic single-token collisions for review rather than deleting them immediately.

**Rationale**
Earlier taxonomy work showed over-aggressive suppression can remove useful occupational aliases. The user preferred pragmatic breadth as long as uniqueness and contamination are handled carefully.

**Alternatives considered**
- immediate hard suppression
- keep everything without flags

**Why chosen**
Review-first preserves information while surfacing risk.

**Trade-offs**
- noisier intermediate graph/meta layers
- but safer than premature deletion

### Decision H: Stub capability labels must not pollute search text

**Chosen approach**
UUID-like capability labels are retained in raw/capability graph for traceability, but must be filtered or downgraded when generating search meta text surfaces.

**Rationale**
Capability graph review showed many stub labels, especially in the current `knowledge` slice.

**Alternatives considered**
- drop all stub capabilities entirely
- keep them everywhere

**Why chosen**
Preserve raw richness, but keep search-facing text clean.

**Trade-offs**
- capability graph and search meta differ in cleanliness
- but that is correct for their roles

---

## 4. Work Completed

This is the chronological record of major work completed in this conversation.

### Milestone 1: Knowledge-graph planning document in the old repo
Before moving fully into the new project, a detailed design plan was written in:

- `/Users/otobio/repo/mpx-jobs-ai-search/lib-enrichment/docs/OCCUPATION_KNOWLEDGE_GRAPH_PLAN.md`

This captured:

- graph model
- search meta concept
- phased build order
- separation of OpenSearch retrieval vs application-side logic

This document is strategic background and informed the new project.

### Milestone 2: New MySQL schema designed and applied
A full exploration-first schema was designed and applied to:

- database: `occupation_search_engine`

Schema includes:

- source import tables
- graph tables
- capability tables
- search meta tables
- embedding tables
- evaluation tables
- review queue
- build artifacts

The schema was saved to:

- `/Users/otobio/repo/occupation-search-engine/sql/schema.sql`

### Milestone 3: Implementation checklist created
A multi-phase execution checklist was written to:

- `/Users/otobio/repo/occupation-search-engine/docs/IMPLEMENTATION_CHECKLIST.md`

This checklist became the contract for sub-agent execution.

### Milestone 4: Phase 0 completed and accepted
Sub-agent built the repo scaffolding:

- `package.json`
- `tsconfig.json`
- `.env.example`
- `.gitignore`
- DB env loader
- MySQL connection utility
- schema apply CLI
- DB check CLI
- README

The main assistant reran the build and DB commands and accepted Phase 0.

### Milestone 5: Phase 1 completed and accepted
Sub-agent implemented ESCO source import into:

- `ose_import_runs`
- `ose_source_files`
- `ose_raw_rows`
- `ose_source_concepts`
- `ose_source_aliases`
- `ose_source_relations`
- `ose_source_memberships`

The main assistant reran import and checked counts.

Important verified source facts:

- `en` occupations: `3045`
- `ro` occupations: `3039`
- broader occupation relations preserved
- occupation-skill relations preserved

### Milestone 6: Phase 2 completed and accepted
Sub-agent built ESCO source audit CLI.

It reports:

- occupations by locale
- aliases per occupation
- missing broader relations
- missing aliases
- collection/membership distribution
- distinction between sparse concept broader field and strong broader relation coverage

The main assistant reran text and JSON audit outputs and accepted the audit layer.

### Milestone 7: Phase 3 completed and accepted
Sub-agent built occupation graph materialization into:

- `ose_graph_nodes`
- `ose_graph_node_sources`
- `ose_graph_aliases`
- `ose_graph_relationships`

Important accepted results:

- `3664` occupation-bucket graph nodes
- `57501` graph aliases
- `3648` broader hierarchy edges
- `1001` flagged generic aliases

The graph preserves ESCO hierarchy literally enough to support later meta generation.

### Milestone 8: Phase 4 completed and accepted
Sub-agent built capability graph into:

- `ose_capabilities`
- `ose_graph_capability_links`

Accepted results:

- `13,475` capabilities
- `11,641` skills
- `1,834` knowledge
- `126,051` occupation->capability links
- only `6` zero-link occupations, all stub UUID occupations

Important discovery:

- `5,617` stub UUID-like capability labels remain in the capability graph
- all `1,834` current `knowledge` capabilities sit within that stub-heavy set

### Milestone 9: Phase 5 completed and accepted
Sub-agent built occupation search meta into:

- `ose_search_meta`
- `ose_search_meta_aliases`
- `ose_search_meta_ancestors`
- `ose_search_meta_siblings`
- `ose_search_meta_capability_hints`

Accepted results:

- `3045` meta rows for `3045` active leaf occupations
- `3039` with hierarchy
- `3039` with capability support
- alias helper rows: `88515`
- capability hint rows: `36065 essential`, `30752 optional`

Most important quality result:

- search-facing text fields are not polluted by stub UUID capability labels
- `search_text` and `dense_text` look usable and semantically structured

---

## 5. Current State

### Exact Stop Point
We stopped immediately after **Phase 5 was accepted**.

The assistant attempted to continue the same sub-agent pattern into Phase 6, but the multi-agent system hit an execution limit in this thread earlier, then later enough capacity existed to continue until Phase 5. The current stopping point is still the same practical boundary:

- **Phase 6 not implemented**
- **Phase 5 accepted**

### Partially Completed Work
None beyond accepted Phase 5.

A sub-agent for Phase 6 was requested conceptually in the last part of the conversation, but not executed to completion in this thread after the handoff request.

### Unresolved Discussions
No major unresolved design debates remain up to this point. The remaining work is mostly implementation.

The only nuanced unresolved item is how strict later retrieval and audit phases should be about:

- parent/group over-literal graph structures
- knowledge stub labels
- generic-risk thresholds

These should be handled incrementally in audits and retrieval, not by revisiting core architecture.

### Pending Implementation
Pending phases:

- Phase 6 search meta audits
- Phase 7 embeddings
- Phase 8 evaluation set
- Phase 9 retrieval
- Phase 10 candidate merge / hierarchy expansion
- Phase 11 disambiguation
- Phase 12 search run tracking
- Phase 13 manual review loop

### Known Risks
1. **Stub capability labels**
   - large number of UUID-like capability labels exist
   - must remain filtered or downgraded in search surfaces

2. **Literal ESCO hierarchy**
   - graph preserves broad parent structures literally
   - some parents like `shop manager` have many children
   - may require interpretation in retrieval/disambiguation rather than graph suppression

3. **Search meta ancestry duplication**
   - a label can appear as both parent and group in ancestry because the graph preserves source structure literally
   - acceptable now, but audits should expose these patterns

4. **Source reruns are source-slice rebuild style**
   - not all tables preserve full per-run snapshots as independent immutable slices
   - acceptable at current stage, but should be remembered

### Blockers
No hard technical blocker in the code itself.

The only blocker encountered was sub-agent thread/agent limits in the current conversation. In a fresh ChatGPT conversation, this should no longer block orchestration.

---

## 6. Outstanding Tasks

This is the prioritized task list.

### Task 1: Phase 6 Search Meta Quality Audits

**Objective**
Evaluate whether the generated occupation search meta is strong enough to support retrieval.

**Dependencies**
- completed search meta layer

**Recommended approach**
Implement audit CLI(s) that report:

- missing hierarchy
- missing locale coverage
- alias sparsity by locale
- high generic risk
- empty dense text
- weak English backbone coverage
- possibly review-queue inserts for obvious issues

**Expected deliverables**
- audit CLI
- npm scripts
- README update
- optional `ose_manual_review_queue` inserts

### Task 2: Phase 7 Embedding Layer

**Objective**
Generate and store embeddings for search meta text surfaces.

**Dependencies**
- stable search meta
- ideally Phase 6 audit confirmation

**Recommended approach**
- register embedding models in `ose_embedding_models`
- generate embeddings for `dense_text` first
- store in `ose_node_embeddings`
- optional alias-bundle embeddings later

**Expected deliverables**
- embedding build CLI
- model registration logic
- verification counts and sample nearest-neighbor checks

### Task 3: Phase 8 Evaluation Set

**Objective**
Create repeatable evaluation queries and expected answers.

**Dependencies**
- basic search meta built

**Recommended approach**
Populate:

- `ose_evaluation_queries`
- `ose_evaluation_expectations`

Include:

- exact titles
- multilingual variants
- noisy recruiter titles
- family fallback cases
- ambiguous cases

**Expected deliverables**
- evaluation seed CLI or SQL load path
- sample evaluation corpus

### Task 4: Phase 9 Retrieval Machinery

**Objective**
Implement candidate retrieval across lexical and dense channels.

**Dependencies**
- search meta
- ideally embeddings
- evaluation set preferred

**Recommended approach**
Build retrieval stages in code:

1. exact local alias
2. folded local alias
3. dense search over embeddings / dense_text

Preserve candidate evidence by source.

**Expected deliverables**
- retrieval CLI or module
- candidate set output with evidence traces

### Task 5: Phase 10 Candidate Merge and Hierarchy Expansion

**Objective**
Cluster retrieved candidates into hierarchy branches.

**Dependencies**
- retrieval results
- graph + search meta

**Recommended approach**
- merge candidates by canonical node
- attach ancestors/siblings/family/group
- group by branch

**Expected deliverables**
- candidate merge module
- hierarchy expansion logic

### Task 6: Phase 11 Disambiguation Layer

**Objective**
Resolve the safest specific occupation level.

**Dependencies**
- candidate merge / hierarchy expansion
- evaluation set

**Recommended approach**
Score by:

- exactness
- specificity
- hierarchy consistency
- capability support
- generic risk suppression
- unrelated-branch penalties

Allow final states:
- leaf
- family/group
- unresolved

**Expected deliverables**
- resolver module
- scored output with explanation

### Task 7: Phase 12 Search Run Tracking

**Objective**
Persist search experiment outputs.

**Dependencies**
- retrieval and disambiguation

**Recommended approach**
Populate:

- `ose_search_runs`
- `ose_search_run_results`

**Expected deliverables**
- run logging
- result storage
- comparative review path

### Task 8: Phase 13 Manual Review Loop

**Objective**
Turn identified weak points into a persistent review workflow.

**Dependencies**
- audits and retrieval results

**Recommended approach**
Use `ose_manual_review_queue` for:

- generic alias conflicts
- hierarchy gaps
- cross-locale gaps
- dense-only suspicious candidates

**Expected deliverables**
- queue insertion logic
- review inspection CLI

---

## 7. Important Context

This section captures context that could easily be lost in a fresh conversation.

### Terminology
- **source layer**: `ose_source_*` imported ESCO data
- **occupation graph**: `ose_graph_nodes`, `ose_graph_aliases`, `ose_graph_relationships`
- **capability graph**: `ose_capabilities`, `ose_graph_capability_links`
- **search meta**: precomputed search-ready occupation profiles in `ose_search_meta*`
- **English backbone**: curated English aliases used as semantic support
- **generic risk**: search meta quality signal derived from alias genericity/collisions

### Naming Conventions
- DB prefix: `ose_`
- schema and project use `occupation_search_engine`
- default source name: `esco_1_2_1`

### Preferences
- boring, pragmatic engineering over overdesign
- exploration-friendly MySQL structures first
- keep intermediate layers inspectable
- preserve richness before aggressive suppression
- explicit verification after every phase

### Coding Style Expectations
- TypeScript, Node.js, mysql2, dotenv
- simple CLIs in `src/cli`
- keep logic modular under `src/...`
- use disk-backed SQL schema, not embedded giant strings for schema after Phase 0
- prefer readable utility and builder classes

### Workflow Expectations
The assistant is expected to act as:

- orchestrator
- architect
- reviewer
- quality gatekeeper
- sometimes direct implementer if sub-agents cannot be spawned

Pattern established:

1. define next phase precisely
2. delegate bounded implementation task to sub-agent
3. inspect changed files
4. rerun build and verification commands manually
5. accept or reject the phase
6. continue to the next phase

### Important Behavioral Rule
Do not casually skip verification. The main assistant has repeatedly rerun the critical commands itself before accepting a phase.

---

## 8. Files / Components / Modules

### Project Root

#### `/Users/otobio/repo/occupation-search-engine/sql/schema.sql`
Full MySQL schema for the project.

Status:
- created
- applied to DB
- should be treated as baseline schema unless a justified change is necessary

#### `/Users/otobio/repo/occupation-search-engine/docs/IMPLEMENTATION_CHECKLIST.md`
Execution roadmap by phase.

Status:
- created
- used as contract for phase execution

### Phase 0 Core

#### `src/config/env.ts`
Loads and validates DB env vars.

#### `src/db/mysql.ts`
Reusable MySQL connection helper.

#### `src/cli/apply-schema.ts`
Applies `sql/schema.sql`.

#### `src/cli/check-db.ts`
Checks DB connectivity and counts `ose_*` tables.

### Phase 1 ESCO Source Import

#### `src/config/esco.ts`
ESCO-specific env/config parsing.

#### `src/utils/csv/read-esco-file.ts`
Reads ESCO CSV files from directory or zip.

#### `src/utils/csv/parse-csv.ts`
CSV parsing utility.

#### `src/importers/esco/import-esco-source.ts`
Main ESCO source importer.

#### `src/cli/import-esco-source.ts`
CLI entrypoint for import.

### Phase 2 ESCO Source Audits

#### `src/audits/esco-source/audit-esco-source.ts`
Main source audit logic.

#### `src/cli/audit-esco-source.ts`
Audit CLI for source layer.

### Phase 3 Occupation Graph

#### `src/graph/reset-graph-bucket.ts`
Resets graph slice for a bucket.

#### `src/graph/occupation/build-occupation-graph.ts`
Builds occupation graph nodes, aliases, and hierarchy.

#### `src/cli/build-occupation-graph.ts`
Occupation graph CLI.

### Phase 4 Capability Graph

#### `src/graph/capability/reset-capability-graph-slice.ts`
Resets capability graph slice for a source.

#### `src/graph/capability/build-capability-graph.ts`
Builds capabilities and occupation->capability links.

#### `src/cli/build-capability-graph.ts`
Capability graph CLI.

### Phase 5 Search Meta

#### `src/search-meta/occupation/reset-occupation-search-meta.ts`
Resets search meta rows for a source scope.

#### `src/search-meta/occupation/build-occupation-search-meta.ts`
Builds main search meta and helper tables.

#### `src/cli/build-occupation-search-meta.ts`
Search meta build CLI.

### Current README
#### `/Users/otobio/repo/occupation-search-engine/README.md`
Updated through Phase 5 with commands and usage.

Status:
- should be kept aligned with new phases

---

## 9. Decisions That Must NOT Be Revisited

Do not revisit these unless new evidence appears.

1. **MySQL-first architecture is deliberate**
2. **ESCO is the canonical backbone**
3. **English is the semantic backbone, not the canonical override**
4. **Occupation graph must exist before search meta and retrieval**
5. **Use broader occupation relations, not sparse broader concept fields, as main hierarchy source**
6. **Search meta is a first-class layer and not optional**
7. **Generic aliases should be flagged first, not aggressively suppressed by default**
8. **Stub capability labels must be kept out of search-facing text**
9. **Every phase must be rerunnable and verifiable**
10. **The assistant should continue the orchestrator/reviewer role, not just code blindly**

---

## 10. Lessons Learned

### Discovery 1: Concept-level broader field is not sufficient
`broader_external_uri` on source concepts is too sparse to drive hierarchy.

**Do not** build future hierarchy logic on that field alone.

### Discovery 2: ESCO broader relations are strong enough to trust
`broader_occupation` relations exist for almost all occupations and are the real usable hierarchy backbone.

### Discovery 3: ESCO source includes stub UUID-like labels
This affects:

- some occupation stubs
- many capability labels
- especially knowledge-like capability rows

**Do not** use these naively in retrieval text or hints.

### Discovery 4: Literal graph preservation is useful at this stage
Some parents are broad or surprising, but preserving them now is better than flattening too early.

### Discovery 5: Search meta must filter, not merely copy
The usefulness of `search_text` and `dense_text` depends on actively filtering noisy sources such as stub capability labels and overgeneric aliases.

### Discovery 6: Review-first is safer than suppression-first
Flagging generic alias collisions retains information while still exposing risk.

---

## 11. Recommended Next Actions

This is the exact sequence the next ChatGPT should follow.

1. Read:
   - `complete-state-update.md`
   - `docs/IMPLEMENTATION_CHECKLIST.md`
   - `README.md`

2. Confirm current accepted state by rerunning:
   - `npm run build`
   - `npm run search-meta:occupations`
   - a small MySQL verification query for `ose_search_meta`

3. Implement **Phase 6: search meta quality audits**
   - add CLI audit(s)
   - report missing hierarchy, missing locale coverage, alias sparsity, high generic risk, empty dense text, poor English backbone coverage
   - optionally insert conservative rows into `ose_manual_review_queue`

4. Review Phase 6 with the same rigor:
   - inspect files
   - rerun audit commands
   - inspect SQL outputs

5. Move to **Phase 7: embedding layer** only after Phase 6 is accepted.

---

## 12. Role Continuity

In this conversation, the assistant has been acting as:

- system architect
- phased planner
- implementation orchestrator
- sub-agent prompt writer
- reviewer
- quality evaluator
- final acceptance gate

The next ChatGPT should continue in exactly the same role and with the same rigor.

Specifically:

- do not act as a passive coding assistant only
- continue the phase-by-phase contract
- if sub-agents are available, delegate bounded implementation slices
- if they are not available, implement directly but still preserve the same review discipline
- rerun important commands yourself before accepting a phase
- do not move to the next phase until the current one is accepted

---

## 13. Suggested First Prompt

Paste the following into a fresh ChatGPT conversation:

```text
You are resuming an occupation search engine project in:
/Users/otobio/repo/occupation-search-engine

Read this file first and treat it as the authoritative handoff:
/Users/otobio/repo/occupation-search-engine/complete-state-update.md

Then read:
- /Users/otobio/repo/occupation-search-engine/docs/IMPLEMENTATION_CHECKLIST.md
- /Users/otobio/repo/occupation-search-engine/README.md

Continue in the same role as the previous ChatGPT:
- orchestrator
- reviewer
- architect
- quality gatekeeper

Important working rules:
- do not re-decide finalized architecture unless new evidence appears
- use sub-agents for bounded implementation work if available
- inspect and rerun critical verification commands yourself before accepting a phase
- keep working phase by phase from the checklist

Current accepted state:
- Phase 0 through Phase 5 are complete and accepted
- Phase 6 (search meta quality audits) is the next task

Start by confirming the current state with a quick build and search-meta verification, then implement Phase 6.
```

---

## Self-Check / Gap Fill

This section fills in any missing context that could break continuity.

### Database Context
Database name:
- `occupation_search_engine`

Current credentials used repeatedly in verification:
- host: `127.0.0.1`
- port: `3306`
- username: `root`
- password: `root`

### Repository Context
Primary repo:
- `/Users/otobio/repo/occupation-search-engine`

Reference repo used for ESCO import semantics and historical taxonomy design:
- `/Users/otobio/repo/mpx-jobs-ai-search`

Important reference source files in that older repo:
- `scripts/import-esco-raw.php`
- `lib-enrichment/docs/OCCUPATION_KNOWLEDGE_GRAPH_PLAN.md`

### Important Current Counts
These are accepted baseline counts at the end of Phase 5:

- `ose_graph_nodes` leaf occupations: `3045`
- `ose_search_meta` rows: `3045`
- hierarchy-backed search meta rows: `3039`
- capability-backed search meta rows: `3039`
- capability graph rows: `13475`
- capability links: `126051`
- broader hierarchy edges: `3648`

### Why Phase 6 Matters Next
The next retrieval phase depends on confidence that search meta is actually healthy. Phase 6 must expose whether there are silent weaknesses in:

- hierarchy coverage
- locale alias coverage
- English backbone coverage
- generic risk distribution
- dense text quality
- stub/noisy search text contamination

Without that audit, moving into retrieval would be premature.

This handoff should now be sufficient for a new ChatGPT instance to continue the project without reopening the prior conversation.
