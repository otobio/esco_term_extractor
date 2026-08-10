import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

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

  if (options.sampleSize !== 'all') {
    runPilotBuild({
      locale: options.locale,
      inputPath: options.inputPath,
      titleColumn: options.titleColumn,
      sampleSize: options.sampleSize,
      seed: options.seed,
      outPath: options.outPath,
      manifestPath: options.manifestPath,
      offset: options.offset,
      limit: options.limit
    });
    return;
  }

  const totalTitles = countTitles(options.inputPath, options.titleColumn);
  const startOffset = options.offset;
  const maxAvailable = Math.max(0, totalTitles - startOffset);
  const totalToProcess = options.limit === null ? maxAvailable : Math.min(options.limit, maxAvailable);

  if (totalToProcess <= 0) {
    throw new Error(`No titles available for locale=${options.locale} after offset=${options.offset} limit=${options.limit ?? 'all'}.`);
  }

  mkdirSync(options.chunkDir, { recursive: true });
  if (options.clearChunks) {
    rmSync(options.chunkDir, { recursive: true, force: true });
    mkdirSync(options.chunkDir, { recursive: true });
  }

  const chunkCount = Math.ceil(totalToProcess / options.chunkSize);

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkOffset = startOffset + chunkIndex * options.chunkSize;
    const chunkLimit = Math.min(options.chunkSize, totalToProcess - chunkIndex * options.chunkSize);
    const chunkNumber = String(chunkIndex + 1).padStart(4, '0');
    const chunkOutPath = path.join(options.chunkDir, `job-title-triage-pilot.${options.locale}.chunk.${chunkNumber}.jsonl`);
    const chunkManifestPath = path.join(options.chunkDir, `job-title-triage-pilot.${options.locale}.chunk.${chunkNumber}.manifest.json`);

    runPilotBuild({
      locale: options.locale,
      inputPath: options.inputPath,
      titleColumn: options.titleColumn,
      sampleSize: 'all',
      seed: `${options.seed}-chunk-${chunkNumber}`,
      outPath: chunkOutPath,
      manifestPath: chunkManifestPath,
      offset: chunkOffset,
      limit: chunkLimit
    });
  }

  execFileSync(
    'node',
    [
      'scripts/merge-llm-job-title-triage-pilot-chunks.js',
      `--input-dir=${options.chunkDir}`,
      `--out=${options.outPath}`,
      `--manifest=${options.manifestPath}`
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env
    }
  );

  console.log(
    [
      `chunk_size=${options.chunkSize}`,
      `chunk_count=${chunkCount}`,
      `chunk_dir=${options.chunkDir}`,
      `merged_out=${options.outPath}`,
      `merged_manifest=${options.manifestPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    locale: 'ro',
    sampleSize: 'all',
    seed: 'job-title-enrichment',
    inputPath: '',
    titleColumn: '',
    offset: 0,
    limit: null,
    chunkSize: 1000,
    outPath: '',
    manifestPath: '',
    chunkDir: '',
    clearChunks: false
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
    if (arg.startsWith('--chunk-size=')) {
      options.chunkSize = positiveInteger(arg.slice('--chunk-size='.length), '--chunk-size');
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.outPath = resolveCliPath(arg.slice('--out='.length));
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = resolveCliPath(arg.slice('--manifest='.length));
      continue;
    }
    if (arg.startsWith('--chunk-dir=')) {
      options.chunkDir = resolveCliPath(arg.slice('--chunk-dir='.length));
      continue;
    }
    if (arg === '--clear-chunks') {
      options.clearChunks = true;
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
  options.outPath ||= path.join(ROOT, 'data', 'taxonomy-review', `job-title-triage-pilot.${options.locale}.jsonl`);
  options.manifestPath ||= path.join(ROOT, 'data', 'taxonomy-review', `job-title-triage-pilot.${options.locale}.manifest.json`);
  options.chunkDir ||= defaultChunkDirForOutPath(options.outPath);
  options.seed = `${options.seed}-${options.locale}`;

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/run-job-title-enrichment-resolution-chunks.js',
      '[--locale=hu]',
      '[--sample=all]',
      '[--input=/path/to/job_titles.csv]',
      '[--title-column=job_title]',
      '[--offset=0]',
      '[--limit=10000]',
      '[--chunk-size=1000]',
      '[--chunk-dir=data/taxonomy-review/job-title-triage-pilot.hu.chunks]',
      '[--out=data/taxonomy-review/job-title-triage-pilot.hu.jsonl]',
      '[--manifest=data/taxonomy-review/job-title-triage-pilot.hu.manifest.json]',
      '[--clear-chunks]'
    ].join(' ')
  );
}

function countTitles(inputPath, titleColumn) {
  const rows = parse(readFileSync(inputPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  let count = 0;
  for (const row of rows) {
    const title = String(row?.[titleColumn] ?? '').trim();
    if (title.length > 0) {
      count += 1;
    }
  }

  return count;
}

function defaultChunkDirForOutPath(outPath) {
  const parsed = path.parse(outPath);
  return path.join(parsed.dir, `${parsed.name}.chunks`);
}

function runPilotBuild({ locale, inputPath, titleColumn, sampleSize, seed, outPath, manifestPath, offset, limit }) {
  const args = [
    'run',
    'enrich:via-job-title:resolution',
    '--',
    `--locale=${locale}`,
    `--sample=${sampleSize}`,
    `--seed=${seed}`,
    `--input=${inputPath}`,
    `--title-column=${titleColumn}`,
    `--out=${outPath}`,
    `--manifest=${manifestPath}`,
    `--offset=${offset}`
  ];

  if (limit !== null) {
    args.push(`--limit=${limit}`);
  }

  execFileSync('npm', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
}

function resolveCliPath(value) {
  const trimmed = value.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.join(ROOT, trimmed);
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

main().catch((error) => {
  console.error('Chunked job-title enrichment replay failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
