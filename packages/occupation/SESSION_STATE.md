# Session State

Current resolver objective: keep the family/leaf fallback structural and locale-aware, using shared role-head equivalence data rather than resolver hardcoding, and validate it on the RO 100-title sample.

New proposed direction: run an `LLM-Assisted Job Title Triage for Structural Artifact Discovery` pilot on a small real-title batch (start with 100 titles) to discover reusable query-preparation and family-support structures from market titles without requiring direct human review of all 10k titles.

Pilot framing and constraints:
- The LLM should not replace the resolver or classify against the full ESCO ontology directly.
- The LLM should act as a bounded title analyst on top of existing pipeline/debug output and propose structured artifact candidates.
- Expected LLM outputs are things like role heads, domain/context terms, title span structure, abbreviation expansions, noisy tokens, hazardous ambiguous tokens, and reusable marker/pattern suggestions.
- The desired outcome of the pilot is structural artifact discovery, not a free-form alias table and not one-off title fixes.
- Anything that looks like a hack or a title-specific patch is not acceptable.

Runtime/data-structure readiness check for the pilot:
- Already consumable today through existing code paths:
  - locale-specific noise peeling rules via `src/query/occupation-noise-peeling.ts`
  - reviewed/common role phrase anchoring via `src/query/common-role-phrase-atlas.ts`
  - reviewed family-alias anchoring via `src/query/family-alias-atlas.ts`
  - role-head equivalence classes via `src/runtime/seeds/occupation-role-head-equivalents.json` and the exported runtime artifact
  - intent-vocabulary-driven role/domain separation via the generated intent-vocabulary artifact
- Not yet backed by a dedicated runtime artifact contract:
  - marker-to-family support discovered from real job titles
  - hazardous alias suppression / ambiguity guardrails sourced from title review
  - generalized LLM-reviewed abbreviation/market-marker artifacts beyond the current hardcoded/query-prep lists
- Conclusion: the pilot is structurally viable, but only part of its output can be consumed immediately. Before integrating new marker-support or hazardous-alias results into runtime, we need explicit artifact schemas, exporter/loaders, validation, and pipeline integration points consistent with the existing runtime-artifact architecture.

Execution checklist with abort gates:

Phase 0: Guardrails and scope lock
- [ ] Keep the work at the job-title pipeline boundary; do not expand into generic ESCO-wide semantic systems.
- [ ] Do not add title-specific hacks, ranking exceptions, or free-form LLM classification.
- [ ] Treat the pilot as blocked until missing runtime artifact contracts exist.
- Abort early if proposed work starts depending on one-off fixes, score tuning, or opaque LLM outputs that cannot be turned into validated artifacts.

Phase 1: Define missing runtime contracts before any pilot
- [ ] Define a `job-title marker support` artifact contract.
- [ ] Define a `hazardous alias suppression` artifact contract.
- [ ] Decide whether reviewed abbreviation / market-marker expansions belong in one of those artifacts or a third dedicated query-prep artifact.
- [ ] For each artifact, define:
  - [ ] schema and manifest fields
  - [ ] source review format
  - [ ] exporter/build entry point
  - [ ] runtime loader and validation rules
  - [ ] exact pipeline/query-prep integration point
  - [ ] diagnostics/explainability surface
- Abort early if an artifact cannot be integrated cleanly without duplicating existing retrieval/ranking evidence paths.

Phase 2: Wire the missing bits into the system in a minimal dormant form
- [ ] Add artifact seed/review files with no behavior-changing entries by default.
- [ ] Add exporter(s) and runtime loader(s).
- [ ] Add runtime artifact checks and structural contract tests.
- [ ] Add debug/explainability output showing when the new artifacts contribute.
- [ ] Keep production behavior unchanged until reviewed entries are present.
- Abort early if the dormant integration changes ranking behavior or materially complicates the hot path.

Phase 3: Offline sample-dataset evaluation without LLM
- [ ] Prepare a bounded RO sample set for structural testing.
- [ ] Manually seed a very small number of obvious entries to exercise the new artifact paths.
- [ ] Run targeted probes and the structural/regression gates.
- [ ] Measure whether the new artifact types produce useful family/leaf improvements, cleaner coverage states, or better debug explanations.
- Abort early if the artifact paths do not show clear value on the sample dataset.

Phase 4: Decide whether the LLM pilot is justified
- [ ] Review Phase 3 results.
- [ ] Confirm that at least one new artifact type is useful enough to justify automated discovery.
- [ ] Confirm that the runtime system now has a place to consume the pilot outputs.
- Abort the LLM pilot entirely if the new artifact paths do not prove useful on the sample dataset.

Phase 5: LLM-Assisted Job Title Triage for Structural Artifact Discovery
- [ ] Define a strict JSON output schema for the LLM.
- [ ] Limit the LLM to bounded title analysis plus pipeline-context review.
- [ ] Ask for artifact proposals, not free-form ESCO decisions.
- [ ] Start with 100 titles only after Phases 1-4 pass.
- [ ] Bucket outputs into:
  - [ ] consumable by existing artifacts
  - [ ] consumable by new artifacts added in Phase 1-2
  - [ ] non-actionable / ambiguous / dictionary-gap
- Abort early if the LLM mostly returns non-reusable phrase-by-phrase suggestions or low-consistency outputs.

Current user direction:
- Prefer wiring the missing runtime-consumption pieces first and testing them on a sample dataset before starting any LLM pilot.
- Only proceed to the LLM pilot if the new artifact paths prove useful in practice.

Bounded pre-pilot experiment direction:
- Before any broad LLM pilot, run a narrow structural experiment on two representative blue-collar family clusters from the RO sample.
- Recommended targets based on repeated sample failures and near-misses:
  - `Electrical equipment installers and repairers` / `Electronics and telecommunications installers and repairers`
  - `Assemblers` (including adjacent mechanical/industrial assembly titles)
- Representative titles in scope include:
  - `TEHNICIAN-ALPINIST TELECOMUNICATII`
  - `Electrician întreţinere şi reparaţii`
  - `Electrician -Tehnician retele echipamente electrice,date-voce`
  - `Electrician montator de instalatii automatizate`
  - `Lacatus mecanic asamblare`
  - `Mecanic utilaje industriale`
- Goal: generate and test a very small reviewed set of marker-support and suppression-style entries for only these family clusters, wire them through the new artifact path, and measure whether they produce structural improvement on the sample dataset.
- This is not yet the LLM pilot; it is a bounded proof-of-utility experiment for the missing runtime artifact path.
- Only give a green light to the broader LLM-assisted title-triage pilot if this bounded experiment shows clear value without hacks or regression drift.

Bounded experiment result:
- Implemented a new reviewed runtime artifact path for bounded family-level marker support / suppression:
  - seed: `src/runtime/seeds/occupation-reviewed-family-signals.json`
  - runtime artifact: `artifacts/runtime/occupation-reviewed-family-signals.json`
  - loader/matcher: `src/runtime/occupation-reviewed-family-signals.ts`
  - exporter: `src/cli/export-occupation-reviewed-family-signals-artifact.ts`
- Integrated the new artifact into runtime boot, runtime checks, package artifact build, and pipeline family scoring.
- Added a dedicated family-evidence channel pair:
  - `reviewed_family_signal`
  - `reviewed_family_penalty`
- Added reviewed-signal authority into post-recovery family ordering so a strong reviewed family signal is not discarded after recovery.

Bounded experiment scope actually validated:
- Target family cluster 1: `Electronics and telecommunications installers and repairers` #15139
- Target family cluster 2: `Assemblers` #15204
- Reviewed rules stayed narrow and role-grounded; no ranking-stage hacks or title-specific if/else logic were added.

Validated improvements:
- `TEHNICIAN-ALPINIST TELECOMUNICATII`
  - before: unresolved, top family confidence ~42% and drift risk toward non-installer branches
  - after: family `Electronics and telecommunications installers and repairers` #15139 at ~83-85% with `reviewed_family_signal`
- `Lacatus mecanic asamblare`
  - before: selected family `Machinery mechanics and repairers` #15114 while `Assemblers` was only a secondary candidate
  - after: selected family `Assemblers` #15204 at ~82% with `reviewed_family_signal`

RO 100-title sample effect:
- latest run summary after the bounded experiment:
  - `leaf=41`, `family=38`, `group=0`, `multi_span=7`, `noise_only=4`, `unresolved=10`
- previous noted sample summary in this file was:
  - `leaf=36`, `family=36`, `group=0`, `multi_span=7`, `noise_only=4`, `unresolved=17`
- This bounded experiment therefore reduced unresolved cases materially on the sample while increasing resolved family/leaf outcomes.

Regression validation after the bounded experiment:
- `npm run build`: passed
- `npm run test:structural`: passed 97/97
- `npm run semantic:bootstrap:matches`: completed; sample output updated at `data/taxonomy-review/ro-family-leaf-sample.csv`
- `npm run evaluation:golden:pipeline:developing`: 33/55, same total pass count as before this experiment
- `npm run evaluation:golden:pipeline -- --suite=stable`: 20/25, same total pass count as before this experiment

Decision:
- Green light for the broader LLM-assisted artifact-discovery pilot is justified.
- Reason: the missing runtime-consumption path now exists and proved useful on bounded real-title cases without introducing new known-suite regression count growth.

Pilot dataset/build state:
- Added a repeatable pilot-batch builder at `scripts/build-llm-job-title-triage-pilot.js`.
- Added npm entry point: `review:triage:pilot`.
- Added strict LLM output schema: `data/taxonomy-review/job-title-triage-output.schema.json`.
- Added aggregated proposal schema: `data/taxonomy-review/job-title-triage-proposals.schema.json`.
- Added pilot contract doc: `docs/LLM_JOB_TITLE_TRIAGE_PILOT.md`.
- Added full handoff doc: `docs/LLM_JOB_TITLE_TRIAGE_HANDOFF.md`.
- Added token-efficient brief builder: `scripts/build-llm-job-title-review-brief.js`.
- Added npm entry point: `review:triage:brief`.
- Added one-file review bundle builder: `scripts/prepare-llm-job-title-review-bundle.js`.
- Added npm entry point: `review:triage:bundle`.
- Added one-command 2-title smoke flow: `scripts/run-llm-job-title-triage-smoke.js`.
- Added npm entry point: `review:triage:smoke`.
- Added proposal aggregation script: `scripts/aggregate-llm-job-title-triage-proposals.js`.
- Added npm entry point: `review:triage:aggregate`.
- Current generated RO pilot dataset:
  - `data/taxonomy-review/job-title-triage-pilot.ro.jsonl`
  - `data/taxonomy-review/job-title-triage-pilot.ro.manifest.json`
- Current generated RO brief review surfaces:
  - `data/taxonomy-review/job-title-triage-brief.columns.json`
  - `data/taxonomy-review/job-title-triage-brief.ro.tsv`
  - `data/taxonomy-review/job-title-triage-brief.ro.manifest.json`
  - `data/taxonomy-review/job-title-triage-review-bundle.ro.json`
- Current RO pilot batch summary:
  - `records=100`
  - `leaf=36`
  - `family_or_group=38`
  - `multi_span=7`
  - `unresolved=15`
  - `noise_only=4`
- The JSONL rows include:
  - original and peeled title
  - effective query and query spans
  - prepared query / role-head / domain diagnostics
  - top ranked families and top leaves with evidence summaries
  - reviewed rule ids when present
  - allowed artifact classes and schema reference for bounded LLM triage
- The brief files keep only the highest-value review fields so LLM review does not waste tokens on the full heavy pipeline dump by default.
- Important detail contract:
  - `job-title-triage-brief.columns.json` defines the review fields once.
  - `job-title-triage-brief.ro.tsv` carries only short field keys plus row values, so the LLM does not pay repeated field-description cost.
  - The review builder now emits only the agreed efficient artifacts for this stage; unused alternate review formats were removed.
- Current size comparison for the RO 100-row batch:
  - full pilot JSONL: `567838` bytes
  - columnar TSV: `69491` bytes
- Default review policy:
  - load `job-title-triage-brief.columns.json` once
  - review `job-title-triage-brief.ro.tsv` in batches as the primary LLM surface
  - open the full pilot JSONL only as a last resort for ambiguous rows that still need extra evidence detail
- The pilot builder is locale-parameterized so the same process can be reused later for HU/ET with different inputs.

Current direct in-process review state:
- The LLM review is currently being executed directly in this process, not through an external API client and not through a separate operator account.
- Per-batch reviewed outputs are being written under:
  - `data/taxonomy-review/job-title-triage-reviewed.ro.batches/`
- The merged reviewed output is rebuilt from those batch files into:
  - `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`
- Aggregated proposal outputs are refreshed with:
  - `npm run review:triage:aggregate`

Current reviewed progress checkpoint:
- Reviewed batches completed: `0001` through `0048`
- Reviewed row range completed: `1-1200`
- Current merged reviewed file:
  - `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`
