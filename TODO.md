# TODO

## Qualifications: experience-requirement as a first-class qualification

**Status:** deferred (parked 2026-07-19)

Today "years of experience" (e.g. `"6 years"`, `"5+ years experience"`) is treated
purely as a **seniority signal**: `parseExperienceYears` (`src/inference/shared.ts`)
feeds `inferLevel` (`src/inference/level.ts:151`), which maps years → a `level:*`
band. There is **no** `qualification:experience_requirement:*` concept.

Consequence: a structured field like `{ bucket: "qualifications", input: "6 years" }`
resolves nothing — "6 years" is not a qualification in the current taxonomy, and
`inferQualifications` (`src/inference/qualifications.ts`) only covers education,
certificates, licenses, language, and gender.

### When we return to it
- Decide the taxonomy shape: fixed bands (e.g. `0_2_years` / `3_5_years` /
  `6_10_years` / `10_plus_years`) vs. a single "minimum N years" requirement.
- Add the canonical keys to the taxonomy/dictionary.
- Wire `parseExperienceYears` into `inferQualifications` to emit the qualification
  term (it already extracts the lower-bound year count). Keep the existing level
  mapping — experience can legitimately drive BOTH `level` and a qualification
  requirement.
- It rides the unified finite path automatically (see
  `finite-resolution-unification` memory) once `inferQualifications` emits it — no
  plumbing changes needed in ingest/title/extractor.

### Related
- Consider whether structured `qualifications` should route through the
  hybrid/semantic path (as the extractor treats it) rather than finite-lexical, so
  conceptual degrees resolve without an exact alias. (Separate, smaller question.)

## Description profile corpus and offline ingestion

**Status:** open (added 2026-08-03)

The description profile is now section-aware and locale-first for `ro` / `hu` /
`et`, but its quality depends on feeding it real board grammar rather than ad hoc
header strings. We need an offline corpus loop so we can scale section-bank
coverage and extraction regressions cheaply.

### Next steps
- Add a small offline listing-ingestion format (likely JSONL) carrying:
  `locale`, `url`, raw HTML or visible text, normalized line-broken text, and
  optional board/source metadata.
- Build a local extractor/eval script pair so we can run the section classifier
  over many saved listings and review only the failures / `unknown` blocks.
- Seed corpus fixtures for Romanian first, then Hungarian, then Estonian, using
  real marketplace samples rather than synthetic examples.
- Add corpus-style tests that assert:
  section kinds, a few representative clauses, and a few high-value bucket
  outcomes (`capabilities`, `qualifications`, `benefits`, `compensation`).
- Extend `match analyze` / smoke tooling only as debug surfaces; the long-term
  data loop should come from saved corpus files, not manual prompt iteration.
