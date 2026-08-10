import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  annotateChunkCandidateStats,
  aggregateChunkFacts,
  chunkAnnotationsToCsvRows,
  chunkFactsToCsvRows,
  chunkStatsToCsvRows,
  discoverRawTitleChunkFacts,
  selectMonitorChunkAnnotations
} from '../enrichment/title-chunk-discovery.js';
import { normalizeQueryLocale } from '../query/query-preparation.js';
import { parseCsvRecords } from '../utils/csv/parse-csv.js';

type CliOptions = {
  locale: string;
  inputPath: string;
  titleColumn: string;
  outDir: string;
  maxChunkTokens: number;
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const locale = normalizeQueryLocale(options.locale);
  if (locale === 'unknown') {
    throw new Error(`Unsupported locale: ${options.locale}`);
  }

  const csvText = await readFile(options.inputPath, 'utf8');
  const records = parseCsvRecords(csvText);
  const rows = records.map((record, index) => {
    const title = String(record[options.titleColumn] ?? '').trim();
    if (!title) {
      return null;
    }

    return {
      rowIndex: index + 1,
      title
    };
  });

  if (!records.some((record) => Object.prototype.hasOwnProperty.call(record, options.titleColumn))) {
    throw new Error(`Title column not found: ${options.titleColumn}`);
  }

  const sourceRows = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  const facts = await discoverRawTitleChunkFacts(sourceRows, { locale, maxChunkTokens: options.maxChunkTokens });
  const stats = aggregateChunkFacts(facts);
  const annotations = annotateChunkCandidateStats(stats, { locale });
  const monitorAnnotations = selectMonitorChunkAnnotations(annotations);

  const factsPath = path.join(options.outDir, `title-chunk-facts.${locale}.csv`);
  const statsPath = path.join(options.outDir, `chunk-candidate-stats.${locale}.csv`);
  const annotationsPath = path.join(options.outDir, `chunk-candidate-annotations.${locale}.csv`);
  const monitorPath = path.join(options.outDir, `chunk-candidate-monitor.${locale}.csv`);

  await mkdir(options.outDir, { recursive: true });
  await writeFile(factsPath, rowsToCsv(chunkFactsToCsvRows(facts)), 'utf8');
  await writeFile(statsPath, rowsToCsv(chunkStatsToCsvRows(stats)), 'utf8');
  await writeFile(annotationsPath, rowsToCsv(chunkAnnotationsToCsvRows(annotations)), 'utf8');
  await writeFile(monitorPath, rowsToCsv(chunkAnnotationsToCsvRows(monitorAnnotations)), 'utf8');

  console.log(
    [
      `locale=${locale}`,
      `source_rows=${sourceRows.length}`,
      `facts=${facts.length}`,
      `candidates=${stats.length}`,
      `annotations=${annotations.length}`,
      `monitor=${monitorAnnotations.length}`,
      `out_facts=${factsPath}`,
      `out_stats=${statsPath}`,
      `out_annotations=${annotationsPath}`,
      `out_monitor=${monitorPath}`
    ].join('  ')
  );
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    locale: 'ro',
    inputPath: '',
    titleColumn: 'job_title',
    outDir: path.join(process.cwd(), 'data', 'taxonomy-review'),
    maxChunkTokens: 5
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
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
    if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length).trim();
      continue;
    }
    if (arg.startsWith('--max-chunk-tokens=')) {
      options.maxChunkTokens = Number(arg.slice('--max-chunk-tokens='.length).trim()) || options.maxChunkTokens;
      continue;
    }
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.inputPath) {
    throw new Error('Missing required argument: --input=/path/to/job_titles.csv');
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node dist/cli/build-raw-title-chunk-discovery.js',
      '--locale=ro',
      '--input=/path/to/job_titles.csv',
      '[--title-column=job_title]',
      '[--out-dir=data/taxonomy-review]',
      '[--max-chunk-tokens=5]'
    ].join(' ')
  );
}

function rowsToCsv(rows: readonly Record<string, string | number | boolean>[]): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))];
  return `${lines.join('\n')}\n`;
}

function csvEscape(value: string | number | boolean | undefined): string {
  const text = String(value ?? '');
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

await main();