- Current aggregate outputs:
  - `data/taxonomy-review/job-title-triage-proposals.ro.json`
  - `data/taxonomy-review/job-title-triage-proposals.ro.csv`
- Current aggregate totals from the 1200-row reviewed subset:
  - `rows_reviewed=1200`
  - `total_proposals=303`
  - `unique_proposals=193`

Current promoted-runtime checkpoint:
- Promoted a first runtime-backed subset of the repeated 600-row review findings instead of waiting for the full 10k review to finish.
- Promoted surfaces were limited to the highest-confidence, repeated, structurally compatible classes already supported by runtime:
  - `common_role_phrase`
  - `role_head_equivalence`
  - `reviewed_family_signal`
  - `reviewed_family_penalty`
  - a small expansion of existing noise peeling rules
- Updated source files:
  - `src/query/common-role-phrase-atlas.ts`
  - `src/query/occupation-noise-peeling.ts`
  - `src/runtime/seeds/occupation-role-head-equivalents.json`
  - `src/runtime/seeds/occupation-reviewed-family-signals.json`
- Re-exported runtime artifacts:
  - `artifacts/runtime/occupation-role-head-equivalents.json`
  - `artifacts/runtime/occupation-reviewed-family-signals.json`

Promoted common-role phrase patterns include:
- `agent vanzari` / `agent vânzări` / `agenți de vânzări`
- `agent servicii clienti` / `agent servicii client`
- `relatii clienti`
- `sef de tura` / `responsabil de tura` / `manager de tura`
- `manager adjunct` / `adjunct manager magazin` / `manager adjunct magazin`
- `manager magazin` / `director de magazin` / `director magazin`
- `programator CNC`
- `operator productie`
- `operator telesales`
- `instalator sanitar`
- `lucrator comenzi`
- `personal de serviciu`
- `manager parc auto`
- `sofer livrari`
- `mecanic mentenanta`
- `electrician intretinere si reparatii`

Promoted role-head equivalence additions include:
- `medic` <-> `doctor` / `physician`
- `stivuitorist` <-> `forklift`
- `strungar` <-> `lathe`
- `achizitor` <-> `buyer`

Promoted reviewed family-level rules include:
- pharmacy-assistant support -> `Medical and pharmaceutical technicians` #14874
- boutique/retail sales support -> `Shop salespersons` #15021
- customer-service support -> `Client information workers` #14965
- customer-service suppression against `Administrative and specialised secretaries` #14914
- agricultural machinery mechanic support -> `Machinery mechanics and repairers` #15114
- heavy-driver marker support -> `Heavy truck and bus drivers` #15215
- electrical-network suppression against telecom-installer drift -> `Electronics and telecommunications installers and repairers` #15139
- assembly-operator support -> `Assemblers` #15204

Promoted noise-peeling additions include repeated metadata phrases such as:
- `perioada determinata` / `perioada nedeterminata`
- `cazare asigurata`
- `free accommodation`
- `cauta colegi`
- `pebune`

Regression state after the first 600-row promotion pass:
- `npm run build`: passed
- `npm run test:structural`: passed 99/99
- `npm run evaluation:golden:pipeline:developing`: 33/55, unchanged from the prior baseline
- `npm run evaluation:golden:pipeline -- --suite=stable`: 20/25, unchanged from the prior baseline
- Conclusion: this first promotion pass appears production-safe under the current local gate and is a valid resumable checkpoint.

Current 1200-row promotion checkpoint:
- Promoted the next highest-value repeated findings from the `1-1200` reviewed subset into the existing query-prep and reviewed-family runtime paths.
- Added new reviewed/common role phrases in `src/query/common-role-phrase-atlas.ts`:
  - `manager program` -> `programme manager`
  - `consultant it` -> `ICT consultant`
  - `customer agent` -> `customer service representative`
  - `support advisor` -> `customer support representative`
  - `operator montaj` -> `assembler`
  - `manipulant marfa` -> `material handler`
- Added new reviewed family rules in `src/runtime/seeds/occupation-reviewed-family-signals.json`:
  - support `Physical and engineering science technicians` #14842 for `tehnician` titles with `audit` / `calitate` / `produs`
- Re-exported the binary reviewed-family runtime artifact after the new rules:
  - `artifacts/runtime/occupation-reviewed-family-signals.binary.manifest.json`
  - companion binary rows / strings / term-id files

Current span-structure checkpoint:
- Replaced the earlier token-bucket span-merge heuristics with a less hacky intent-based merge gate in `src/query/occupation-retrieval-query.ts`.
- Adjacent kept spans are now merged using existing query-preparation signals such as:
  - phrase/family alias anchors
  - role-token gain in the combined span
  - confidence gain in the combined span
  - weak or context-only standalone span detection
- This keeps the structural benefit for reviewed cases like:
  - `Specialist planificare/ logistica`
  - `COMMUNITY & EVENTS COORDINATOR`
  - `Antrenor / instructor pentru gimnastica ritmica`
  - `COLECTOR CREANTE DEBITE - DEPARTAMENT SALES SUPPORT`
- The explicit fallback hack that suppressed English-surface fallback whenever query prep rewrote the role query was removed after review; the repo is back to the normal fallback logic.

Current reverted experiment checkpoint:
- Tried a narrow `near-exact` / order-insensitive role-form exactness layer for cases like `Manager program` -> `programme manager`.
- The experiment was reverted in the same session because it leaked into core leaf/family ranking and caused regressions on unrelated exact/localized titles, including technology and ICT cases.
- Guardrail recorded from this failure:
  - do not reintroduce near-exact role-form authority without isolated negative tests proving that specialized and partial leaves cannot outrank legitimate generic-head family logic or exact localized alias paths.
- The useful part of the idea is recorded for future design work, but no near-exact runtime logic remains active in the current codebase.

Current review cleanup checkpoint:
- Removed the broad textile-family suppression idea for generic `operator productie` titles before commit preparation.
- Reason: it was too broad and could hide legitimate textile-production titles instead of only suppressing drift.

Regression state after the 1200-row promotion + cleanup pass:
- `npm run build`: passed
- `npm run test:structural`: passed 109/109
- `npm run evaluation:golden:pipeline:developing`: 34/55, unchanged from the prior local baseline
- `npm run evaluation:golden:pipeline -- --suite=stable`: 20/25, unchanged from the prior local baseline
- Representative spot checks:
  - `Operator montaj FW A350` now resolves through `assembler` and lands in `Assemblers`
  - `Tehnician audit de produs` now lands in `Physical and engineering science technicians` with `reviewed_family_signal`
  - `Manager program` now preserves `programme manager` through pipeline fallback gating

Current deeper query-preparation absorption pass:
- After the first runtime-seed promotion pass, implemented a deeper structural query-preparation improvement rather than waiting for the full 10k title review.
- Main change: locale token-variant logic is now shared and used both for retrieval expansion and for intent-time token matching.
- Added shared module:
  - `src/query/token-variants.ts`
- Updated query-preparation to route expansion through the shared token-variant layer:
  - `src/query/query-preparation.ts`
- Updated query-intent matching so role-head / role-modifier / domain / ambiguous checks can recognize locale variants instead of only exact tokens or the old English-only simple plural reduction:
  - `src/query/query-intent.ts`

What this deeper pass added structurally:
- Romanian inflection support improvements for repeated occupation forms discovered in the first 600 rows:
  - plural -> singular reductions
  - feminine -> base occupation reductions
  - repeated shop-floor / retail / office market title variants
- Romanian synonym/head bridging for repeated market forms discovered in the 600-row review:
  - `medic` -> doctor/physician side
  - `stivuitorist` -> forklift side
  - `strungar` -> lathe side
  - `achizitor` -> buyer side
- Query intent now sees more of the real variant space before fallback, instead of only seeing raw surface tokens plus acronym expansion.

Consistency cleanup applied during this pass:
- Removed new redundant diacritic-only duplicates from normalized rule paths where normalization already collapses them.
- Kept inflectional variants only where they represent meaningfully different normalized forms such as `cauta` vs `cautam`.

Regression state after the deeper query-preparation pass:
- `npm run build`: passed
- `npm run test:structural`: passed 100/100
- `npm run evaluation:golden:pipeline:developing`: 34/55, improved by +1 from the previous 33/55 checkpoint
- `npm run evaluation:golden:pipeline -- --suite=stable`: 20/25, unchanged from the previous checkpoint

Observed evaluation effect from this deeper pass:
- Confirmed improvement on Romanian plural-accountant handling:
  - `dev-ro-contabile` now passes in the developing suite.
- Stable suite remained flat while the stronger locale-aware expansion and intent matching were added.

Current production interpretation:
- The system is now materially closer to production-grade locale handling because reviewed learnings are no longer only seed phrases and family rules; they now also inform the core token-variant and intent-recognition layer.
- Remaining big structural gaps are still:
  - broader Romanian phrase coverage for repeated market titles not yet promoted
  - better span-splitting control for synonym pairs, bilingual duplicates, and role-plus-context separators
  - further locale-aware morphology/synonym coverage for HU/ET and for more Romanian occupation classes

Current reviewed-family runtime-format checkpoint:
- Converted the `reviewed_family_signal` / `reviewed_family_penalty` runtime artifact path from JSON runtime loading to a binary manifest + table representation.
- Authoring input remains JSON seed:
  - `src/runtime/seeds/occupation-reviewed-family-signals.json`
- Runtime artifact is now exported as:
  - `artifacts/runtime/occupation-reviewed-family-signals.binary.manifest.json`
  - companion binary files for strings, rows, and term ids
- Updated runtime loader/export path:
  - `src/runtime/occupation-reviewed-family-signals.ts`
  - `src/cli/export-occupation-reviewed-family-signals-artifact.ts`
- Runtime behavior is preserved at the matcher/API surface, but JSON rule parsing is no longer paid in the runtime path.

Regression state after the reviewed-family binary conversion:
- `npm run build`: passed
- `npm run test:structural`: passed 100/100
- `npm run evaluation:golden:pipeline:developing`: 34/55, unchanged from the deeper query-preparation checkpoint
- `npm run evaluation:golden:pipeline -- --suite=stable`: 20/25, unchanged from the deeper query-preparation checkpoint
- Conclusion: reviewed-family runtime is now on the binary artifact path with no observed local regression drift.

Current absorption status of the first 600 reviewed RO titles:
- Absorbed into production/runtime-relevant paths already:
  - repeated Romanian common-role phrases promoted into `common-role-phrase-atlas`
  - repeated role-head equivalences promoted into the reviewed role-head equivalence seed + runtime artifact
  - repeated family support/suppression patterns promoted into reviewed family signals and exported to binary runtime artifact form
  - repeated Romanian morphology/synonym findings promoted into the shared token-variant layer and wired into query preparation + intent matching
  - repeated employment/recruiting/accommodation noise findings promoted into the current noise-peeling rule tables
- Not yet fully absorbed from the 600-row review:
  - the full remaining repeated phrase clusters not yet promoted from the reviewed JSONL aggregate
  - token-variant-aware phrase matching in `common-role-phrase-atlas` and `family-alias-atlas`
  - conversion of `common-role-phrase-atlas` and `family-alias-atlas` from hardcoded source arrays into generated runtime artifacts
  - broader runtime-backed noise-rule authoring/export flow instead of the current code-embedded rule table
  - structural span-splitting fixes for synonym pairs, bilingual duplicates, and role-plus-context separators discovered in the review
- Interpretation:
  - The 600-row review has been materially absorbed, but not exhausted.
  - We have already converted the highest-confidence repeated findings into runtime behavior and query-preparation behavior.
  - The remaining work is mostly about moving more reviewed phrase/noise/span knowledge into proper generated artifact paths and stronger phrase matching, not about discovering whether the review was useful.

What the first 600 reviewed rows are revealing:
- The biggest value is not one-off family forcing; it is repeated canonicalization, repeated family support, and repeated noise stripping.
- The strongest recurring reusable phrase or head patterns so far include:
  - `strungar` -> `lathe and turning machine operator`
  - `stivuitorist` -> `forklift operator`
  - `asistent manager` -> `management assistant`
  - `manager adjunct` / `adjunct manager magazin` -> assistant-store-manager style intent
  - `director de magazin` / `director magazin` / `manager magazin` -> store-manager intent
  - `sef de tura` / `responsabil de tura` / `manager de tura` -> shift-supervisor intent
  - `operator productie` -> `production operator`
  - `programator cnc` / CNC-machine wording -> industrial CNC programmer/operator intent
  - `relatii clienti` / `agent servicii clienti` / customer-service phrasing -> customer-service representative intent
  - `lucrator comercial` / `asistent vanzari` / retail-advisor phrases -> retail shop-sales intent
  - `instalator sanitar` -> `plumber`
  - `medic` -> `medical doctor` when the row clearly refers to a human clinical specialty and not veterinary work
  - `personal de serviciu` -> cleaner/cleaning-staff intent
  - `mecanic mentenanta` / `electrician intretinere si reparatii` -> maintenance-mechanic / maintenance-electrician intent
