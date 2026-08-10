# Getting Started

This guide explains how to build, run, inspect, evaluate, and compare the occupation search engine from a fresh local setup.

## Prerequisites

- Node.js 20+
- MySQL reachable from this project
- A database matching `DB_DATABASE`
- ESCO locale pack files available on disk

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment

The CLI uses these local MySQL defaults when no `.env` file is present:

```text
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=occupation_search_engine
DB_USERNAME=root
DB_PASSWORD=root
```

Create `.env` only when your local values differ:

```bash
cp .env.example .env
```

Set ESCO import inputs:

```text
ESCO_DOWNLOADS_DIR=/path/to/esco/downloads
ESCO_VERSION=1.2.1
```

## 3. Apply Schema

```bash
npm run db:apply-schema
npm run db:check
```

Expected result:

- `db:check` can connect to MySQL.
- The `ose_*` tables exist.

## 4. Import ESCO Source Data

Import all configured locales:

```bash
npm run import:esco
```

Or import a selected locale set:

```bash
npm run import:esco -- --locales=en,ro --version=1.2.1
```

Audit source import:

```bash
npm run audit:esco-source
```

## 5. Build Graph Layers

Build occupation graph:

```bash
npm run graph:occupations -- --source-name=esco_1_2_1 --locales=en,ro
```

Build capability graph:

```bash
npm run graph:capabilities -- --source-name=esco_1_2_1 --locales=en,ro
```

## 6. Build Search Meta

```bash
npm run search-meta:occupations -- --source-name=esco_1_2_1 --locales=en,ro
```

Audit search meta:

```bash
npm run audit:search-meta
```

Optional: insert obvious quality issues into the review queue:

```bash
npm run audit:search-meta -- --insert-review-queue
```

Build automated O*NET/EURES alias-review CSVs:

```bash
npm run review:aliases:auto
```

Expected output:

```text
artifacts/enrichment/review/automated-review-decisions.csv
artifacts/enrichment/review/manual-review-queue.csv
```

Export all runtime artifacts used by deploy/runtime resolution:

```bash
npm run runtime:artifacts-build
```

This command exports the binary search-meta graph/details artifact, binary
retrieval index, binary family-profile tables, binary family-token relevance
tables, binary alias-ngram artifacts, signal vocabulary, intent vocabulary, and role-head equivalences. For deploys, this is
the command to run after rebuilding source graph/search-meta data.

If the local DB needs to be rebuilt first, run the DB-backed rebuild path:

```bash
npm run runtime:artifacts-rebuild-db
```

That command runs capability graph build, occupation search-meta build, then the
full runtime artifact export. Use it when regenerating from DB so search-meta,
retrieval, family-profile, family-token relevance, alias-ngram, signal, intent, and role-head artifacts
all share the same graph node IDs.

When starting from a checked-in SQL dump, restore that dump before running
`runtime:artifacts-rebuild-db`. Store dumps under `sql/snapshots/`. If a dump is
larger than GitHub's per-file limit, split the dump archive into numbered chunks
under 50 MB and reconstruct the archive by concatenating chunks in lexical order
before restore. The dump is the reproducible DB snapshot; the runtime package
still consumes generated `artifacts/runtime/occupation-*` files. Do not mix a
restored DB snapshot with older runtime artifacts, because graph node IDs and
generated family/search indexes must stay coherent.

Reviewed taxonomy fixes are source inputs, not runtime patches. Keep the CSV
override files under `data/taxonomy-review` and
`src/runtime/occupation-taxonomy-family-overrides.ts` in sync, then rebuild all
runtime artifacts after changing them.

Expected runtime outputs include:

```text
artifacts/runtime/occupation-search-meta.esco_1_2_1.manifest.json
artifacts/runtime/occupation-retrieval-index.esco_1_2_1.manifest.json
artifacts/runtime/occupation-family-profiles.esco_1_2_1.manifest.json
artifacts/runtime/occupation-family-profiles.esco_1_2_1.*.bin
artifacts/runtime/occupation-family-profiles.esco_1_2_1.*.idx
artifacts/runtime/occupation-alias-ngrams.esco_1_2_1.en.family.binary.manifest.json
artifacts/runtime/occupation-signal-vocabulary.esco_1_2_1.manifest.json
artifacts/runtime/occupation-intent-vocabulary.esco_1_2_1.manifest.json
artifacts/runtime/occupation-role-head-equivalents.binary.manifest.json
```

Human-review mirrors for the generated runtime artifacts live under
`data/runtime-review/`. Runtime should load the binary artifacts from
`artifacts/runtime`; reviewers should inspect the decoded JSON/JSONL mirrors from
`data/runtime-review`.

