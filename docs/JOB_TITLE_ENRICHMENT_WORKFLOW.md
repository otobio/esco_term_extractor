# Job Title Enrichment Workflow

Purpose: run the locale-specific job-title enrichment loop in resumable chunks, review only the hard cases with the direct LLM operator, promote only structural reusable improvements, and rerun the same chunk after accepted fixes before moving to the next chunk.

## Verified Resume State
- `ro`
  - Reviewed rows on disk: `1200`
  - Reviewed batch files on disk: `48`
  - Verified source: `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl` and `data/taxonomy-review/job-title-triage-reviewed.ro.batches/`
  - Next replay offset when RO resumes: `1200`
  - Important: the current `data/taxonomy-review/job-title-triage-pilot.ro.jsonl` and `job-title-triage-batches.ro*` files are smoke-sized, not the 1200-row working surface. Rebuild the RO working chunk before resuming review.
- `hu`
  - Prepared pilot rows on disk: `250`
  - Reviewed rows on disk: `50`
  - Reviewed batch files on disk: `2`
  - Verified source: `data/taxonomy-review/job-title-triage-pilot.hu.jsonl`, `data/taxonomy-review/job-title-triage-batches.hu.manifest.json`, `data/taxonomy-review/job-title-triage-reviewed.hu.jsonl`, and `data/taxonomy-review/job-title-triage-reviewed.hu.batches/`
  - Next direct-review batch: `3`
  - Next replay offset after this HU chunk is fully cycled: `250`

## Goal
- Process `1000` titles per locale at a time.
- Finish one full chunk cycle before moving to the next chunk.
- Use the direct session LLM operator for row review when needed; do not switch back to a manual-first loop.
- Let each completed chunk produce structural runtime improvements so the next replay/review cycle needs fewer LLM interventions.

## Current Automated Contracts
- Raw-title-first chunk extraction, aggregation, and cheap coverage annotation into CSV review artifacts
- Resumable chunked replay of the live title corpus into `job-title-triage-pilot.<locale>.jsonl`
- Compact TSV review surface generation from the pilot JSONL
- Stable 25-row review batch splitting
- Direct LLM batch runner with schema validation, retry-on-contract-failure, per-batch files, merged JSONL output, and default resume behavior
- Proposal aggregation into repeated structural candidates
- Automatic shaping of repeated `common_role_phrase`, `family_alias_anchor`, and `noise_rule` proposals into seed-candidate JSON

## Structural Runtime Improvements Already In The Loop
- Automatic noise selection and locale-specific noise review surfaces
- Common role phrase anchoring
- Family alias anchoring
- Reviewed family support and family suppression
- Role-head equivalence updates
- Query-prep seed candidate shaping from reviewed aggregates

These are exactly the kinds of improvements that should reduce future LLM load. The chunk workflow should keep feeding these contracts rather than introducing title-specific runtime branches.

## Raw Title Discovery Layer
Use this before any triage/replay step when you want cheap structural discovery directly from raw titles.

Command:

```bash
npm run enrich:via-job-title:raw-discovery -- --locale=hu --input=/path/to/job_titles.csv --title-column=job_title --out-dir=data/taxonomy-review
```

Outputs:
- `data/taxonomy-review/title-chunk-facts.<locale>.csv`
- `data/taxonomy-review/chunk-candidate-stats.<locale>.csv`
- `data/taxonomy-review/chunk-candidate-annotations.<locale>.csv`
- `data/taxonomy-review/chunk-candidate-monitor.<locale>.csv`

Validation:

```bash
npm run test:enrichments
```

Scope:
- Starts from raw titles, not `effective_query`
- Extracts lightweight token spans only
- Aggregates by exact normalized surface
- Adds only cheap exact coverage checks against reviewed/common-role, family-alias, and reviewed-noise dictionaries
- Does not run retrieval, ranking, family selection, leaf selection, or auto-promotion
- `chunk-candidate-monitor.<locale>.csv` contains only rows whose final `review_bucket` is `monitor`; this is the long-tail unknown surface file that can later be used for LLM-assisted interpretation if desired

### How To Read The Statistics
- `occurrence_count`: total extracted chunk occurrences across the input titles
- `unique_title_count`: number of distinct raw titles containing that chunk
- `title_df`: `unique_title_count / total_unique_titles`

