import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const lines = readFileSync(options.inputPath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);

  if (lines.length <= 1) {
    throw new Error(`Expected TSV with header and rows at ${options.inputPath}`);
  }

  const header = lines[0];
  const rows = lines.slice(1);
  mkdirSync(options.outDir, { recursive: true });
  const manifest = {
    input_path: options.inputPath,
    out_dir: options.outDir,
    batch_size: options.batchSize,
    row_count: rows.length,
    batch_count: 0,
    files: []
  };

  for (let offset = 0; offset < rows.length; offset += options.batchSize) {
    const batchRows = rows.slice(offset, offset + options.batchSize);
    const batchIndex = Math.floor(offset / options.batchSize) + 1;
    const fileName = `job-title-triage-batch.${String(batchIndex).padStart(4, '0')}.tsv`;
    const filePath = path.join(options.outDir, fileName);
    writeFileSync(filePath, `${header}\n${batchRows.join('\n')}\n`, 'utf8');
    manifest.files.push({
      batch_index: batchIndex,
      file: filePath,
      row_start: offset + 1,
      row_end: offset + batchRows.length,
      row_count: batchRows.length
    });
  }

  manifest.batch_count = manifest.files.length;
  writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    [
      `rows=${manifest.row_count}`,
      `batch_size=${manifest.batch_size}`,
      `batch_count=${manifest.batch_count}`,
      `out_dir=${manifest.out_dir}`,
      `manifest=${options.manifestPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    inputPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-brief.ro.tsv'),
    outDir: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-batches.ro'),
    manifestPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-batches.ro.manifest.json'),
    batchSize: 25
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length).trim();
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length).trim();
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = Number.parseInt(arg.slice('--batch-size='.length).trim(), 10);
      continue;
    }
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error(`--batch-size must be a positive integer. Received "${options.batchSize}".`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/split-llm-job-title-review-tsv.js',
      '[--input=data/taxonomy-review/job-title-triage-brief.ro.tsv]',
      '[--out-dir=data/taxonomy-review/job-title-triage-batches.ro]',
      '[--manifest=data/taxonomy-review/job-title-triage-batches.ro.manifest.json]',
      '[--batch-size=25]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error('LLM review TSV split failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
