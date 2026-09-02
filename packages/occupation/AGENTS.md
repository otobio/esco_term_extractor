# AGENTS.md

This file documents project invariants that coding agents must preserve. Before changing retrieval, ranking, runtime artifacts, or pipeline selection, read this file and validate that the change does not violate the "How It Works" rules below.

## Coding Guidelines

Correctness, readability, and runtime speed are all first-class requirements in this repository. This is an occupation-resolution engine, so small ranking mistakes can produce semantically wrong ESCO results, and slow paths are user-visible.

- Prefer clear domain code at the ranking/retrieval boundary. A reader should be able to tell which evidence is alias, lexical, capability, family, graph, or reviewed-prior support without reverse-engineering generic plumbing.
- Keep reusable mechanics out of domain modules. Shared text normalization, sorted lookup, hash lookup, validation, scoring helpers, artifact loading, and comparison logic should live in utilities or focused helper classes, then be reused by the ESCO-specific implementation.
- Prefer shallow orchestration in hot paths. The main pipeline method should show the real operation order directly, especially query preparation, span splitting, retrieval, ranking, and fallback attempts. Avoid wrapper helpers that only hide a loop or branch without naming a reusable domain concept.
- Keep runtime data contracts lean and directional. A function should return the new data it produced, not echo the input context it was given. Do not return `preparedQuery`, normalized/folded query strings, source/locale/options, or debug-only fields from retrieval/ranking helpers when the caller already owns them. If display/debug output needs both input context and produced data, keep them as separate variables or a CLI/debug-only wrapper instead of bloating the runtime result type.
- Keep one owner for each query shape. Query cleaning/preparation owns raw query, effective query, spans, intent, tokens, and prepared forms. Retrieval consumes that prepared query and returns evidence/metrics. Branch retrieval consumes candidate evidence and returns graph branch evidence. Ranking consumes prepared query plus branch evidence and returns ranked decisions. Do not re-prepare queries, hide query preparation inside retrieval, or pass duplicate query forms through multiple layers just in case a later caller might want them.
- Prefer plain stage names over vague expansion/manager abstractions. Use names that describe the domain operation directly, such as candidate retrieval, branch retrieval, family scoring, or leaf recovery. Avoid compatibility aliases, "expander" wrappers, passthrough `run()` objects, and result objects whose main purpose is to carry unrelated fields from an earlier layer.
- Use advanced data structures when they materially improve query-time behavior. Sorted arrays with binary search, hash tables, compact numeric indexes, bitsets, precomputed token hashes, minimal/perfect hash tables, memory-mapped or binary artifacts, and cache-friendly layouts are welcome when they reduce lookup, parsing, allocation, or serialization cost.
- Make performance-oriented structures explicit and documented. If a structure is optimized for binary lookup, memory layout, or artifact loading speed, name that in the code and keep construction in build/export steps where possible.
- Prefer generated runtime artifacts over query-time construction. Runtime should load already-shaped data and perform bounded lookups/scans; artifact builders can do heavier normalization, grouping, sorting, hashing, and validation.
- Do not preload huge runtime artifacts or sidecar files into memory when bounded file-backed/range reads can preserve the same behavior. Large binary tables, postings, detail rows, strings, and generated indexes should be lazy, page/range-backed, or explicitly capped at runtime; eager loading is only acceptable when the file is small enough to be irrelevant under the Lambda memory budget and the decision is documented.
- Keep the Lambda runtime memory budget visible in code reviews: production occupation resolution should stay under a 300 MB RSS ceiling for representative warm mixed-locale and multi-span requests. If a retrieval/runtime change can push above that, measure it, document the tradeoff, and prefer file-backed access or bounded result shaping over weakening business logic.
- When a hot path only needs the top `N` results, avoid building full lean-plus-full representations in parallel. Compute expensive detail fields only for the retained top candidates, and trim per-span or per-family payloads before aggregation when the extra detail is not used downstream.
- Avoid duplicating retrieval surfaces or fallback passes unless the second pass materially changes selection quality. If a fallback exists only to rescue weak evidence, gate it tightly so it does not double the live object graph for already-sufficient queries.
- Push back on ideas that are over-engineered, compute-heavy, or misaligned with the current architecture before implementing them. State the concrete risk, such as extra runtime scans, memory growth, duplicated artifact contracts, loss of explainability, or unnecessary tie-breakers, and propose the smallest structure that preserves business logic and accuracy.
- When a new runtime contract is better, replace the old path instead of keeping parallel compatibility systems. Avoid dual schema/runtime branches unless an explicit migration window is required; otherwise fail clearly and rebuild the generated artifacts.
- Treat runtime artifact shape as a production contract. When changing an artifact, update the exporter, loader, runtime check, docs, and session handoff together; stale artifact documentation is a correctness risk because rebuild/runtime operators follow it.
- Do not let core query-preparation paths silently fall back to incomplete hand-built vocabularies when a generated runtime artifact is part of the production contract. It is acceptable for artifact builders and tests to provide explicit fixtures, but runtime resolution should load the generated artifact and fail clearly when it is missing.
- Keep modules small by extracting generic patterns before adding more domain branches. If several ranking/retrieval paths repeat the same matching, coverage, scoring, sorting, or validation pattern, move the pattern into a reusable helper and keep the domain module focused on ESCO semantics.
- Do not trade away explainability for speed. Optimized retrieval must still expose enough diagnostics to explain why a family or leaf won, especially matched terms, missing terms, evidence channels, and confidence gates.
- Prefer structural evidence improvements over fractional score tuning. Before changing weights, ask whether the pipeline is missing a clearer evidence channel, authority pass, gate, or generated artifact. Fractional tuning should be the last resort because it often shifts errors between cases without improving the model of evidence.
- Treat clause-separated occupation spans as independent occupation contexts, not as related modifiers for one title. If query preparation keeps multiple split spans such as `role A / role B`, the pipeline should resolve each surviving span like its own title call and expose span-level family/leaf results instead of pooling evidence into one selection.
- Benchmark or inspect timings when changing hot paths. Changes to artifact loading, retrieval calls, family recovery, query preparation, or candidate merging should be checked with pipeline debug timings.
- Do not retrofit runtime behavior just to make tests pass. When a regression or failure appears during artifact, retrieval, ranking, or query-preparation work, first identify the concrete cause and report it clearly. Do not apply unrequested semantic fixes, ranking changes, or threshold adjustments unless the user explicitly approves that broader scope.
- Before debugging a failing title, verify that the case is actually supposed to be generically solvable under the current contract. Check whether the title is intentionally handled by a curated phrase/common-role rescue, an abstain/unresolved path, an exact-canonical rescue, or a multi-span split contract before changing retrieval or ranking. If the current tests or code explicitly say the no-rescue behavior should stay unresolved, do not "fix" it by broadening retrieval or downstream scoring.