Example:
- if `takarító` appears in `2` distinct titles out of `20`, then:
  - `unique_title_count=2`
  - `title_df=0.1`

How to verify manually:
1. Open `chunk-candidate-stats.<locale>.csv` and pick a `chunk_normalized_surface`.
2. In `title-chunk-facts.<locale>.csv`, count distinct `original_title` rows with that same `chunk_normalized_surface`.
3. Divide that distinct-title count by the total number of distinct input titles.
4. Confirm it matches `title_df`.

Interpretation:
- high `occurrence_count` plus low `unique_title_count`: repeated wording, but possibly duplicated title strings
- high `unique_title_count`: broader market reuse, stronger discovery signal
- high `title_df`: common surface in this corpus slice
- low `title_df` but clean multi-token phrase: still potentially useful, just lower priority

## Full Chunk Cycle
Use this as the standard operating loop for each locale chunk.

### 1. Prepare the chunk replay surface
Replay the next title window, then build the compact review artifacts.

Example for a fresh 1000-row HU chunk:

```bash
npm run enrich:via-job-title:prepare -- --locale=hu --sample=all --input=/Users/otobio/Downloads/profession_job_titles_01.csv --title-column=job_title --offset=250 --limit=1000 --chunk-size=1000
```

Example for resuming the already prepared HU `0..249` chunk:
- Do not rebuild yet.
- Resume direct review from batch `3`.

### 2. Review only the prepared batches that are still missing
The direct runner resumes by default and skips existing per-batch outputs.

HU current resume command:

```bash
npm run enrich:via-job-title:review:direct -- --locale=hu --start-batch=3 --end-batch=10
```

Notes:
- `--resume` is the default behavior.
- Existing files under `data/taxonomy-review/job-title-triage-reviewed.<locale>.batches/` are skipped automatically.
- The merged `job-title-triage-reviewed.<locale>.jsonl` file is rebuilt from the batch directory at the end of the run.

### 3. Aggregate reviewed proposals
After the row review block finishes, aggregate repeated proposals.

```bash
npm run enrich:via-job-title:aggregate -- --input=data/taxonomy-review/job-title-triage-reviewed.hu.jsonl --out-json=data/taxonomy-review/job-title-triage-proposals.hu.json --out-csv=data/taxonomy-review/job-title-triage-proposals.hu.csv
```

### 4. Shape query-prep seed candidates
This is the automatic bridge from reviewed rows to reusable query-prep candidate artifacts.

```bash
npm run enrich:via-job-title:seed:proposals -- --input=data/taxonomy-review/job-title-triage-proposals.hu.json --out=data/taxonomy-review/job-title-query-prep-seed-proposals.hu.json
```

### 5. Promote only accepted structural proposals
Promote only reusable, role-grounded proposals into reviewed seed artifacts.

Important distinction:
- Aggregation is automatic.
- Query-prep seed shaping is automatic.
- Promotion into tracked runtime seed files is not automatic and must stay deliberate.
- A shaped candidate file is only a review surface, not an approval signal.

Allowed runtime-facing proposal classes:
- `reviewed_family_signal`
- `reviewed_family_penalty`
- `noise_rule`
- `role_head_equivalence`
- `common_role_phrase`
- `family_alias_anchor`

Do not promote:
- leaf forcing
- free-form alias dumps
- title-specific patches
- domain-only family selectors

## Promotion Rules
These rules define what may be promoted into each artifact contract.

### common_role_phrase
Promote only when all of these are true:
- The surface is an actual occupation phrase, not just a title fragment or employer phrasing.
- The phrase has a stable occupation meaning that should canonicalize before fallback head selection.
- The phrase is reusable market language, not a one-off title wording.
- The canonical English target is the role phrase itself, not a guessed preferred ESCO leaf.
- The phrase is strong enough that direct canonicalization is appropriate.

Do not promote as `common_role_phrase` when any of these are true:
- The wording is only a family hint and still too broad to canonicalize directly.
- The wording is primarily domain, venue, seniority, employment-format, or recruiter noise.
- The wording is a specialization wrapper around a role unless the whole phrase is itself a stable market role.
- The evidence is just one reviewed row and we have not judged it to be a truly standard market role.
- Promoting it would effectively turn many arbitrary job titles into canonical role phrases.

