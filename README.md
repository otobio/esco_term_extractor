# esco-term-extractor

An ESCO-style, embedding-based term extractor for job posts, written in TypeScript.

It is a self-contained TypeScript re-implementation of
[KonstantinosPetrakis/esco-skill-extractor](https://github.com/KonstantinosPetrakis/esco-skill-extractor),
generalized from ESCO skills/occupations to **every canonical bucket** carried by
the `canonical_runtime_terms` dictionary: `occupation`, `capabilities` (ESCO
skills + knowledge), `location`, `workplace`, `employment`, `schedule`, `level`,
`collar_kind`, `company_type`, `benefits`, `qualifications`, `compensation`.

## Packages

- **root (`src/`)** — production term-resolution modules used by `esco-term-extractor/ingest`:
  buckets, rule inference, the gazetteer-backed location resolver, matchers, profiles. No
  embedding-model dependency.
- **`packages/extractor-dev`** — the embedding-model `TermExtractor`/`Embedder` described below,
  plus its calibration/eval tooling. Dev-only: not on the production ingest path. Owns
  `@huggingface/transformers` as a real dependency so it never leaks into production installs.
- **`packages/gazetteer`**, **`packages/utils`** — standalone location gazetteer and shared
  cross-package utilities.

## How it works

Same core idea as the reference project, plus a high-precision lexical path:

1. **Embed the dictionary once.** Every canonical term is embedded with a
   sentence-transformer running locally via
   [Transformers.js](https://github.com/huggingface/transformers.js) / ONNX
   Runtime. The default model is the **multilingual**
   `paraphrase-multilingual-MiniLM-L12-v2` (384-dim) — the same dimension as the
   original English `all-MiniLM-L6-v2` but far stronger on ro/hu/et. Vectors are
   mean-pooled and L2-normalized and cached to disk grouped by `(bucket, language)`,
   together with a per-term **hubness bias** (see below).
2. **Split the input into clauses.** The document is split on line breaks and
   `. , ; and or` (extended with ro/hu/et conjunctions and bullet/slash
   separators), mirroring the reference tokenizer.
3. **Match.** Each clause is embedded; for every target bucket we take the single
   best-matching term (max cosine) and keep it when the score crosses that
   bucket's threshold. In parallel, exact normalized-alias hits (1..6-grams) are
   matched lexically — this recovers abbreviations/codes/multi-word names ("wfh",
   "SQL", "Cluj-Napoca") where a short embedding is unreliable.
4. **Merge.** Candidates are merged by `canonical_key`, keeping the strongest
   evidence and capping per bucket.

Because vectors are normalized, similarity is a plain dot product, then
hubness-centered (below). Per-bucket thresholds live in `src/buckets.ts`; on the
default multilingual model, centered correct matches score ~0.50–0.73 and the
noise floor is ~0.20–0.37.

### Hubness centering

High-dimensional embeddings have "hubs" — a few vectors (short/brand-like display
names such as `verger`, `stevedore`, `reiki`, `Vyper`) that sit near the global
centroid and score high against *everything*. At build time we record each term's
similarity to the centroid (`bias`) and at query time subtract
`HUBNESS_CENTERING × bias[i]` from its score (`src/vector-store.ts`). This demotes
hubs while leaving specific terms untouched, and is what makes the multilingual
model usable. Re-run `npm run calibrate` if you change the model or centering.

### Precision safeguards

The lexical path is high-recall but some dictionary aliases are ordinary words
("design", "software", "days", Romanian "marketing"/"mediu"/"față") that would
mis-fire. Two guards keep precision high without losing distinctive short tokens
(`SQL`, `AWS`, `Java`):

- **Multi-word alias hits are trusted unconditionally** ("meal vouchers", "work
  from home", "cluj napoca").
- **Single-word alias hits must be semantically corroborated** — the clause
  embedding has to be near the term's own embedding (`unigramCorroboration` per
  bucket in `src/buckets.ts`). This is language-agnostic and, for the gazetteer
  `location` bucket, tightened to near-exact so village names that collide with
  common words (Romanian *Fața* → village *Fata*) are rejected while real cities
  (which appear as their own short clause) pass.

A small function-word stopword list (`src/stopwords.ts`) drops the most common
unigrams before they even reach corroboration.

### Further precision refinements (validated on real listings)

- **Data-quality sanitizer** (`isUsableTerm`, applied at build): drops dictionary
  terms whose display name is empty or a URL/code (e.g. a leaked
  `http://data.europa.eu/.../nace2.1/...`) so they can never be surfaced.
- **Title anchoring**: `occupation` and `level` live in the title, so semantic
  matches from *description/section* clauses must clear a higher bar
  (`+0.07`). On an 80-listing sample this cut weak/wrong semantic occupations
  from 41 → 4 with negligible loss of correct ones. Tunable via
  `BucketConfig.titleAnchored`.
- **Load guards**: the index carries a schema version and its build model/dim;
  `extract`/`resolveStructured` throw a clear error if the loaded embedder's
  output dimension doesn't match the index (rather than silently scoring wrong).

### Model & remaining limitations

The default is now the multilingual `paraphrase-multilingual-MiniLM-L12-v2`,
validated on 80 random real listings: vs the old English `all-MiniLM-L6-v2` it
fixed the Romanian semantic failures (e.g. *Kinetoterapeut*→`kinesiologist`,
*Asistent farmacie*→`pharmacy assistant`) and — with hubness centering — removed
the systematic hub false positives. To rebuild with a different model, pass
`--model` to `build:index` and re-run `npm run calibrate` to reset thresholds
(the score scale shifts). For an index built before hubness support, backfill it
with `tsx scripts/add-hubness-bias.ts --data-dir <dir>` (no re-embedding needed).

Remaining weak spots (future work, mostly dictionary-side):
- **Short-title occupation recall.** Some obvious Romanian titles resolve to empty
  rather than wrong (e.g. *Casier*, *Montator* have no alias; *Sofer*/*Vânzător*
  have aliases but corroborate too weakly to pass safely). We deliberately favor
  precision — an empty occupation beats a confident wrong one — because several
  generic Romanian words are over-broad aliases (`munca`→labour policy officer,
  `asistent`→social worker). Cleaning those aliases is the highest-leverage fix.
- **Language-knowledge redundancy.** `capability:knowledge:romanian/english`
  can fire on prose written in that language; real requirements are also captured
  under `qualifications`.

## Salary ranges — a separate structured channel

Salary is **not** a term bucket (there's no taxonomy) — it's numeric parsing into a
typed object, returned on its own `ExtractionResult.salary` channel:

```ts
interface SalaryRange {
  minAmount?: number; maxAmount?: number;
  currency?: 'RON'|'EUR'|'USD'|'HUF';
  period?: 'hour'|'day'|'week'|'month'|'year';
  taxMode?: 'gross'|'net';
  periodInferred?: boolean;   // period came from magnitude, not stated
  evidence: string; confidence: number;
}
```

`src/salary/` parses amounts (locale separators `4.500`/`4,786`, `k`-notation,
dash & "between X and Y" ranges), currency, period and gross/net. **Validation is
the point** — an amount is only accepted when:
1. a **currency or pay cue** (`salariu`/`salary`/`pachet salarial`…) is adjacent;
2. it is **not** in a non-salary money context (`cifră de afaceri`/turnover,
   `investit`, `vouchere`/`decont`/benefits, employee/store/city counts);
3. its **magnitude is plausible** for its currency+period (per-currency bounds in
   `salary.ts`) — e.g. `10.000.000 lei` is rejected as turnover, not a wage.

Period is inferred (month/year) from magnitude only; hour/week/day must be stated
(`/oră`, `/week`) since a bare small number is usually per-event, not hourly pay.
Word lists are per-locale (ro/hu/et/en); currency & amount syntax are neutral.
Structured `input.salary` passes through untouched. On 400 acme listings: ~14%
carry a validated salary (weekly EUR for abroad postings, monthly RON gross/net,
ranges) with turnover/benefit/count amounts correctly rejected.

## Per-bucket matching strategies

Every bucket declares a `matchStrategy` in `src/buckets.ts`, matched to the shape
of its vocabulary:

| Strategy | Buckets | System |
|---|---|---|
| `hybrid` | occupation, capabilities | dense embeddings (hubness-centered) + lexical aliases |
| `hybrid` | company_type (industry), benefits, compensation | alias-led + semantic (richer controlled taxonomies) |
| `inferred` | company_size | startup/scaleup/enterprise from stage words + employee counts (below) |
| `hybrid` + inference | qualifications | semantic/lexical for degrees/certs; strict inference for license-class & language (see below) |
| `controlled` + derived | collar_kind | derived from occupation via the graph (below); text match as fallback |
| `controlled` | workplace | alias + strict semantic backstop + structured + negation |
| `lexical` | employment, schedule | alias + **inference** + structured + negation (no semantic) |
| `inferred` | level | **inference** + structured only (aliases too ambiguous) |
| `gazetteer` | location | dedicated gazetteer resolver (no embeddings) |

### Controlled-vocabulary buckets

Small closed enumerations (a handful to ~30 terms) with curated multilingual
aliases. Their system, in priority order:

1. **Structured-field fusion (primary).** `extract({ structured: { employment: 'Full time' } })`
   resolves the field via exact alias — near-instant, ~100% precise, `method: 'structured'`.
   These attributes are usually in structured fields, not prose.
2. **Curated alias lexical** from prose (exact n-gram, multilingual).
3. **Negation guard** (`src/negation.ts`): "no remote", "not full-time",
   "fără X", "nem X" suppress the match (applied to both lexical and semantic hits).
4. **Strict semantic backstop** (`+0.12` over the base bar) only for paraphrases
   the aliases miss.
5. Abstain over guessing.

### Inference layer (employment, schedule, level)

`employment`, `schedule` and `level` are usually **implied**, not stated — by
hours, shift idioms and years-of-experience — so they add a deterministic rule
engine (`src/inference/`) on top of aliases + structured.

**Structure:** rules live in **per-locale blocks** — every regex is single-language
(ro/hu/et/en), never a mixed alternation; numeric parsers build one regex per
`Locale` from `inference/locales.ts` (hour/week/day/years/experience/cue words).
Adding a locale is one block. All rules are negation-aware and emit
`method: 'inferred'` so output distinguishes stated vs inferred.

- **Employment** (`inference/employment.ts`): weekly/daily **hours** (`40h/week`,
  `8 ore/zi` → full_time; `part-time 4h` → part_time), norm idioms (`normă
  întreagă`), contract duration (`perioadă determinată` → temporary), freelance
  (`PFA`, `contract de colaborare`, `1099`), internship, seasonal, per-diem.
- **Schedule** (`inference/schedule.ts`): shift idioms + counts (`2 schimburi` →
  rotational, `tura de noapte` → night), clock **time-ranges** (`22:00–06:00` →
  night, `09:00–17:00`/`luni–vineri` → 9-to-5), flexible, on-call, weekend, 4x10.
- **Qualifications** (`inference/qualifications.ts`) — the bucket stays `hybrid`
  (semantic+lexical) for conceptual subtypes (degrees, certificates, registrations,
  authorizations), but its two **brittle subtypes are handled only by strict,
  context-gated inference** and suppressed from the fuzzy path:
  - *driving-license class* (the discriminator is a single letter, so embeddings
    can't tell B from C): requires a license word AND the class letter qualifying
    it — `permis categoria B` → `driving_license_b`; `category B products` / `plan
    B` → nothing.
  - *language requirement*: a bare language name isn't a requirement — needs a cue
    nearby (`limba`/`fluent`/`nivel`/`language`) — `fluency in English` → english;
    `English CV` / `a Romanian company` → nothing. (Kills the every-RO-post
    "Romanian" false positive.)
- **Company size** (`inference/company-size.ts`, strategy `inferred`) — its own
  bucket, split from `company_type` (which now carries only industry `category`).
  The `company_stage` terms (startup/scaleup/enterprise) are relabeled to the
  `company_size` bucket at build time, and resolved by inference: explicit stage
  words (startup, multinational, IMM/SME, …) and **employee counts** (`500
  employees`, `peste 200 de angajați`, `team of 20` → startup <50 / scaleup 50–249
  / enterprise ≥250). Guarded on both sides so a term describing a product,
  customer or culture is rejected — `enterprise software`, `enterprise accounts`,
  `startup mindset`, `servicii pentru IMM`, `over 5000 clients` → nothing.
- **Level** (`inference/level.ts`, strategy `inferred` — no lexical/semantic, since
  its aliases like `nivel mediu`/`management` are too ambiguous): title tokens
  (`Sr`/`Jr`/`Principal`/`Head of`/`C-level`/`team leader`), **years of
  experience** → band (only when tied to an *experience* word, so age "peste 35
  ani" or contract length don't count), and team-management idioms. A years→band
  guess is dropped when an explicit band (junior/mid/senior/entry) is stated.

On 200 acme listings: employment 14% → 30%, schedule 4% → 13%, level 29% → 52%,
all high precision (explicit hits outrank inferred).

## Cross-bucket signals from the knowledge graph

### collar_kind from occupation

`collar_kind` (white/blue/grey) is almost never written in a post, but it's a
property of the occupation. The taxonomy has a direct `occupation → collar_kind`
edge (`canonical_relationships`), snapshot to `data/occupation_collar.json`
(`npm run snapshot:collar`). After occupation is extracted, `src/derive/collar.ts`
looks up the strongest occupation's edge and emits the collar with
`method: 'derived'`. The score **propagates the occupation's certainty**
(`edge.confidence × occupation.score`) — ~0.90 when the occupation is a confident
lexical match, ~0.55 when it's a weak semantic guess. On 200 acme listings this
took collar_kind coverage from ~1% → 80% (tracking occupation), correct wherever
the occupation is correct. Requires `occupation` in `targetBuckets`.

### capabilities ↔ occupation consistency

The taxonomy links each occupation to its essential/optional capabilities &
knowledge (`occupation_to_essential_capability`, …, snapshot to
`data/occupation_capabilities.json` via `npm run snapshot:occ-caps`). When a
**confident** occupation is extracted (score ≥ 0.85 — a lexical/`both` match, not a
weak semantic guess), `src/derive/capability-consistency.ts` **boosts** the
extracted capabilities that occupation actually needs, *before* the per-bucket cap
— so relevant skills survive the cutoff and rank higher. It only re-ranks skills
found in the text (never invents them), and the confidence gate stops a wrong
occupation guess from dragging in wrong capabilities. Occupation is processed
first so capabilities can re-rank against it in one pass.

> Note: `runtime_alias_records` (per-alias type/confidence) is **not** retrievable
> from the current index, so alias-confidence weighting isn't available; lexical
> scoring stays per-bucket flat. Revisit if that metadata is re-added to the index.

## Location is a gazetteer, not embeddings

The `location` bucket does **not** use embeddings. Place names are proper nouns, so
cosine similarity against ~21k tiny localities is pure noise. Instead `location`
has `matchStrategy: 'gazetteer'` (see `src/buckets.ts`) and is served by a
dedicated resolver (`src/gazetteer/`):

- **Exact** name matching (diacritic-folded), longest-span-first, over the
  location terms + a hierarchy snapshot (`canonical_relationships`).
- **Admin-level gating** — the precision core. A single free-text token that is a
  common word (stop-name: `luna`=month, `centru`=center, `alba`=white, 2-letter
  county codes) is rejected; a single-token *village* needs its county/region to
  also appear; multi-word names, major cities, and the structured field pass.
- **Hierarchy expansion** — a matched city also yields its county + region.
- **Disambiguation** — shared names resolve by in-text county context, county-seat
  (name == county, e.g. Iași, Tartu — any language), and a `MAJOR_CITIES`
  name→county map; otherwise **abstain** (a miss beats a guessed village). The
  structure is language-agnostic (ro/hu/et all settle via these signals);
  `MAJOR_CITIES` is the one extensible, exact list — adding a city (name→county)
  can never reintroduce village/city confusion.
- **Fuzzy** matching is applied only to the structured location field (never free
  text — edit-distance-1 of common Romanian words hits villages catastrophically).

Measured on 200 random acme listings: ~exact precision with city→county→region
expansion (vs the embedding path's obscure-village noise). A location-only
extraction skips the embedding model entirely.

## Commands

Everything runs on `tsx` (no build step). Prereq tags: **[OS]** OpenSearch @ `:9201`
(occupation / capabilities / finite buckets — plain HTTP REST via `fetch`, no SDK);
**[DB]** MySQL (dev-only, gazetteer dataset build); **[model]** the local embedding
model (downloaded on first `build:index`). **Location** needs none of these — it reads
the packed gazetteer binary.

### Dev & quality

```bash
npm test               # vitest — all suites, incl. the gazetteer package tests
npm run typecheck      # tsc --noEmit (whole workspace)
npm run lint           # biome: lint + format check
npm run lint:fix       # biome: autofix + format
npm run format         # biome: format only
```

### Extract & query (runtime)

```bash
# Unstructured — free text → all buckets                                   [OS][model]
npm run extract -- "Senior Java developer, remote, Cluj-Napoca. Meal vouchers."
npm run extract -- --file some-post.txt

# Structured — one keyword → canonical term in one bucket                  [OS][model]
npm run structured -- employment "Full time"
npm run structured -- location "Cluj" --languages ro,en
npm run structured -- level "Senior" "Junior" "Mid"          # batch

# Interactive REPL (loads the model once)                                  [OS][model]
npm run repl          # paste text, "." on its own line to run; :buckets / :langs / :quit
```

### Title matcher & term-matcher CLI (`match`)

```bash
# Title profile — resolve a whole title into per-bucket spans              [OS]
npm run match -- --profile title --locale ro "LUCRATOR COMERCIAL SIZEER PART TIME -PIATRA NEAMT"
npm run match -- --profile title --locale ro --verify "…"    # + dense-agreement stamp [model]

# Resolve a single surface → canonical key in one bucket                   [OS]
npm run match -- occupation "pavator" ro
npm run match -- capabilities "project management" en

# Extract mode — all buckets over OpenSearch (apples-to-apples vs dense)   [OS]
npm run match -- extract "Senior Product Manager - Cluj"
npm run match -- repl                                        # interactive
```

### Location (gazetteer) — no OpenSearch, no model

```bash
npm run resolve:location -- "Cluj-Napoca" --locale ro
npm run resolve:location -- "Bucuresti Sector 2" --structured --locale ro   # structured + fuzzy
npm run resolve:location -- "delta" --locale ng --debug                     # gating flags
npm run resolve:location -- repl --locale ro                                # interactive
```

### Build the data

```bash
# Term dictionary + embedding index (from OpenSearch)                      [OS][model]
npm run snapshot -- --languages en,ro --buckets occupation,capabilities,location
npm run snapshot:relationships          # location hierarchy edges
npm run snapshot:collar                 # occupation → collar map
npm run snapshot:occ-caps               # occupation ↔ capability consistency map
npm run build:index                     # embedding + lexical index (downloads model first run)
npm run build:index -- --alias-embed --alias-cap 8          # higher recall (slower/larger)
npm run hubness:backfill                # backfill hubness bias into the index

# Gazetteer dataset + runtime binary — in packages/gazetteer                     [DB]
cd packages/gazetteer
bash scripts/download-geonames.sh       # fetch GeoNames build inputs (offline rebuild)
npm run build:dataset                   # GeoNames → enrich → MySQL + data/location/*.jsonl
npm run pack                            # → data/gazetteer.gzb (shipped runtime artifact)
npm run stats                           # inspect the stored dataset
```

### Eval & calibration

```bash
npm run eval:gold                       # precision/recall vs data/gold.json          [model]
npm run eval:listings -- --n 60 --seed 7 --languages en,ro                          # [OS][model]
tsx scripts/eval-location.ts --locale ro    # location accuracy vs gold (model-free)
npm run calibrate                       # sweep matcher thresholds                    [OS][model]
npm run ingest:smoke                    # ingest-adapter smoke test                   [OS]
```

## Workflow

```bash
cd libs/term-extractor
npm install                        # installs @huggingface/transformers, tsx

# 1. Snapshot the dictionary + location hierarchy from OpenSearch (cluster @ :9201)
npm run snapshot                   # -> data/dictionary.jsonl  (~90k terms)
npm run snapshot:relationships     # -> data/relationships.jsonl (location hierarchy)
#    scope it while iterating:
#    npm run snapshot -- --languages en,global --buckets occupation,capabilities,location

# 2. Build the embedding index + lexical index (downloads the model on first run)
npm run build:index                # -> data/vectors.bin, data/index.meta.json, data/lexical.json
#    (location vectors are excluded by default — the gazetteer serves that bucket)
npm run build:gazetteer            # -> data/gazetteer.json (location resolver index)
#    higher recall (slower/larger):
#    npm run build:index -- --alias-embed --alias-cap 8

# 3a. Extract (unstructured) — free text -> all buckets
npm run extract -- --file some-post.txt
npm run extract -- "Senior Java developer, remote, Cluj-Napoca. Meal vouchers, private medical."

# 3b. Structured — a keyword -> canonical term in one bucket
npm run structured -- employment "Full time"
npm run structured -- location "Cluj" --languages ro,en
npm run structured -- level "Senior" "Junior" "Mid"        # batch

# 3c. Interactive REPL (loads the model once; test many descriptions)
npm run repl
#   paste a description, type "." on its own line to run
#   commands: :buckets a,b | :langs ro,en | :quit
```

## Two extraction modes

Load the extractor once, then use whichever mode fits the input.

```ts
import { TermExtractor } from 'esco-term-extractor';

const extractor = await TermExtractor.load({
  dataDir: 'libs/term-extractor/data',
  defaultLanguages: ['ro', 'en'], // optional default scope; per-call `languages` overrides
});
```

### 1. Unstructured — free text → all buckets

For a job post's title + description. Returns matches grouped by bucket.

```ts
const result = await extractor.extractFromJobPost(
  'Senior Java Developer',
  'Remote role in Cluj-Napoca. Spring Boot, SQL. Meal vouchers, private medical.',
  { languages: ['ro', 'en'] }, // optional
);
console.log(result.matchesByBucket);

// equivalent, with more control:
await extractor.extract(
  { title, description, sections: [{ name: 'benefits', text }] },
  { targetBuckets: ['occupation', 'capabilities', 'location'], languages: ['hu', 'en'] },
);
```

### 2. Structured — one keyword → canonical term in one bucket

For structured fields where the caller already knows the bucket (e.g. an
`employment_type` column). **Lexical-exact-first**, so an exact alias resolves
with no embedding call at all; only unrecognized values fall back to semantics.

```ts
await extractor.resolveStructured('employment', 'Full time');
// → { matched: true, method: 'lexical', terms: [{ canonicalKey: 'employment:full_time', ... }] }

await extractor.resolveStructured('location', 'Cluj', { languages: ['ro', 'en'] });
// → location:county:cluj  (lexical)

await extractor.resolveStructured('occupation', 'person who writes software');
// → software developer / software architect  (semantic fallback)

// Batch — exact hits resolve instantly, remaining values are embedded in ONE batch:
await extractor.resolveStructuredMany('level', ['Senior', 'Junior', 'Mid']);
```

`StructuredResolveOptions`: `languages`, `topK` (default 3), `minScore`
(defaults to the bucket threshold), `semanticFallback` (default `true`).

### Language safety (ro / hu / et / en)

Pass `languages` (per call or as `defaultLanguages`) to scope both the semantic
and lexical paths — faster and it avoids cross-language collisions. In practice
you pass a local language plus English: `['ro','en']`, `['hu','en']`,
`['et','en']`. `global` (language-neutral terms like `employment:full_time`) is
**always** included automatically, so scoping never silently drops them. Omitting
`languages` considers every indexed language (the default, unchanged behavior).

Each match is an `ExtractedTerm`:

```ts
{
  bucket: 'workplace',
  canonicalKey: 'workplace:remote',
  displayName: 'Remote',
  termType: 'workplace_type',
  languageCode: 'en',
  score: 0.94,
  method: 'both',            // 'semantic' | 'lexical' | 'both'
  evidence: [{ clause: 'Remote role in Cluj-Napoca', method: 'lexical', score: 0.94 }],
}
```

## Notes

- The generated `data/` artifacts (`dictionary.jsonl`, `vectors.bin`,
  `index.meta.json`, `lexical.json`) are **not** committed — regenerate them with
  the two build steps above. Full 90k index ≈ 140 MB.
- First `build:index` / `extract` run downloads the model weights (~90 MB) to the
  Transformers.js cache; subsequent runs are fully offline.
- Tuning lives in `src/buckets.ts` (per-bucket thresholds & caps) and can be
  overridden per call via `ExtractOptions.bucketOverrides`.
- **Testability / embedding:** the extractor depends on the `TextEmbedder`
  interface, so `TermExtractor.fromComponents({ store, lexical, embedder })` lets
  you inject a store/lexical index (`VectorStore.fromEntries`,
  `LexicalIndex.fromTerms`) and a stub embedder. The lock-down suites
  (`test/*.spec.ts`) pin extraction, structured resolution, corroboration and the
  global-language union deterministically — no model download in CI. Run
  `npm test` / `npm run typecheck`.
```