- The strongest recurring family-support or family-penalty patterns so far include:
  - heavy-driver signals from `categoria c`, `c-e`, `c+e`, `tir`, `curse interne`, `comunitate`
  - shop-sales support for `consilier vanzari`, boutique retail wording, and sales-assistant retail surfaces
  - installer or repairer support for electrical-network and telecom-service wording
  - assembler support for `asamblare` and assembly-operator wording
  - machinery-mechanic support for mechanical/agricultural-equipment titles
  - penalties against telecom-installer drift when the title is clearly about electrical networks rather than telecom
  - penalties against assembly drift when the title is clearly a mechanic or maintenance role
- The strongest recurring noise themes so far include:
  - salary and currency markers such as `ron`, `eur`, salary ranges, and bonus fragments
  - recruiting boilerplate such as `cauta colegi`, `angajeaza`, `#pebune`
  - employment-term markers such as `perioada determinata`, `full time`, `part-time`, `4h`
  - benefit or relocation metadata such as `cazare asigurata`
  - repeated employer, city, and branch metadata overwhelming otherwise clear role heads

Interpretation of the 600-row subset:
- The review is confirming that the highest-yield runtime improvements are likely to come from:
  - phrase-level canonicalization of common Romanian market titles
  - role-head equivalence for recurring market shorthand and acronym forms
  - family-level support for repeated blue-collar and retail patterns
  - family-level penalties for repeated drift patterns
  - better noise peeling for salary, recruiting boilerplate, location, and employment-format fragments
- The review is not indicating that title-specific hacks or free-form alias dumping are needed.
- The review is also showing repeated bad-span-split cases where separators join synonymous role wording, seniority variants, bilingual duplicates, or role-plus-context rather than separate occupations.

Recommended next resume point:
- Continue direct review from batch `0025` onward.
- Keep writing per-batch files under `data/taxonomy-review/job-title-triage-reviewed.ro.batches/`.
- Rebuild `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl` from the batch directory after each run block.
- Re-run `npm run review:triage:aggregate` after each run block and inspect repeated proposals before promoting any runtime seeds.

Current repeatable commands:
- Build/runtime verification:
  - `npm run build`
  - `npm run test:structural`
- Generate RO pilot batch:
  - `npm run review:triage:pilot`
- Generate token-efficient RO review brief:
  - `npm run review:triage:brief`
- Generate one-file RO review bundle:
  - `npm run review:triage:bundle`

Smoke-flow state:
- Fixture input:
  - `data/taxonomy-review/job-title-triage-smoke-input.ro.csv`
- One-command end-to-end smoke flow:
  - `npm run review:triage:smoke`
- Smoke outputs:
  - `data/taxonomy-review/smoke/job-title-triage-pilot.smoke.ro.jsonl`
  - `data/taxonomy-review/smoke/job-title-triage-brief.smoke.columns.json`
  - `data/taxonomy-review/smoke/job-title-triage-brief.smoke.ro.tsv`
  - `data/taxonomy-review/smoke/job-title-triage-reviewed.smoke.ro.jsonl`
  - `data/taxonomy-review/smoke/job-title-triage-proposals.smoke.ro.json`
  - `data/taxonomy-review/smoke/job-title-triage-proposals.smoke.ro.csv`
  - `data/taxonomy-review/smoke/job-title-triage-review-bundle.smoke.ro.json`
- Smoke validation result: passed.
- Smoke review summary:
  - row 1 telecom title produced reviewed family support for #15139 and family penalty for #15204
  - row 2 assembly title produced reviewed family support for #15204
  - aggregated proposal output contained the expected three structural proposals with no schema drift
- Aggregate reviewed LLM proposal output:
  - `npm run review:triage:aggregate`
- Regenerate sample review CSV:
  - `npm run semantic:bootstrap:matches`
- Golden regression gates:
  - `npm run evaluation:golden:pipeline:developing`
  - `npm run evaluation:golden:pipeline -- --suite=stable`

Pilot operating checklist (must be followed during execution):
- Use this file as the working memory and state tracker for the pilot.
- Keep the pilot focused on production-grade, repeatable structures for job-title -> closest safe ESCO family/leaf resolution.
- Do not add hacks.

Anti-hack rules:
- No direct title-specific code paths.
- No `if query == ...` or substring special-casing for one title.
- No ranking-stage exceptions added only to rescue one case.
- No score tuning without a structural artifact or evidence-path reason.
- No free-form LLM classification over all ESCO.
- No opaque LLM outputs entering runtime directly.

Allowed implementation shapes:
- Add reviewed entries to an existing artifact contract.
- Add a new artifact contract only when it has a clear runtime purpose, loader, validation, and explainability surface.
- Improve query preparation structurally when the behavior generalizes across many titles.
- Add family-level support or suppression only when it is role-grounded and explainable.

Pilot output classes currently allowed:
- `reviewed_family_signal`
- `reviewed_family_penalty`
- existing noise rules
- existing role-head equivalence updates
- existing reviewed/common role phrase updates when clearly reusable
- existing family-alias anchoring updates when clearly reusable

Pilot output classes currently not allowed into runtime without a new contract:
- free-form alias dumps
- leaf-forcing rules
- open-ended abbreviation tables with no validation/gating model
- arbitrary LLM rationale with no typed artifact destination

Validation questions for every LLM-derived proposal:
- Which artifact contract does it belong to?
- Does it generalize beyond one title?
- Is it role-grounded rather than just domain/context grounded?
- Does it preserve exact/folded alias supremacy?
- Can it be explained in debug output with rule id, matched terms, and target family?
- Can it be added without changing core ranking logic for unrelated queries?
- Would the same pattern be reusable for other locales later?

Minimum acceptance bar for any LLM-derived runtime rule:
- Must fit a declared artifact contract.
- Must be explainable in debug output.
- Must help a repeated pattern, cluster, or clearly productive market form.
- Must not increase known golden-suite failure counts materially.
- Must not require title-specific fallback code.

Abort gates during the pilot:
- Stop a rule batch if most suggestions are one-off phrases.
- Stop if new rules mainly improve one title each with no reuse pattern.
- Stop if a rule causes stable/developing suite failure growth.
- Stop if a rule competes with exact/folded alias authority rather than supporting family selection.
- Stop if a suggestion has no clear runtime artifact destination.

Execution flow for the pilot:
- Step 1: run LLM-assisted triage on a bounded title batch.
- Step 2: convert outputs only into allowed artifact proposal classes.
- Step 3: deduplicate proposals into reusable patterns.
- Step 4: reject one-off/non-structural proposals.
- Step 5: seed reviewed artifacts.
- Step 6: run sample evaluation and regression gates.
- Step 7: keep only rules that improve real titles while preserving production invariants.

Target outcome of the pilot:
- A repeatable system that can solve real job titles to the closest safe ESCO family at minimum, and to a leaf when evidence is strong enough.
- A process that can be reused for later locales by changing reviewed artifacts, not by adding locale-specific hacks to ranking/runtime.

Latest resolver state:
- Added a shared teaching equivalence class in `src/runtime/seeds/occupation-role-head-equivalents.json` and mirrored it into `artifacts/runtime/occupation-role-head-equivalents.json`.
- Moved a broader-family rescue into `src/search-pipeline/occupation-search-pipeline.ts` so the pipeline can fall back to a better family when the top leaf is a false positive.
- The RO sample CSV now resolves `Educator-Puericultor - Bucuresti` to `University and higher education teachers` #14769 instead of `zoo educator` #16824.
- Current sample output path: `data/taxonomy-review/ro-family-leaf-sample.csv`.
- Latest 100-row RO run summary: `leaf=36`, `family=36`, `group=0`, `multi_span=7`, `noise_only=4`, `unresolved=17`.
- Noise peeler now preserves the original title when no noise was actually removed, so separator punctuation like `-` is not dropped just because the title was tokenized internally.
- The RO sample CSV now exposes both `query` (raw peeled title sent to the pipeline) and `effective_query` (pipeline-prepared query) to avoid confusion.
- `normalizeQueryLocale()` returns `unknown` for unsupported locales; `unknown` is a safe fallback, not a supported locale profile.
- Remaining review note: the current sample still has unresolved noisy cases like `TEHNICIAN-ALPINIST TELECOMUNICATII`, `Operator calculator - Magazin Online`, `Sef tura patiserie Delissima Bakery`, `Responsabil de Tură București, Gării Cățelu (f/m)`, and `ȘEF DE ȘANTIER REABILITARE REȚELE TERMICE`, which should be tackled by the RO noise extractor rather than the resolver.
- Confirmed fixed in the latest rerun: `Livrator BRINGO cu autoturism propriu (ORAS - IASI)` now peels to `Livrator`, and `Cautam colegi pentru Pizza Hut!` is now `noise_only`.

LLM-style audit of the current RO 100-row sample:
- Noise peeling still needs to be stricter about preserving untouched punctuation and separators unless a chunk was actually removed.
- The sample export should keep `query` and `effective_query` distinct so reviewers can tell what came from peeling versus what came from query preparation.
- `TEHNICIAN-ALPINIST TELECOMUNICATII` is still a noise-peeling miss, likely because the compound `alpinist`/location-like token is not being classified strongly enough.
- `Livrator BRINGO cu autoturism propriu (ORAS - IASI)` is still a noise-peeling miss for employer/app branding plus location.
- `Cautam colegi pentru Pizza Hut!` is now a confirmed `noise_only` case and should stay as a reference pattern for CTA + employer-brand stripping.
- `Operator calculator - Magazin Online` is a likely mixed noise / low-signal query-prep case and should be reviewed as a title pattern, not a family issue.
- `Sef tura patiserie Delissima Bakery` is still a likely employer-brand plus shift-pattern noise miss.
- `Responsabil de Tură București, Gării Cățelu (f/m)` is a location + shift case that needs better embedded-location handling.
- `Inginer executie electrice` and `ȘEF DE ȘANTIER REABILITARE REȚELE TERMICE` are likely true dictionary-gap or weak-coverage cases, not pure noise.
- `Jurist` still appears to be a family-placement weakness rather than a clean noise issue.
- Multi-span cases such as `Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician` are behaving as intended and should stay separate from single-title cleanup.

Current objective: Build a deterministic, locale-specific noise pattern extractor for job-title cleanup, starting with RO `ejobs` and HU `profession` inputs, then decide how to persist and consume the extracted patterns.

Latest user direction:
- Focus on deterministic noise extraction first, not ESCO-derived language statistics.
- Use locale-specific patterns from real RO title corpora to capture obvious noise like locations, employment flags, dates, salary markers, identifier tags, and UI artifacts.
- Use `/Users/otobio/Downloads/ejobs_job_titles.csv` as the RO source of truth and `/Users/otobio/Downloads/profession_job_titles_01.csv` + `_02.csv` as the HU source of truth.
- Keep the extractor isolated behind its own review/export entry so it does not get hardcoded into unrelated query or ranking logic yet.
- Store generation state in this file so the extractor build remains recoverable.

Current working shape:
- A standalone extractor script at `scripts/extract-noise-patterns.js`.
- A reusable noise-peeling utility at `src/query/occupation-noise-peeling.ts` for future query-preparation integration.
- NPM entry point: `review:noise:extract`.
- NPM entry point: `review:noise:audit`.
- Locale profiles are standardized through `LOCALE_PROFILES`, now including `ro` and `hu`.
- Input corpus:
  - `/Users/otobio/Downloads/ejobs_job_titles.csv`
  - `/Users/otobio/Downloads/profession_job_titles_01.csv`
  - `/Users/otobio/Downloads/profession_job_titles_02.csv`
- Output review CSVs:
  - `data/taxonomy-review/job-title-noise-patterns.ro.csv`
  - `data/taxonomy-review/job-title-noise-patterns.hu.csv`
- Sample review CSVs:
  - `data/taxonomy-review/job-title-noise-patterns.sample.ro.csv`
  - `data/taxonomy-review/job-title-noise-patterns.sample.hu.csv`
- Sample audit CSVs:
  - `data/taxonomy-review/job-title-noise-audit.sample.ro.csv`
  - `data/taxonomy-review/job-title-noise-audit.sample.hu.csv`
- Columns:
  - `locale`, `kind`, `match_type`, `surface`, `normalized_surface`, `source`, `ejobs_count`, `profession_count`, `title_count`, `lead_count`, `middle_count`, `trail_count`, `confidence`, `action`, `examples`
- Audit columns:
  - `row_index`, `title`, `normalized_title`, `chunk_count`, `matched_noise`, `matched_noise_count`, `obvious_hints`, `obvious_hint_count`