Examples of acceptable `common_role_phrase` shapes:
- localized role names with stable occupational meaning such as `könyvelő`
- repeated market phrases such as `műszakvezető`
- clear mixed-language market roles such as `SOC Analyst`

Examples of non-acceptable `common_role_phrase` shapes:
- employer- or company-specific wording
- broad family wording like "sales personnel" when the wording still needs family-level treatment
- long descriptive title strings that contain a role but are not themselves a stable reusable role phrase

### family_alias_anchor
Promote only when all of these are true:
- The wording safely points to a family-side role concept.
- The wording is weaker or broader than a direct role canonicalization.
- The wording should help family recovery but should not become direct role-phrase authority.
- The canonical English target is the family-side concept being anchored.

Do not promote as `family_alias_anchor` when any of these are true:
- The wording is precise enough to be a `common_role_phrase` instead.
- The wording is too vague, domain-only, or ambiguous across unrelated families.
- The wording would effectively create a backdoor exact alias for many leaves.

### noise_rule
Promote only when all of these are true:
- The wording is removable noise, not occupational signal.
- The noise kind is explicit and correct: salary, shift, location, employer_brand, application_cta, identifier, language, date, ui_artifact, or equivalent reviewed bucket.
- Removal generalizes safely across many titles in the locale.
- Removing it would not delete the occupation head or role-defining modifier.

Do not promote as `noise_rule` when any of these are true:
- The token can be occupational in many real titles.
- The token is only noisy in one employer or one scrape source.
- The wording is actually role, domain, or venue evidence.

### reviewed_family_signal / reviewed_family_penalty
Promote only when all of these are true:
- The rule is role-head gated.
- The rule is family-scoped.
- The added query terms are role-grounded markers, not domain-only selectors.
- The rule captures a repeated drift or repeated missing-support pattern.
- The rule remains explainable as support or suppression, not hidden score tuning.

Do not promote when any of these are true:
- The rule exists only to save one title.
- The query terms are broad management, business, or domain words with no role grounding.
- The rule would compete with exact or folded alias authority.

### role_head_equivalence
Promote only when all of these are true:
- The term is a real recurring head-equivalent in the locale or market.
- The equivalence holds across many titles, not one local phrasing.
- The equivalence changes head understanding, not just ranking preference.

Do not promote when any of these are true:
- The mapping is only a contextual specialization.
- The mapping would erase a meaningful distinction between different occupations.

## Current Safety Gap
The shaping script currently creates candidate entries for any complete reviewed proposal, even when support is only one reviewed row.

That means:
- `occurrences >= 1` is enough to appear in `job-title-query-prep-seed-proposals.<locale>.json`
- but it is not enough by itself to justify promotion into runtime seed files

Manual promotion must still ask:
- Is this a true reusable market role or just a reviewed title?
- Is this the right artifact contract?
- Would this broaden runtime authority too far?
- Would I still want this entry if I saw it without the original title?

## What Actually Determines Promotion Today
This section is the concrete answer to "who decides" and "what stats determine it".

### 1. What is gathered from reviewed rows
Each reviewed row can emit typed `artifact_proposals`.

For each identical proposal fingerprint, aggregation records:
- `occurrences`
- `row_indexes`
- `confidence_labels`
- `rationales`

The proposal fingerprint is built from the structural fields, not from title text alone.

For `common_role_phrase` and `family_alias_anchor`, the effective grouped identity is:
- `type`
- `locale`
- `surface`
- `canonical_english`
- `role_key`
- optional priority if supplied

For `noise_rule`, the grouped identity is:
- `type`
- `locale`
- `noise_rule_kind`
- `noise_match_type`
- term fields such as `surface`, `query_terms_any`, `query_terms_all`

For family support/suppression, the grouped identity is:
- `type`
- `locale`
- `target_family_node_id`
- `target_family_label`
- `role_heads_any`
- `query_terms_any`
- `query_terms_all`

### 2. What statistics exist today
The current pipeline computes only simple structural support statistics.

Available support signals today:
- `occurrences`: how many reviewed rows proposed the exact same structural artifact
- `row_indexes`: which reviewed rows produced it
- `confidence_labels`: low / medium / high assigned during row review
- `rationales`: preserved examples of why it was proposed

