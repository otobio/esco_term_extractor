# Title Profile — Work State (for continuation / finetuning)

Compact dump of the title-profile work so a fresh context can resume finetuning.
Full detail: `docs/title-profile.md`.

## What this is

A self-contained title-resolution pipeline in `term-extractor` that turns a job
title string into canonical taxonomy buckets. Resolves against the live
`canonical_runtime_terms` OpenSearch index (neural-sparse + lexical additive
hybrid). **Does NOT touch `job-resolver`** (separate repo, production). Reads title
text only. Must support **hu, ro, en, et**.

Status: **stable, 133 tests pass, `tsc` clean.** Ready for accuracy finetuning.

## Constraints (hard)

- Self-contained to `term-extractor`; do not modify `job-resolver`.
- Title/description fields only.
- Everything per-locale (hu/ro/en/et).
- No dictionary/ingest changes on our side — query-side only (variants, residual).

## Architecture (file → role)

- `src/profiles/title.ts` — `resolveTitle(text, deps)`, the 7-step pipeline.
- `src/profiles/lookups.ts` — `BucketLookup` interface, `openSemanticLookup` /
  `aliasLookup` / `gazetteerLookup`, `osFinalize` (ranking), `computeResidual`,
  `isGrounded`, `BOUNDARY_WORDS` (per-locale), `SOURCE_PREF`.
- `src/profiles/index.ts` — exports + `PROFILES` registry.
- `src/matchers/additive-hybrid.ts` — occupation/capabilities strategy; `FLOORS`
  {occupation term1/neural5.5, capabilities term1/neural4.8}.
- `src/matchers/lexical.ts` — finite-bucket strategy.
- `src/matchers/strategy.ts` — `foldSurface`, `exactClauses`, `fuzzyClauses`,
  `topHits` (termAnchored), boosts (EXACT100/DISPLAY70/ALIAS70/PHRASE18/FUZZY8).
- `src/matchers/morphology.ts` — `numberVariants(gram, locale)`, per-locale RULES,
  MIN_STEM 3.
- `src/matchers/resolve.ts` — `strategyForBucket` (occupation/capabilities→additive,
  else lexical), `buildFilters` (locale→[locale,en,global]).
- `src/gazetteer/resolver.ts` — `resolve(clauses, structured?, locale?)`, per-locale
  place gating.
- `scripts/match.ts` — CLI (`--profile title`, `--locale`, `--verify`).
- `scripts/title-failures.ts` — aggregate pattern scan over `data/gold.json`.

## Key design decisions (and WHY)

1. **Uniform `BucketLookup`** — same interface, per-bucket mechanism, single
   `_msearch`, no per-bucket special-casing in the pipeline.
2. **Soft munch / residual** — peel modifier buckets
   (level/workplace/schedule/employment/company_size) to expose the occupation core,
   sent AS EXTRA candidates alongside the whole clause (non-destructive). Boundary
   trimming uses a tiny per-locale connector set, NOT the broad stopword list
   (which contains content words like customer/support).
3. **"Residual boost" = ranking priority, not a number.** `osFinalize` ranks
   `grounded (exact) → residual > clause → score`. Reason: a full clause out-scores
   a clean residual just by having more tokens to fuzzy-match (senior python
   developer→sensor_engineer 50 vs residual python developer ~5). A small additive
   boost can't flip 5-vs-50; fuzzy-floor tuning was rejected as too generic. The
   priority also protects exact compounds (CEO, Lead Nurse) from being over-peeled.
4. **Location per-locale** — `locale ≈ country code`; resolver gates places to the
   locale before disambiguation. en → nothing. locale omitted → ungated (dense path
   unchanged).
5. **`--verify`** — opt-in, non-destructive dense cosine stamp on non-location
   rows. Profile stays embedder-free unless a verifier is injected. Stamp only (no
   gate yet). ✓≥0.5 / ⚠<0.5. **Compares SAME-LOCALE** (term's value + up to 2
   aliases in the query locale, via `ResolvedTerm.verifyTargets`; `agreement` = max
   cosine) — NOT the English `display_name`, because cross-lingual cosine runs low
   and false-⚠'d correct ro/hu/et (asistent vanzari 0.47→0.66). Falls back to the EN
   display + `agreementCrossLingual` (rendered `ˣˡ`) when no same-locale row. The
   `Verifier` contract is `{span, texts[]}` → number[].
6. **Fuzzy locale-scoping (OS matcher change)** — in `strategy.ts` `fuzzyClauses(term,
   locale?)`: phrase clauses stay cross-locale, but edit-distance `fuzziness` clauses
   are wrapped in a NON-SCORING `filter` on `language_code = locale` when a locale is
   set. Kills cross-language fuzzy look-alikes (ro sef ~ en chef) with no boost.
   Applies to BOTH additive + lexical strategies (shared matcher). Decided AGAINST a
   same-locale score boost (LOCALE_BOOST) — deferred.