## New Occupation Classifier Boundary

`src/occupation-classifier/specialization/**` is a structural extraction framework. Its job is to extract canonical specialization concepts and role heads from title text. It is not the occupation classifier itself.

Specialization code owns:

- token/span classification into specialization dimensions;
- canonical concept IDs, concept aliases, concept equivalence, and role-head aliases;
- role-head phrase and concept span arbitration;
- locale-aware extraction inputs used by classifier preparation and translation-related matching;
- specialization gate decisions such as exact concept, equivalent concept, literal match, recoverable value, unknown, or contradiction.

Specialization code does not own:

- candidate scoring;
- leaf promotion thresholds;
- family selection;
- ranking tie-breakers;
- fallback policy;
- retrieval behavior;
- classifier decision types or confidence shaping.

When fixing specialization behavior, stay inside the specialization framework unless the user explicitly asks to change classifier ranking or selection. If a specialization change exposes a failure in `src/occupation-classifier/candidates.ts`, `families.ts`, `decision.ts`, retrieval, or runtime artifacts, report that as a separate downstream issue instead of patching across the boundary.

Within the classifier, specialization output is consumed as extracted structure, including for translation-related matching. The classifier may use extracted concepts and role heads, but classifier logic must not be changed as a side effect of a specialization-framework task. If a downstream scoring or selection invariant appears wrong, stop and make the boundary crossing explicit before editing it.

## How It Works

This codebase resolves free-text job titles to ESCO occupation graph nodes. ESCO has broader grouping nodes and leaf occupation nodes:

- A `family` is a broader ESCO occupation group used when the query is real but no single leaf is safe enough.
- A `leaf` is the final ESCO occupation node returned only when the evidence supports a specific occupation.
- An `alias` is a known title/synonym for a leaf, including locale-specific labels and reviewed crosswalk aliases.
- A `capability` is skill/knowledge/task/tool text linked to occupations. It can explain occupational intent, but result-side capabilities must not justify an otherwise wrong leaf.
- A `domain/context term` narrows where the job happens, such as `airline`, `hospital`, `hotel`, or `school`.
- An `occupation head term` describes the work role itself, such as `auditor`, `nurse`, `developer`, `driver`, `teacher`, or `installer`.
- A `dictionary gap` means the query is plausible but ESCO does not have a safe exact leaf for the full title.