Pattern strategy:
- Match obvious noise with normalized substring checks rather than ESCO semantics.
- Treat location detection as explicit-only with a known-hints list so occupations do not get swallowed by a broad fallback.
- Add a location-context pass for common embedded-location forms such as `pe teren`, `zona`, `oras`, `jud`, `municipiul`, `autoturism propriu`, and suffix-style markers like `jud.` / `judet` / road and mall/park references followed by a place token.
- Include explicit Romanian locality hints for frequently seen tokens such as `Otopeni`, `Timisoara`, `Iasi`, `Galati`, `Buftea`, `Harghita`, `Acatari`, and `Medgidia`.
- Keep an acronym-aware normalization path for noise decisions so short uppercase/alpha-numeric codes can be treated differently from ordinary folded text.
- Treat bracketed chunks as noise by default; do not spend effort interpreting the parenthetical content.
- Treat employer-brand detection conservatively so one-word occupational titles do not become brand noise.
- Normalize occupation exemptions and location hints before matching so accent-folded title text still hits the right filters.
- Keep shift/schedule text in its own `noise_shift` bucket so it does not get diluted into the generic date bucket.
- Use the sample audit file to inspect the original sampled titles, not just the successfully matched noise rows.

Generation progress:
- Added `scripts/extract-job-title-pattern-review.js` to mine signal/noise chunks from the RO/HU extracts.
- Added `scripts/extract-noise-patterns.js` for the dedicated noise-only pass.
- Added npm script `review:noise:extract`.
- Added npm script `review:noise:sample` for a seeded 100-title RO validation pass.
- Added npm script `review:noise:audit` to write the original sampled 100 titles plus matched noise and obvious-hint columns.
- The dedicated extractor now runs successfully and writes per-locale review CSVs.
- Latest run summary:
  - sample extractor currently yields `32` noise rows from seeded `100`-title RO and HU subsets
  - `noise_location=16`
  - `noise_employment=4`
  - `noise_shift=...` now splits from the generic date bucket
  - `noise_date=4`
  - `noise_salary=0`
  - `noise_identifier=1`
  - `noise_cta=1`
- The output is intentionally review-oriented, not a runtime artifact yet.
- The 100-title sample currently holds up on the obvious noise cases after tightening salary and employer-brand false positives.
- The sample now explicitly keeps singleton location hits so examples like `Manipulant Marfa – Bucuresti- Ilfov (f/m)` surface both the employment flag and the location chunk.
- The audit now shows embedded location patterns directly in the sampled titles, including `Tehnician pe teren zona Harghita`, `Livrator BRINGO cu autoturism propriu (ORAS - IASI)`, `Lucrător Depozit – Galati - Travel Free`, `Mecanic utilaje industriale - Acăţari,jud.Mures`, `ȘEF DE ȘANTIER – PARCUL 1 MAI, MUNICIPIUL MEDGIDIA`, and `Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI`.
- The sample audit now shows the original 100 titles alongside detected noise chunks so missed patterns can be reviewed directly.
- The extractor still has a few conservative edge cases to review, but the core noise classes are now being captured from the RO corpus.
- The extractor now emits locale-specific review and audit files so RO and HU never share one combined artifact.
- The HU profile currently catches obvious location/workplace context in titles such as `Univerzális tanácsadó - Kistarcsa` and `Banki tranzakciós tanácsadó (Budapest)`, but it still needs more locale-specific employment and venue noise patterns before it is ready for runtime use.
- Latest per-locale sample run:
  - `ro`: `20` noise rows
  - `hu`: `21` noise rows
- Latest full per-locale run:
  - `ro`: `229` noise rows
  - `hu`: `51` noise rows
- Utility state:
  - `src/query/occupation-noise-peeling.ts` is added but not yet wired into query preparation.
  - Next locale work still needs `et` and `en` profiles before integration.

New review-corpus work:
- Added `scripts/extract-job-title-pattern-review.js` to mine candidate signal/noise chunks from real RO/HU job-title extracts in `/Users/otobio/Downloads/ejobs_job_titles.csv` and `/Users/otobio/Downloads/profession_job_titles.csv`.
- Generated a review CSV at `data/taxonomy-review/job-title-pattern-review.csv`.
- The review CSV is chunk-based rather than token-based, to preserve title context and avoid the city-name/standalone-head ambiguity that showed up in the first pass.
- Final review CSV summary:
  - 644 chunk rows total
  - 390 signal candidates
  - 120 noise candidates
  - 134 review/ambiguous candidates
- The current classifier cleanly marks obvious noise such as `f/m`, `Szűrés`, `Értékeld munkahelyedet`, `Diákmunka`, `Full-Time`, `Part-Time`, `September 15th start date`, and location chunks like `București`, `Bacau`, `Craiova`, and `Budapest` as noise.
- The current classifier keeps clear occupational candidates like `Hostess`, `Brand Ambassador`, `Sales Development Representative`, and `Inginer Ofertare` on the signal side.

Semantic atom experiment handoff:
- Preserved on branch `experiment/semantic-atoms-family-evidence`, commit `46d2b97` (`Preserve semantic atom family evidence experiment`).
- That branch contains the semantic atom CSV, binary exporter/loader, runtime artifact, ranking integration, tests, and measured probes.
- Mainline should not keep semantic atoms unless a future measured comparison shows they beat the discriminator approach for accuracy/runtime/maintenance cost.

Family ambiguity discovery:
- Added offline CLI `src/cli/inspect-family-ambiguity.ts`.
- Added npm script `families:ambiguity`.
- The CLI mines ambiguous family pairs from runtime search-meta labels plus a capped set of English aliases. It normalizes by family size and downweights terms shared by too many families.
- Output is written to `artifacts/analysis/family-ambiguity.esco_1_2_1.json`; this is analysis data, not a runtime artifact.
- Latest run: `npm run families:ambiguity -- --limit=250` produced 250 candidate ambiguous family pairs from 125 families and 3039 leaves.
- Examples surfaced by the artifact:
  - `Building and housekeeping supervisors` <-> `Domestic, hotel and office cleaners and helpers`
  - `Nursing and midwifery associate professionals` <-> `Personal care workers in health services`
  - `Database and network professionals` <-> `Software and applications developers and analysts`
  - `Architects, planners, surveyors and designers` <-> `Artistic, cultural and culinary associate professionals`
  - `Sales, marketing and development managers` <-> `Sales, marketing and public relations professionals`
- This gives us an ESCO-derived ambiguous-family target list for LLM-generated discriminators instead of relying only on the small developing/golden failure set.

Taxonomy cleanup / override review:
- User wants a small override path for obvious ESCO broad-family placement issues before adding discriminator runtime logic.
- Example verified by debug pipeline: `website designer` selects leaf `web designer` #15902 with `matched_label="website designer"` under broad family #14739 `Architects, planners, surveyors and designers`, group #14745 `Graphic and multimedia designers`.
- Generated review-only CSV at `data/taxonomy-review/esco-subfamily-family-review.csv`.
- The CSV has one row per unique ESCO group/sub-family from runtime search-meta, with current broad family, leaf count, example leaves, and blank review/override columns.
- Latest generation produced 427 sub-family rows plus header.
- `Graphic and multimedia designers` is `sub_family_node_id=14745`, current family #14739, 16 leaves including `web designer`, `graphic designer`, `illustrator`, and `animator`.
- There is one visible missing-label bucket with six UUID-looking labels; keep it visible for cleanup review rather than silently filtering it.
- User reviewed and accepted eight sub-family family overrides:
  - `Graphic and multimedia designers` -> #14832 `Creative and performing artists`
  - `Product and garment designers` -> #14935 `Artistic, cultural and culinary associate professionals`
  - `Chefs` -> #14998 `Cooks`
  - `Gallery, museum and library technicians` -> #14818 `Librarians, archivists and curators`
  - `Photographers` -> #14832 `Creative and performing artists`
  - `Office supervisors` -> #14984 `Other clerical support workers`
  - `Fashion and other models` -> #14832 `Creative and performing artists`
  - `Psychologists` -> #14759 `Other health professionals`
- Implemented reviewed override source in `src/runtime/occupation-taxonomy-family-overrides.ts` and applied it at `src/runtime/occupation-search-meta-artifact.ts`.
- Override behavior is loader-side for immediate testing: decoded core records expose effective `familyNodeId/familyLabel`, and `getLeafCoreRecordsForFamilies()` removes moved leaves from old family scopes while adding them to target family scopes.
- Full `npm run runtime:artifacts-build` should later be run so derived retrieval/family-profile artifacts are rebuilt from the same effective family mapping.
- Verification so far:
  - `npm run build`: passed.
  - `npm run test:structural`: passed 29/29.
  - Accessor check: all eight reviewed sub-family groups had `bad=0` leaves after override.
  - Probe `website designer`: selected `web designer` #15902 under #14832 `Creative and performing artists`.
  - Probe `chef`: selected `chef` #15483 under #14998 `Cooks`.
  - Probe `psychologist`: selected `psychologist` #16310 under #14759 `Other health professionals`.
  - `npm run evaluation:golden:pipeline:developing`: exited cleanly with `blocking_failures=0`, 33/54 developing cases passed.
  - Updated stable expectations for the reviewed `Chefs` -> `Cooks` override (`short-form-chef`, `ro-bucatar-sef`).
  - `npm run evaluation:golden:pipeline -- --suite=stable`: 21/24 passed; remaining blockers are unrelated existing cases (`Fullstack developer` confidence 58 vs 60, `electrical wiring installer` leaf-vs-family, `dezvoltatori software` confidence 81 vs 85).
  - Probe `React Designer` is still not solved by taxonomy cleanup: it selects `Electrical equipment installers and repairers` via weak `solar designer`; this needs future software/framework discriminator or vocabulary evidence, not more sub-family family overrides.
- Sub-agent later extended taxonomy overrides into DB search-meta construction, runtime search-meta export, OpenSearch occupation/alias document population, and added CSV mirror tests.
- Review finding/fix: OpenSearch occupation direct population overrode `family_node_id/family_label` but left `ancestor_text` sourced from old DB ancestor rows when DB search-meta had not been rebuilt. Patched `src/opensearch/occupations-index.ts` to load `ancestor_role` and replace the family ancestor label in `ancestor_text` for reviewed sub-family overrides.
- Post-review validation: `npm run build` passed, `npm run test:structural` passed 30/30, `git diff --check` clean.
- User noticed sub-family moves are too blunt because some sub-families contain mixed leaves. Example: #14745 `Graphic and multimedia designers` contains `web designer`, `gambling games designer`, and `performance lighting designer`, which may belong in different sub-families.
- New direction: review/fix leaf -> sub-family placement first, then revisit sub-family -> family overrides.
- Generated leaf-level review CSV at `data/taxonomy-review/esco-leaf-subfamily-review.csv`.
  - 3,045 leaf rows plus header.
  - Columns include leaf id/label, current sub-family, original broad family from the sub-family review CSV, parent, and blank override/review columns.
  - The CSV intentionally uses original broad family values from `esco-subfamily-family-review.csv` rather than runtime loader effective family values, because the current loader applies experimental overrides.
  - #14745 `Graphic and multimedia designers` rows include: `3D animator`, `3D modeller`, `animation layout artist`, `animator`, `desktop publisher`, `digital artist`, `digital games designer`, `digital media designer`, `gambling games designer`, `graphic designer`, `illustrator`, `performance lighting designer`, `performance video designer`, `special effects artist`, `stop-motion animator`, `web designer`.
  - First six rows still have UUID-like labels and missing hierarchy; keep visible for cleanup review.
- Refined taxonomy override model into two active generation-time operation lists:
  - Leaf -> sub-family: `data/taxonomy-review/esco-leaf-subfamily-overrides.csv`.
    - Active row: #15902 `web designer` -> #14805 `Web and multimedia developers`, family #14802 `Software and applications developers and analysts`.
  - Sub-family -> family: `data/taxonomy-review/esco-subfamily-family-overrides.csv`.
    - Active row: #14939 `Chefs` -> #14998 `Cooks`.
- Deferred leaf -> family operation type for now because it can create mixed semantics where a leaf's group remains in one branch but family points elsewhere. Psychologist and archive/library cases are not active.
- Removed runtime-side taxonomy remapping from `src/runtime/occupation-search-meta-artifact.ts`; runtime now reads generated artifact hierarchy directly.
- Generation paths apply reviewed taxonomy operations:
  - `src/search-meta/occupation/build-occupation-search-meta.ts` rebuilds hierarchy for leaf -> sub-family and then applies sub-family -> family.
  - `src/cli/export-occupation-search-meta-artifact.ts` applies the same reviewed operations when exporting from current DB rows.
  - OpenSearch occupation/alias population applies effective group/family fields; occupation `ancestor_text` also replaces old parent/group/family labels for leaf moves.