7. **Generic occupation head skip** — per-locale special-case set
   (`GENERIC_OCCUPATION_HEADS`, like `BOUNDARY_WORDS`) of bare head nouns
   (asistent/manager/…) that we do NOT match as occupation candidates. Skips the
   bare token (span/clause/residual) but keeps multi-word spans ("asistent
   manager"); never lists specific trades (sudor/electrician). Enabled via
   `openSemanticLookup('occupation', { dropGenericHeads: true })`. Filtered before
   the whole-clause fallback gate so a bare head doesn't block a real fallback.
   Effect: gold ambiguous occupations 24→18, no new misses.
8. **Neural = ON for all again** — `NEURAL_ENGLISH_ONLY = false` in
   `additive-hybrid.ts`. Neural re-enabled on every locale (it sits in `should`, so
   it can never veto); the English encoder still helps English-primary country-code
   locales. `matcher.spec` locks neural-present-for-all (still omitted when no query
   model is deployed). Flip to `true` to restrict neural to English/unset queries.
9. **Country-code locale w/ English surfaces (`ng`)** — the lexical span scan gated
   candidates to `language_code = [locale]` only, stricter than OS `buildFilters`
   ([locale, en, global]); an `ng` title (English surfaces, only location stored as
   `ng`) therefore found NO spans. `title.ts` scan `langs` now mirrors buildFilters
   (`locale === 'en' ? [en, global] : [locale, en, global]`), so English/global
   surfaces resolve under any country-code locale. ro/en gold unchanged
   (clean 62 / ambig 18 / whole 13 / miss 6).

## Measured results

- Gold titles occupation pattern: clean-span **62**, ambiguous **18** (was 24 before
  generic-head skip), whole-clause **13**, miss **6** (run `npx tsx
  scripts/title-failures.ts`). Expanding GENERIC_OCCUPATION_HEADS (en+ro+hu+et)
  improved clean/whole/miss with no new misses — single-token noise removal.
- Residual fixes (residual resolves above floor & wins): Remote Customer Support →
  customer_service_representative; Lead Sales Representative → sales rep family;
  Fullstack…Remote Work → software_developer.
- Verify separation: real 0.80–0.88, fuzzy artifacts 0.18–0.40.

## Open finetuning items (next context)

1. **Residual below neural floor** — `"python developer"` scores ~5 < 5.5 occupation
   floor → no accepted residual, so the fuzzy full-clause (sensor_engineer 50)
   survives. Options: lower/att-adjust occupation neural floor for residual-sourced
   candidates; or let `--verify` GATE (demote/drop ⚠<threshold) so the confident-
   wrong hit becomes an honest miss. (User explicitly likes verify-as-gate as a
   candidate.)
2. **`--verify` gate** — currently stamps only. Wide 0.5 separation makes a gate
   safe; decide stamp vs demote vs drop.
3. **hu/et stubs** — `morphology.ts` RULES, `lookups.ts` BOUNDARY_WORDS **and
   GENERIC_OCCUPATION_HEADS** for hu/et are minimal; expand. en/ro generic-head sets
   are seeded but tunable — add/remove tokens as false positives surface.
4. **Sub-span occupation** — un-anchored no-modifier compounds (e.g. "Fullstack
   Python Developer") only try the whole clause; no sub-n-grams generated. Consider
   generating occupation sub-grams when no span and no peel.
5. **Dictionary gaps (user side)** — RO occupations (Deservent Buldoexcavator,
   Strungar), `head`→level alias.
6. **Revisit `NEURAL_ENGLISH_ONLY`** (decision #8) — temporary; observe ro/hu/et
   impact of neural-off, then keep or flip back to false.
7. **Same-locale score BOOST (deferred)** — user's insight: neural query encoder is
   English, so it distorts non-English queries; idea was to boost same-locale terms a
   little so they're preferred over distorted English-neural hits (must+should
   constant_score, ~15–20). Not implemented — revisit if English-neural hits are seen
   out-ranking correct ro/hu/et terms. (Verify same-locale + fuzzy-scoping shipped;
   boost did not.)
7. **`--locale` must be passed** — the title profile still runs unfiltered (all
   languages) when no locale is given → cross-locale leaks. Caller always passes a
   locale in practice; a "no unfiltered path (default en-only)" guard was discussed
   but not built.

## Commands

```bash
npx vitest run                      # 133 tests
npx tsc --noEmit                    # clean
npm run match -- --profile title "<title>" --locale <ro|hu|et|en> [--verify]
npx tsx scripts/title-failures.ts   # aggregate occupation/capabilities/location patterns
```

OpenSearch cluster on :9201 (canonical_runtime_terms). The `--verify` path loads the
local multilingual embedder (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`, fp16).
