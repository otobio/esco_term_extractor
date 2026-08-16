import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';

type CliOptions = {
  inputPath: string;
  outputPath: string | null;
  locale: string;
  titleColumn: string;
};

type CsvRow = Record<string, string>;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const csvText = await readFile(options.inputPath, 'utf8');
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true
  }) as CsvRow[];

  const outputRows = await Promise.all(
    rows.map(async (row) => {
      const title = String(row[options.titleColumn] ?? '').trim();
      const cleaned = title ? await cleanTitle(title, options) : '';

      return {
        job_title: title,
        known_tokens: cleaned
      };
    })
  );

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
    locale: DEFAULT_RETRIEVAL_LOCALE,
    titleColumn: 'job_title',
    outputPath: null
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

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--title-column=')) {
      options.titleColumn = arg.slice('--title-column='.length).trim();
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

async function cleanTitle(title: string, options: CliOptions): Promise<string> {
  return cleanOccupationQuerySurface(title, options.locale);
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/report-occupation-known-tokens.js',
      '  --input=/path/to/file.csv',
      '  [--output=/path/to/output.csv]',
      `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      '  [--title-column=job_title]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation known-token report failed.');
  console.error(message);
  process.exitCode = 1;
});
