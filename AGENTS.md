# AGENTS.md

This repository is a job-document matcher. Treat every change as a precision/recall decision over messy job posts, not as generic text classification. The system exists to turn job titles, descriptions, structured fields, and salary text into safe canonical job-search signals.

The default engineering posture is: preserve existing matching patterns when they are adequate; when they are not, propose a better domain-shaped direction that covers the existing behavior and the new case without adding one-off hacks. Always choose the best algorithm for the domain problem at hand; precision and quality matter more than keeping every bucket on one generic matching path.

## How We Do It

The matcher is precision-first. A miss is usually better than a confident wrong canonical key, especially for identity-like buckets (`occupation`, `location`, `level`, `workplace`, `employment`). Wrong matches pollute search, ranking, analytics, and downstream automation.

The system combines several evidence types, each with a proper home:

```text
structured fields     -> deliberate caller-provided bucket values
exact aliases         -> normalized lexical surfaces and abbreviations
dense semantics       -> paraphrase for open vocabularies
rule inference        -> implied job attributes from constrained cues
gazetteer             -> place names and admin hierarchy
salary parser         -> numeric compensation facts, not canonical terms
graph derivation      -> facts implied by confident canonical matches
profile matching      -> input-shape-specific extraction, especially titles
OpenSearch strategies -> ingest/title matching against canonical runtime terms
```

Do not collapse these into one generic matcher. The architecture works because each signal has a trust model and failure mode.

Vectors are real but should not be treated as the universal center of the system. The root `TermExtractor` uses vectors for semantic matching, structured semantic fallback, and single-token lexical corroboration. The title profile and ingest adapter are more targeted OpenSearch/profile pipelines; they do not load the local vector store for ordinary matching, except for optional dense agreement verification in `scripts/match.ts --profile title --verify`.

## Domain Direction

Job posts are noisy documents. They contain titles, boilerplate, benefits, legal text, contact details, locations, shift patterns, money amounts, company descriptors, and skills. The extractor should identify the job-relevant signal while avoiding attractive false positives from ordinary words.

When solving a problem, first classify the signal:

| Signal | Correct layer | Reason |
|---|---|---|
| Known field value, e.g. `Full time` | structured resolution | Caller already knows the bucket; trust exact alias first |
| Multi-word skill/title alias | lexical index | Exact surface is stronger than semantic guess |
| Paraphrased occupation/capability | dense/vector or OpenSearch hybrid | Open vocabularies need semantic recall |
| Hours, shifts, years, license class, language requirement | inference | These are implied or brittle, so use gated rules |
| City/county/region | gazetteer | Place names need hierarchy/disambiguation, not embeddings |
| Salary amount/range | salary parser | Numeric pay is not taxonomy data |
| Collar kind from occupation | graph derivation | The text rarely states it; occupation implies it |
| Capability relevance to occupation | graph re-rank | Boost only found capabilities; never invent skills |

If a bug does not fit an existing layer cleanly, that is a design smell. Prefer adding a small domain abstraction or extending a strategy over inserting local special cases into orchestration code.

Prefer profile-like approaches when the input shape carries strong semantics. A job title is not a generic document paragraph: it is short, bucket-dense, modifier-heavy, and often contains occupation, level, workplace, schedule, employment, location, and capability clues in one compressed phrase. The existing title profile succeeds by being less generic: it scans all bucket aliases once, peels modifiers, resolves occupation residuals, routes each bucket through its best mechanism, and ranks by provenance. This is the model to follow for other structured subdocuments when generic extraction becomes hit-or-miss.

## Matching Philosophy

### Open Buckets

`occupation` and `capabilities` are open semantic buckets in the root extractor. They use hybrid matching: dense similarity plus lexical aliases. Dense search handles paraphrase; lexical search handles short exact surfaces such as abbreviations, technology names, and canonical aliases.

For these buckets:

- Preserve exact alias strength.
- Keep semantic thresholds conservative.
- Treat single generic words as dangerous unless corroborated.
- Prefer title evidence for occupation.
- Do not let description prose create weak occupation identities.

### Finite Buckets

Finite buckets such as `employment`, `schedule`, `level`, `workplace`, `company_size`, and parts of `qualifications` are not miniature semantic search problems. Their labels are short and ambiguous. A fuzzy or semantic near miss often maps to the wrong category.

For these buckets:

- Prefer exact aliases, structured fields, and inference.
- Use strict context gates for brittle concepts.
- Avoid edit-distance fuzzy matching.
- Abstain when the text does not clearly state or imply the value.

### Location

