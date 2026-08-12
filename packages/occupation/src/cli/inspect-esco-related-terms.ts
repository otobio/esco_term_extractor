import { giveObjectRelated, giveVerbSynonym } from '../api/esco-related-terms.js';

type CliOptions = {
  sourceName: string;
  locale: string;
  limit: number;
  verb?: string;
  object?: string;
};

const DEFAULT_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_LOCALE = 'en';
const DEFAULT_LIMIT = 20;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.verb && options.object) {
    throw new Error('Use either --verb or --object, not both.');
  }

  if (!options.verb && !options.object) {
    throw new Error('Provide --verb=<value> or --object=<value>.');
  }

  if (options.verb) {
    const rows = await giveVerbSynonym(options.verb, {
      sourceName: options.sourceName,
      locale: options.locale,
      limit: options.limit
    });
    printVerbRows(options, rows);
    return;
  }

  const rows = await giveObjectRelated(options.object ?? '', {
    sourceName: options.sourceName,
    locale: options.locale,
    limit: options.limit
  });
  printObjectRows(options, rows);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_SOURCE_NAME,
    locale: DEFAULT_LOCALE,
    limit: DEFAULT_LIMIT
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length).trim(), 'limit');
      continue;
    }

    if (arg.startsWith('--verb=')) {
      options.verb = arg.slice('--verb='.length).trim();
      continue;
    }

    if (arg.startsWith('--object=')) {
      options.object = arg.slice('--object='.length).trim();
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

function printVerbRows(options: CliOptions, rows: Awaited<ReturnType<typeof giveVerbSynonym>>): void {
  console.log(`verb=${options.verb}  locale=${options.locale}  source=${options.sourceName}  count=${rows.length}`);

  for (const row of rows) {
    console.log(
      [`- ${row.relatedVerb}`, `relationship=${row.relationshipType}`, `direction=${row.direction}`, `evidence=${row.evidenceCount}`].join(
        '  '
      )
    );
  }
}

function printObjectRows(options: CliOptions, rows: Awaited<ReturnType<typeof giveObjectRelated>>): void {
  console.log(`object=${options.object}  locale=${options.locale}  source=${options.sourceName}  count=${rows.length}`);

  for (const row of rows) {
    console.log(
      [
        `- ${row.relatedObject}`,
        `relationship=${row.relationshipType}`,
        `direction=${row.direction}`,
        `evidence=${row.evidenceCount}`
      ].join('  ')
    );
  }
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/inspect-esco-related-terms.js',
      `[--source-name=${DEFAULT_SOURCE_NAME}]`,
      `[--locale=${DEFAULT_LOCALE}]`,
      `[--limit=${DEFAULT_LIMIT}]`,
      '--verb=<term> | --object=<term>'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('ESCO related-term inspect failed.');
  console.error(message);
  process.exitCode = 1;
});
