import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_INPUT_BY_LOCALE = {
  ro: '/Users/otobio/Downloads/ejobs_job_titles.csv',
  hu: '/Users/otobio/Downloads/profession_job_titles_01.csv'
};
const DEFAULT_TITLE_COLUMN_BY_LOCALE = {
  ro: 'job_title',
  hu: 'job_title'
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const paths = buildPaths(options.locale);

  runNpmScript('enrich:via-job-title:resolution:chunks', [
    `--locale=${options.locale}`,
    `--sample=${options.sampleSize}`,
    `--seed=${options.seed}`,
    `--input=${options.inputPath}`,
    `--title-column=${options.titleColumn}`,
    `--out=${paths.pilotJsonl}`,
    `--manifest=${paths.pilotManifest}`,
    `--chunk-size=${options.chunkSize}`,
    ...optionalFlag('--offset', options.offset),
    ...optionalFlag('--limit', options.limit)
  ]);

  runNpmScript('enrich:via-job-title:query', [
    `--input=${paths.pilotJsonl}`,
    `--out-tsv=${paths.briefTsv}`,
    `--out-columns=${paths.briefColumns}`,
    `--manifest=${paths.briefManifest}`
  ]);

  runNpmScript('enrich:via-job-title:batches', [
    `--input=${paths.briefTsv}`,
    `--out-dir=${paths.batchDir}`,
    `--manifest=${paths.batchManifest}`,
    `--batch-size=${options.batchSize}`
  ]);

  runNpmScript('enrich:via-job-title:bundle', [`--locale=${options.locale}`, `--out=${paths.bundleJson}`]);

  console.log('Prepared locale-specific job-title enrichment review surface.');
  console.log(`locale=${options.locale}`);
  console.log(`pilot_jsonl=${paths.pilotJsonl}`);
  console.log(`pilot_manifest=${paths.pilotManifest}`);
  console.log(`brief_tsv=${paths.briefTsv}`);
  console.log(`brief_columns=${paths.briefColumns}`);
  console.log(`brief_manifest=${paths.briefManifest}`);
  console.log(`batch_dir=${paths.batchDir}`);
  console.log(`batch_manifest=${paths.batchManifest}`);
  console.log(`bundle_json=${paths.bundleJson}`);
  console.log(`reviewed_batches_dir=${paths.reviewedBatchesDir}`);
  console.log(`reviewed_jsonl=${paths.reviewedJsonl}`);
  console.log(`aggregate_json=${paths.proposalsJson}`);
  console.log(`aggregate_csv=${paths.proposalsCsv}`);
  console.log(`next_manual=Open ${paths.bundleJson} and ${path.join('docs', 'LLM_JOB_TITLE_TRIAGE_OPERATOR_RUNBOOK.md')}`);
  console.log(`next_direct=npm run enrich:via-job-title:review:direct -- --locale=${options.locale} --start-batch=1 --end-batch=10`);
  console.log(
    `next_aggregate=npm run enrich:via-job-title:aggregate -- --input=${paths.reviewedJsonl} --out-json=${paths.proposalsJson} --out-csv=${paths.proposalsCsv}`
  );
}

function parseCliOptions(args) {
  const options = {
    locale: 'ro',
    sampleSize: 'all',
    seed: 'job-title-enrichment',
    inputPath: '',
    titleColumn: '',
    offset: null,
    limit: null,
    chunkSize: 1000,
    batchSize: 25
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }
    if (arg.startsWith('--sample=')) {
      const value = arg.slice('--sample='.length).trim();
      options.sampleSize = value.toLowerCase() === 'all' ? 'all' : positiveInteger(value, '--sample');
      continue;
    }
    if (arg.startsWith('--seed=')) {
      options.seed = arg.slice('--seed='.length).trim();
      continue;
    }
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
      continue;
    }
    if (arg.startsWith('--title-column=')) {
      options.titleColumn = arg.slice('--title-column='.length).trim();
      continue;
    }
    if (arg.startsWith('--offset=')) {
      options.offset = nonNegativeInteger(arg.slice('--offset='.length), '--offset');
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = positiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = positiveInteger(arg.slice('--batch-size='.length), '--batch-size');
      continue;
    }
    if (arg.startsWith('--chunk-size=')) {
      options.chunkSize = positiveInteger(arg.slice('--chunk-size='.length), '--chunk-size');
      continue;
    }
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.inputPath ||= DEFAULT_INPUT_BY_LOCALE[options.locale] || DEFAULT_INPUT_BY_LOCALE.ro;
  options.titleColumn ||= DEFAULT_TITLE_COLUMN_BY_LOCALE[options.locale] || DEFAULT_TITLE_COLUMN_BY_LOCALE.ro;
  options.seed = `${options.seed}-${options.locale}`;

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/run-job-title-enrichment-prepare.js',
      '[--locale=hu]',
      '[--sample=all]',
      '[--input=/path/to/job_titles.csv]',
      '[--title-column=job_title]',
      '[--offset=0]',
      '[--limit=1000]',
      '[--chunk-size=1000]',
      '[--batch-size=25]',
      '[--seed=job-title-enrichment]'
    ].join(' ')
  );
}

function buildPaths(locale) {
  const base = path.join(ROOT, 'data', 'taxonomy-review');

  return {
    pilotJsonl: path.join(base, `job-title-triage-pilot.${locale}.jsonl`),
    pilotManifest: path.join(base, `job-title-triage-pilot.${locale}.manifest.json`),
    briefTsv: path.join(base, `job-title-triage-brief.${locale}.tsv`),
    briefColumns: path.join(base, 'job-title-triage-brief.columns.json'),
    briefManifest: path.join(base, `job-title-triage-brief.${locale}.manifest.json`),
    batchDir: path.join(base, `job-title-triage-batches.${locale}`),
    batchManifest: path.join(base, `job-title-triage-batches.${locale}.manifest.json`),
    bundleJson: path.join(base, `job-title-triage-review-bundle.${locale}.json`),
    reviewedBatchesDir: path.join(base, `job-title-triage-reviewed.${locale}.batches`),
    reviewedJsonl: path.join(base, `job-title-triage-reviewed.${locale}.jsonl`),
    proposalsJson: path.join(base, `job-title-triage-proposals.${locale}.json`),
    proposalsCsv: path.join(base, `job-title-triage-proposals.${locale}.csv`)
  };
}

function optionalFlag(flagName, value) {
  return value === null ? [] : [`${flagName}=${value}`];
}

function positiveInteger(rawValue, flagName) {
  const value = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer. Received "${rawValue}".`);
  }
  return value;
}

function nonNegativeInteger(rawValue, flagName) {
  const value = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative integer. Received "${rawValue}".`);
  }
  return value;
}

function runNpmScript(scriptName, extraArgs) {
  execFileSync('npm', ['run', scriptName, '--', ...extraArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
}

main().catch((error) => {
  console.error('Locale-specific job-title enrichment preparation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
