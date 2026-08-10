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
    outPath: null
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

  if (!options.outPath) {
    options.outPath = path.join(process.cwd(), 'data', 'taxonomy-review', `job-title-triage-review-bundle.${options.locale}.json`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/prepare-llm-job-title-review-bundle.js',
      '[--locale=ro]',
      '[--out=data/taxonomy-review/job-title-triage-review-bundle.<locale>.json]'
    ].join(' ')
  );
}

function buildBundle(locale) {
  const base = 'data/taxonomy-review';
  const docsBase = 'docs';

  return {
    locale,
    workflow: [
      'step_1_automated_query_replay_chunks',
      'step_2_automated_compact_review_surface',
      'step_3_automated_review_batches',
      'step_4_operator_or_llm_review_rows',
      'step_5_automated_aggregate_reviewed_proposals',
      'step_5a_automated_shape_query_prep_seed_candidates',
      'step_6_operator_manual_promote_reviewed_artifacts',
      'step_7_automated_export_runtime_artifacts',
      'step_8_automated_validate_structural',
      'step_9_automated_validate_golden_developing',
      'step_10_automated_validate_golden_stable'
    ],
    decision_points: [
      'Use the compact TSV as the primary review surface; open the full pilot JSONL only for ambiguous rows.',
      'If the pipeline result is already structurally plausible, keep artifact_proposals empty.',
      'Use `common_role_phrase` when repeated market wording should canonicalize to a reusable role phrase before head selection.',
      'Use `family_alias_anchor` when repeated market wording should anchor a family-side canonical role phrase but is weaker than a strong common role phrase.',
      'Use `noise_rule` only for repeated removable wording, and include `noise_rule_kind` plus `noise_match_type` whenever you propose one.',
      'If a repeated role-side family cue is missing, propose reviewed_family_signal only when the cue is reusable.',
      'If a repeated cue is causing drift into the wrong related family, propose reviewed_family_penalty only when the suppression is reusable.',
      'If a title looks one-off, noisy, or uncertain, prefer an empty proposal list over a speculative structural rule.'
    ],
    acceptance_rules: [
      'Do not force ESCO leaf selection from the LLM review stage.',
      'Do not accept title-specific patches or free-form alias dumps.',
      'Do not let domain-only terms choose a family.',
      'Only promote proposal types that match the allowed artifact classes and survive aggregate review.',
      'Treat runtime artifact export and regression validation as the gate before any promoted rule is trusted.'
    ],
    input_files: {
      column_definitions: `${base}/job-title-triage-brief.columns.json`,
      row_data_tsv: `${base}/job-title-triage-brief.${locale}.tsv`,
      row_batch_manifest: `${base}/job-title-triage-batches.${locale}.manifest.json`,
      row_batch_dir: `${base}/job-title-triage-batches.${locale}`,
      full_pilot_jsonl: `${base}/job-title-triage-pilot.${locale}.jsonl`,
      pilot_manifest: `${base}/job-title-triage-pilot.${locale}.manifest.json`,
      brief_manifest: `${base}/job-title-triage-brief.${locale}.manifest.json`
    },
    llm_contract: {
      prompt_doc: 'docs/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md',
      handoff_doc: 'docs/LLM_JOB_TITLE_TRIAGE_HANDOFF.md',
      operator_runbook_doc: 'docs/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md',
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
      reviewed_row_batch_dir: `${base}/job-title-triage-reviewed.${locale}.batches`,
      reviewed_row_output_jsonl: `${base}/job-title-triage-reviewed.${locale}.jsonl`,
      aggregated_proposals_json: `${base}/job-title-triage-proposals.${locale}.json`,
      aggregated_proposals_csv: `${base}/job-title-triage-proposals.${locale}.csv`,
      query_prep_seed_candidates_json: `${base}/job-title-query-prep-seed-proposals.${locale}.json`
    },
    commands: {
      step_0_workflow_help: 'npm run step_0_workflow_help',
      prepare_all: `npm run enrich:via-job-title:prepare -- --locale=${locale} --sample=all --input=/path/to/job_titles.csv --title-column=job_title --chunk-size=1000`,
      step_1_automated_query_replay_chunks: `npm run step_1_automated_query_replay_chunks -- --locale=${locale} --sample=all --input=/path/to/job_titles.csv --title-column=job_title --chunk-size=1000`,
      step_2_automated_compact_review_surface: `npm run step_2_automated_compact_review_surface -- --input=data/taxonomy-review/job-title-triage-pilot.${locale}.jsonl --out-tsv=data/taxonomy-review/job-title-triage-brief.${locale}.tsv --manifest=data/taxonomy-review/job-title-triage-brief.${locale}.manifest.json`,
      step_3_automated_review_batches: `npm run step_3_automated_review_batches -- --input=data/taxonomy-review/job-title-triage-brief.${locale}.tsv --out-dir=data/taxonomy-review/job-title-triage-batches.${locale} --manifest=data/taxonomy-review/job-title-triage-batches.${locale}.manifest.json --batch-size=25`,
      prepare_bundle: `npm run enrich:via-job-title:bundle -- --locale=${locale}`,
      step_4_operator_or_llm_review_rows: `npm run step_4_operator_or_llm_review_rows -- --locale=${locale} --start-batch=1 --end-batch=10`,
      step_5_automated_aggregate_reviewed_proposals: `npm run step_5_automated_aggregate_reviewed_proposals -- --input=data/taxonomy-review/job-title-triage-reviewed.${locale}.jsonl --out-json=data/taxonomy-review/job-title-triage-proposals.${locale}.json --out-csv=data/taxonomy-review/job-title-triage-proposals.${locale}.csv`,
      step_5a_automated_shape_query_prep_seed_candidates: `npm run step_5a_automated_shape_query_prep_seed_candidates -- --input=data/taxonomy-review/job-title-triage-proposals.${locale}.json --out=data/taxonomy-review/job-title-query-prep-seed-proposals.${locale}.json`,
      step_6_operator_manual_promote_reviewed_artifacts: 'npm run step_6_operator_manual_promote_reviewed_artifacts',
      step_7_automated_export_runtime_artifacts: 'npm run step_7_automated_export_runtime_artifacts',
      step_8_automated_validate_structural: 'npm run step_8_automated_validate_structural',
      step_9_automated_validate_golden_developing: 'npm run step_9_automated_validate_golden_developing',
      step_10_automated_validate_golden_stable: 'npm run step_10_automated_validate_golden_stable',
      bootstrap_build: 'npm run enrich:via-job-title:bootstrap:build',
      bootstrap_evaluate: 'npm run enrich:via-job-title:bootstrap:evaluate',
      sample_review_csv: 'npm run semantic:bootstrap:matches'
    },
    operator_docs: {
      workflow_help: `${docsBase}/LLM_JOB_TITLE_TRIAGE_HANDOFF.md`,
      prompt_contract: `${docsBase}/LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md`,
      runbook: `${docsBase}/LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md`
    }
  };
}

main().catch((error) => {
  console.error('LLM review bundle preparation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
