import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { parse } from 'csv-parse';
import { classifyOccupationTitle, type RuntimeResult, type SupportedQueryLocale } from '../occupation-classifier/index.js';
import { DEFAULT_CLASSIFIER_SOURCE_NAME } from '../occupation-classifier/constants.js';
import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';

type CliOptions = {
  inputPath: string;
  outputPath: string | null;
  locale: SupportedQueryLocale;
  sourceName: string;
  titleColumn: string;
  offset: number;
  limit: number | null;
};

type CsvRow = Record<string, string>;

const OUTPUT_COLUMNS = ['job_title', 'decision', 'reason', 'confidence', 'top_leaf', 'top_family'];
const ROW_BATCH_SIZE = 32;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro'],
    leafStructureRuntime: true
  });

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
        await writeBatch(batch, writer, options, runtime);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await writeBatch(batch, writer, options, runtime);
    }
  } finally {
    if (outputStream) {
      outputStream.end();
      await once(outputStream, 'finish');
    }
  }

  if (options.outputPath) {
    console.log(`Wrote occupation classifier comparison to ${path.resolve(options.outputPath)}`);
  }
}

async function writeBatch(
  rows: CsvRow[],
  writer: NodeJS.WritableStream,
  options: CliOptions,
  runtime: OccupationRuntimeContext
): Promise<void> {
  const lines = rows.map((row) => {
    const title = String(row[options.titleColumn] ?? '').trim();

    if (!title) {
      return Promise.resolve(
        csvRowToLine({
          job_title: '',
          decision: '',
          reason: '',
          confidence: '',
          top_leaf: '',
          top_family: ''
        })
      );
    }

    return classifyOccupationTitle({
      query: title,
      locale: options.locale,
      sourceName: options.sourceName,
      runtime
    })
      .then((result) => {
        return csvRowToLine({
          job_title: title,
          decision: result.decision.type,
          reason: result.decision.reason,
          confidence: result.decision.confidence.toFixed(2),
          top_leaf: topLeafColumn(result),
          top_family: topFamilyColumn(result)
        });
      })
      .catch(() => '');
  });

  const renderedLines = await Promise.all(lines);
  await writeCsvLine(writer, renderedLines.join(''));
}

function topLeafColumn(result: RuntimeResult): string {
  return result.spans ? result.spans.map((span) => span.result.leaf?.canonicalLabel ?? '').join('|') : (result.leaf?.canonicalLabel ?? '');
}

function topFamilyColumn(result: RuntimeResult): string {
  return result.spans ? result.spans.map((span) => span.result.family?.familyLabel ?? '').join('|') : (result.family?.familyLabel ?? '');
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
    locale: DEFAULT_RETRIEVAL_LOCALE as SupportedQueryLocale,
    sourceName: DEFAULT_CLASSIFIER_SOURCE_NAME,
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
      options.locale = parseLocale(arg.slice('--locale='.length).trim());
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

function parseLocale(value: string): SupportedQueryLocale {
  if (value === 'en' || value === 'ro' || value === 'hu' || value === 'et' || value === 'unknown') {
    return value;
  }

  throw new Error(`Unsupported locale "${value}".`);
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
      'Usage: node dist/cli/report-occupation-classifier-comparison.js',
      '  --input=/path/to/file.csv',
      '  [--output=/path/to/output.csv]',
      `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `  [--source-name=${DEFAULT_CLASSIFIER_SOURCE_NAME}]`,
      '  [--title-column=job_title]',
      '  [--offset=0]',
      '  [--limit=N]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation classifier comparison failed.');
  console.error(message);
  process.exitCode = 1;
});
