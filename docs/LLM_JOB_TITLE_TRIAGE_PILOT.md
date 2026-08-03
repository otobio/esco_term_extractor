# LLM Job Title Triage Pilot

Purpose: produce reusable artifact proposals from real job titles without adding title-specific runtime hacks.

## Inputs
- A pilot JSONL batch such as `data/taxonomy-review/job-title-triage-pilot.ro.jsonl`
- The exact review prompt at `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`
- The output schema at `data/taxonomy-review/job-title-triage-output.schema.json`
- The operating rules in `SESSION_STATE.md`

## Allowed Outputs
- `reviewed_family_signal`
- `reviewed_family_penalty`
- `noise_rule`
- `role_head_equivalence`
- `common_role_phrase`
- `family_alias_anchor`

## Forbidden Outputs
- leaf forcing
- title-specific runtime conditions
- free-form alias dumps
- untyped rationale with no artifact destination

## LLM Task
For each row:
- classify the title structure
- judge whether the current pipeline result is plausible
- identify the most likely structural failure mode when the result is not plausible
- propose only reusable artifact candidates that fit the allowed output classes

## Decision Rules
- Prefer family-safe structural fixes over leaf-specific guesses.
- Domain/context terms must not select a family by themselves.
- Exact and folded alias authority remain stronger than LLM-derived reviewed signals.
- If a proposal looks one-off, reject it.

## Review Prompt
Use `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md` as the exact prompt contract.

For the actual human-operated batch workflow, use `docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md`.

Short version:

```text
You are reviewing real-world job titles for a production occupation resolver.

Your job is not to choose an ESCO leaf freely.
Your job is to analyze title structure and propose only reusable artifact candidates.

Allowed artifact classes:
- reviewed_family_signal
- reviewed_family_penalty
- noise_rule
- role_head_equivalence
- common_role_phrase
- family_alias_anchor

Forbidden:
- leaf forcing
- title-specific code
- one-off phrase memorization unless it is clearly reusable market language

Return JSON matching the provided schema only.
```

## Batch Builder
Generate a pilot batch with:

```bash
npm run review:triage:pilot
```

This writes:
- `data/taxonomy-review/job-title-triage-pilot.ro.jsonl`
- `data/taxonomy-review/job-title-triage-pilot.ro.manifest.json`

For other locales later, override the locale and input path.

## Token-Efficient Review Brief
Build a compact review surface from the full pilot JSONL with:

```bash
npm run review:triage:brief
```

This writes:
- `data/taxonomy-review/job-title-triage-brief.columns.json`
- `data/taxonomy-review/job-title-triage-brief.ro.tsv`
- `data/taxonomy-review/job-title-triage-brief.ro.manifest.json`

Use the column definitions once, then review the TSV rows in batches.
Open the full `job-title-triage-pilot.ro.jsonl` only for ambiguous rows that need extra evidence detail.

## One-Bundle Handoff
Prepare a single machine-readable bundle that lists the inputs, outputs, schemas, and commands for the LLM review stage:

```bash
npm run review:triage:bundle
```

This writes:
- `data/taxonomy-review/job-title-triage-review-bundle.ro.json`

## Reviewed Output Target
The reviewed LLM output should be written to:

- `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

Template:

- `data/taxonomy-review/job-title-triage-reviewed.template.jsonl`

## Proposal Aggregation
After the LLM reviews the row-level dataset and writes JSONL output that matches `job-title-triage-output.schema.json`, aggregate it with:

```bash
npm run review:triage:aggregate
```

Default expected input:
- `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

Outputs:
- `data/taxonomy-review/job-title-triage-proposals.ro.json`
- `data/taxonomy-review/job-title-triage-proposals.ro.csv`

Those aggregated outputs are the acceptance surface for deciding which proposals become reviewed runtime seed entries.
