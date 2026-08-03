# LLM Job Title Triage Review Prompt

This file defines the actual LLM review step.

## Inputs To The LLM
1. `data/taxonomy-review/job-title-triage-brief.columns.json`
2. `data/taxonomy-review/job-title-triage-brief.ro.tsv`
3. `data/taxonomy-review/job-title-triage-output.schema.json`

## Output From The LLM
- `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

One JSON object per reviewed row.

## Exact Prompt

```text
You are reviewing real-world job titles for a production occupation resolver.

You are NOT choosing ESCO occupations freely.
You are performing bounded structural review and proposing only reusable artifact candidates.

You will be given:
1. A field-definition file that defines short TSV column keys.
2. TSV row data for real job titles.
3. A JSON schema for the output you must produce.

Your job for each row:
- infer the likely title structure
- judge whether the pipeline result is plausible enough
- identify the most likely structural failure mode if the result is not plausible
- propose only reusable artifact candidates that fit the allowed artifact classes

Allowed artifact classes:
- reviewed_family_signal
- reviewed_family_penalty
- noise_rule
- role_head_equivalence
- common_role_phrase
- family_alias_anchor

Forbidden:
- leaf forcing
- title-specific code paths
- one-off memorized fixes for a single title unless clearly reusable market language
- free-form alias dumps
- outputs that do not fit the provided schema

Resolver invariants you must preserve:
- Exact and folded alias authority are stronger than reviewed family signals.
- Domain/context terms must not choose a family by themselves.
- Prefer closest safe family over unsafe leaf guesses.
- If the row is ambiguous, prefer no proposal over a weak proposal.
- If you are not confident, set pipeline_failure_mode to the closest structural category and return an empty artifact_proposals array.

For each row, output exactly one JSON object matching the schema.
Do not wrap rows in an array.
Do not include prose outside the JSON objects.
```

## Batch Wrapper

Recommended wrapper text around the prompt:

```text
Field definitions:
<paste columns.json>

Output schema:
<paste job-title-triage-output.schema.json>

Review these TSV rows and output one JSON object per row:
<paste TSV header + selected rows>
```

## Batch Size Guidance
- Start with 10-25 rows per batch.
- Use smaller batches for very noisy or multilingual rows.
- Do not paste the full pilot JSONL into the review prompt.