Check required runtime artifacts before starting the app/API:

```bash
npm run runtime:check
npm run test:structural
```

You can still run individual exporters while developing a specific artifact.
For example, export only the runtime graph/search-meta artifact:

```bash
npm run search-meta:export-runtime
```

Expected output:

```text
artifacts/runtime/occupation-search-meta.esco_1_2_1.manifest.json
artifacts/runtime/occupation-search-meta.esco_1_2_1.strings.bin
artifacts/runtime/occupation-search-meta.esco_1_2_1.core-rows.bin
artifacts/runtime/occupation-search-meta.esco_1_2_1.detail-rows.bin
artifacts/runtime/occupation-search-meta.esco_1_2_1.alias-rows.bin
artifacts/runtime/occupation-search-meta.esco_1_2_1.capability-rows.bin
```

Export only the binary retrieval index:

```bash
npm run retrieval:index:export
```

Export only the runtime alias-ngram retrieval artifact for deterministic alias
search:

```bash
npm run retrieval:aliases:ngram:export -- --locales=en,ro,hu,et --include-family-supporting
```

Expected output:

```text
artifacts/runtime/occupation-alias-ngrams.esco_1_2_1.en.family.binary.manifest.json
artifacts/runtime/occupation-alias-ngrams.esco_1_2_1.ro.family.binary.manifest.json
```

Runtime alias-ngram retrieval is enabled by default and uses the generated `.family`
artifact for the requested locale. Set `OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL=1` to
turn this retrieval channel off, or `OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT=1` to
force leaf-only ngram artifacts.

## 7. Seed Evaluation Queries

Seed the 25-query smoke/regression set:

```bash
npm run evaluation:seed -- --source-name=esco_1_2_1 --set-key=phase8-core-v1
```

Use `--reset-set` only when you intentionally want to delete and recreate rows owned by this seed marker:

```bash
npm run evaluation:seed -- --source-name=esco_1_2_1 --set-key=phase8-core-v1 --reset-set
```

Seed the expanded Phase 15 evaluation set (`phase15-expanded-v1`, currently 100 queries):

```bash
npm run evaluation:seed -- --source-name=esco_1_2_1 --set-key=phase15-expanded-v1
```

Reset and recreate only the expanded set rows owned by this seed marker:

```bash
npm run evaluation:seed -- --source-name=esco_1_2_1 --set-key=phase15-expanded-v1 --reset-set
```

## 8. Run Search Manually

Retrieve candidates:

```bash
npm run retrieval:candidates -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10
```

Run candidates against the offline binary retrieval backend:

```bash
npm run retrieval:candidates -- --query="software developer" --locale=en --source-name=esco_1_2_1 --retrieval-backend=binary-cache --limit=10
```

Inspect hierarchy branches:

```bash
npm run retrieval:branches -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

Resolve a query:

```bash
npm run resolution:query -- --query="software developer" --locale=en --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

Resolve a Romanian folded-alias example:

```bash
npm run resolution:query -- --query="trefilator sarma" --locale=ro --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

Resolve a noisy-title example:

```bash
npm run resolution:query -- --query="senior data analyst - SQL dashboards" --locale=en --source-name=esco_1_2_1 --limit=10 --sibling-limit=5
```

Resolve an acronym-expanded occupation title:

```bash
npm run resolution:pipeline -- --query="HVAC technician" --locale=en
```

Query preparation preserves acronym tokens in normalized/folded forms and adds controlled long-form signals. For example, `HVAC technician` keeps `HVAC` and also searches with `heating ventilation air conditioning`.

If acronym normalization or alias indexing code changed, rebuild the runtime search data:

```bash
npm run search-meta:occupations
npm run runtime:artifacts-build
```

Run retrieval against the portable offline path:

```bash
npm run retrieval:candidates -- --query="senior data analyst SQL dashboards" --locale=en --source-name=esco_1_2_1 --retrieval-backend=binary-cache --limit=10 --format=text
```

## 9. Use The API

The product-facing API intentionally hides retrieval implementation details such
as `retrieval_backend`. Runtime combines exact/folded alias evidence,
alias-ngram evidence, lexical evidence, family-profile evidence, and graph branch
scoring.

For fully offline/package-local resolution, build runtime artifacts and run the
pipeline with `--retrieval-backend=binary-cache`. That path does not require
MySQL, OpenSearch, model inference, vector artifacts, or network access at query
time.

Use `getCanonicalTerm` from application code:

```ts
import { getCanonicalTerm } from 'occupation-search-engine';

const result = await getCanonicalTerm({
  input: 'senior data analyst',
  locale: 'en'
});

