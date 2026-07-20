import { withConnection } from '../db/mysql.js';
import { OccupationGraphBuilder } from '../graph/occupation/build-occupation-graph.js';

type CliOptions = {
  sourceName?: string;
  locales?: string[];
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  await withConnection(async (connection) => {
    const builder = new OccupationGraphBuilder(connection);
    await builder.run({
      sourceName: options.sourceName,
      locales: options.locales
    });
  });

  const localeSummary = options.locales && options.locales.length > 0 ? options.locales.join(', ') : 'all available locales';
  const sourceSummary = options.sourceName?.trim() || 'esco_1_2_1';
  console.log(`Occupation graph build completed for source "${sourceSummary}" and ${localeSummary}.`);
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

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log('Usage: node dist/cli/build-occupation-graph.js [--source-name=esco_1_2_1] [--locales=en,ro]');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation graph build failed.');
  console.error(message);
  process.exitCode = 1;
});
