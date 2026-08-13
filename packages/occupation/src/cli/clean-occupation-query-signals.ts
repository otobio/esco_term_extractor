import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationTitleSignals } from '../query/occupation-signal-oov-cleaner.js';
import { peelOccupationTitleNoise } from '../query/occupation-noise-peeling.js';

type OutputFormat = 'text' | 'json';
type NoiseKind = 'oov' | 'peeler' | 'oov_peeler';

type CliOptions = {
  title?: string;
  locale: string;
  sourceName: string;
  format: OutputFormat;
  noiseKind: NoiseKind;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (!options.title?.trim()) {
    throw new Error('Provide --title="...".');
  }

  const result = await cleanTitle(options.title, options);

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Occupation signal cleaner: "${options.title}"`);
  console.log(`locale=${options.locale}  source=${options.sourceName}  noise_kind=${options.noiseKind}`);
  console.log(`cleaned="${result}"`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    format: 'text',
    noiseKind: 'oov'
  };

  for (const arg of args) {
    if (arg.startsWith('--title=')) {
      options.title = arg.slice('--title='.length).trim();
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

  return options;
}

function parseFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }

  throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
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
      'Usage: node dist/cli/clean-occupation-query-signals.js --title="Fuel Validation Officer-Numan,Adamawa State"',
      `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--format=text|json]',
      '[--noise-kind=oov|peeler|oov_peeler]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error('Occupation signal cleaning failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
