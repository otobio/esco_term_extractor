import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
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
const ROW_BATCH_SIZE = 32;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const inputStream = createReadStream(options.inputPath, { encoding: 'utf8' });
  const parser = inputStream.pipe(
    parse({
      bom: true,
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true
    })
  ) as AsyncIterable<CsvRow>;
  const outputStream = options.outputPath ? createWriteStream(options.outputPath, { encoding: 'utf8' }) : null;
  const writer = outputStream ?? process.stdout;

  try {
    await writeCsvLine(writer, csvHeaderLine(OUTPUT_COLUMNS));

    let skippedRows = 0;
    let emittedRows = 0;
    let batch: CsvRow[] = [];

    for await (const row of parser) {
      if (skippedRows < options.offset) {
        skippedRows++;
        continue;
      }

      if (options.limit !== null && emittedRows >= options.limit) {
        break;
      }

      batch.push(row);
      emittedRows++;

      if (batch.length >= ROW_BATCH_SIZE) {
        await writeBatch(batch, writer, options);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await writeBatch(batch, writer, options);
    }
  } finally {
    if (outputStream) {
      outputStream.end();
      await once(outputStream, 'finish');
    }
  }

  if (options.outputPath) {
    console.log(`Wrote occupation pipeline comparison to ${path.resolve(options.outputPath)}`);
  }
}

async function writeBatch(rows: CsvRow[], writer: NodeJS.WritableStream, options: CliOptions): Promise<void> {
  const lines = rows.map((row) => {
    const title = String(row[options.titleColumn] ?? '').trim();

    if (!title) {
      return csvRowToLine({
        job_title: '',
        selected: '',
        top_leaf: '',
        top_family: ''
      });
    }

    return getCanonicalTerm({
      input: title,
      locale: options.locale,
      sourceName: options.sourceName
    } as GetCanonicalTermOptions)
      .then((result) => {
        const context = result.occupationContexts[0] ?? null;
        const decisionType = context?.decision.decisionType ?? 'unresolved';
        const selected = decisionType !== 'unresolved' && decisionType !== 'multi_span';
        const topLeaf = context?.selectedLeafTerm?.canonicalTerm ?? context?.altLeafCanonicalTerms[0]?.canonicalTerm ?? '';
        const topFamily = context?.selectedFamilyTerm?.canonicalTerm ?? context?.altFamilyCanonicalTerms[0]?.canonicalTerm ?? '';

        return csvRowToLine({
          job_title: title,
          selected: selected ? 'yes' : 'no',
          top_leaf: topLeaf,
          top_family: topFamily
        });
      })
      .catch((e) => {
        return '';
      });
  });

  const renderedLines = await Promise.all(lines);
  await writeCsvLine(writer, `${renderedLines.join('\n')}\n`);
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/gu, ' ').trim();
  return `"${normalized.replace(/"/gu, '""')}"`;
}

function csvHeaderLine(columns: string[]): string {
  return `${columns.map(escapeCsvCell).join(',')}\n`;
}

function csvRowToLine(row: Record<string, string>): string {
  return `${OUTPUT_COLUMNS.map((column) => escapeCsvCell(row[column] ?? '')).join(',')}\n`;
}

async function writeCsvLine(writer: NodeJS.WritableStream, line: string): Promise<void> {
  if (!writer.write(line)) {
    await once(writer, 'drain');
  }
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
