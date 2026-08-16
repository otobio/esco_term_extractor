import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { parse } from 'csv-parse';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { getCanonicalTerm, type GetCanonicalTermOptions } from '../api/canonical-term.js';

type CliOptions = {
  inputPath: string;
  outputPath: string | null;
  locale: string;
  sourceName: string;
  titleColumn: string;
  offset: number;
  limit: number | null;
};

type CsvRow = Record<string, string>;

const OUTPUT_COLUMNS = ['job_title', 'selected', 'top_leaf', 'top_family'];
const DEFAULT_BATCH_SIZE = 8;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const outputStream = options.outputPath ? createWriteStream(options.outputPath, { encoding: 'utf8' }) : process.stdout;

  writeCsvLine(outputStream, OUTPUT_COLUMNS);

  const parser = createReadStream(options.inputPath, { encoding: 'utf8' }).pipe(
    parse({
      columns: true,
      skip_empty_lines: true
    })
  );
  let seen = 0;
  let emitted = 0;
  let batch: CsvRow[] = [];

  for await (const row of parser) {
    if (seen < options.offset) {
      seen += 1;
      continue;
    }

    if (options.limit !== null && emitted >= options.limit) {
      break;
    }

    batch.push(row as CsvRow);
    seen += 1;
    emitted += 1;

    if (batch.length >= DEFAULT_BATCH_SIZE) {
      await writeBatch(outputStream, batch, options);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await writeBatch(outputStream, batch, options);
  }

  if (options.outputPath) {
    outputStream.end();
    await once(outputStream, 'finish');
    console.log(`Wrote occupation pipeline comparison to ${path.resolve(options.outputPath)}`);
  }
}

async function writeBatch(output: NodeJS.WritableStream, rows: CsvRow[], options: CliOptions): Promise<void> {
  const outputRows = await Promise.all(rows.map((row) => evaluateRow(row, options)));

  for (const row of outputRows) {
    writeCsvLine(
      output,
      OUTPUT_COLUMNS.map((column) => row[column] ?? '')
    );
  }
}

async function evaluateRow(row: CsvRow, options: CliOptions): Promise<Record<string, string>> {
  const title = String(row[options.titleColumn] ?? '').trim();

  if (!title) {
    return {
      job_title: '',
      selected: '',
      top_leaf: '',
      top_family: ''
    };
  }

  const result = await getCanonicalTerm({
    input: title,
    locale: options.locale,
    sourceName: options.sourceName
  } as GetCanonicalTermOptions);
  const context = result.occupationContexts[0] ?? null;
  const decisionType = context?.decision.decisionType ?? 'unresolved';
  const selected = decisionType !== 'unresolved' && decisionType !== 'multi_span';
  const topLeaf = context?.selectedLeafTerm?.canonicalTerm ?? context?.altLeafCanonicalTerms[0]?.canonicalTerm ?? '';
  const topFamily = context?.selectedFamilyTerm?.canonicalTerm ?? context?.altFamilyCanonicalTerms[0]?.canonicalTerm ?? '';

  return {
    job_title: title,
    selected: selected ? 'yes' : 'no',
    top_leaf: topLeaf,
    top_family: topFamily
  };
}

function writeCsvLine(output: NodeJS.WritableStream, values: string[]): void {
  output.write(`${values.map(escapeCsvCell).join(',')}\n`);
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/gu, ' ').trim();
  return `"${normalized.replace(/"/gu, '""')}"`;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    titleColumn: 'job_title',
    outputPath: null,
    offset: 0,
    limit: null
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

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--title-column=')) {
      options.titleColumn = arg.slice('--title-column='.length).trim();
      continue;
    }

    if (arg.startsWith('--offset=')) {
      options.offset = parseNonNegativeInteger(arg.slice('--offset='.length).trim(), '--offset');
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parseNonNegativeInteger(arg.slice('--limit='.length).trim(), '--limit');
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

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/report-occupation-pipeline-comparison.js',
      '  --input=/path/to/file.csv',
      '  [--output=/path/to/output.csv]',
      `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '  [--title-column=job_title]',
      '  [--offset=0]',
      '  [--limit=N]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation pipeline comparison failed.');
  console.error(message);
  process.exitCode = 1;
});
