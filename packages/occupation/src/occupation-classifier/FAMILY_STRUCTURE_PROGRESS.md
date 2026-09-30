# Family Structure Completion Progress

Scope: only `src/occupation-classifier/**` and related `tests/occupation-classifier/**`.

## Goal

Make family structure/statistics complete enough that every ESCO leaf canonical title contributes explicit structural evidence. Useful tokens should resolve to concepts, and non-useful tokens should be accounted for as intentional noop/role-head/stopword/unresolved policy rather than silently disappearing from family generation.

## Current Findings

- `budget manager` currently exposes `manager` as a role head, but `budget` is not emitted as `budget_knowledge_domain` in `profile.concepts`.
- `budget_knowledge_domain,budget,knowledge_domain,knowledge` is syntactically valid because the fourth column is `role_modes`, but behaviorally wrong for manager titles because `manager` does not activate `knowledge` role mode.
- Existing whole-leaf structure test proves no true family is rejected, but it does not prove family statistics prefer the true family.
- Quick audit before changes found:
  - `3039` real ESCO leaves.
  - `0` true-family structural rejects.
  - `230` leaves where another structurally viable family scores above the true family by current statistics.
  - `397` leaves with no extracted concept signal.

## Next Steps

1. Add failing tests for schema/extraction completeness.
2. Audit every leaf token assignment and concept extraction.
3. Fix specialization schema/arbitration defects first.
4. Feed enriched structural evidence into family coverage/statistics.
5. Add all-leaf tests for true-family statistical preference or explicit ambiguity.
6. Run focused tests, then full required gate.

## Changes Made

- Added red tests for `budget manager` concept extraction and every-leaf unresolved-token accounting.
- Ungated `budget_knowledge_domain` in the live specialization concept rules and test schema snapshot.
- Query specialization now preserves deterministic literal structural assignments instead of marking them unresolved.
- Added aliases `fishery -> fisheries` and `mechanics -> mechanical`.
- Added `src/occupation-classifier/specialization/audit-leaf-specialization.ts`.
- `npm run test:classifier:specialization` passes with:
  - `3039` leaves.
  - `2650` leaves with concepts.
  - `4685` total concept matches.
  - `1540` witnessed concepts.
  - `0` leaves with unresolved canonical tokens.
- Applied family-structure coverage review additions, including `budget_knowledge_domain` for family `14677`.
- Family structure now uses specialization concept-equivalence families and records query-side equivalent concepts so broad-context guards still work.
- Regenerated `src/occupation-classifier/family-statistics/family-statistics.json`.
- Focused family tests passing:
  - `family-structure-context-weighting`
  - `family-structure-leaf-self-validation`
  - `family-structure-coverage-review`
  - `family-statistics`
- Full classifier unit suite passes: `npm run test:classifier:unit` (`464` tests).

## Remaining Diagnostics

- Compact family-statistics audit after these changes:
  - true-family structural rejects: `0`
  - no extracted concept IDs in prepared family query: `395`
  - structurally viable wrong family with higher pure statistics score: `272`
- The `notTop` statistic is not yet a correctness gate because `scoreFamilyStatisticalFit` only boosts confidence for already viable families; many examples are generic manager/director titles where other families have stronger statistical priors. Do not tune weights blindly to force this to zero.
- `payroll manager` still structurally rejects Business Admin/Finance Manager families because `payroll_work_object` is currently leaf-backed by `payroll clerk` under Numerical Clerks, not by a manager-family leaf.

## Latest Coverage Scan

- `npx tsx src/occupation-classifier/specialization/audit-leaf-specialization.ts`
  - `3039` leaves scanned.
  - `2650` leaves with concepts.
  - `4685` total concept matches.
  - `0` leaves with unresolved canonical tokens.
- `npx tsx src/occupation-classifier/family-structure/review-family-structure-coverage.ts`
  - `0` family-structure coverage additions found.
  - `125` families and `3039` leaves scanned.
- Focused coverage tests pass:
  - `npm run test:classifier:unit -- --suite=specialization-dimension-mapper`
  - `npm run test:classifier:unit -- --suite=family-structure-coverage-review`
  - `npm run test:classifier:unit -- --suite=family-structure-leaf-self-validation`
  - `npm run test:classifier:unit -- --suite=family-statistics`
