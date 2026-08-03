import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const files = readdirSync(options.inputDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No chunk JSONL files found in ${options.inputDir}`);
  }

  const rows = [];
  for (const file of files) {
    const text = readFileSync(path.join(options.inputDir, file), 'utf8');
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      rows.push(JSON.parse(line));
    }
  }

  const manifestFiles = readdirSync(options.inputDir)
    .filter((file) => file.endsWith('.manifest.json'))
    .sort((left, right) => left.localeCompare(right));
  const manifests = manifestFiles.map((file) => JSON.parse(readFileSync(path.join(options.inputDir, file), 'utf8')));

  const mergedManifest = {
    locale: manifests[0]?.locale ?? 'unknown',
    source_name: manifests[0]?.source_name ?? 'unknown',
    chunk_count: files.length,
    source_title_count: manifests[0]?.source_title_count ?? rows.length,
    records: rows.length,
    noise_only: sum(manifests, 'noise_only'),
    unresolved: sum(manifests, 'unresolved'),
    family_or_group: sum(manifests, 'family_or_group'),
    leaf: sum(manifests, 'leaf'),
    multi_span: sum(manifests, 'multi_span'),
    chunks: manifests.map((manifest) => ({
      offset: manifest.offset ?? 0,
      limit: manifest.limit ?? null,
      records: manifest.records ?? 0
    }))
  };

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(options.manifestPath, `${JSON.stringify(mergedManifest, null, 2)}\n`, 'utf8');

  console.log(
    [
      `chunks=${files.length}`,
      `records=${mergedManifest.records}`,
      `leaf=${mergedManifest.leaf}`,
      `family_or_group=${mergedManifest.family_or_group}`,
      `multi_span=${mergedManifest.multi_span}`,
      `unresolved=${mergedManifest.unresolved}`,
      `noise_only=${mergedManifest.noise_only}`,
      `out=${options.outPath}`,
      `manifest=${options.manifestPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    inputDir: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-pilot.ro.all.chunks'),
    outPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-pilot.ro.all.jsonl'),
    manifestPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-pilot.ro.all.manifest.json')
  };

  for (const arg of args) {
    if (arg.startsWith('--input-dir=')) {
      options.inputDir = arg.slice('--input-dir='.length).trim();
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim();
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length).trim();
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
      'Usage: node scripts/merge-llm-job-title-triage-pilot-chunks.js',
      '[--input-dir=data/taxonomy-review/job-title-triage-pilot.ro.all.chunks]',
      '[--out=data/taxonomy-review/job-title-triage-pilot.ro.all.jsonl]',
      '[--manifest=data/taxonomy-review/job-title-triage-pilot.ro.all.manifest.json]'
    ].join(' ')
  );
}

function sum(items, key) {
  return items.reduce((total, item) => total + (typeof item?.[key] === 'number' ? item[key] : 0), 0);
}

main().catch((error) => {
  console.error('LLM triage pilot chunk merge failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
