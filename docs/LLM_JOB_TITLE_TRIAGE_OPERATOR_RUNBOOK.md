# LLM Job Title Triage Operator Runbook

Purpose: run the RO batch review with a human-operated LLM in a way that is repeatable, schema-safe, and strict about reusable artifact proposals.

## Scope
- Input corpus: `data/taxonomy-review/job-title-triage-batches.ro.all/`
- Locale: `ro`
- Batch manifest: `data/taxonomy-review/job-title-triage-batches.ro.all.manifest.json`
- Expected reviewed output: `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`
- Expected aggregate step after review: `npm run review:triage:aggregate`

## Files The Operator Must Use
- Prompt contract: `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`
- This runbook: `docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md`
- Column definitions: `data/taxonomy-review/job-title-triage-brief.columns.json`
- Output schema: `data/taxonomy-review/job-title-triage-output.schema.json`
- TSV batches: `data/taxonomy-review/job-title-triage-batches.ro.all/job-title-triage-batch.XXXX.tsv`
- Fallback deep context only when needed: `data/taxonomy-review/job-title-triage-pilot.ro.all.jsonl`

## Operator Goal
For each TSV row, get one JSON object that:
- matches `job-title-triage-output.schema.json`
- preserves the resolver invariants
- proposes only reusable artifact candidates
- returns an empty `artifact_proposals` array when the case is uncertain or one-off

## Non-Negotiable Rules
- Do not ask the LLM to choose ESCO leaves freely.
- Do not accept title-specific fixes.
- Do not accept free-form alias dumps.
- Do not accept proposals outside the allowed artifact classes.
- Do not let domain-only words choose a family.
- Prefer closest safe family logic over aggressive leaf guessing.
- If a row is ambiguous, keep the proposal list empty.

## Allowed Artifact Classes
- `reviewed_family_signal`
- `reviewed_family_penalty`
- `noise_rule`
- `role_head_equivalence`
- `common_role_phrase`
- `family_alias_anchor`

## Batch Inventory
- Total rows: `10040`
- Batch size: `25`
- Total batch files: `402`

The final batch file may contain fewer than 25 rows.

## Recommended Operator Loop
1. Open `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md` and this runbook.
2. Load `data/taxonomy-review/job-title-triage-brief.columns.json` once into the LLM context.
3. Load `data/taxonomy-review/job-title-triage-output.schema.json` once into the same context.
4. Submit one TSV batch file at a time.
5. Require the LLM to return only JSON objects, one per TSV row, with no markdown and no prose.
6. Validate basic shape manually before saving the batch output.
7. Append accepted batch output lines to `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`.
8. If a batch response is malformed, discard it and rerun the same batch with a stricter reminder.

## Direct Runner
If an API key is available in the local environment, the repo can run the batch flow directly:

```bash
npm run review:triage:llm:direct -- --batch-index=1
```

Useful variants:

```bash
npm run review:triage:llm:direct -- --dry-run --batch-index=1
npm run review:triage:llm:direct -- --start-batch=1 --end-batch=10
```

Default credential source:
- `OPENAI_API_KEY`

Default outputs:
- per-batch JSONL: `data/taxonomy-review/job-title-triage-reviewed.ro.batches/`
- merged reviewed JSONL: `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

## Exact Wrapper To Use Around Each Batch
Use the prompt contract from `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`, then add this wrapper:

```text
Field definitions:
<paste data/taxonomy-review/job-title-triage-brief.columns.json once>

Output schema:
<paste data/taxonomy-review/job-title-triage-output.schema.json once>

Review these TSV rows and output exactly one JSON object per row.
Return newline-delimited JSON only.
Do not wrap the objects in an array.
Do not include markdown fences.
Do not include commentary before or after the JSON objects.

TSV rows:
<paste header plus one batch file>
```

After the first successful batch in the same LLM session, do not repaste the field definitions or schema unless the model appears to have lost them.

## Strong Retry Message
If the LLM returns anything except pure JSONL, retry the same batch with this message:

```text
Your last response did not follow the contract.

Re-run the same TSV rows.
Return newline-delimited JSON only.
One JSON object per TSV row.
No array wrapper.
No markdown.
No prose.
Every object must match the provided schema exactly.
If uncertain, keep artifact_proposals empty.
```

## What To Check Before Accepting A Batch
- The number of JSON lines equals the number of TSV data rows in the batch.
- Every JSON object has `row_index`.
- Every JSON object has all required top-level fields from the schema.
- `pipeline_failure_mode` is one of the allowed enum values.
- `title_type` is one of the allowed enum values.
- `artifact_proposals` is present on every line.
- Every proposal `type` is one of the allowed artifact classes.
- No line contains markdown fences, bullets, or explanation text.

## What Good Output Looks Like
- Plausible existing pipeline result:
  - `pipeline_result_plausible: true`
  - `pipeline_failure_mode: "none"`
  - usually `artifact_proposals: []`
- Clear reusable family marker missing:
  - `pipeline_result_plausible: false`
  - `pipeline_failure_mode: "missing_family_marker_support"`
  - one or more tightly scoped `reviewed_family_signal` proposals
- Clear reusable suppression needed:
  - `pipeline_result_plausible: false`
  - `pipeline_failure_mode: "needs_family_suppression"`
  - one or more `reviewed_family_penalty` proposals
- Ambiguous or likely one-off:
  - choose the closest failure mode
  - keep `artifact_proposals: []`

## What Bad Output Looks Like
- The model invents a leaf answer that is not represented by the row evidence.
- The model proposes a rule for one exact title string with no reuse pattern.
- The model outputs a long explanation instead of JSONL.
- The model emits unbounded alias lists.
- The model uses domain terms as the main family selector.

## When To Escalate To Deep Context
Open `data/taxonomy-review/job-title-triage-pilot.ro.all.jsonl` only when a row cannot be judged from the TSV surface alone.

Use deep context sparingly for cases like:
- multi-span rows where the split appears suspicious
- rows with unclear missing-role-token behavior
- rows where top family hints look contradictory

Do not switch the whole workflow back to the full JSONL.

## Output Assembly Rules
- Save each accepted batch as plain JSONL.
- Preserve one object per line.
- Preserve the original `row_index` values.
- Append batches in row order when possible.
- Do not deduplicate or sort the reviewed rows manually.
- Do not insert blank lines.

Target final file:
- `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

## Suggested Batch Tracking Sheet
Track these fields outside the model:
- `batch_file`
- `row_start`
- `row_end`
- `status`
- `accepted_on_first_try`
- `retry_count`
- `notes`

Suggested statuses:
- `pending`
- `in_review`
- `accepted`
- `retry_needed`
- `blocked`

## Finalization After All Batches
1. Confirm the reviewed JSONL exists at `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`.
2. Confirm it contains one JSON object per reviewed row.
3. Run `npm run review:triage:aggregate`.
4. Review the aggregated proposals for one-offs before any runtime seed promotion.

## Acceptance Standard
The operator succeeded if:
- the LLM output is strict JSONL
- rows are not dropped or duplicated within a batch
- artifact proposals stay inside the typed structural classes
- ambiguous rows prefer empty proposal sets over speculative fixes
- the aggregate output is reusable enough to review for runtime seed promotion
