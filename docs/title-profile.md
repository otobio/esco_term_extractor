# Title Resolve Profile

A profile is an **input-specific pipeline** over the shared OpenSearch matcher. The
`title` profile is tuned for short, bucket-dense job titles (e.g. `"Senior Python
Developer - Remote"`). It runs a full longest-match span scan, peels modifier
buckets to expose the occupation core, resolves every bucket through one uniform
interface, and (optionally) stamps a dense-embedding sanity check on each result.

It is **self-contained in `term-extractor`** and does not touch `job-resolver`. It
reads **only** the title text (one string in, structured buckets out).

- Entry point: `src/profiles/title.ts` → `resolveTitle(text, deps)`
- Per-bucket mechanisms: `src/profiles/lookups.ts`
- Registry / exports: `src/profiles/index.ts`
- CLI: `scripts/match.ts --profile title [--locale <ro|hu|et|en>] [--verify]`

---

## Pipeline (`resolveTitle`)

```
1. splitClauses      → clauses            (tokenizer; a spaced " - " / "/" splits an OR-list)
2. scan (lookupAll)  → per-clause alias hits   ONE number-aware lexical pass, ALL buckets
3. residual          → per-clause occupation core   (clause minus peel-bucket spans)
4. candidates        → each bucket's OS surfaces, tagged with provenance
5. match             → a SINGLE _msearch for every OS candidate
6. finalize          → each bucket's results (OS resolution and/or local gazetteer)
7. verify (optional) → dense-agreement stamp on each non-location result
```

Candidate generation (step 4) lives in its own stage, **outside** the match loop,
so the file reads top-to-bottom as a pipeline. The clause-expansion (number
variants) also sits outside the loop, in the scan.

### Why one `_msearch`

Every OS-backed bucket contributes its candidate surfaces up front; they are all
issued in a single `msearch`. Nothing fans out per-bucket at request time. The
matcher never loads the local embedding model on this path (see `--verify` for the
one exception).

---

## The uniform `BucketLookup` interface

Every bucket implements the **same** two-phase interface, with its own mechanism
behind it — so the pipeline has **no per-bucket special-casing**:

```ts
interface BucketLookup {
  bucket: BucketName;
  peels?: boolean;                                        // modifier bucket? (see residual)
  candidates(clauses, scan, ctx): Candidate[];            // OS surfaces to probe ([] if local)
  finalize(results, clauses, ctx): ResolvedTerm[];        // this bucket's results
}
```

| Mechanism | Buckets | How it resolves |
|---|---|---|
| `openSemanticLookup` | `occupation`, `capabilities` | alias spans + (occupation only) a whole-clause / residual fallback; resolved by the **additive-hybrid** OS strategy (handles paraphrase) |
| `aliasLookup` | `level`, `workplace`, `schedule`, `employment`, `company_size`, `benefits`, `company_type`, `collar_kind`, `qualifications`, `compensation` | exact alias spans, confirmed by the **lexical** OS strategy |
| `gazetteerLookup` | `location` | resolved **locally** by the gazetteer (no OS probe) |

`strategyForBucket` (`src/matchers/resolve.ts`): `occupation`/`capabilities` →
`additiveHybridStrategy`, everything else → `lexicalStrategy`.

### `openSemanticLookup` — the whole-clause fallback