What does not exist today:
- no automatic minimum frequency threshold such as `>= 20 in 1000`
- no automatic percentage-of-chunk threshold
- no cross-chunk recurrence requirement
- no statistical test that says "this is now officially common"
- no automatic promotion gate based on support counts

So if you ask "what stat determines common role phrase promotion today?", the exact answer is:
- there is no automatic statistical promotion rule today
- only support evidence is recorded
- the final decision is still operator/manual acceptance

### 3. What the shaping script does automatically
`scripts/build-query-prep-seed-proposals.js` does not decide whether something is truly common.

It only does these mechanical steps:
- filters proposals by type
- checks field completeness
- derives missing `roleKey` from `canonical_english` when possible
- computes a default priority when none is supplied
- carries forward support evidence
- sorts candidates by support

For phrase-like candidates, current default priority is:
- `priority = max(90, min(99, 90 + occurrences))`

That means:
- `1` occurrence becomes priority `91`
- `2` occurrences becomes `92`
- `9+` occurrences caps at `99`

Important:
- this priority is not a proof that the phrase is common
- it is only a fallback shaping value used in the candidate file

### 4. Who actually decides today
Current decision chain:
1. LLM row review proposes a typed artifact candidate per row.
2. Aggregation groups exact structural repeats and records support.
3. Seed shaping converts complete grouped proposals into typed candidate objects.
4. Operator decides whether to promote into tracked seed files.

So today the answer to "who determines it" is:
- the LLM suggests
- aggregation measures repeated support
- seed shaping formats the candidate
- operator acceptance determines runtime promotion

### 5. What a non-generic auditor should check for `common_role_phrase`
For `common_role_phrase`, the most important concrete signals are:
- occurrence count inside the reviewed chunk
- recurrence across later chunks or earlier reviewed files
- whether the exact same `surface -> canonicalEnglish` pair repeats
- whether the phrase is short and occupation-like rather than a full descriptive title
- whether it survives case normalization and still represents the same market role
- whether it already behaves like a role phrase in query intent or alias evidence

Practical interpretation:
- `1` occurrence can be enough to appear as a candidate
- `1` occurrence should usually not be enough by itself to justify promotion unless the phrase is obviously a standard market role
- repeated support such as `5`, `10`, or `20+` occurrences across a chunk is much stronger evidence that the phrase is truly common
- a phrase appearing `20` times in `1000` rows is exactly the kind of statistic that should heavily support promotion, but that threshold is not implemented automatically today

### 6. What should probably be implemented later if we want statistical auto-promotion
If we want this to stop being generic and become auditable by rule, the next contract should be explicit thresholds such as:
- minimum reviewed occurrence count per locale
- optional minimum distinct-chunk count
- optional minimum reviewed-confidence mix
- optional denylist for broad/non-occupational wrappers
- separate thresholds per artifact class:
  - stricter for `common_role_phrase`
  - looser for `family_alias_anchor`
  - strict safety checks for `noise_rule`

Example future shape:
- `common_role_phrase`: auto-promote candidate only if `occurrences >= 5` in reviewed data and no broad-wrapper flag
- `family_alias_anchor`: allow lower threshold such as `occurrences >= 3`
- `noise_rule`: require `occurrences >= 5` plus explicit `noise_rule_kind`

This does not exist yet. Right now those thresholds are human judgment, not code.

## Auto-Statistics Promotion Plan
This is the intended replacement for the current LLM-first candidate discovery on common cases.

### Goal
Move the enrichment workflow to:
1. statistical mining first
2. deterministic candidate generation second
3. operator review on thresholded candidates third
4. LLM review only for residual ambiguous cases

This makes the workflow auditable because every promoted artifact can say whether it came from:
- automatic statistical promotion
- threshold-qualified candidate requiring operator approval
- LLM-suggested structural candidate

### Core Principle
Common-case runtime vocabulary should come from repeated evidence in large corpora, not from one reviewed title.

So for the major query-prep contracts:
- `common_role_phrase` should be primarily statistics-backed
- `family_alias_anchor` should be primarily statistics-backed
- `noise_rule` should be primarily statistics-backed
- `reviewed_family_signal` / `reviewed_family_penalty` can combine statistics with residual review because they are more semantic and family-scoped

### Existing Data We Can Reuse
We already have most of the needed raw surfaces.