Location is a gazetteer problem. Do not use embeddings for place resolution. Proper nouns, small villages, counties, regions, common-word names, and same-name places require hierarchy-aware logic.

Good location behavior:

- structured location fields are highly trusted;
- free text needs exact/admin-aware matching;
- ambiguous same-name places should abstain without context;
- leaf places often need corroborating parent/admin evidence;
- matched places may expand to parent regions/counties.

### Salary

Salary is not a bucket. It is a structured numeric channel with validation. Amounts must look like compensation, not turnover, reimbursement, voucher value, employee count, store count, or years of experience.

When changing salary behavior, improve context validation before broadening numeric parsing.

### Profiles

Profiles are domain-specific matchers for known input shapes. They should exist when the document region has its own grammar, signal density, or ranking needs. The current title profile is the clearest example: it is intentionally not a generic full-document extractor.

Use or propose a profile when:

- the input shape has repeatable structure, such as titles or structured snippets;
- several buckets must be inferred from one compact phrase;
- generic clause extraction misses useful signals or produces unstable false positives;
- ranking depends on where a candidate came from, such as span vs residual vs whole clause;
- the best algorithm differs by bucket inside that input shape.

Do not force profile-worthy problems through the generic extractor just because the generic path exists.

## Coding Guide

1. Start with the bucket strategy in `src/buckets.ts`. The bucket strategy is the architectural decision point.
2. Put matching behavior in the right layer: `LexicalIndex`, `VectorStore`, `src/inference/*`, `packages/gazetteer`, `src/salary/*`, `src/matchers/*`, or derivation modules.
3. Keep `TermExtractor` as orchestration: prepare clauses, dispatch strategies, merge evidence, derive final signals. Do not grow it into a rule dump.
4. Preserve evidence provenance. Consumers need to know whether a term was `structured`, `lexical`, `semantic`, `both`, `gazetteer`, `inferred`, or `derived`.
5. Add tests around false positives, not only happy-path recall. The project quality bar is defined by what it refuses to match.
6. Use deterministic fakes in tests where possible: fake embedders, in-memory indexes, synthetic gazetteers, fake OpenSearch responses.
7. When adding locale logic, keep rules per-locale and context-gated. Avoid mixed-language regex blobs.
8. Do not hand-edit generated artifacts such as `data/dictionary.jsonl` during coding. Put durable changes in the generator inputs, runtime source files, or code-owned inference/normalization layers, then regenerate artifacts through the proper pipeline when regeneration is actually required.
9. If fixing one example would weaken a whole class of cases, stop and propose a better matching direction.
10. Prefer specialized algorithms over generic reuse when the domain demands it: gazetteer for places, inference for brittle finite facts, profile matching for titles, numeric validation for salary, vectors for open-vocabulary paraphrase.
11. Keep comments to a top-of-file module doc-comment. Do not scatter inline or per-function comments explaining what code does — well-named identifiers should carry that. If a WHY is genuinely non-obvious (a hidden constraint, a subtle invariant), fold it into the top-of-file comment rather than leaving it inline in the body.

## Surgical Editing Rules

Before editing, identify the failing evidence type:

```text
wrong exact alias?          -> dictionary/lexical surface problem
wrong semantic result?      -> threshold, title anchoring, hubness, or bucket strategy
wrong inferred value?       -> rule context/negation/gate problem
wrong location?             -> gazetteer surface, stop-name, hierarchy, or disambiguation
wrong salary?               -> money-context validation problem
wrong ingest result?        -> OpenSearch strategy, title profile, or merge-tier issue
wrong title result?         -> title profile scan, peeling, residual, provenance, or bucket lookup issue
```

Then make the smallest architectural edit that improves the class of errors. Do not patch a single observed string unless the domain concept is genuinely that specific, such as a known city exonym or a fixed legal/license phrase.

When existing patterns are insufficient, propose the next better pattern in the same domain language. Examples:

- If aliases are too broad, add corroboration or move the concept to inference.
- If dense search overfires, add title anchoring, a stricter threshold, or a better evidence gate.
- If a finite bucket needs recall, add deterministic rules rather than semantic fuzziness.
- If place matching needs recall, add gazetteer surfaces or hierarchy rules rather than vectors.
- If body text pollutes identity buckets, adjust trust-tier merge policy, not downstream consumers.
- If title matching is poor, improve the title profile instead of pushing title-specific logic into generic extraction.

## Core Pipelines

### Root Extractor