For a clause that yielded **no span**, occupation adds the whole clause verbatim as
a candidate (a title's un-anchored phrase often *is* the occupation, e.g. `"Head of
VPS Infrastructure"`). This fallback is **ON for occupation, OFF for capabilities**
— a whole title is almost never a skill phrase, so that fallback was pure noise
(~77 % of titles). Capabilities therefore resolves from spans only.

### Generic occupation head nouns (per-locale special case)

A bare **generic head noun** — `asistent`, `manager`, `coordonator`, … — is never a
reliable occupation on its own: it aliases dozens of entries, so it resolves to
ambiguous fuzzy/neural noise across every `*_assistant` / `*_manager`. So, exactly
like boundary words, there is a small **per-locale special-case set**
(`GENERIC_OCCUPATION_HEADS` / `genericHeadsFor`) of heads we simply **do not match**
as occupation candidates (`dropGenericHeads`, ON for occupation only):

- A **bare** (single-token) generic head is skipped — as a span, as a whole-clause
  candidate, and as a residual.
- It still contributes **inside a multi-word span** (`"asistent manager"` →
  `management_assistant` is untouched).
- The head is removed from the span set **before** the whole-clause fallback gate,
  so a bare `"asistent"` does not block the fallback for `"asistent vanzari"`.
- Tuned to generic *heads* only — **never** specific trades (`sudor`, `electrician`,
  `strungar`), which remain valid bare occupations. hu/et are stubs to grow.

Effect on the gold titles (initial list → expanded list): ambiguous occupations
**24 → 18**, and expanding the heads further lifted clean-span **57 → 62**,
whole-clause **17 → 13**, and misses **7 → 6** — i.e. removing single-token noise
let *more* titles resolve cleanly, with **no** increase in misses. hu/et heads are
best-effort cognates (the gold set is mostly ro/en, so they're unvalidated there).

---

## Step 2 — Scan (`LexicalIndex.lookupAll`)

One number-aware pass per clause finds **all** alias spans for **all** buckets at
once (longest-match, left-to-right). Each hit carries `{gram, words, entry.bucket}`.

Query-side **number variants** (`src/matchers/morphology.ts`, `numberVariants`) let
a plural title surface match a singular dictionary alias (and vice-versa) **without
touching ingest**. Safe-by-construction: variants feed an *exact* match, so a wrong
variant simply matches nothing. Rules are **per-locale**, `MIN_STEM = 3`:

| locale | strip suffixes | add suffixes |
|---|---|---|
| en | `s`, `es` | `s` |
| ro | `i`, `e`, `uri` | `i`, `e` |
| hu | `k`, `ok`, `ek`, `ak` | `k` |
| et | `d`, `id` | `d` |
| default | `i`, `s` | `i`, `s` |

> hu/et are deliberate stubs — correct in shape, minimal in coverage. Refine here.

---

## Step 3 — Residual (soft munch)

`computeResidual(clauses, scan, PEEL_BUCKETS, locale)` in `lookups.ts`.

**Peel buckets** are modifiers wrapped around the occupation core; their matched
token spans are removed to expose the residual:

```
PEEL_BUCKETS = level, workplace, schedule, employment, company_size
```

Algorithm per clause:
1. Mark token positions covered by any **peel-bucket** span as consumed.
2. If nothing was peeled → return `[]` (residual would just equal the clause; no
   point).
3. Otherwise emit the contiguous **unconsumed** runs as residual segments, trimming
   **boundary connector words** from each run's ends.

Example: `"Head of VPS Infrastructure"` → peel level `head` → residual `"vps
infrastructure"` (`of` trimmed).

### Boundary words are PER-LOCALE

A tiny connector set per locale (`BOUNDARY_WORDS` / `boundaryWordsFor`), **not** the
broad stopword list — the stopword list contains content words like
`customer`/`support` that must survive in an occupation residual.

| locale | connectors |
|---|---|
| en | of, the, a, an, and, or, for, in, to, at, on, with |
| ro | de, la, pentru, si, cu, pe, un, o, in, a, al, ale |
| hu | a, az, es, vagy |
| et | ja, voi |
| default | of, the, a, and, or, de, la, si |

The residual segments become **extra occupation candidates** (source `residual`),
sent alongside the whole clause (source `clause`).

---

## Step 4–6 — Candidate provenance & ranking

Each candidate is tagged with **where it came from**, which governs ranking when
several candidates in one bucket resolve to *different* keys:

```ts
type CandidateSource = 'span' | 'residual' | 'clause';   // SOURCE_PREF: span 2 > residual 1 > clause 0
```

### The "residual boost" is a ranking priority, NOT a magic number

`osFinalize` keeps one row per canonical key and ranks them by:

```
grounded (exact surface match)  →  source preference  →  raw score
```

- **grounded** = the surface (any number-variant, folded) IS one of the hit's own
  surfaces (value / display_name / alias) — an exact match, not a soft/fuzzy
  neighbour. `isGrounded()` in `lookups.ts`.
- **source preference** = `span > residual > clause`.

**Why a priority, not a score bonus:** a full clause out-scores a clean residual
purely by having *more tokens to fuzzy-match*. Measured:

```
"senior python developer" (full)     → sensor_engineer   50   (fuzzy accumulation)
"python developer"        (residual) → property_developer  5   (soft neural)
```

No small additive bonus can flip 5 vs 50, and tuning the fuzzy floor is a generic
lever we rejected. The ranking makes the clean residual win over full-clause fuzzy
noise, while **an exact (grounded) full-clause compound still wins** — so
`"Chief Executive Officer"` is not wrongly peeled to `"executive officer"`, and
`"Lead Nurse"` (exact alias) beats the residual `"nurse"`.

**Limitation:** if the residual scores *below the bucket neural floor* it produces
no accepted result, so there is nothing to prioritise (e.g. `"python developer"` at
5 < the occupation neural floor of 5.5). That case is left to `--verify`.

---

## OpenSearch resolution

### Additive-hybrid strategy (occupation, capabilities)

`src/matchers/additive-hybrid.ts`. All clauses go in `should` with
`minimum_should_match: 1` — neural **never gates** lexical and vice-versa:

- exact clauses (folded value/display_name/alias `.keyword`, over number variants)
- fuzzy clauses
- `neural_sparse` on `sparse_embedding` (`query_text`, `model_id`)

Boosts (`src/matchers/strategy.ts`): EXACT 100, DISPLAY_NAME 70, ALIAS 70, PHRASE
18, FUZZY 8. Diacritics are folded on both sides (`foldSurface` +
index-side asciifolding).

**Edit-distance fuzzy is locale-scoped.** Exact, phrase, and neural clauses match
across `[locale, en, global]` (the surface is often English, which must resolve).
But edit-distance `fuzziness` bridges cross-language look-alikes (ro `sef` ~ en
`chef`) — only ever a false positive — so when a locale is set those two `match`
clauses are wrapped in a **non-scoring** `filter` on `language_code = locale` (no
added boost; same tricky fuzzy, just same-locale). `fuzzyClauses(term, locale?)`.

> **TEMPORARY (`NEURAL_ENGLISH_ONLY`, 2026-07):** neural-sparse is now generated
> only for English docs, and the query encoder is English, so neural on a ro/hu/et
> query only bridges cross-lingually (distorted). While this flag is on, the neural
> clause is added **only for English (or unset) queries**; ro/hu/et resolve via
> exact/phrase/fuzzy same-locale. It's aggressive (also drops neural for English
> fragments inside a non-English title) — enabled to observe impact; flip to `false`
> to restore neural on every query.

Asymmetric acceptance **floors** (`FLOORS`): a **term-anchored** (exact) hit is
trusted at a low floor; a purely **neural** hit must clear a high floor.

| bucket | term floor | neural floor |
|---|---|---|
| occupation | 1 | 5.5 |
| capabilities | 1 | 4.8 |
| default | 1 | 5.5 |

### Location — per-locale gazetteer (`locale ≈ country code`)

`src/gazetteer/resolver.ts` → `resolve(clauses, structuredLocation?, locale?)`.

Locations do not mix across locales, so the resolver gates candidate places to the
query locale **at the source** (before disambiguation — not a lossy post-filter):

- `ro` / `hu` / `et` → only that country's places.
- `en` → naturally nothing (no country-specific places).
- **locale omitted** → ungated (the dense-extractor path is unchanged, backward
  compatible).

---

## Step 7 — `--verify` (optional dense stamp)

An **opt-in, non-destructive** cross-check: for each non-location result it computes
a dense cosine agreement between the input span and the resolved term. It **never
reorders or removes** — it only stamps `ResolvedTerm.agreement ∈ [0,1]`.

**Compared same-locale, not against the English display name.** The canonical
`display_name` is always English, so `embed(ro span) · embed(en display_name)` is a
**cross-lingual** comparison — and multilingual cosine runs systematically lower
(a correct ro↔en pair sits ~0.4–0.6, vs ~0.8–0.9 monolingual), which false-`⚠`s
correct ro/hu/et matches (e.g. `asistent vanzari → sales_support_assistant` scored
0.47). So instead the term's **same-locale surfaces** (its `value` + up to 2
aliases in the query locale, pulled from the same response into
`ResolvedTerm.verifyTargets`) are used, and `agreement` is the **max** cosine over
them — a fair monolingual check (that case now scores ~0.66). When the term has **no
same-locale row** (only en/global exists), it falls back to the English display name
and sets `agreementCrossLingual` (rendered `ˣˡ`) so the lower score isn't
over-trusted.

