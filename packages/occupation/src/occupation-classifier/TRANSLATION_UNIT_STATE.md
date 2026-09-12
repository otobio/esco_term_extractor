# Translation Unit State

Goal: stop treating all translated English tokens as independent AND requirements.

Invariant:
- Translation owns source-span semantics.
- Retrieval may use flattened English tokens for broad recall.
- Strict exact-key, resemblance, and family validation should use source units.
- One local source unit with several concept alternatives is satisfied by any one alternative.
- A role-head alias owns its span over concept aliases for the same span.

Current cases:
- `farmacist` must translate to role head `pharmacist`, not `medical pharmacist`.
- `vanzari` may produce alternatives such as `sales` and `business`; a candidate/family covering either should satisfy that source unit.
- `Solar System Panel` must still not exact-shortcut to `electrician`; `solar` is a real source token and must be covered structurally or lexically.
- `Consultant Vanzari - Mobexpert Baia Mare` should select `business consultant`.

Implementation shape:
1. Add translation units to `CanonicalComparisonQuery`.
2. Build units in `translateTitleForClassifier`.
3. Generate canonical exact keys from role-head units crossed with modifier-unit alternatives.
4. Use units in `computeCanonicalResemblance` for modifier coverage and required non-role completeness.
5. Use units in family validation so same-source alternatives do not become contradictions.

Status:
- Source inspection complete.
- The concept schema CSV has dimensions, but `SpecializationConceptRule` currently drops them. First patch will carry dimension through the schema lookup.
- Translation will expose `translationUnits` on `CanonicalComparisonQuery`: one local span, many alternatives.
- `computeCanonicalResemblance` and exact-canonical shortcut will use unit coverage, so `business|sales` from one local token is OR, not AND.
- Family validation will use unit concept coverage against family structure rules, so rejected flat alternatives can be accepted when each source unit has at least one covered concept.
- Implemented in source:
  - `SpecializationConceptRule` carries `dimension`.
  - `TranslatedTitle` and `CanonicalComparisonQuery` carry `translationUnits`.
  - Romanian `vanzari` becomes one concept unit with `business` and `sales` alternatives.
  - `computeCanonicalResemblance` uses modifier token units and concept-unit requested coverage.
  - `selectUniqueExactCanonicalLeaf` uses unit completeness when comparison query units are available.
  - `validateFamilies` only softens a reject when the candidate is role-grounded and the family covers the translated concept units.
- Tests added:
  - translation unit shape for `consultant vanzari`.
  - full canonical resemblance coverage for `business|sales` unit.
  - exact canonical shortcut coverage for translated alternatives.
  - family validation coverage for translated alternatives.
- `npm run test:classifier:unit` passes: 142/142.
- Validation:
  - `npm run build` passes.
  - Focused integration `node --test dist/tests/occupation-classifier/integration/exact-alias-role-head-mismatch.test.js` passes: 5/5.
  - CLI `Consultant Vanzari - Mobexpert Baia Mare` selects `business consultant` with score 1.
  - CLI `FARMACIST` selects `pharmacist` through `exact_canonical_leaf`.
  - CLI `Solar System Panel` selects `solar energy technician`; `electrician` remains only an alternate leaf.
  - CLI `Sef tura patiserie` selects `head pastry chef`.
  - CLI `TEHNICIAN-ALPINIST TELECOMUNICATII` selects `telecommunications technician`; `steeplejack` is not selected.
  - CLI `Brand Consultant TOBACCO` now returns the sales/marketing/public-relations family, not a wrong leaf.
  - `Consilier de vânzări` now returns a sales family, but not `specialised seller`; that remaining gap is role-head bridging/adviser-vs-seller, not the translation OR bug.
  - `npm run test:structural` fails in broader structural tests outside this confined classifier work.
  - `npm run evaluation:golden:pipeline:developing` exits 0 with `blocking_failures=0`.
  - `npm run evaluation:golden:pipeline -- --suite=stable` fails in the broader pipeline suite; it reports legacy/stable failures including `ro-farmacist` confidence 43%, while the new classifier CLI resolves `FARMACIST` at confidence 1.
- Cleanup pass:
  - Removed the one-line family coverage wrapper.
  - Removed hot-path token-unit helper indirection.
  - Pre-tokenized unit alternatives once in `buildQueryResemblanceInput`.
  - Candidate and exact-canonical coverage loops now do direct nested loops over unit alternatives and token sets.
  - Avoided new spread/concat allocation in the new query resemblance setup.
  - `npm run test:classifier:unit` passes after cleanup: 142/142.
  - `npm run build` passes after cleanup.
- Tokenization cache pass:
  - Added a 500-entry `BoundedCache` inside `src/utils/texts.ts` for `tokenizeNormalizedText`.
  - This keeps phrase alternative tokenization cheap without adding classifier-specific cache plumbing.
  - `npm run test:classifier:unit` passes after cache change: 142/142.
  - `npm run build` passes after cache change.
- Family-selection structural root-cause review:
  - English input must not create translation units. Translation units model source-span OR semantics for actual locale translation; applying them to English self-labels dropped stopwords such as `and` from exact canonical family keys and forced exact leaf self-labels through unnecessary strict unit completeness. The exact family/leaf slow sweeps now pass again.
  - The alias hot-path workaround was reverted. The structural issue appears to be in family compatibility: family-side `population` is globally treated as empty, so `customer` cannot disambiguate `agent` families even when the family rule explicitly models `customer`. A broad population enablement was tried and then reverted because population is too ambiguous as a normal hard dimension.
  - Next structural direction: use population only as role-conditioned disambiguating context for ambiguous matched role heads, not as standalone family proof.
  - CLI debug now prints a `familySelection=...` line plus per-family selector leaf rank derived from real ranked leaves, without adding debug-only fields to `FamilyAssessment`.
  - Validation:
    - `npm run build` passes.
    - `npm run test:classifier:unit` passes: 143/143.
    - `node --test dist/tests/occupation-classifier/integration/exact-name-resolution-slow.test.js` passes: 2/2.
    - `node --test dist/tests/occupation-classifier/integration/exact-alias-role-head-mismatch.test.js` passes: 6/6.
    - CLI `Customer Agent with English and Irish understanding` currently selects `customer service representative`, but family structure still needs the narrower role-conditioned population treatment.