Pipeline stages:

1. Query preparation
   Status: implemented.
   What happens: `cleanOccupationTitleSignals` first extracts strong occupation signals from the submitted title using the generated signal-vocabulary artifact. This is the OOV/signal-trimming pass: weak title fragments can be dropped, and kept fragments become the effective query. Clause-separated kept fragments are also preserved as `querySpans`. Then async `prepareQuery` loads the generated intent-vocabulary artifact and builds normalized, folded, tokenized, variant-expanded, acronym-expanded, role/head, and domain/context query forms for retrieval. `prepareFamilyScopedQuery` builds the token set used later for family/leaf fit checks.
   Why it matters: every downstream retrieval path currently searches the effective query, so a bad signal-cleaning decision changes the whole pipeline.

2. Multi-occupation span handling
   Status: implemented.
   What happens: when query preparation keeps multiple clause-separated occupation spans, the pipeline returns a `multi_span` decision and runs each span through the normal pipeline independently. Top-level family/leaf rankings stay empty because the spans are separate job contexts, not one combined occupation.
   Why it matters: titles such as `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD` commonly mean a company is advertising one of two roles or two separate roles. Evidence from one span must not make the other span select a wrong family or leaf.

3. Query intent separation
   Status: implemented as generated artifact plus runtime classifier.
   What happens: the generated intent vocabulary and query-intent classifier split the prepared title into `role/head` intent and `domain/context` modifiers before family-profile scoring and family-constrained recovery. For `Airline Compliance Auditors`, the intended structure is `role=compliance auditors`, `domain=airline`.
   Why it matters: family selection searches for the role first, then uses domain as support. Domain must not select a family by itself.

4. Direct candidate retrieval
   Status: implemented.
   What happens: `OccupationCandidateRetriever` queries exact aliases, folded aliases, canonical-label matches, subphrase aliases, lexical text, capability/task text, and alias-ngram evidence through the configured retrieval backend.
   Why it matters: these channels produce leaf evidence. They are not final decisions, and exact/folded/canonical evidence must stay separate from lexical, capability, and ngram evidence.

5. Candidate evidence merge
   Status: implemented.
   What happens: all evidence for the same ESCO `graphNodeId` is merged into one candidate with channel scores, total score, scanned hit counts, and diagnostics.
   Why it matters: later ranking depends on which channel produced the evidence, not only on the total score.

6. Graph family mapping
   Status: implemented.
   What happens: branch expansion loads runtime search-meta records for candidate leaves and attaches ESCO hierarchy data: family, group, parent, siblings, generic risk, hierarchy support, and capability support.
   Why it matters: this creates the family candidates that can be returned when no specific leaf is safe.

7. Pipeline evidence accumulation
   Status: implemented.
   What happens: branch and candidate evidence are copied into pipeline family/leaf records. Branch share and branch margin become `graph_support`; candidate channels become family and leaf evidence. Non-English exact aliases can add English-backbone support from the same ESCO record.
   Why it matters: this is where retrieval evidence becomes ranking evidence.

8. Family profile evidence
   Status: implemented as a generated runtime artifact.
   What happens: the pipeline loads prebuilt family profiles and scores the query against aggregated family labels, aliases, leaf labels, and capability labels.
   Why it matters: this gives family-level evidence without constructing large family indexes during query execution.

9. Family scoring
   Status: implemented with role-first evidence.
   What happens: families are ranked from graph support, exact/folded/lexical evidence, family-profile evidence, semantic evidence, role coverage, domain support, breadth, capability support, leaf fit, and generic-risk penalties.
   Why it matters: this decides which ESCO families get leaf recovery. Role evidence is the primary family signal; domain evidence only refines families that already match the role.

10. Family-constrained leaf recovery
   Status: implemented.
   What happens: after top families are selected, the pipeline loads local leaf records for those families and runs family-constrained lexical retrieval through the configured retrieval backend. It also loads aliases and capability labels for recovered leaves.
   Why it matters: leaf promotion is restricted to the selected family context instead of searching the entire ESCO graph again.

11. Leaf scoring and promotion
    Status: implemented.
    What happens: recovered leaves are scored with direct evidence, semantic evidence, role-scoped title/alias closeness, family-scoped fit, capability fit, hierarchy support, and family confidence.
    Why it matters: result-side capabilities may support a plausible leaf, but must not justify a leaf that lacks role/title grounding.

