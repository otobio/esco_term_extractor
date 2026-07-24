# Session State

Current objective: Replace the semantic-atom experiment with a family-discriminator/taxonomy-cleanup direction.

Latest user direction:
- The semantic atom approach did not justify itself clearly enough for mainline.
- Preserve the semantic-atom experiment on a branch and remove it from the main working direction.
- Explore family discriminators instead: terms that separate commonly confused ESCO families.
- The developing/golden set is too small to define all ambiguity; derive ambiguous families from the ESCO runtime artifacts.

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
