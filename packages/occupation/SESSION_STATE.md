# Session State

Current resolver objective: keep the family/leaf fallback structural and locale-aware, using shared role-head equivalence data rather than resolver hardcoding, and validate it on the RO 100-title sample.

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