- Location is excluded (already grounded locally by the gazetteer).
- The profile stays **embedder-free** unless a `verify` function is injected via
  `TitleDeps.verify`, so the normal path never loads the model. The CLI builds one
  from the local multilingual `Embedder` only when `--verify` is passed.
- The injected `Verifier` takes `{span, texts[]}` and returns the max cosine.
- CLI render threshold: `✓` at agreement ≥ 0.5, `⚠` below (`ˣˡ` = cross-lingual).

Observed separation is wide — real matches 0.80–0.88, fuzzy artifacts 0.18–0.40:

```
Senior Python Developer → sensor engineer (50)  ⚠0.28   ← fuzzy artifact flagged
Java Software Engineer   → software architect    ✓0.88
Warehouse Forklift Op.   → forklift operator     ✓0.86
Remote Customer Support  → customer service rep   ✓0.80   (residual "customer support")
```

Currently a **stamp only**; an optional gate (drop/demote `⚠` rows) is a possible
follow-up.

---

## Per-locale coverage (hu / ro / en / et)

| concern | per-locale? | where |
|---|---|---|
| number variants (plural↔singular) | ✅ rule set per locale | `morphology.ts` |
| residual boundary-word trim | ✅ connector set per locale | `lookups.ts` `BOUNDARY_WORDS` |
| generic occupation head skip | ✅ head set per locale | `lookups.ts` `GENERIC_OCCUPATION_HEADS` |
| query language filter (`ro→[ro,en,global]`) | ✅ | `resolve.ts` `buildFilters` |
| location gazetteer | ✅ `locale ≈ country code` | `resolver.ts` |