- Rebuilt runtime artifacts with `npm run runtime:artifacts-build` after approval for local MySQL access.
- Post-refactor verification:
  - Artifact rows: #15902 `web designer` parent/group #14805, family #14802; #15483/#15296/#17052 chef leaves group #14939, family #14998; #17676 psychologist and #16250 big data archive librarian unchanged.
  - `npm run test:structural`: passed 31/31.
  - `website designer`: selects leaf `web designer` under #14802 `Software and applications developers and analysts`.
  - `React Website Designer`: selects leaf `web designer` under #14802.
  - `chef`: selects leaf `chef` under #14998 `Cooks`.
  - `npm run evaluation:golden:pipeline -- --suite=stable`: 21/24, same three unrelated blockers (`Fullstack developer` confidence 58 vs 60, `electrical wiring installer` leaf-vs-family, `dezvoltatori software` confidence 81 vs 85).
  - `npm run evaluation:golden:pipeline:developing`: exited cleanly with `blocking_failures=0`, 33/54 developing cases passed.
- Added a second safe sub-family -> family rule after user confirmation:
  - #14825 `Psychologists` -> #14759 `Other health professionals`.
  - This moves all six leaves in the `Psychologists` sub-family, including `psychologist`, `clinical psychologist`, `educational psychologist`, `health psychologist`, `psychotherapist`, and `polygraph examiner`.
  - Rebuilt runtime artifacts with `npm run runtime:artifacts-build`.
  - Verified artifact rows: all six `Psychologists` leaves now have group #14825 and family #14759; `web designer` and `chef` overrides still hold.
  - `npm run test:structural`: passed 31/31.
  - Probes: `psychologist` -> leaf `psychologist` under `Other health professionals`; `clinical psychologist` -> leaf `clinical psychologist` under `Other health professionals`.

Guideline update:
- Added an `AGENTS.md` coding guideline requiring agents to push back on over-engineered, compute-heavy, or architecture-misaligned ideas before implementation, with a concrete risk explanation and a smaller accuracy-preserving alternative.

User direction:
- Do not add `sector`; `sector` is company/industry context and would create too many tie breakers.
- Use `jobFunction` only because it is closer to the role and more useful for ESCO family selection.
- Accept a pure slug such as `skilled_trades`, `it_software_data`, or `finance_accounting`; do not support or emit `job_function:` prefixes.
- Preserve family-first correctness: the hint should disambiguate plausible families, not override title role evidence.
- Keep memory impact negligible and do not add runtime artifacts.

Facts verified from `/Users/otobio/repo/term-extractor/src/inference/facets.ts`:
- `sector` has the same broad company/industry slug family as the old `company_type`.
- `job_function` has 34 finite slugs:
  - `administration`
  - `animal_care_childcare_cleaning`
  - `architecture_design`
  - `arts_entertainment`
  - `banking`
  - `business_development`
  - `community_social_services`
  - `consulting_strategy`
  - `customer_support`
  - `education_training`
  - `engineering`
  - `finance_accounting`
  - `health_safety`
  - `healthcare`
  - `hospitality_food_service`
  - `human_resources`
  - `insurance`
  - `it_software_data`
  - `legal_compliance`
  - `management`
  - `marketing_communications`
  - `mechanical_technical`
  - `mining_natural_resources`
  - `operations_logistics`
  - `physical_manual_work`
  - `procurement`
  - `project_management`
  - `quality_assurance`
  - `research_development`
  - `sales_commerce`
  - `security`
  - `skilled_trades`
  - `transport_driving`
  - `volunteering_internships`

Implemented in current uncommitted work:
- Renamed the prior module to `src/search-pipeline/job-function-family-priors.ts`.
- Removed the previous company/sector hint path from API, pipeline options, CLI, tests, and retriever option types.
- Added `jobFunction?: string` to `OccupationSearchPipelineOptions` and `GetCanonicalTermInput`.
- CLI flag is now `--job-function=skilled_trades`.
- Evidence channel is now `job_function_family_prior`.
- Query context/debug output exposes `jobFunction` as `job_function=<slug>`.
- Prior map is keyed by pure `job_function` slugs, with all 34 known slugs represented. `volunteering_internships` intentionally maps to no family priors because it is not an occupation-role hint.
- Prior still applies only to existing candidate families and still requires title role grounding before it contributes.
- Stale generated files for the previous hint module were removed; new `dist/search-pipeline/job-function-family-priors.*` files are generated by build.

Validation completed:
- `npm run build`: passed.
- `npm run test:structural`: passed, 27/27.
- `git diff --check`: passed.
- `npm run runtime:check`: passed.
- Stale-reference scan for previous company-hint symbols in `src`, `dist`, and `SESSION_STATE.md`: clean.
- `npm run evaluation:golden:pipeline:developing`: passed command, `33/54`, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable`: exited 1 with known baseline `21/24`, `blocking_failures=3`.
- `npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: passed command, `33/54`, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: exited 1 with known baseline `21/24`, `blocking_failures=3`.
- Known stable failures unchanged:
  - `Fullstack developer` confidence `58%` vs expected `60%`.
  - `electrical wiring installer` promotes `electrician`, expected family.
  - `dezvoltatori software` confidence `81%` vs expected `85%`.
- `npm run resolution:pipeline -- --query="Builder" --locale=en --job-function=skilled_trades --retrieval-backend=binary-cache --no-color`: selected `house builder` under `Building frame and related trades workers`, with `job_function_family_prior` evidence.
- `npm run resolution:pipeline -- --query="Airline Compliance Auditors" --locale=en --job-function=transport_driving --retrieval-backend=binary-cache --no-color`: remained unresolved/dictionary-gap and did not drift to aircraft/pilot families.

Current issue:
- User reported `npm run resolution:pipeline -- --query="backend developer" --locale=ro` selects the wrong family, while `--locale=en` selects `Software and applications developers and analysts`.
- Reproduced with debug:
  - `locale=ro`: unresolved, top leaf `photographic developer`, top family `Chemical and photographic products plant and machine operators`.
  - `locale=en`: family `Software and applications developers and analysts`, top leaf `software developer`.
- Diagnosis: retrieval is single-surface by requested locale. For non-English locale inputs containing English surface text, English aliases/canonical/text records are not searched; only `ro`/`hu`/`et` surface artifacts participate. Desired behavior is `en -> [en]`, non-English -> `[locale, en]`.
- Planned fix: keep query preparation/scoring context in the requested locale, but retrieve candidate and family-constrained lexical evidence from ordered search surfaces. Merge evidence before ranking. Do not add broad multilingual surfaces or change business ranking gates.

Implemented locale-surface fix:
- Added `retrievalSurfaceLocales(locale)` in `src/retrieval/occupation-candidates.ts`.
  - `en` searches `['en']`.
  - Non-English locales search `[locale, 'en']`.
- `OccupationCandidateRetriever.run()` now gathers alias, canonical-label, lexical, and alias-ngram evidence across those ordered surfaces, then merges evidence before existing candidate scoring.
- `retrieveLexicalFamilyHits()` in `src/search-pipeline/occupation-search-pipeline.ts` uses the same ordered surfaces for family-constrained leaf recovery.
- Added structural coverage for the surface policy and for `query="backend developer", locale="ro"` selecting family `Software and applications developers and analysts`.
- Build-generated `dist` files were updated.

Validation after fix:
- `npm run build`: passed.
- `npm run test:structural`: passed 33/33.
- `npm run resolution:pipeline -- --query="backend developer" --locale=ro --debug --no-color`: now selects family `Software and applications developers and analysts` at 58%, top leaf `software developer`.
- `npm run resolution:pipeline -- --query="backend developer" --locale=en --debug --no-color`: still selects family `Software and applications developers and analysts` at 58%.
- `npm run resolution:pipeline -- --query="backend developer" --locale=hu --debug --no-color`: selects family `Software and applications developers and analysts` at 58%.
- `npm run evaluation:golden:pipeline:developing`: passed command, 33/54, blocking_failures=0.
- `npm run evaluation:golden:pipeline -- --suite=stable`: still exits 1 with known baseline 21/24 and the same three blockers: `Fullstack developer` confidence, `electrical wiring installer` leaf-vs-family, and `dezvoltatori software` confidence.

Second-pass release review:
- Rechecked the locale-surface implementation against code guidelines.
- Confirmed the fix stays at retrieval orchestration boundaries and does not change ranking gates or business flow.
- Confirmed no full-corpus preload or unbounded cache was introduced; non-English requests only add bounded per-request retrieval rows and one secondary English prepared query.
- Noted that downstream scoring counts exact/folded evidence records, so no extra duplicate/provenance evidence records were added during the release pass.
- Localized probes remained correct:
  - `dezvoltator software` / `ro` -> leaf `software developer`.
  - `contabil` / `ro` -> leaf `accountant`.
  - `szoftverfejlesztő` / `hu` -> leaf `software developer`.
- `npm run runtime:check`: passed; runtime context still loads `binary-cache` and keeps alias-ngram artifacts lazy.

Dev tooling setup:
- User asked to set up dev-only lint and type checking, likely with Biome.
- Added `@biomejs/biome` as a dev dependency.
- Added scripts:
  - `typecheck`: `tsc --noEmit --pretty false`
  - `lint`: `biome lint .`
  - `format`: `biome format --write .`
  - `check:dev`: `npm run typecheck && npm run lint`
- Added `biome.json` with explicit ignores for generated/runtime-heavy paths (`artifacts/**`, `dist/**`, `node_modules/**`, generated CSV review data, and Python cache files).
- Full-repo Biome formatting is intentionally not in `check:dev` yet: `biome format .` still wants a broad mechanical rewrite across existing files, so formatting adoption should be a separate cleanup pass.

Taxonomy placement cleanup direction:
- User wants to stop doing raw/manual 3k+ leaf review and instead generate a focused top suspicious-placement queue from production runtime artifacts.
- Design: offline-only audit using binary runtime search-meta. Score each leaf against its current sub-family with leave-one-out evidence, then compare against alternative sub-family profiles built from labels, aliases, and capped capability labels.
- The audit now defaults to a top-5 high-precision review queue at `data/taxonomy-review/esco-leaf-placement-suspicious.esco_1_2_1.csv` with current hierarchy, suggested target sub-family/family, fit gap, evidence terms, and blank review columns.
- This is review guidance only. Accepted rows later become explicit `leaf -> sub_family` CSV overrides; runtime behavior must not change from the audit itself.
- Implemented CLI `src/cli/inspect-taxonomy-placements.ts` and npm script `taxonomy:placements`.
- Current scoring details:
  - Uses binary runtime search-meta as the corpus.
  - Builds leaf vectors from canonical label, capped English aliases, and capped capability labels.
  - Builds sub-family profiles from the same leaf vectors plus hierarchy labels.
  - Scores current sub-family with leave-one-out evidence so the leaf cannot prove its own current placement.
  - Splits `... in ...` title surfaces into role and domain text so domain/product terms do not become occupation heads.
  - Adds a small fixed decompound pass for common occupation-head suffixes, e.g. `photojournalist -> journalist`, and singularizes exact plural hierarchy heads such as `Journalists -> journalist`.
  - Applies diversity caps by current sub-family and current->suggested pair so the top review queue does not collapse into one repeated pattern.
  - Default `--precision=high` requires a family-changing candidate, head conflict, low current fit, minimum suggested fit, and a distinct target occupation-head anchor from the target hierarchy label that the current hierarchy label lacks.
  - `--precision=broad` remains available for exploratory recall, but it is too noisy for direct review.
- Generated current high-precision queue with `npm run taxonomy:placements`; it produced 2 rows:
  - #17354 `industrial maintenance supervisor`: `Mechanical engineering technicians` -> `Manufacturing supervisors`.
  - #16167 `photojournalist`: `Photographers` -> `Journalists`.
- Output file: `data/taxonomy-review/esco-leaf-placement-suspicious.esco_1_2_1.csv`.
- Current caveat: this is still a suspicion queue, not an auto-move list. High precision is intentionally allowed to return fewer than five rows rather than fill the list with weak candidates.
- Validation after implementation: `npm run check:dev` passed and `npm run test:structural` passed 33/33.

Accepted taxonomy override:
- User approved #16167 `photojournalist` as a reviewed `leaf -> sub_family` move.
- User approved #17354 `industrial maintenance supervisor` as a reviewed `leaf -> sub_family` move after noting `industrial assembly supervisor` already belongs in the target supervisor branch.
- Added to `data/taxonomy-review/esco-leaf-subfamily-overrides.csv` and `src/runtime/occupation-taxonomy-family-overrides.ts`:
  - #16167 `photojournalist` -> #14830 `Journalists`, family #14828 `Authors, journalists and linguists`.
  - Reason: the occupation head is journalist; photography is the medium rather than the occupational family.
  - #17354 `industrial maintenance supervisor` -> #14854 `Manufacturing supervisors`, family #14852 `Mining, manufacturing and construction supervisors`.
  - Reason: supervisor is the occupation head, and related industrial supervisor leaves already sit under manufacturing supervisors.