- `npm run test:structural` skipped at user request.
- `graphify update .` skipped at user request.
- Pipeline golden suites are outside this new-classifier coverage task and should be skipped unless explicitly requested.

## Contradiction Investigation Notes

Sampled reported low-quality titles through `classifyOccupationTitleDebug` and `compareFamilyStructureToQuery`.

- The most common hard-failure shape is not missing family coverage; it is over-final family survival:
  - candidate family is present;
  - family statistics never helps because `structureDecision === "reject"` short-circuits statistical confidence;
  - the final result falls to low-confidence unresolved.
- Main structural weakness categories found:
  - Composite/compound role heads are treated as all-required. Example: `Merchants Sales Account Manager` extracts `merchant` and `manager`; the sales-management family matches `sales` and manager authority, but rejects because it does not list `merchant`.
  - Same-dimension concept mismatch is too hard at family level. Example: `First Officer ... Pilot` matches pilot role/family but `entry` becomes a task contradiction; `Specialist AI, Online & Optimizare Procese` matches software/process concepts but `intelligence_knowledge_domain` can contradict instead of serving as weak context.
  - Locale/role-head gaps still dominate many Romanian examples. Examples: `stivuitoristi`, `tamplar`, `medici`, `operatori sali de jocuri` often have no role head in the structural profile, so families are only partial and ungrounded rather than truly contradicted.
  - Noisy recruiter/context tokens still become strong concepts. Examples: `MEDIA` from `MEDIAS`, `program`, `line`, `part`, `entry`, and `process` can become structural concepts even when they are location/noise/process context rather than family-defining occupation evidence.
  - Authority mismatch can still overrule realistic compound roles. Example: `ODOO ERP COACH AND ADMINISTRATOR` becomes manager authority plus coach/admin role heads, then rejects the teaching/coach candidate on authority and software work-object contradiction.
- Aggregate pass over the sampled list showed:
  - `26` top-family reject assessments in the inspected top slices.
  - `17` role-head mismatch reasons.
  - `25` concept-contradiction dimensions.
  - `22` partial-but-not-role-grounded top-family assessments.
  - `8` queries with no extracted role head in the post-translation structural profile.
- Direction: do not tune weights first. The next fix should separate family-level "exclusion contradictions" from "weak/unsupported context mismatch", and should distinguish primary occupation heads from secondary/compound role tokens before family survival is decided.

## Soft Family-Contradiction Fix

- Added failing family-gate tests for:
  - `Merchants Sales Account Manager` keeping Sales, Marketing And Development Managers alive through `manager` authority plus `sales` task support even when `merchant` is a secondary compound role token.
  - `First Officer Command and Direct Entry Pilot` keeping Ship And Aircraft Controllers And Technicians alive through the strong `pilot` role head even when `entry` is a weak task mismatch.
  - `Specialist AI Online Optimizare Procese` keeping Software And Applications Developers And Analysts alive because it matches `optimisation_task`, while health specialist families with no matched context stay non-viable.
- Family structure now distinguishes hard family-level concept contradictions from soft context mismatches:
  - hard: `population`, `product`, `work_object`;
  - soft for family survival: broad `task` and `knowledge_domain` mismatches can downgrade to `partial` instead of hard-rejecting when role/authority/matched context supports the family.
- Role-head mismatch can survive as `partial` only with real survival support:
  - matched non-domain concept support (`task`, `knowledge_domain`, `population`, `product`, `work_object`), or
  - non-contradicted authority evidence.
  - domain-only matches (`venue`, `channel`, `industry`) do not rescue a role-head mismatch, preserving the `Airline Compliance Auditors` aviation-drift guard.
- Residual catch-all families are no longer promoted from `partial` to `accept` when a specific partial family is already available.
- Classifier-level sample outcomes after the change:
  - `Merchants Sales Account Manager` -> leaf `sales manager`, family `14682`.
  - `First Officer, Accelerated Command and Direct Entry Pilot` -> family `14867`.
  - `Specialist AI, Online & Optimizare Procese` -> family `14802`.
  - `Airline Compliance Auditors` still rejects aviation family `14867`.