```text
input
  -> collect raw text for salary
  -> split title/description/sections into clauses
  -> drop noise and duplicate clauses
  -> embed only if targeted buckets need vectors
  -> process occupation first
  -> match each bucket by configured strategy
  -> boost found capabilities when a confident occupation requires them
  -> derive collar_kind from occupation
  -> return matchesByBucket + salary + diagnostics
```

Files: `src/extractor.ts`, `src/buckets.ts`, `src/types.ts`.

### Structured Resolution

Structured resolution is one bucket at a time. Exact alias wins without embedding. Semantic fallback is only for unresolved values and is batched in `resolveStructuredMany`. `location` bypasses this and uses the gazetteer.

Files: `src/extractor.ts`, `src/lexical-index.ts`.

### Ingest Adapter

The ingest adapter produces `CanonicalMatch` records for downstream job-ingest systems. It is OpenSearch-backed for non-location buckets and gazetteer-backed for location. Signal tiers matter:

```text
structured field > title/profile > gated unstructured body
```

Unstructured body evidence must not casually claim identity buckets.

Files: `src/ingest/index.ts`, `src/ingest/merge.ts`, `src/matchers/*`, `src/profiles/title.ts`.

### Title Profile

Title matching is bucket-dense and short-text-specific. The profile scans all aliases once, peels modifier buckets, resolves residual occupation candidates, batches OpenSearch requests, and ranks by grounded evidence and candidate provenance.

Do not replace this with generic full-document extraction. Titles have different failure modes from descriptions.

The title profile is an architectural pattern: profile the input shape, then choose the best bucket-level algorithm inside that profile. This should be preferred over miss-and-hit generic matching whenever a document region has a stable domain grammar.

Files: `src/profiles/title.ts`, `src/profiles/lookups.ts`.

## Domain Invariants

- Location stays gazetteer-owned.
- Salary stays outside canonical term buckets.
- Structured evidence outranks prose.
- Exact lexical evidence is not vetoed by neural or dense semantics.
- Dense vectors are used where they add open-vocabulary semantic value; they are not the default answer for every bucket or profile.
- Profile-based matching is preferred for known structured subdocuments when it yields higher-quality bucket extraction than generic extraction.
- Single-token aliases need special care; common words are not enough.
- Inference rules must be negation-aware and context-aware.
- Derived terms must be based on confident upstream terms.
- Capabilities can be boosted by occupation consistency only if they were found in text.
- Identity buckets should not be filled from weak body-text evidence.

## Common Quality Moves

Use these moves before inventing new machinery:

- Add a negative test for the false positive.
- Add a positive test for the intended recall.
- Check whether the bucket should be `hybrid`, `controlled`, `lexical`, `inferred`, or `gazetteer`.
- Tighten single-word corroboration for broad aliases.
- Add a context cue instead of matching a bare term.
- Add a negation guard if the phrase can be denied.
- Use structured field fusion for caller-known facts.
- Add gazetteer admin context for place ambiguity.
- Re-rank, do not invent, derived capability evidence.

## Important Files By Intent

| Intent | Files |
|---|---|
| Bucket strategy and thresholds | `src/buckets.ts` |
| Extraction orchestration | `src/extractor.ts` |
| Types and output contracts | `src/types.ts` |
| Lexical alias matching | `src/lexical-index.ts`, `src/normalize.ts`, `src/stopwords.ts` |
| Dense embedding/vector search | `src/embedder.ts`, `src/vector-store.ts` |
| Rule inference | `src/inference/*` |
| Location resolver | `packages/gazetteer/src/*` |
| Salary parser | `src/salary/*` |
| Graph derivation | `src/derive/*` |
| OpenSearch strategies | `src/matchers/*` |
| Ingest adapter and merge policy | `src/ingest/*` |
| Title-specific profile | `src/profiles/*` |

`packages/occupation` is a separate occupation-resolution workspace with its own `packages/occupation/AGENTS.md`. Read that before changing occupation-search-engine code.

## Tests That Matter

Use tests to preserve matcher judgment, not only code paths.

- Extractor fusion and structured fast path: `test/extractor.spec.ts`
- Location dispatch: `test/extractor-location.spec.ts`
- Inference rules and false positives: `test/inference.spec.ts`
- Salary validation: `test/salary.spec.ts`
- Ingest adapter and trust merge: `test/ingest-adapter.spec.ts`, `test/ingest-merge.spec.ts`
- OpenSearch strategy behavior: `test/matcher.spec.ts`
- Title profile behavior: `test/title-profile.spec.ts`
- Gazetteer precision/disambiguation: `packages/gazetteer/tests/*`

Run focused tests for the layer changed. Add regression cases for both the example that failed and the nearest dangerous false-positive class.