- Rebuilt runtime artifacts with `npm run runtime:artifacts-build`.
- Verified artifact row: #16167 now has group #14830 `Journalists` and family #14828 `Authors, journalists and linguists`.
- Verified artifact row: #17354 now has group #14854 `Manufacturing supervisors` and family #14852 `Mining, manufacturing and construction supervisors`.
- Probe `npm run resolution:pipeline -- --query="photojournalist" --locale=en --retrieval-backend=binary-cache --no-color` selects leaf #16167 under #14828 with 96% confidence.
- Probe `npm run resolution:pipeline -- --query="industrial maintenance supervisor" --locale=en --retrieval-backend=binary-cache --no-color` selects leaf #17354 under #14852 with 93% confidence.
- Re-ran `npm run taxonomy:placements` after the two accepted leaf moves; the high-precision queue now writes 0 suspicious taxonomy placement candidates.
- Validation after accepted override:
  - `npm run check:dev`: passed.
  - `npm run test:structural`: passed 33/33.
  - `npm run runtime:check`: passed.

Documentation/reproducibility cleanup:
- Updated live runtime docs to reflect the current dense-free runtime contract:
  - `AGENTS.md`: direct retrieval, family recovery, runtime artifact list, and selection invariants now describe alias/lexical/capability/ngram/binary-cache evidence instead of dense/vector evidence.
  - `docs/IMPLEMENTATION_DETAIL.md`: search-meta runtime layout now describes binary core/detail/string-table accessors rather than old JSONL core/detail shards.
  - `README.md` and `docs/GETTING_STARTED.md`: added SQL snapshot restore guidance before `npm run runtime:artifacts-rebuild-db`.
- Marked older phase docs as historical where they still preserve dense/vector exploration notes:
  - `docs/SEARCH_DECISION_TREE.md`
  - `docs/IMPLEMENTATION_CHECKLIST.md`
  - `docs/POST_PHASE14_REFINEMENT_CHECKLIST.md`
- Added `sql/snapshots/README.md`:
  - put reproducible DB dumps under `sql/snapshots/`;
  - keep committed snapshot chunks under GitHub's 50 MB per-file limit;
  - snapshot archive is staged as `esco_search_dump.tar.xz.part-*` chunks; the local unsplit `*.tar.xz` archive is ignored;
  - reconstruct the archive from chunks in lexical order, restore the SQL, then run `npm run runtime:artifacts-rebuild-db`;
  - runtime package still uses only `dist` plus generated `artifacts/runtime/occupation-*`.

Latest full regression run:
- `npm run build`: passed.
- `npm run test:structural`: passed 33/33.
- `npm run evaluation:golden:pipeline:developing`: passed command, 33/54, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable`: exited 1 with known baseline 21/24 and 3 blockers:
  - `generic-tail-fullstack-developer`: confidence 58 vs expected >=60.
  - `descriptive-people-who-install-wiring`: selected leaf `electrician`; expected broader `Electrical equipment installers and repairers` family.
  - `ro-plural-dezvoltatori-software`: confidence 81 vs expected >=85.
- `npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: passed command, 33/54, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: exited 1 with the same known baseline 21/24 and same 3 blockers.
- `npm run runtime:check`: passed; runtime context loads `binary-cache`, artifacts validate, and alias-ngram artifacts remain lazy.
- `git diff --check`: passed.

Commit / working tree handoff:
- Committed the taxonomy audit, accepted overrides, rebuilt runtime artifacts, docs cleanup, and SQL snapshot chunks in:
  - `00789e1 Add taxonomy audit overrides and reproducible snapshot`
- The original local snapshot archive `sql/snapshots/esco_search_dump.tar.xz` was intentionally not committed because it is about 61 MB and exceeds GitHub's 50 MB file limit. It is ignored by `.gitignore`.
- Committed snapshot chunks:
  - `sql/snapshots/esco_search_dump.tar.xz.part-aa` about 45 MB.
  - `sql/snapshots/esco_search_dump.tar.xz.part-ab` about 16 MB.
- Remaining untracked scratch files after the commit, intentionally left alone:
  - `audit_report.txt`
  - `data/taxonomy-review/esco-leaf-subfamily-review copy.csv`
  - `scripts/__pycache__/`
  - `scripts/audit_esco_leaf_subfamily_review.py`
- New Codex context handoff: read this `SESSION_STATE.md` first, then run `git status --short` before editing.

Semantic bootstrap handoff:
- The current objective is still the deterministic RO/HU noise extractor, but the bootstrap semantics work is now separated out and should not be confused with the noise list.
- Added a compact locale-specific semantic bootstrap generator:
  - `scripts/build-semantic-bootstrap.js`
- Added a sample evaluator for real-title smoke testing:
  - `scripts/evaluate-semantic-bootstrap.js`
- Added a dedicated artifact loader API:
  - `src/runtime/occupation-semantic-bootstrap-artifact.ts`
- Added pure contribution/threshold logic:
  - `src/query/occupation-semantic-bootstrap.ts`
- The generated bootstrap JSON now includes `thresholds`, `tokenRules`, and `phraseRules` and stays per-locale:
  - `data/taxonomy-review/semantic-bootstrap.ro.json`
  - `data/taxonomy-review/semantic-bootstrap.hu.json`
- Current ruleset counts after rebuild:
  - RO: `44` token rules, `16` phrase rules
  - HU: `60` token rules, `20` phrase rules
- Latest 100-title smoke test:
  - RO: `role_hit=66`, `domain_hit=15`, `noise_hit=5`, `clean=33`
  - HU: `role_hit=59`, `domain_hit=13`, `noise_hit=9`, `clean=33`
- The bootstrap is intentionally review-oriented and is not wired into query preparation or ranking yet.
- The loader default path is the review-data directory under `data/taxonomy-review`, with an override via `OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH`.

RO corpus review loop:
- Added a dedicated full-corpus RO review script:
  - `scripts/review-semantic-bootstrap.js`
- Added npm entry point:
  - `semantic:bootstrap:review`
- The review script scans all `10040` RO titles from `/Users/otobio/Downloads/ejobs_job_titles.csv`.
- It writes two review artifacts:
  - `data/taxonomy-review/semantic-bootstrap.ro.review.csv`
  - `data/taxonomy-review/semantic-bootstrap.ro.miss-summary.csv`
- The review and smoke-test passes now run the noise peel first, so bootstrap coverage is measured against cleaner titles rather than the raw corpus.
- Latest full-corpus RO metrics after peel-first review:
  - `role_hit=9167`
  - `domain_hit=2315`
  - `noise_hit=995`
  - `clean=583`
  - `help=8215`
  - `neutral=1802`
  - `hurt=23`
- The no-hit tail is now measured on peeled titles, so the remaining gaps are more likely to be actual semantic gaps rather than removable title junk.
- Remaining top no-hit patterns now concentrate around:
  - recruitment boilerplate like `cautam colegi`
  - location tails like `sibiu`, `alexandria`, `bucharest`
  - domain clusters like `vopsitor industrial`, `laborant fabrica`, `montator subansamble`
  - English spillover like `engineer`, `advisor`, `sales`
- The current bootstrap is now strong enough to use as a compact locale-specific control layer for query cleanup, but it still needs another review round before we wire it into the resolver.

RO family/leaf sample review:
- Added a dedicated 100-title resolver sample runner:
  - `scripts/review-ro-family-leaf-sample.js`
- Added npm entry point:
  - `semantic:bootstrap:matches`
- The runner peels RO title noise first and then resolves the cleaned title through the real pipeline.
- Fully peeled noise-only rows are now short-circuited instead of being forced into a family/leaf result.
- Output file:
  - `data/taxonomy-review/ro-family-leaf-sample.csv`
- Latest 100-title sample metrics:
  - `leaf=31`
  - `family=27`
  - `multi_span=7`
  - `noise_only=15`
  - `unresolved=20`
- Example rows from the new sample:
  - `Reprezentant Tehnic si Receptioner Tura de Noapte` -> `noise_only`
  - `Tehnician constructor` -> `construction equipment technician`
  - `Vopsitor industrial - 2 schimburi` -> `construction painter`
  - `Contabil` -> `accountant`
  - `Cautam colegi pentru Pizza Hut!` -> `noise_only`
- Noise peel improvements added during the sample pass:
  - language qualifiers like `with English`, `English required`, and `fluent English` now peel as dedicated `noise_language`
  - acronym-like uppercase fragments remain eligible for employer/brand noise classification
  - visibly separated all-caps brand tokens like `BRINGO` and `MUSA` now peel as `noise_employer_brand`
  - location-like all-caps tails like `OTOPENI` still peel as `noise_location`
- The current unresolved frontier is now narrower and mostly consists of titles that need either deeper locale-specific title splitting or more occupation-specific semantic vocabulary rather than generic boilerplate cleanup.
- The sample file is now the primary artifact for judging family/leaf quality on real RO titles while keeping noise, semantic matching, and unresolved cases separate.

Open follow-up:
- The remaining concern is leaf over-promotion on partial matches.
- Example pattern to revisit: `Educator -> zoo educator` when the query has no zoo/domain signal.
- We need to validate the noise eliminator and the semantic lexicon together before touching leaf promotion again.
- Leaf selection should stay stricter than family selection so a weak partial overlap cannot outrank the broader family.
- Keep family visibility in resolver output so leaf wins can always be inspected against their family context.
- Noise elimination should run after `splitClause` in query preparation so multi-span queries are detected first and then peeled independently per span.
- The noise step should only remove pure noise, not perform clause splitting or broader role segmentation work.
- The current chunk-level noise peel is too aggressive for mixed titles and needs to be narrowed to true noise-only removal.
- The query-preparation pipeline now calls the noise peeler after clause splitting so the existing signal filters work on already-peeled spans.
- The peel vocabulary was narrowed after probe failures so domain-bearing words like `tura`, `medie`, `inalta`, and `tensiune` are no longer stripped as generic noise.
- Current exact probes now behave better:
  - `Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI` -> `Senior Specialist Aprovizionare`
  - `Livrator BRINGO cu autoturism propriu` -> `Livrator`
  - `Operator MUSA strungar` -> `Operator strungar`
  - `Customer Agent with English` -> `Customer Agent`
  - `Sef tura patiserie Delissima Bakery` now survives the peel and should be reviewed later as a genuine role-bearing case, not generic shift noise.
- The shift rule now only targets explicit schedule phrases and numeric shift markers, not standalone `tura`/`shift` tokens.
- Latest 100-title RO sample after the noise-peel wiring:
  - `leaf=33`
  - `family=34`
  - `group=0`
  - `multi_span=7`
  - `noise_only=0`
  - `unresolved=26`
- Notable sample rows from the latest rerun:
  - `Reprezentant Tehnic si Receptioner Tura de Noapte` -> `family` (`night auditor`)
  - `Tehnician constructor` -> `construction equipment technician`
  - `Vopsitor industrial - 2 schimburi` -> `construction painter`
  - `Contabil` -> `accountant`
  - `Livrator BRINGO cu autoturism propriu (ORAS - IASI)` -> `car and van delivery driver`
  - `Specialist planificare/ logistica` -> `multi_span`
  - `QUALITY PLANNING ENGINER` is no longer being peeled as employer noise; it now survives the peel for downstream ranking.
- The semantic bootstrap lexicon has been cleaned to occupation-only evidence and rebuilt:
  - RO: `55` token rules, `16` phrase rules
  - HU: `49` token rules, `19` phrase rules