- Validation run:
  - `npm run test:classifier:unit` passed `467` tests.
  - New integration guard passed in isolation with `node --test --test-concurrency=1 --test-name-pattern "classifier keeps plausible families alive through soft family-level mismatches" dist/tests/occupation-classifier/integration/classifier-family-structure.test.js`.
  - `npm run build` passed.
  - Full `classifier-family-structure` integration file still has unrelated dirty-baseline failures; the new guard itself passes.

## Commands To Re-run

```bash
npx vitest run tests/occupation-classifier/unit/specialization-dimension-mapper.test.ts
npx vitest run tests/occupation-classifier/unit/family-structure-leaf-self-validation.test.ts
npx vitest run tests/occupation-classifier/unit/family-statistics.test.ts
npm run build
```

## Locale Token-Variant Query Expansion

- Added a red-to-green query-level specialization test for Romanian plural role heads and concepts:
  - `Medici - Buzau` now resolves role head `doctor` through `medici -> medic/doctor`.
  - `ELECTROMECANICI INDUSTRIALI` now resolves role head `mechanic` and industry `industrial` through locale token variants.
- Implementation is intentionally narrow:
  - `classifySpecializationQuery` passes locale variants only into single-token role-head and literal concept resolution.
  - Role-head phrase matching, structural concept phrase matching, and title/leaf snapshot classification keep their previous exact-token behavior.
  - No mapper-level cache was added; it reuses the existing bounded cache inside `src/query/token-variants.ts`.
  - Missing or unrecognized locale is normalized to base locale `en`; there is no separate unknown-locale behavior in this classifier path.
- Added/kept full leaf-token coverage as a hard mapper test:
  - every ESCO leaf canonical token must be structurally accounted for by query specialization;
  - current scan is `3039` leaves, `0` unresolved canonical tokens.
- Added conservative literal fallback coverage for recurring leaf inventory tokens that were still ambiguous/unresolved in query scans:
  - `centre`, `educational`, `human`, `public`, `sewing`, `special`, `technical`, `tourism`.
- Validation run:
  - `npm run test:classifier:unit -- --suite=specialization-dimension-mapper` passed `86` tests.
  - `npm run test:classifier:unit -- --suite=family-structure-context-weighting` passed `8` tests.
  - `npm run test:classifier:unit -- --suite=specialization-gate` passed `47` tests.
  - `npm run build` passed.
- Broader `npm run test:classifier:unit` still has the known family-rule coverage/self-validation failures:
  - `family-structure-coverage-review` reports 8 missing family-rule coverage details.
  - `family-structure-leaf-self-validation` reports 9 true-family self-rejections.
  - These are the next family-structure dataset issues, not the query token-variant injection itself.

## Constrained All-Rejected Family Recovery

- Added a final, flat family recovery pass inside `validateFamilies` that runs only when normal family validation has no eligible family (`accept`, or role-grounded `partial`).
- Recovery candidates are limited to families that already entered the candidate ledger through hard-rejected leaf candidates.
- Recovery still requires:
  - a prepared structural query;
  - the family structure gate to be `accept` or `partial` for that family;
  - concrete candidate evidence: direct alias evidence, or a non-rejected leaf structural gate with positive requested concept coverage.
- Recovered families use support kind `rejected` so debug output remains explicit that no leaf survived.
- Recovery confidence is deterministic and structural:
  - exact family-rule concept matches count more than equivalence-only matches;
  - equivalence can support recovery but cannot beat exact concept coverage by itself.
- Guarded real case:
  - `Client Support ITALIAN Bucharest - September 15th start date` now resolves to family `14965` (`Client information workers`) with no leaf promotion.
- Validation run:
  - `npm run test:classifier:unit -- --suite=family-validation` passed `7` tests.
  - `npm run test:classifier:unit -- --suite=family-structure-context-weighting` passed `8` tests.
  - Isolated integration guard passed:
    `npm run build:tests && node --test --test-concurrency=1 --test-name-pattern "classifier recovers a constrained family when all leaf candidates are rejected" dist/tests/occupation-classifier/integration/classifier-family-structure.test.js`
  - `npm run classification:occupation -- --query="Client Support ITALIAN Bucharest - September 15th start date" --locale=ro --no-color` returned family `Client information workers (node=14965)`.
  - `npm run build` passed.