11a. Post-recovery family authority
    Status: implemented.
    What happens: after family-constrained recovery, families are reranked with recovered leaf authority: exact alias evidence, role-head coverage, best recovered leaf role coverage, best recovered leaf selection tier, family-profile role coverage, confidence, and branch support.
    Why it matters: branch share/global retrieval evidence is discovery evidence, not final selection authority. A family with a recovered leaf that clearly matches the role should beat a family that only has broad branch support.

12. Coverage status
    Status: implemented.
    What happens: the result reports whether the selected leaf/family is an exact canonical match, closest available match, cross-locale support, likely dictionary gap, or insufficient evidence. It exposes matched and missing query terms from the top leaf.
    Why it matters: callers need to know when ESCO does not safely cover the submitted title.

Example: `Airline Compliance Auditors` should treat `airline` as domain context and `compliance/auditors` as the occupation intent. A pilot or aircraft-control family is wrong even though `airline` is a strong aviation signal, because those results do not represent the auditor/compliance role.

## Retrieval Backend Contract

The retrieval boundary is `OccupationRetrievalEngine` in `src/retrieval/retrieval-engine.ts`.

- Default runtime behavior is OpenSearch.
- Alternate engines must implement the same interface and be injected explicitly.
- Do not add new direct OpenSearch construction inside pipeline stages.
- Do not let a file-backed or in-memory backend return rows outside the requested `sourceName`, `locale`, or `familyNodeId`.
- Keep exact alias, folded alias, subphrase alias, canonical-label, lexical, and family-constrained retrieval as distinct evidence paths.

See `docs/RETRIEVAL_ENGINE.md` for return types and backend requirements.

## Runtime Artifacts

Runtime should consume prebuilt artifacts instead of constructing large indexes during query execution.

- Search meta, retrieval index, signal vocabulary, intent vocabulary, role-head equivalences, alias ngrams, family-token relevance, and family profiles live under `artifacts/runtime`.
- Generated runtime artifacts are rebuilt with `npm run runtime:artifacts-build`.
- Runtime loaders should use `src/runtime/runtime-dir.ts` for default artifact paths.
- New artifact loaders must validate manifests and records before use.
- Avoid adding per-query full-record scans or memory-heavy index construction unless the result is cached and measured.

## Family Profiles And Capability Evidence

Family profiles are generated ahead of runtime and aggregate family labels, aliases, leaf labels, and capability labels.

Result-side capability labels are supporting evidence for an already plausible leaf. They must not become circular selection evidence that makes a wrong weakly retrieved leaf look correct.

Do not derive query intent from selected leaf capabilities. Query intent is extracted during async query preparation from the generated intent-vocabulary artifact, before family-profile scoring, family recovery, and leaf promotion. Downstream stages should use role/head terms first and treat domain/context terms only as support.

## Selection Invariants

Preserve these ranking rules:

- Exact alias and exact canonical matches are the strongest occupation evidence.
- Folded/local alias evidence outranks weak lexical, capability-only, or ngram-only evidence.
- Weak lexical, capability-only, or ngram-only evidence should not promote a leaf when useful query terms are missing.
- Family-level selection is acceptable when no leaf safely represents all useful query terms.
- Coverage status must expose missing useful terms for dictionary gaps and partial matches.
- Domain terms should constrain a match when possible, but should not dominate occupational head terms.

## Regression Checks

Before finalizing retrieval, ranking, runtime artifact, query-preparation, or pipeline-selection changes, always run the full local regression gate:

```bash
npm run build
npm run test:structural
npm run evaluation:golden:pipeline:developing
npm run evaluation:golden:pipeline -- --suite=stable
```

Do not skip the stable suite just because the change looks structural or artifact-only. Artifact layout, lazy hydration, and retrieval backend changes can still move rankings.

When a change is specifically intended for the offline binary-cache backend, run the same golden suites with that backend as well:

```bash
npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache
npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache
```

Important exploratory case:

```bash
npm run resolution:pipeline -- --query="Airline Compliance Auditors" --locale=en --debug --no-color
npm run resolution:pipeline -- --query="LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD" --locale=ro --debug --no-color
```

This case should expose `airline` as domain/context and `compliance`/`auditors` as role intent. A result may still be a dictionary-gap family when ESCO lacks a safe full leaf, but it must not drift to pilot or aviation-operation families based on the domain term alone.
The Romanian slash-separated case should expose a top-level `multi_span` decision with separate span-level results, not a single blended family/leaf.
