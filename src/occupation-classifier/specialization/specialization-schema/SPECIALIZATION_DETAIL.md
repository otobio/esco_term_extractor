You are working on a structural occupation-specialization classifier. The dataset is intentionally strict and must be treated as a canonical production taxonomy, not as fuzzy suggestion data.

  Scope:
  - Work only inside `tools/structural-classifier-check`.
  - Treat this folder as self-contained logic.
  - Do not use external heuristics, embeddings, fallback classifiers, or unrelated codepaths.

  Core rules:
  - The system’s goal is to match queries to the closest canonical leaf occupation.
  - Canonical outward values must be stable and normalized.
  - If a query maps to a canonical role head or canonical concept through aliasing, the outward profile must expose the canonical English value, not the surface form.
  - Role-head aliases and concept aliases exist to make downstream equality checks safe and naive comparisons reliable.
  - Structural correctness is more important than patching outputs.

  Dataset strictness:
  - There must be a single source of truth for each schema surface.
  - Do not create duplicate sources for aliases, role heads, or concept equivalence.
  - Only promote aliases when they are exact and safe.
  - Reject approximate, broad, or semantically drifting aliases.
  - Exact locale variants are good candidates.
  - If an alias duplicates an existing canonical leaf token in a conflicting way, reject it.
  - If a term is ambiguous, do not autopromote it.

  Role-head rules:
  - `specialization-role-heads.csv` is the canonical role-head inventory.
  - `specialization-role-head-aliases.csv` is the single alias source.
  - Role-head groups must be absorbed from the real canonical role-head inventory, not from old fallback constants.
  - Related role-head groups are meant to express true semantic families, not loose theme buckets.
  - Prefer detailed, concrete families like `developer/programmer/coder` or `teacher/lecturer/trainer/tutor`, not vague mixed buckets.

  Concept rules:
  - Concept aliases should stabilize multilingual and surface variation into canonical English concepts.
  - Concept equivalence should capture related canonicals within the same dimension so narrow contradictions do not wrongly hard-reject.
  - Broad contradictions must still reject.
  - Narrow related canonicals should remain neutral or equivalent, not contradictory.

  Ambiguity rules:
  - Ambiguity resolution should happen later, after structural extraction.
  - Early extraction should stay conservative when evidence is mixed.
  - If one dimension is present on one side and absent on the other, absence should usually stay neutral rather than contradict.
  - Role modes are weak disambiguation hints, not hard commitments.

  Testing expectations:
  - Add tests first when introducing structural changes.
  - Tests should encode the real invariant, not implementation details.
  - Golden tests are important.
  - Leaf-focused tests are preferred.
  - It is acceptable for a new test to fail initially if it captures the right invariant.

  Implementation style:
  - Keep code simple, explicit, and low-complexity.
  - Prefer data-driven fixes over heuristic logic growth.
  - Do not add abstraction unless it clearly reduces repeated logic without hiding behavior.
  - Do not patch outputs when the real issue is schema ownership, aliasing, canonicalization, or contradiction modeling.

  When reviewing or changing behavior, always answer:
  1. What is the canonical source of truth?
  2. Is this exact and safe, or approximate?
  3. Should this be alias, equivalence, neutral, or contradiction?
  4. Will downstream naive equality checks still work?
  5. Did we improve structural correctness of leaf matching?

  Deliverables I care about:
  - stricter canonicalization
  - safer alias promotion
  - richer but precise role-head grouping
  - better narrow-vs-broad contradiction handling
  - tests that prove the invariant
  - no duplicate data sources
  - no fuzzy shortcuts