- Added a standalone semantic lexicon API at `src/query/occupation-semantic-lexicon.ts`.
- The API loads the locale-specific bootstrap artifact and returns `help`, `neutral`, or `hurt` for token, phrase, and surface evaluations.
- The bootstrap lexicon is now separated from the peel: the peel handles location/schedule/job-board noise, while the lexicon only handles occupation evidence.
- The current API is locale-scoped and will return neutral for tokens that are not part of that locale's occupation lexicon.
- The semantic integration is intentionally narrow: query prep now calls a single `cleanOccupationSemanticSurface(...)` helper and keeps semantic scoring inside the lexicon module.
- The RO bootstrap was narrowed to RO-only review again before the next test pass; HU stays deferred until the RO behavior is stable.
- After adding weak RO-only negative evidence for `personal`, `serviciu`, `servicii`, `general`, `generale`, `profesional`, and `suport`, the bootstrap rebuilt to `62` RO token rules and `16` RO phrase rules.
- On a random 100-title RO sample from `ejobs_job_titles.csv`, the semantic cleaner made one real removal against the normalized baseline: `Sales Network Specialist - Divizia Suport Vanzari` -> `sales network specialist - divizia vanzari`.
- The RO sample file also contains repeated real uses of the weak-noise terms, including `Suport Vanzari`, `SUPORT TEHNIC VÂNZĂRI`, `Personal de Serviciu`, and `Personal service auto`, so the negative bucket has corpus support.
- The semantic lexicon loader is now internal only; the public API is the fast cleaner plus the analyzer/comparison helpers.
- The analyzer now returns optional debug detail only when requested, and comparison only counts shared positive semantic tokens or phrases.
- The false-positive pair `sales personnel` vs `personnel director` now resolves to `neutral` in the semantic comparison because `personnel` is not treated as shared positive evidence.
- The compare path was optimized into a pre-analyzed form so the query is analyzed once and reused against candidate analyses instead of re-normalizing every comparison.
- Semantic rescoring is plugged into `OccupationCandidateRetriever` after the top candidate set is built, which keeps the feature off the high-fanout alias scan path.
- The current rescoring only touches candidates that already survived base retrieval, and it prefers local alias surfaces over canonical English labels when choosing the semantic comparison text.
- The retrieval sample output now surfaces `semantic_score` and `semantic_surface` for each candidate so the effect is inspectable without extra debug plumbing.
- A live sample query for `Sales Network Specialist - Divizia Suport Vanzari` shows the semantic boost on the top candidate (`semantic_score=0.25`, `semantic_surface="network specialist"`), which is enough to inspect the effect while keeping the ranking path bounded.
- The semantic feature was moved out of the retrieval scorer and into the resolver selection path so it only runs after branch expansion, on the top candidate of each branch.
- Resolver debug output now shows `semantic_score` and `semantic_surface` on branches and leaves.
- Current sample: `Educator` in `ro` still resolves as `unresolved`, but the semantic hook is visible on the top branch/candidate: `zoo educator` carries `semantic_score=0.18` and `semantic_surface="zoo educator"`. This is the right structural place to tune next, not the retrieval path.

Cleanup and current direction:
- Removed obvious workspace noise that was no longer part of the active work:
  - `audit_report.txt`
  - `data/taxonomy-review/esco-leaf-subfamily-review copy.csv`
  - `scripts/__pycache__/`
- The active runtime path is now:
  - RO/HU noise peeling as a standalone query-prep utility
  - locale-scoped semantic lexicon analysis used only where it helps selection
  - role-head equivalence as a shared generated artifact
  - family-visible leaf promotion so partial matches can be audited against their parent family
- The semantic lexicon direction is not “more generic language stats”; it is occupation-only evidence that helps reject weak partial matches and improves comparison safety.
- The current integration boundary stays narrow:
  - query prep cleans and normalizes
  - the lexicon answers whether a token/surface should help, do nothing, or hurt
  - resolver/pipeline consumes those signals without duplicating the semantic logic elsewhere

Dataset status:
- RO source corpus: `ejobs_job_titles.csv` with ~`10k` titles under `/Users/otobio/Downloads`
- HU source corpus: `profession_job_titles.csv` remains the deferred second locale after RO stabilizes
- Current RO review artifacts live under `data/taxonomy-review/`
- The latest sampled RO family/leaf baseline remains the reference for now; the unresolved tail still needs stricter partial-match control, especially for weak leaf promotions like the `Educator -> zoo educator` style failure.

Next work queue:
- tighten the partial-match guard so family fallback wins when leaf evidence is too weak
- keep the noise extractor narrow so it only removes clear location/brand/shift/job-board boilerplate
- continue RO refinement first, then apply the learned structure to HU without merging locale state

Lexicon cleanup status:
- The obsolete specificity/common-term lexicon branch has been removed from the active source tree.
- Removed files included:
  - `src/query/occupation-common-term-lexicon.ts`
  - `src/query/occupation-specificity-lexicon.ts`
  - `src/query/occupation-specificity-lexicon-v2.ts`
  - the matching runtime loaders and export CLIs
- The matching generated JSON artifacts and compiled `dist` outputs were also deleted.
- The runtime check now validates the active semantic bootstrap artifact instead of the retired common-term lexicon artifact.
- `npm run build` passes after the cleanup.
- The only lexicon path left in active use is the semantic bootstrap/semantic lexicon pair that is already wired into query prep and resolver comparison.