Large-corpus inputs:
- source title corpora such as `/Users/otobio/Downloads/ejobs_job_titles.csv`, `/Users/otobio/Downloads/profession_job_titles_01.csv`, `/Users/otobio/Downloads/profession_job_titles_02.csv`

Runtime/statistical surfaces already available:
- signal vocabulary and longest-known-phrase matches
- generated role phrase matches from query preparation / query intent
- alias-ngram review mirrors
- family-token relevance review mirrors
- runtime-review search-meta mirrors
- existing noise pattern extracts
- chunked pilot JSONL and compact TSV review surfaces

This means we do not need to ask the LLM to discover most common phrases from scratch.

### New Proposed Pipeline Phase
Add a new deterministic step before LLM review:

`statistical-candidate-mining`

Outputs:
- `common_role_phrase` candidates with support stats
- `family_alias_anchor` candidates with support stats
- `noise_rule` candidates with support stats
- single-token candidate reports for:
  - possible family-prior support
  - possible role-head equivalence
  - possible noise tokens

Not all outputs should share the same promotion path.

### Candidate Classes By Statistical Eligibility
#### A. Multi-token role phrases
Main target: `common_role_phrase`

Primary source signals:
- repeated longest contiguous token matches from cleaned titles
- repeated generated role phrase spans from query intent / query prep
- repeated reviewed query spans that remain stable after noise peeling
- repeated alias-ngram family-support evidence for the same phrase

Hard constraints:
- minimum token count `>= 2`
- exclude pure single-token phrases from `common_role_phrase`
- exclude phrases dominated by noise tokens, cities, dates, seniority wrappers, or recruiter text
- exclude phrases with high canonical ambiguity across unrelated families

#### B. Weaker multi-token or colloquial surfaces
Main target: `family_alias_anchor`

Primary source signals:
- repeated phrases that are clearly occupational but not strong enough for direct canonicalization
- repeated phrases whose top evidence is family-consistent but leaf-inconsistent

#### C. Single-token surfaces
Single tokens should generally not become `common_role_phrase` automatically.

Instead they should be routed to one of:
- family-prior support candidate surface
- role-head equivalence candidate surface
- noise candidate surface
- manual holdout if too ambiguous

Exception policy:
- a single token may still become `common_role_phrase` only with much stricter thresholds and very low ambiguity, but this should be exceptional and explicitly marked in audit output

### Required Statistics Per Candidate
Every mined candidate should carry an auditable evidence record.

Minimum fields:
- `candidate_type`
- `locale`
- `surface`
- `normalized_surface`
- `token_count`
- `source_kind`
  - examples: `generated_role_phrase`, `longest_phrase_match`, `noise_extract`, `family_consistent_phrase`, `llm_reviewed`
- `title_occurrences`
- `distinct_title_count`
- `distinct_chunk_count`
- `source_corpus_size`
- `coverage_per_1000`
- `top_canonical_target`
- `top_target_support`
- `target_entropy` or an equivalent ambiguity score
- `top_family_id`
- `top_family_support`
- `family_entropy` or equivalent family ambiguity score
- `noise_overlap_score`
- `single_token_flag`
- `auto_decision`
  - `promote`
  - `review`
  - `reject`
- `auto_decision_reason`
- `promotion_basis`
  - `statistics_only`
  - `statistics_plus_operator`
  - `llm_plus_operator`

This is the audit contract external reviewers need.

### Statistical Decision Markers
Each candidate should receive explicit markers, for example:
- `frequency_strong`
- `frequency_medium`
- `cross_chunk_repeated`
- `low_family_entropy`
- `low_target_entropy`
- `single_token_blocked`
- `noise_overlap_blocked`
- `broad_wrapper_blocked`
- `llm_only_candidate`

These markers matter more than prose. They explain exactly why a candidate was promoted or held.

### Proposed Threshold Model
Numbers should be configurable by artifact class and locale, but the structure should be fixed.

Suggested starting model:

For `common_role_phrase` auto-promotion candidates:
- token count `>= 2`
- title occurrences `>= 5` within the mined corpus
- distinct chunk count `>= 2` when chunked data exists
- low ambiguity: dominant canonical target and dominant family
- low noise overlap
- not blocked by broad-wrapper rules