> hu/et number + boundary sets are minimal stubs — the shape is correct, coverage
> is for refinement.

---

## CLI

```bash
npm run match -- --profile title "Senior Python Developer - Remote" --locale en
npm run match -- --profile title "Pavatori Piatra Neamt" --locale ro
npm run match -- --profile title "Senior Python Developer" --locale en --verify
```

Each result row shows the **span + bucket provenance** it came from
(`◂ [occupation] "python developer"`), so a bad result reads as *weak-match* (clean
span, wrong term) vs *weak-span* (noisy surface). Without `--profile`, the CLI's
default (`extract` / single-shot / `repl`) behaviour is unchanged.

---

## Tests (regression guards)

| file | covers |
|---|---|
| `test/title-profile.spec.ts` | end-to-end resolution, whole-clause fallback gating |
| `test/title-ranking.spec.ts` | residual > full-clause fuzzy; grounded > residual; generic-head skip; verify stamp + location exclusion; no-verify path |
| `test/residual.spec.ts` | `computeResidual` peel/trim/segment behaviour |
| `test/morphology.spec.ts` | per-locale number variants |
| `test/gazetteer.spec.ts` | resolution + **per-locale gating** |

The ranking tests drive the **real** `resolveTitle` with a surface-aware fake OS
client (resolves each query by the surface embedded in it), so they lock the
ranking contract, not a mock of the internals.

---

## Known limitations / open items

- Residual below the neural floor → no result to prioritise (`--verify` catches the
  fuzzy full-clause survivor but does not yet re-rank/gate).
- hu/et morphology + boundary sets are stubs.
- Dictionary-side alias gaps are the user's side (e.g. RO `Deservent
  Buldoexcavator`, `Strungar`; `head`→level).
