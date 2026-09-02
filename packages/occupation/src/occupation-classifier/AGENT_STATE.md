# Occupation Classifier Agent State

This file is temporary working state for coding agents. Keep durable project invariants in `AGENTS.md`; keep turn-by-turn context here.

## Current Boundary

- `src/occupation-classifier/specialization/**` is the active work area.
- Specialization is a structural extraction framework for concepts and role heads from title/query text.
- Do not change classifier scoring, ranking, family selection, leaf promotion, retrieval, runtime artifacts, or candidate resemblance logic while doing specialization-framework work.
- If specialization changes expose a downstream classifier failure, report it as separate instead of patching across the boundary.

## Current Work

- Role-head phrase vs specialization-concept span arbitration was stabilized in commit `c19063a`.
- Current work adds explicit structural combination evidence.
- Structural combination evidence belongs to the specialization framework output as `structural_combination`; it is not a direct `role_head` alias and should not rewrite concept dimensions.
- The classifier benefits from combination-derived role heads only at the translation boundary in `buildQueryStructuralProfile`, where `structural_combination.derivedRoleHeads` are merged into the classifier-facing `profile.role_head`.
- Reviewed combination mappings currently live in `specialization-structural-combinations.csv`.
- `front_desk -> receptionist` and `reception -> receptionist` are modeled as structural combinations because they can imply the role in classifier use, but they are not direct role-head aliases.
- There is one output for this evidence: `structural_combination`. Do not add a second sibling output such as `derived_role_head`.
- Role-head phrase matches should participate in the same span conflict ordering as concept candidates.
- Role-head phrase matching is stopword-tolerant and reserves the original token span, because role-head aliases include surfaces like `constatator de daune`.
- Concept alias and phrase-dimension matching are still contiguous-token matching. A broad stopword-tolerant concept pass caused family self-validation regressions for titles like `land-based machinery technician` and `speech and language therapist`.
- Accepted role-head phrases may reserve spans and become `role_head` output.
- Rejected role-head phrases must not become `role_head`, must not affect `roleModes`, and must not block winning concept output.
- Every dumped role-head alias should resolve through the full mapper as a role head. Punctuation-tokenized aliases such as `bo'sun` must not be merged away as duplicates of single-token variants such as `bosun`.
- Query and title surfaces should share the same arbitration shape:
  - `classifySpecializationQuery(...)`
  - `classifySpecializationTitle(...)`
  - `classifySpecializationTitleDetailed(...)`

## Tests To Cover

- Equal-length explicit concept beats role-head phrase.
- Longer role-head phrase beats shorter concept.
- Longer concept beats shorter role-head phrase.
- Losing role-head phrase does not influence role modes.
- Query/title/detailed parity for contested spans.
- Live-schema regressions:
  - `co-pilot` resolves to role head `pilot` with no `co` work object.
  - `front-end developer` resolves `front end` to work object `web`.
  - `front desk receptionist` should not double-count role heads or invent contradictory evidence.
  - Romanian `conducator auto` / `conducător auto` resolves to role head `driver` without leaking `auto`.

## Follow-Up

- Concept aliases with stopwords need a separate structural design. Current snapshot review found many concept aliases whose stopword-compressed form would resolve but whose full stopword form does not.
- Do not solve concept stopword handling by making every concept alias globally stopword-tolerant. That previously broke family self-validation.
- Candidate direction: build an explicit compressed-token matching surface for reviewed/eligible concept aliases, map matches back to original spans, then arbitrate normally with concepts and role heads.
- Concept-to-role-head derivation should be modeled through `structural_combination` evidence, not by reclassifying arbitrary concepts as role heads in classifier scoring.

## Validation

- Use `npm run test:classifier:specialization` for the fast specialization mapper loop.
- `npm run test:classifier:specialization` passed on 2026-09-02 with 62 passing tests after adding single-output structural combination evidence.
- `npm run test:classifier:unit` passed on 2026-09-02 with 417 passing tests after adding single-output structural combination evidence.
- `npm run test:classifier:specialization` passed on 2026-09-02 with 58 passing tests.
- `npm run test:classifier:unit` passed on 2026-09-02 with 412 passing tests.
- `npm run test:classifier:integration` was run on 2026-09-02. It had the expected single failure:
  `base-vs-specialized-leaf-ranking.test.js` expected `leaf`, got `family`.
- Do not run `npm run test:structural` for this task unless explicitly requested.
