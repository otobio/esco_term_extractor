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

Proposal-field expectations:
- `common_role_phrase`
  - use when repeated market wording should canonicalize directly into a reusable role phrase
  - include `locale`, `surface`, `canonical_english`, and preferably `role_key`
- `family_alias_anchor`
  - use when repeated wording is weaker or broader than a true common role phrase but still safely anchors a family-side canonical role phrase
  - include `locale`, `surface`, `canonical_english`, and preferably `role_key`
- `noise_rule`
  - use only for repeated removable wording, not one-off recruiter text
  - include `locale`, `noise_rule_kind`, `noise_match_type`, plus the terms through `surface`, `query_terms_any`, or `query_terms_all`
  - `noise_match_type` must be `token` or `phrase`
  - prefer specific reusable kinds such as salary, shift, location, employer_brand, application_cta, identifier, language, date, or ui_artifact

Review-surface hints:
- `crp` shows a common role phrase already detected by the runtime
- `fam` shows a family alias anchor already detected by the runtime
- `nt` shows deterministic noise tokens already peeled or identified
- `mt` shows safe job-level modifiers already stripped from retrieval
- if `crp` or `fam` is already correct, usually do not emit another proposal for the same pattern

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

Important:
- Return explicit `noise_rule_kind` for every `noise_rule` proposal.
- Return `role_key` when proposing `common_role_phrase` or `family_alias_anchor` if the canonical role is clear.

Review these TSV rows and output one JSON object per row:
<paste TSV header + selected rows>
```

## Batch Size Guidance
- Start with 10-25 rows per batch.
- Use smaller batches for very noisy or multilingual rows.
- Do not paste the full pilot JSONL into the review prompt.
