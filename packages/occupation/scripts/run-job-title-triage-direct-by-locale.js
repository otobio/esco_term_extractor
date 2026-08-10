import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const base = path.join(ROOT, 'data', 'taxonomy-review');
  const batchManifest = options.batchManifestPath || path.join(base, `job-title-triage-batches.${options.locale}.manifest.json`);
  const outDir = options.outDir || path.join(base, `job-title-triage-reviewed.${options.locale}.batches`);
  const outPath = options.outPath || path.join(base, `job-title-triage-reviewed.${options.locale}.jsonl`);

  const args = [
    'scripts/run-llm-job-title-triage-direct.js',
    `--batch-manifest=${batchManifest}`,
    `--out-dir=${outDir}`,
    `--out=${outPath}`,
    ...passthroughArgs(options.passthroughArgs)
  ];

  execFileSync('node', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
}

function parseCliOptions(args) {
  const options = {
    locale: 'ro',
    batchManifestPath: '',
    outDir: '',
    outPath: '',
    passthroughArgs: []
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }
    if (arg.startsWith('--batch-manifest=')) {
      options.batchManifestPath = resolveCliPath(arg.slice('--batch-manifest='.length));
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      options.outDir = resolveCliPath(arg.slice('--out-dir='.length));
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.outPath = resolveCliPath(arg.slice('--out='.length));
      continue;
    }
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    options.passthroughArgs.push(arg);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/run-job-title-triage-direct-by-locale.js',
      '[--locale=hu]',
      '[--batch-manifest=data/taxonomy-review/job-title-triage-batches.hu.manifest.json]',
      '[--out-dir=data/taxonomy-review/job-title-triage-reviewed.hu.batches]',
      '[--out=data/taxonomy-review/job-title-triage-reviewed.hu.jsonl]',
      '[--start-batch=1 --end-batch=10]',
      '[--batch-index=1]',
      '[--dry-run]'
    ].join(' ')
  );
}

function resolveCliPath(value) {
  const trimmed = value.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.join(ROOT, trimmed);
}

function passthroughArgs(args) {
  return args.map((arg) => String(arg));
}

main().catch((error) => {
  console.error('Locale-specific direct LLM triage runner failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