Family-token relevance artifact (experimental, not wired into production):
- Built a per-(family, token) discriminativeness signal: `relevance = tfRatio * idf`, tf normalized by each family's own leaf-text length so bigger families don't win on volume alone, idf computed with family (not global) document frequency.
- New files: `src/query/alias-role-policy.ts` (hoisted `aliasRoleScoreFactor`/`isSearchAliasRole` shared between `alias-ngram-retriever.ts` and the new builder so the two don't drift), `src/query/occupation-family-token-relevance.ts` (types + path helpers), `src/cli/export-occupation-family-token-relevance-artifact.ts` (CLI), `scripts/validate-family-token-relevance.js` (standalone before/after validator against real pipeline evidence, not wired into any test suite).
- Output: `artifacts/runtime/occupation-family-token-relevance.esco_1_2_1.json`, npm script `query:family-token-relevance:export`. Deliberately not added to `runtime:artifacts-build` — this is a first cut, not production-ready.
- Bug caught and fixed during build: the noise floor (`MIN_FAMILY_TOKEN_OCCURRENCES=2`) was being applied to role-weighted occurrence sums instead of raw match counts, so two real "personnel" aliases at weight 0.92 each (`1.84 < 2`) got silently dropped even though the underlying evidence was real. Fixed by tracking a separate `tokenMatchCounts` map and flooring on that.
- Bug caught and fixed in the validator: `shadowMultiplier`'s fallback for a family with zero relevance entries for a matched token defaulted to that token's global max relevance, which (combined with the normalization denominator) silently gave "no evidence" families the same multiplier as the single best family. Fixed to fall back to 0.
- Validated against the real "Sales Personnel" repro: family 14677's `ngram_alias` "personnel manager"/"personnel director" evidence correctly drops ~17x (0.59→0.034), family 14975's drops to 0 (its own personnel occurrence is genuinely below noise floor), unrelated "personal assistant" matches on family 14914 are correctly left untouched.
- Critical caveat: family 14796 (the actually-correct family for "Sales Personnel") never enters `ranked_families` for this query at all, so this signal can only reorder among already-wrong candidates — it cannot by itself fix this repro. That gap is a candidate-generation/branch-expansion issue, not a relevance-weighting issue, and is still open/uninvestigated.

Query-intent fallback-bug fix (`src/query/query-intent.ts`, `classifyOccupationQueryIntent`):
- Root cause: when `findRoleHead()` returns null (no token matches `vocabulary.roleHeads`), the old code blindly took the rightmost surviving token as the role head (`termTokens[termTokens.length - 1]`) with no check against how that same token would otherwise classify. Any query built entirely from domain-modifier words (e.g. "sales", "personnel" — both confirmed via the intent-vocabulary artifact to be `domainModifierTerms`, not `roleHeadTerms`) always hit this branch and got a wrong forced role head.
- Fix: scan `termTokens` right-to-left; skip tokens that are seniority/credential/domain-modifier/ambiguous-modifier (these already have a correct dedicated classification path); the first token that survives becomes the fallback role head. If none survive, no fallback is chosen and `roleHeadTokens` stays empty (an already-supported downstream path — `occupation-resolver.ts`, `occupation-search-pipeline.ts`, and `generic-head-family-priors.ts` all already handle `roleHeadTokens.length === 0`).
- Iteration: the first version of the fix also excluded venue-context terms (`kitchen`, `office`, `warehouse`, ...) from the fallback scan, mirroring the left-scan logic used when a real role head exists. That caused a real regression — "Kitchen Staff" went from leaf `kitchen assistant` (0.907 confidence) to fully unresolved (0.485), because "staff" isn't a known vocabulary term at all and "kitchen" was the only remaining candidate. Checked whether any venue-context term is also independently flagged as a domain modifier in the vocabulary artifact — none are — so venue-context terms were kept eligible in the fallback scan (unlike the left-scan case, where a real role head already exists and venue terms should stop the scan rather than get folded in). This restored "Kitchen Staff" and also fixed "Office Personnel" (unresolved → family "Administrative and specialised secretaries", 0.668) as a bonus, with zero regressions elsewhere.
- Verified via `git stash`-based A/B testing against `npm run evaluation:golden:pipeline`: byte-identical 19/24 pass rate before/after, same 5 pre-existing failing IDs (`generic-tail-fullstack-developer`, `multi-word-primary-school-teacher`, `descriptive-people-who-install-wiring`, `ro-dezvoltator-software`, `ro-plural-dezvoltatori-software`) — none related to this fix.
- 12-query manual probe (Sales/Media/Warehouse/Security/Office/General Personnel, Support/Medical/Kitchen Staff, Sales Support, Personnel Manager/Officer) confirmed:
  - Real improvements: "Media Personnel" unresolved(0.46) → family "Sales, marketing and public relations professionals" (0.826, the actually-correct family). "Security Personnel" wrong leaf "human resources officer" (0.771) → family "Protective services workers" (0.717). "General Personnel" unresolved(0.46) → family "Administration professionals" (0.5).
  - Unaffected (a genuine role head was already found, so this branch never ran): Support Staff, Medical Staff, Sales Support, Personnel Manager, Personnel Officer.
  - "Sales Personnel" itself: `roleHeadTokens` is now correctly `[]` (was wrongly `["personnel"]`), but the pipeline still lands on a wrong family (now "Administrative and specialised secretaries" 0.5904, previously "Business services and administration managers" 0.5) — still not the correct family 14796, because (per the family-token-relevance work above) 14796 never becomes a ranked candidate for this query at all. This is the same open gap noted above and needs separate investigation into candidate generation/branch expansion, not query-intent classification.

Locale-aware generic fallback direction (`src/query/query-intent.ts`) — user-authored, verified:
- User added `GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE` (`en: -1` rightmost, `ro/hu/et: 1` leftmost, `unknown: -1`) so the null-role-head fallback scans in the direction that matches each locale's typical head position (English head-final compounds vs. RO/HU/ET head-initial noun phrases), instead of always taking the rightmost token.
- Verified correct and non-regressive: `tsc --noEmit`/`biome lint` clean, `npm run evaluation:golden:pipeline` byte-identical (19/24, same 5 pre-existing failures), full English 12-query probe byte-identical, and direct RO debug checks confirmed the scan now goes leftmost and picks the correct token (e.g. "Tehnic Productie" -> leaf 0.76, "Productie Tehnic" -> leaf 0.76 too, both now consistent instead of one being unresolved).
- Caught and fixed one latent bug while verifying: the diagnostic reason string for this fallback was hardcoded as `'rightmost useful token fallback'` even on the new leftmost path. Introduced a `fallbackReason` variable set from the actual `scanDirection` and used it in the diagnostics ternary. Cosmetic only (affects `--debug` text, not `roleHeadTokens` or the decision).
- Inherent limitation (not a flaw in this fix): a purely positional fallback is still order-sensitive for symmetric two-modifier-only pairs with no real anchor (e.g. a synthetic "Productie Tehnic" vs "Tehnic Productie" can still flip which word wins). The fix is still correct because it should match the real head-initial distribution of RO/HU/ET titles; no positional heuristic can fully escape this for adversarial pairs.

Family-token-relevance artifact wired into production retrieval (`src/retrieval/alias-ngram-retriever.ts`):
- Added `tryLoadOccupationFamilyTokenRelevanceLookup`/`familyTokenRelevanceMultiplier` exports to `src/query/occupation-family-token-relevance.ts` (Map-based lookup built once per source name, cached; graceful `null`/no-op fallback if the artifact file is missing since it's still not part of `runtime:artifacts-build`).
- Wired the multiplier into both `retrieveAliasNgramHits` (JS index, used only by CLI/eval tooling) and `retrieveBinaryAliasNgramHits` (the binary-cache path, which is the only path the live pipeline actually uses via `retrieval-engine-factory.ts`), multiplying into the existing `ngram_alias` score alongside `aliasRoleScoreFactor`.
- Confirmed functionally live, not a no-op: pulled raw `ngram_alias` candidate scores for "Sales Personnel" with the artifact file present vs. temporarily moved aside. Scores for weakly-associated token/family pairs measurably drop (e.g. "insurance broker" 0.2669 -> 0.2458), while scores stay unchanged for the family that most owns a token (e.g. "personnel" under family 14791 "Administration professionals" is unchanged, since that family is at/near the per-token max relevance so the multiplier is ~1). `tsc`/`biome`/`npm run evaluation:golden:pipeline` all clean, same 19/24 pass rate.
- Honest caveat: this has **zero observable effect on the "Sales Personnel" repro's final decision**, because none of the `ngram_alias`-bearing leaves/families (14682, 14791, 14903, 14796) ever survive into `ranked_families` for this query regardless of the multiplier — see the candidate-generation root cause below. The multiplier is confirmed "plugged in" in the sense the user asked for (it demonstrably changes real production scores), but this repro can't be used to show its downstream effect since the channel never reaches the decision for this query.

Candidate-generation root cause found for "Sales Personnel" (the open #2 gap, now with a concrete mechanism instead of just "family 14796 never becomes a candidate"):
- `resolve-occupation-pipeline.js --debug` for this query calls the candidate retriever with `limit=10` (pipeline default), not the `--limit=50` used in ad-hoc CLI probes. Branch/family consolidation only ever sees whichever leaves survive that top-10 cut — `ngram_alias`-driven leaves are being cut before they ever reach `accumulateCurrentRetrievalEvidenceStage`/`consolidateFamiliesStage`, not filtered out afterward.
- Root mechanism is in `src/retrieval/occupation-candidates.ts`'s `totalScore` combination (`RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT` in `src/scoring/scoring-policy.ts`: `EXACT_ALIAS=10, FOLDED_ALIAS=7, NGRAM_ALIAS=5, OPENSEARCH_LEXICAL=4, CAPABILITY_TASK=2`). The *weights* actually favor `ngram_alias`, but the *raw per-channel scores* don't: generic "assistant"/"call centre"-type leaves get `opensearch_lexical=0.35` + `capability_task=0.35` (or 0.236) purely from "personnel"/"sales" matching as loose full-text vocabulary in their capability description, producing `totalScore` 1.4-2.1. The genuinely correct `ngram_alias`-only leaves/families ("sales manager" 1.21, "insurance broker" 1.23, family "Sales, marketing and development managers" 1.12, family "Sales and purchasing agents and brokers" 0.98, "human resources officer" 1.39) all score lower than that generic block and get pushed past rank 10 in the full (unlimited) candidate list. Verified directly: `retrieve-occupation-candidates.js --limit=10` for "Sales Personnel" returns 10 candidates that are ALL generic administrative/call-centre leaves with `ngram_alias=0`; the first `ngram_alias`-scored candidate ("human resources officer", total 1.39) ranks around #25 out of the full 50.
- Confirmed via `debug.signals` in the pipeline output: `roleHeadTokens: []`, `domainTokens: ["sales","personnel"]` — with no role head at all, retrieval leans entirely on generic lexical/capability matching for both words, which is exactly the channel that's outscoring the precise alias matches here.
- Not yet fixed — this is a real design trade-off (retrieval limit vs. channel-score calibration) that needs a decision before changing: either raise the pre-consolidation candidate limit so precise-but-lower-scoring `ngram_alias` leaves survive long enough to reach family evidence, or rebalance how `opensearch_lexical`/`capability_task` raw scores are computed so generic full-text overlap on both a query's words doesn't out-rank a real alias-ngram phrase match. Flagged to the user as the next concrete lever for #2 rather than acted on unilaterally.

Candidate-generation fix implemented: removed the redundant post-merge truncation (top-K-per-channel union, per user decision):
- `src/retrieval/occupation-candidates.ts`, `buildCandidates`: removed the final `.slice(0, limit)` (and its now-dead `limit` parameter) after the per-`graphNodeId` merge. Each of the 5 channels was already independently bounded at the source before merging (`exact_alias`/`folded_alias`/`opensearch_lexical` at `limit`=10, `ngram_alias` at `max(limit*3,25)`=30, `capability_task` derived from the same `opensearch_lexical` rows — not a separate fetch) — the old slice was a *second*, redundant cut on an already-diverse union, not the thing providing the bound. Full details, including the per-channel cap table, written to `core.md` §8.1.
- Validated: `tsc`/`biome`/`npm run build` clean, `npm run evaluation:golden:pipeline` byte-identical 19/24 (same 5 pre-existing failures). Flagship repro "Sales Personnel": wrong-but-confident family (`Administrative and specialised secretaries`, 0.5904) -> `unresolved` (0.31) — correct-ish `ngram_alias`-backed families (14903, 14682) visible in `ranked_families` for the first time.
- Broader 12-query probe surfaced 2 new anomalies alongside 2 wins ("Media Personnel"/"Office Personnel" improved): "Security Personnel" flipped from "Protective services workers" (0.72) to "Database and network professionals" (0.60); "General Personnel" escalated from family-level to a specific leaf "operations manager" (0.73). Both trace to `familyEvidenceTier`'s `strong_phrase` promotion being a boolean presence check (`hasEvidenceChannel`) on `ngram_alias` evidence, not a strength/precision check — pre-existing design, not introduced by this fix, but made visible by it. Full before/after numbers in `core.md` §8.2.

Channel-rebalancing fix implemented: fixed a genuine `capability_task`/`opensearch_lexical` double-count in candidate `totalScore`:
- Proved `capability_task` evidence is always derived from the *same* `opensearch_lexical` row (`buildCapabilityTaskEvidence`'s `details.source_channel` is hardcoded to `'opensearch_lexical'`, `score = row.score * min(1, 0.35 + coverage*0.65)` — factor always <=1), so `channelScores.capability_task <= channelScores.opensearch_lexical` always holds. The old formula summed both with separate weights (`opensearch_lexical*4 + capability_task*2`), giving one opensearch hit up to weight 6 — more than `ngram_alias`'s weight of 5 — by counting it twice under two channel names.
- Fix (`occupation-candidates.ts`, `finalizeCandidate`): `totalScore` now uses `max(opensearch_lexical, capability_task) * 4` instead of summing both terms. `capability_task` still exists as its own channel/evidence everywhere else (tiebreak sort key, and independently in family/leaf `capabilitySupport` scoring, untouched).
- Validated: `tsc`/`biome`/`npm run build` clean, `npm run evaluation:golden:pipeline` byte-identical 19/24. 12-query probe + Security/General Personnel re-run: **byte-identical decisions and confidences to 6 decimal places** — for every case checked, `max(opensearch_lexical, capability_task)` was already achieved by `opensearch_lexical` alone, so this fix, while a real correctness fix, did not move any observed outcome.
- Checked and rejected a second hypothesis before settling on the above: considered a minimum-score floor for `ngram_alias`-driven `strong_phrase` tier promotion to fix the "Security Personnel" anomaly directly. Rejected after pulling real numbers: "Security Personnel"'s wrong family (14808) has `ngram_alias` scores 0.45-0.53 (single-token "security" matches), but "Sales Personnel"'s *correct* families (14903, 14682) — which the candidate-generation fix above was specifically meant to rescue — have `ngram_alias` scores of only 0.19-0.28 (single-token "sales"/"personnel" matches). A floor high enough to block 14808 would also have blocked the families this session's main fix was trying to surface. Documented as a falsified hypothesis in `core.md` §8.3 so it isn't re-attempted blindly later.
- **Open, deliberately not fixed**: the actual mechanism behind both new anomalies is `familyEvidenceTier`'s boolean "has `ngram_alias` evidence at all" promotion to `strong_phrase`, which then outranks higher-raw-confidence `family_profile`-tier families regardless of score (`compareFamilies`, tier before confidence — a pre-existing, deliberate design choice, not introduced by this session's fixes). Any real fix needs to distinguish a genuine multi-token phrase match from a single ambiguous-token match spread across many leaves in one family, validated against both directions of failure (don't re-break "Sales Personnel," don't leave "Security Personnel"/"General Personnel" wrong). Not attempted this session — likely belongs in `ngram_alias` scoring/token-coverage semantics, not the candidate channel-weight table. Full writeup in `core.md` §8.3.
- `core.md` updated throughout to match current (fixed) state: §1/§2 mental-model and stage-table text describing the old flat truncation now marked historical/fixed; §3 channel breakdown updated with the corrected `totalScore` formula and the double-count proof; §7 retitled "(FIXED)"; new §8 added covering both fixes and the open evidence-tier issue with full reasoning.

Fix A implemented: alias-retrieval phrase-window head-token fallback (`src/retrieval/binary-retrieval-engine.ts`, `src/retrieval/opensearch-alias-retriever.ts`), for user hypotheses A/B/C/D on why "personnel" drags wrong families into results:
- Root cause of hypothesis A ("security alias hits = 148, security personnel alias hits = 0"): a multi-token alias query only ever searched its full-width phrase window (e.g. the single window `"security personnel"`), which matches zero existing aliases, wiping out `folded_alias`/`opensearch_lexical` evidence entirely even though the head word "security" alone would have matched broadly. This is a different code path from the `ngram_alias` channel discussed in §8.2/8.3 of `core.md` — that channel comes from a separate retriever, `alias-ngram-retriever.ts`'s `retrieveBinaryAliasNgramHits`, gated behind `!hasWholeAlias` and untouched by this fix.
- Fix: when the primary phrase-window search returns zero rows, fall back to single-token windows restricted to the query's classified role-head token(s) (`preparedQuery.intent.roleHeadTokens`) — not every useful token. Restricting to the role head avoids a self-caught regression where a generic wrapper long enough to pass the single-token length gate (e.g. "personnel", 9 chars) would hijack the fallback ("Media Personnel" wrongly matching HR leaves via "personnel" instead of "media").
- Confirmed effect: "Security Personnel" now resolves to family "Protective services workers" at 66% confidence (previously flipped to "Database and network professionals" per `core.md` §8.2's anomaly).
- Refactor (this segment, no behavioral change): the near-duplicate phrase-window-building logic in both retrieval engines was consolidated into a new shared module, `src/retrieval/alias-phrase-windows.ts` (`buildAliasPhraseWindows`, `buildAliasHeadTokenFallbackWindows`), eliminating ~140 duplicated lines. Verified byte-identical behavior via `tsc`/`biome`/`npm run build`, the structural test suite, the golden suite (same 19/24 pre-refactor baseline), and a 9-query spot-check against pre-refactor output.
- Tests added: `src/tests/structural/alias-phrase-windows.test.ts` (5 unit tests against the shared module), two new pipeline-level regression tests in `runtime-contract.test.ts` (Security Personnel fix + Media Personnel non-regression), and two golden cases — stable `ambiguous-wrapper-security-personnel` (guards the fix) and developing `dev-en-sales-personnel-generic-wrapper-pollution` (documents the still-open gap below, non-blocking).
- Full golden suite after all additions: stable 20/25 (5 pre-existing failures, unrelated, unchanged), developing 33/55 (22 non-blocking failures, including the new documented case) — no regressions from the pre-existing baseline.

Hypotheses B/C/D status (user's own labels from the kickoff prompt for this investigation) — reconciled against work already done earlier in this session, not just this segment:
- **A — fixed** (above).
- **B — "why does OpenSearch stop returning Protective Services for the two-word query?"** Not independently re-verified. Fix A's effect on the Security Personnel golden case is fully explained by the `folded_alias`-channel restoration alone; the `opensearch_lexical` lexical retriever itself (`this.occupationRetriever.retrieve`) was not touched this session, so B is neither confirmed nor ruled out.
- **C — "should personnel/staff/worker(s)/... be generic wrappers, not domain modifiers?"** Two separate things bundled under this letter, both already addressed *before* this segment, not by fix A: (1) the query-intent fallback-bug fix (see above, `roleHeadTokens: []` confirmed for "sales personnel" today, not wrongly `["personnel"]`), and (2) the family-token-relevance artifact wired into `alias-ngram-retriever.ts` (see above). Neither one fixes "Sales Personnel": family 14791 "Administration professionals" is genuinely at/near the per-token max relevance for "personnel" (it really does own that token most in the corpus), so family-conditioning has no leverage — the relevance multiplier for it is correctly ~1, not a discount.
- **D — "penalize alias matches that only match the head token; the second token should matter." Still open — now the clearest remaining lever.** Confirmed live today: `--query="Sales Personnel"` → `unresolved` (31% confidence). Family 14791's winning `ngram_alias` evidence has `matched_tokens: ["personnel"]` only — "sales" contributes nothing to it. The correct sales-domain families (14903, 14682) are visible in `ranked_families` (thanks to the earlier candidate-generation union fix) but don't clear the confidence gates on their own weaker "sales"-only evidence. Nothing in the pipeline currently requires or rewards a family matching *more* of the query's tokens over a family matching only one token, however legitimately that one token belongs to it. Likely next lever: weight/require `ngram_alias` promotion by `token_coverage`, not just per-token family-relevance.
  - Note: an earlier probe in this session (before the candidate-generation union fix landed) had observed a *different* family, 14677 "Business services and administration managers", winning this same "personnel manager"/"personnel director" evidence for the same query — not contradictory, both families genuinely carry "personnel"-heavy aliases; which one surfaces as top wrong-ish candidate shifted as other unrelated fixes landed. The underlying gap (D) is unchanged either way.
- "General Personnel" (leaf "operations manager", 73% confidence): observed, not triaged, no golden case added — no confident view yet of what the "correct" expected answer should be.
- Full writeup with code citations: `core.md` §8.4 (fix A) and §8.5 (B/C/D status).