For `common_role_phrase` strong auto-promotion:
- title occurrences `>= 20` per `1000` titles reviewed or equivalent corpus-scaled threshold
- or a very strong absolute threshold across the full locale corpus

For `family_alias_anchor` candidates:
- lower threshold than `common_role_phrase`
- examples: title occurrences `>= 3`
- family consistency must be high
- direct leaf consistency need not be high

For `noise_rule` candidates:
- title occurrences `>= 5`
- explicit noise kind
- high removable-context consistency
- must not correlate strongly with occupation-head use

For single-token candidates:
- never auto-promote to `common_role_phrase` under the normal threshold path
- require a stricter override path with explicit justification

These exact thresholds should be configurable constants and emitted into the audit output.

### Ambiguity Computation
We need an explicit ambiguity measure so a frequent phrase is not promoted if it means too many things.

Minimum ambiguity checks:
- canonical target concentration:
  - what fraction of occurrences align to the top canonical target?
- family concentration:
  - what fraction align to the top family?
- head stability:
  - does the phrase keep the same role head in query intent?

Interpretation:
- high frequency plus low ambiguity supports `common_role_phrase`
- high frequency plus moderate ambiguity supports `family_alias_anchor`
- high frequency plus high ambiguity blocks promotion

### De-Promotion / Reversal Path
Promotion must be reversible.

Add a reviewed override state for mined candidates:
- `accepted`
- `rejected`
- `demoted`
- `superseded`

Every promoted seed should keep provenance fields in a sidecar review file:
- `promotion_basis`
- `support_stats_snapshot`
- `accepted_by`
- `accepted_at`
- `source_candidate_id`

If later corpus runs show drift, we should be able to:
- mark the candidate `demoted`
- rebuild runtime artifacts
- retain the audit trail explaining why it was previously accepted and later removed

### Revised Workflow Steps
The revised enrichment workflow should become:

1. Replay chunk or full locale corpus.
2. Run deterministic statistical candidate mining on the larger locale corpus.
3. Emit audited candidate reports with explicit thresholds and decision markers.
4. Auto-promote only the artifact classes and thresholds that are approved for automatic promotion.
5. Send only residual uncertain candidates to operator review or LLM review.
6. Aggregate operator/LLM decisions separately from automatic promotions.
7. Promote approved residual candidates with provenance marking.
8. Export runtime artifacts.
9. Validate.
10. Replay the same chunk again.

This makes LLM usage narrower and more justified.

### Concrete Implementation Plan
#### Phase 1: candidate mining report
Add a new script, for example:
- `scripts/build-statistical-enrichment-candidates.js`

It should:
- read the larger locale corpus
- reuse cleaned/effective query signals
- extract repeated multi-token phrase candidates
- compute family and target concentration stats
- emit a review JSON and CSV with decision markers

#### Phase 2: explicit thresholds config
Add a config file, for example:
- `src/runtime/seeds/enrichment-promotion-thresholds.json`

It should hold:
- per artifact thresholds
- per locale overrides if needed
- blocked token classes
- single-token handling policy

#### Phase 3: auto-promotion output
Add a second script, for example:
- `scripts/apply-statistical-enrichment-promotions.js`

It should:
- read the candidate report
- promote only threshold-qualified candidates for approved artifact classes
- write provenance-rich outputs
- leave uncertain candidates untouched for operator review

#### Phase 4: residual review surface
Then reduce the LLM/operator workflow to:
- borderline candidates
- family support/suppression cases needing semantic judgment
- unresolved edge cases not covered by deterministic stats

## Implemented Statistical Commands
The first three phases are now implemented.

Phase 1: statistical candidate mining

```bash
npm run enrich:via-job-title:stats:candidates -- --locale=hu --pilot=data/taxonomy-review/job-title-triage-pilot.hu.jsonl --manifest=data/taxonomy-review/job-title-triage-pilot.hu.manifest.json --noise-csv=data/taxonomy-review/job-title-noise-patterns.hu.csv --out-json=data/taxonomy-review/job-title-statistical-candidates.hu.json --out-csv=data/taxonomy-review/job-title-statistical-candidates.hu.csv
```

Phase 2: explicit thresholds config
- `src/runtime/seeds/enrichment-promotion-thresholds.json`

Phase 3: statistical auto-promotion with provenance

