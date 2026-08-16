import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { prepareQuery } from '../query/query-preparation.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query?: string;
  locale: string;
  sourceName: string;
  format: OutputFormat;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (!options.query?.trim()) {
    throw new Error('Provide --query="...".');
  }

  const cleanedQuery = await cleanOccupationQuerySurface(options.query, options.locale);
  const prepared = await prepareQuery(cleanedQuery || options.query, options.locale, {
    sourceName: options.sourceName
  });
  const roleHeadDecision = prepared.intent.diagnostics.find((entry) => entry.kind === 'role_head') ?? null;

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          query: options.query,
          cleanedQuery,
          prepared
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Occupation query intent: "${options.query}"`);
  console.log(`locale=${prepared.locale}  source=${options.sourceName}`);
  console.log(`cleaned="${cleanedQuery}"`);
  console.log(`normalized="${prepared.normalized}"`);
  console.log(`folded="${prepared.folded}"`);
  console.log(
    [
      `role_heads=${prepared.intent.roleHeadTokens.join(',') || 'none'}`,
      `role_tokens=${prepared.intent.roleTokens.join(',') || 'none'}`,
      `venue=${prepared.intent.venueTokens.join(',') || 'none'}`,
      `domain=${prepared.intent.domainTokens.join(',') || 'none'}`,
      `unresolved=${prepared.intent.unresolvedModifierTokens.join(',') || 'none'}`,
      `confidence=${prepared.intent.confidence}`
    ].join('  ')
  );

  if (roleHeadDecision) {
    console.log(`role_head_reason=${roleHeadDecision.reason}`);
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    format: 'text'
  };

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length).trim();
      continue;
    }

    if (arg.startsWith('--title=')) {
      options.query = arg.slice('--title='.length).trim();
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

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
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

function parseFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }

  throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/query-intent.js --query="Consilier de vânzări (m/f)"',
      `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '  [--format=text|json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation query intent failed.');
  console.error(message);
  process.exitCode = 1;
});
