import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const bundle = buildBundle(options.locale);

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  console.log(`Prepared LLM review bundle: ${options.outPath}`);
}

function parseCliOptions(args) {
  const options = {
    locale: 'ro',
    outPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-review-bundle.ro.json')
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim();
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/prepare-llm-job-title-review-bundle.js',
      '[--locale=ro]',
      '[--out=data/taxonomy-review/job-title-triage-review-bundle.ro.json]'
    ].join(' ')
  );
}

function buildBundle(locale) {
  const base = 'data/taxonomy-review';

  return {
    locale,
    workflow: [
      'Generate pilot dataset',
      'Generate column definitions and TSV row data',
      'Load field definitions once and review TSV rows in batches with the LLM',
      'Write reviewed row output JSONL matching the schema',
      'Aggregate proposals',
      'Accept only structural artifact candidates',
      'Promote accepted proposals into reviewed runtime seeds',
      'Run structural/sample/golden validation'
    ],
    input_files: {
      column_definitions: `${base}/job-title-triage-brief.columns.json`,
      row_data_tsv: `${base}/job-title-triage-brief.${locale}.tsv`,
      full_pilot_jsonl: `${base}/job-title-triage-pilot.${locale}.jsonl`,
      pilot_manifest: `${base}/job-title-triage-pilot.${locale}.manifest.json`,
      brief_manifest: `${base}/job-title-triage-brief.${locale}.manifest.json`
    },
    llm_contract: {
      prompt_doc: 'docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md',
      handoff_doc: 'docs/LLM_JOB_TITLE_TRIAGE_HANDOFF.md',
      session_state: 'SESSION_STATE.md',
      row_output_schema: `${base}/job-title-triage-output.schema.json`,
      aggregated_output_schema: `${base}/job-title-triage-proposals.schema.json`,
      allowed_artifact_classes: [
        'reviewed_family_signal',
        'reviewed_family_penalty',
        'noise_rule',
        'role_head_equivalence',
        'common_role_phrase',
        'family_alias_anchor'
      ]
    },
    output_targets: {
      reviewed_row_output_jsonl: `${base}/job-title-triage-reviewed.${locale}.jsonl`,
      aggregated_proposals_json: `${base}/job-title-triage-proposals.${locale}.json`,
      aggregated_proposals_csv: `${base}/job-title-triage-proposals.${locale}.csv`
    },
    commands: {
      build_pilot: 'npm run review:triage:pilot',
      build_brief: 'npm run review:triage:brief',
      prepare_bundle: 'npm run review:triage:bundle',
      aggregate_proposals: 'npm run review:triage:aggregate',
      structural_test: 'npm run test:structural',
      sample_review_csv: 'npm run semantic:bootstrap:matches',
      golden_developing: 'npm run evaluation:golden:pipeline:developing',
      golden_stable: 'npm run evaluation:golden:pipeline -- --suite=stable'
    }
  };
}

main().catch((error) => {
  console.error('LLM review bundle preparation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