console.log(result.leafCanonicalTerms);
console.log(result.familyCanonicalTerms);
console.log(result.capabilityTerms);
console.log(result.occupationContexts);
```

Response shape:

```ts
type GetCanonicalTermResult = {
  decision: {
    decisionType: 'leaf' | 'family' | 'group' | 'multi_span' | 'unresolved';
    selectedCanonicalTerm: string | null;
    selectedGraphNodeId: number | null;
    confidence: number;
  };
  leafCanonicalTerms: Array<{ graphNodeId: number; canonicalTerm: string; confidence: number }>;
  familyCanonicalTerms: Array<{ graphNodeId: number; canonicalTerm: string; confidence: number }>;
  capabilityTerms: Array<{ capabilityId: number; canonicalTerm: string; capabilityType: string; confidence: number }>;
  occupationContexts: Array<{
    spanIndex: number;
    input: string;
    decision: GetCanonicalTermResult['decision'];
    leafCanonicalTerms: GetCanonicalTermResult['leafCanonicalTerms'];
    familyCanonicalTerms: GetCanonicalTermResult['familyCanonicalTerms'];
    capabilityTerms: GetCanonicalTermResult['capabilityTerms'];
  }>;
};
```

Default output returns up to 3 leaf terms, 3 family terms, and 3 capability terms.

If one submitted job title contains multiple occupation spans, such as `LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD`, the top-level `decisionType` is `multi_span`. The top-level term arrays contain one representative term per span first, and `occupationContexts` contains the authoritative span-level decisions and canonical terms. Bracketed markers such as `(m/f)` are stripped as title noise and do not create separate spans.

## 11. Persist An Evaluation Run

```bash
npm run evaluation:run -- --run-label=semantic-test-v1 --source-name=esco_1_2_1 --set-key=phase8-core-v1 --limit=10 --sibling-limit=5
```

Persist the current expanded local-hash baseline:

```bash
npm run evaluation:run -- --run-label=phase15-expanded-local-hash-v1 --source-name=esco_1_2_1 --set-key=phase15-expanded-v1 --model-key=local-hash-v1 --limit=10 --sibling-limit=5
```

Current expanded baseline:

```text
search_run_id=5
query_count=100
selected_count=71
unresolved_count=29
```

Dry run without writing:

```bash
npm run evaluation:run -- --dry-run --max-queries=5
```

Expected behavior:

- Non-dry runs create one row in `ose_search_runs`.
- Result rows are written to `ose_search_run_results`.
- Unresolved queries are counted in run notes but do not get fake selected rows.

## 12. Build Manual Review Queue

Use the search run ID returned by `evaluation:run`:

```bash
npm run review:build -- --search-run-id=3
```

Inspect pending rows:

```bash
npm run review:inspect -- --status=pending --limit=25
```

Inspect one issue type:

```bash
npm run review:inspect -- --status=pending --review-type=relatedness_gap --limit=25
```

Dry-run review generation:

```bash
npm run review:build -- --search-run-id=3 --dry-run --include-existing
```

## 13. Compare Readiness

Compare a candidate run to a baseline:

```bash
npm run evaluation:compare -- --baseline-run-id=2 --candidate-run-id=3
```

Emit JSON:

```bash
npm run evaluation:compare -- --baseline-run-id=2 --candidate-run-id=3 --format=json
```

Interpretation:

- `can_answer_from_evidence=yes` means the evidence is sufficient to judge readiness.
- `readiness_status=ready` means the candidate cleared the conservative bar.
- `readiness_status=not_ready` means it did not.
- `category_summaries` show hit, miss, unresolved, and missing-expectation counts by evaluation category.
- `category_deltas` show candidate-minus-baseline movement by category when the compared runs cover the same query IDs.

The current measured state is:

```text
expanded baseline: search_run_id=5
tuned hybrid candidate: search_run_id=9
semantic candidate: search_run_id=11
default readiness status: ready for run 9
semantic promotion status: not_ready under the current conservative unresolved gate
```

## Key Reference Docs

- `docs/SEARCH_DECISION_TREE.md`: table-by-table search decision flow.
- `docs/SEARCH_MATURITY_PLAN.md`: pipeline maturity percentages and path to an 85% test-run target.
- `docs/IMPLEMENTATION_CHECKLIST.md`: phase-by-phase implementation state and definitions of done.

## Common Troubleshooting

### MySQL connection fails

Check `.env` and run:

```bash
npm run db:check
```

### Search meta audit shows UUID-like rows

This is a known data-quality issue from six ESCO stub occupation rows. Search machinery can run, but clean Search Meta DoD requires resolving or quarantining those rows.

### Candidate run selects more queries but readiness is still not ready

This is expected when unresolved queries become wrong selections. The readiness bar requires improved successful hits without increasing misses or review debt.