```bash
npm run enrich:via-job-title:stats:promote -- --locale=hu --report=data/taxonomy-review/job-title-statistical-candidates.hu.json --provenance=data/taxonomy-review/job-title-statistical-auto-promotions.hu.json
```

Behavior:
- only candidates marked `auto_decision=promote` are applied automatically
- applied changes are written into tracked seed files
- every applied or skipped automatic promotion is written into a provenance report
- review candidates stay out of runtime until a later operator decision

### Auditor-Facing Decision Examples
Every promoted artifact should be explainable like this:

Example:
- `surface = "műszakvezető"`
- `candidate_type = common_role_phrase`
- `title_occurrences = 54`
- `distinct_chunk_count = 4`
- `coverage_per_1000 = 21.4`
- `top_canonical_target = shift supervisor`
- `top_target_support = 0.91`
- `top_family_support = 0.95`
- `single_token_flag = false`
- `auto_decision = promote`
- `promotion_basis = statistics_only`

Contrast with an LLM-derived residual candidate:
- `surface = "HR Business Partner"`
- `title_occurrences = 1`
- `distinct_chunk_count = 1`
- `auto_decision = review`
- `promotion_basis = llm_plus_operator`

That difference is exactly what should be visible to reviewers.

### Immediate Direction
Before doing more LLM review for common cases, implement the statistical candidate-mining layer first.

That is the missing foundation needed to make enrichment decisions:
- repeatable
- thresholded
- externally auditable
- reversible

### 6. Export runtime artifacts and validate
After promotion, rebuild runtime artifacts and run the regression gate.

```bash
npm run runtime:artifacts-build
npm run test:structural
npm run evaluation:golden:pipeline:developing
npm run evaluation:golden:pipeline -- --suite=stable
```

### 7. Rerun the same chunk if the accepted fixes should change its unresolved/drift cases
This is the key chunk-cycle rule.

If the promoted fixes improve:
- noise peeling
- common role phrase anchoring
- family alias anchoring
- family support / suppression
- role-head equivalence

then replay the same chunk again and re-review the reduced hard-case set before moving to the next offset.

### 8. Move to the next chunk offset only after the current chunk is fully cycled
This keeps the enrichment loop compounding improvements instead of deferring them.

## Recommended Working Pattern For Today
### HU first
1. Resume reviewed HU batches `3..10`.
2. Aggregate and shape seed proposals.
3. Promote accepted structural changes.
4. Export runtime artifacts.
5. Run structural + golden validation.
6. Replay the same HU `0..249` chunk if the accepted fixes should materially reduce unresolved/drift cases.
7. Only then prepare the next HU chunk starting at offset `250`.

### RO later
1. Keep `1200` as the verified RO resume point.
2. Rebuild the RO working surface with `--offset=1200 --limit=1000` because the current RO pilot/brief/batch files are smoke artifacts.
3. Run the same full chunk cycle on that RO block.

## Stability Notes
- The direct batch runner is already safer than the original manual loop because it validates schema shape, retries malformed responses, writes per-batch files, and merges outputs deterministically.
- The main stability improvement still needed is procedural, not ranking-side: treat each locale chunk as a closed loop that can feed accepted structural fixes back into the next replay of the same chunk.
- The direct runner already supports the needed resume model for this: continue by batch range, skip existing reviewed batches, and regenerate the merged reviewed JSONL automatically.
- The biggest remaining documentation gap was that the repo had the pieces of this workflow spread across scripts, bundles, and RO-oriented handoff docs, but not one explicit chunk-cycle document describing the resumable all-LLM operator flow.

## Related Files
- Workflow help: `scripts/print-job-title-enrichment-workflow.js`
- Chunk replay: `scripts/run-job-title-enrichment-resolution-chunks.js`
- One-command prep: `scripts/run-job-title-enrichment-prepare.js`
- Direct locale runner: `scripts/run-job-title-triage-direct-by-locale.js`
- Direct LLM batch runner: `scripts/run-llm-job-title-triage-direct.js`
- Proposal aggregation: `scripts/aggregate-llm-job-title-triage-proposals.js`
- Query-prep seed shaping: `scripts/build-query-prep-seed-proposals.js`
- Prompt contract: `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`
- Detailed row-review contract: `docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md`
- Legacy handoff/state doc: `docs/LLM_JOB_TITLE_TRIAGE_HANDOFF.md`
