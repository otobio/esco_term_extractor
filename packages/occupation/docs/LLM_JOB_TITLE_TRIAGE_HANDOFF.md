# LLM Job Title Triage Handoff

This document is the on-disk handoff for the LLM-assisted artifact-discovery workflow.

## Current State
- Runtime already supports reviewed family-level marker support/suppression.
- The anti-hack operating rules live in `SESSION_STATE.md`.
- A bounded RO pilot dataset can be regenerated at any time.
- The pilot does not write to runtime directly.

## Runtime Contracts Already Available
- Noise peeling
- Common role phrase anchoring
- Family alias anchoring
- Role-head equivalence
- Reviewed family support / suppression

## Runtime Contract Not Yet Automatic
The dataset itself is not runtime.

Flow:
1. Build pilot dataset from real titles.
2. LLM reviews rows and emits typed proposals.
3. Aggregate proposals.
4. Reject one-offs / non-structural suggestions.
5. Promote accepted proposals into reviewed seed artifacts.
6. Export runtime artifacts.
7. Run structural + sample + golden validation.

## Files On Disk

### Input / review data
- `data/taxonomy-review/job-title-triage-pilot.ro.jsonl`
- `data/taxonomy-review/job-title-triage-pilot.ro.manifest.json`
- `data/taxonomy-review/job-title-triage-brief.columns.json`
- `data/taxonomy-review/job-title-triage-brief.ro.tsv`
- `data/taxonomy-review/job-title-triage-brief.ro.manifest.json`
- `data/taxonomy-review/job-title-triage-review-bundle.ro.json`

### LLM schemas
- `data/taxonomy-review/job-title-triage-output.schema.json`
- `data/taxonomy-review/job-title-triage-proposals.schema.json`
- `data/taxonomy-review/job-title-triage-reviewed.template.jsonl`

### Runtime artifacts / seeds
- `src/runtime/seeds/occupation-reviewed-family-signals.json`
- `artifacts/runtime/occupation-reviewed-family-signals.binary.manifest.json`
- `data/runtime-review/occupation-reviewed-family-signals.json`

### Workflow docs
- `docs/LLM_JOB_TITLE_TRIAGE_PILOT.md`
- `docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md`
- `docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`
- `SESSION_STATE.md`
- `docs/LLM_JOB_TITLE_TRIAGE_HANDOFF.md`

### Builder / aggregator scripts
- `scripts/build-llm-job-title-triage-pilot.js`
- `scripts/build-llm-job-title-review-brief.js`
- `scripts/aggregate-llm-job-title-triage-proposals.js`

## Commands

### Generate pilot dataset
```bash
npm run enrich:via-job-title:resolution -- --locale=ro
```

### Generate token-efficient review brief
```bash
npm run enrich:via-job-title:query -- --input=data/taxonomy-review/job-title-triage-pilot.ro.jsonl --out-tsv=data/taxonomy-review/job-title-triage-brief.ro.tsv --manifest=data/taxonomy-review/job-title-triage-brief.ro.manifest.json
```

Primary review surface:
- `data/taxonomy-review/job-title-triage-brief.columns.json`
- `data/taxonomy-review/job-title-triage-brief.ro.tsv`

Fallback deep context only when needed:
- `data/taxonomy-review/job-title-triage-pilot.ro.jsonl`

### Prepare one review bundle
```bash
npm run enrich:via-job-title:bundle -- --locale=ro
```

This writes:
- `data/taxonomy-review/job-title-triage-review-bundle.ro.json`

That bundle is the single file a new context can open to see the exact triage -> fields-once -> row-data -> LLM -> reviewed JSONL -> aggregate flow.

### Aggregate reviewed LLM proposal output
Expected reviewed input path by default:
- `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`

Direct batch runner when `OPENAI_API_KEY` is available:

```bash
npm run enrich:via-job-title:review:direct -- --locale=ro --start-batch=1 --end-batch=10
```

Run:
```bash
npm run enrich:via-job-title:aggregate -- --input=data/taxonomy-review/job-title-triage-reviewed.ro.jsonl --out-json=data/taxonomy-review/job-title-triage-proposals.ro.json --out-csv=data/taxonomy-review/job-title-triage-proposals.ro.csv
```

Outputs:
- `data/taxonomy-review/job-title-triage-proposals.ro.json`
- `data/taxonomy-review/job-title-triage-proposals.ro.csv`

### Validate runtime / regressions
```bash
npm run test:structural
npm run semantic:bootstrap:matches
npm run evaluation:golden:pipeline:developing
npm run evaluation:golden:pipeline -- --suite=stable
```

## Required Review Discipline
- Only proposals that fit an allowed artifact class may advance.
- No direct title-specific runtime logic.
- No free-form alias dump promotion.
- No leaf forcing.
- Exact/folded alias authority remains stronger than reviewed family signals.
- Prefer family-safe improvement over aggressive leaf promotion.

## What A New Context Should Do Next
1. Read `SESSION_STATE.md` first.
2. Start with `npm run enrich:via-job-title:help` or run the one-command prep surface:

```bash
npm run enrich:via-job-title:prepare -- --locale=ro --sample=all --input=/path/to/job_titles.csv --title-column=job_title
```

3. Run LLM review against the compact TSV first; escalate to the full pilot JSONL only when needed.
4. Follow `docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md` for the actual human-operated batch procedure.
5. Save the reviewed row output as `data/taxonomy-review/job-title-triage-reviewed.ro.jsonl`.
6. Run proposal aggregation.
7. Review aggregated proposals for reuse and anti-hack compliance.
8. Promote accepted proposals into reviewed seed artifacts.
9. Export / validate / measure.

## Success Criteria
- Real job titles move to the closest safe ESCO family at minimum.
- The method is repeatable for later locales by changing reviewed artifacts, not runtime hacks.
- Golden-suite failure counts do not materially increase.
