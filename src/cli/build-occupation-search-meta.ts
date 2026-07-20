import { withConnection } from '../db/mysql.js';
import { OccupationSearchMetaBuilder } from '../search-meta/occupation/build-occupation-search-meta.js';

type CliOptions = {
  sourceName?: string;
  locales?: string[];
  skipReset?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  await withConnection(async (connection) => {
    const builder = new OccupationSearchMetaBuilder(connection);
    await builder.run({
      sourceName: options.sourceName,
      locales: options.locales,
      skipReset: options.skipReset
    });
  });

  const localeSummary = options.locales && options.locales.length > 0 ? options.locales.join(', ') : 'all active alias locales';
  const sourceSummary = options.sourceName?.trim() || 'esco_1_2_1';
  const resetSummary = options.skipReset ? 'without reset' : 'with scoped reset';
  console.log(`Occupation search meta build completed for source "${sourceSummary}", ${localeSummary}, ${resetSummary}.`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--locales=')) {
      options.locales = arg
        .slice('--locales='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === '--skip-reset') {
      options.skipReset = true;
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

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/build-occupation-search-meta.js [--source-name=esco_1_2_1] [--locales=en,ro --skip-reset]',
      '',
      'Safety:',
      '  Rebuilding selected locales with reset is refused because occupation search meta is per graph node.',
      '  Use no --locales for a full safe rebuild, or combine --locales with --skip-reset for diagnostics.'
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation search meta build failed.');
  console.error(message);
  process.exitCode = 1;
});
