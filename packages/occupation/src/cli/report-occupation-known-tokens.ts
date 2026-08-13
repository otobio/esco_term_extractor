import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationTitleSignals } from '../query/occupation-signal-oov-cleaner.js';
import { peelOccupationTitleNoise } from '../query/occupation-noise-peeling.js';

type NoiseKind = 'oov' | 'peeler' | 'oov_peeler';

type CliOptions = {
  inputPath: string;
  outputPath: string | null;
  sourceName: string;
  locale: string;
  titleColumn: string;
  noiseKind: NoiseKind;
};

type CsvRow = Record<string, string>;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const csvText = await readFile(options.inputPath, 'utf8');
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true
  }) as CsvRow[];

  const outputRows = await Promise.all(rows.map(async (row) => {
    const title = String(row[options.titleColumn] ?? '').trim();
    const cleaned = title ? await cleanTitle(title, options) : '';

    return {
      job_title: title,
      known_tokens: cleaned
    };
  }));

  const output = toCsv(outputRows, ['job_title', 'known_tokens']);

  if (options.outputPath) {
    await writeFile(options.outputPath, output, 'utf8');
    console.log(`Wrote known-token report to ${path.resolve(options.outputPath)}`);
    return;
  }

  process.stdout.write(output);
}

function toCsv(rows: Array<Record<string, string>>, columns: string[]): string {
  const lines = [columns.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(row[column] ?? '')).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/gu, ' ').trim();
  return `"${normalized.replace(/"/gu, '""')}"`;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    locale: DEFAULT_RETRIEVAL_LOCALE,
    titleColumn: 'job_title',
    outputPath: null,
    noiseKind: 'oov'
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length).trim();
      continue;
    }

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--title-column=')) {
      options.titleColumn = arg.slice('--title-column='.length).trim();
      continue;
    }

    if (arg.startsWith('--noise-kind=')) {
      options.noiseKind = parseNoiseKind(arg.slice('--noise-kind='.length));
      continue;
    }

    if (arg.startsWith('--noise_kind=')) {
      options.noiseKind = parseNoiseKind(arg.slice('--noise_kind='.length));
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.inputPath) {
    throw new Error('Provide --input=/path/to/file.csv.');
  }

  return options as CliOptions;
}

function parseNoiseKind(value: string): NoiseKind {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'oov' || normalized === 'peeler' || normalized === 'oov_peeler') {
    return normalized;
  }

  throw new Error(`Unsupported noise kind "${value}". Use --noise-kind=oov|peeler|oov_peeler.`);
}

async function cleanTitle(title: string, options: CliOptions): Promise<string> {
  if (options.noiseKind === 'peeler') {
    return peelOccupationTitleNoise(title, options.locale);
  }

  if (options.noiseKind === 'oov_peeler') {
    const peeled = peelOccupationTitleNoise(title, options.locale);
    return peeled
      ? cleanOccupationTitleSignals({
          sourceName: options.sourceName,
          locale: options.locale,
          title: peeled
        })
      : '';
  }

  return cleanOccupationTitleSignals({
    sourceName: options.sourceName,
    locale: options.locale,
    title
  });
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/report-occupation-known-tokens.js',
      '  --input=/path/to/file.csv',
      '  [--output=/path/to/output.csv]',
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      '  [--title-column=job_title]',
      '  [--noise-kind=oov|peeler|oov_peeler]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation known-token report failed.');
  console.error(message);
  process.exitCode = 1;
});
