import {
  formatBuildManualReviewQueueResult,
  ManualReviewQueueBuilder,
  type BuildManualReviewQueueOptions,
  type ManualReviewBuildFormat
} from './manual-review/build-manual-review-queue.js';
import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from './audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const result = await withConnection(async (connection) => {
    const builder = new ManualReviewQueueBuilder(connection);
    return builder.run(options);
  });

  console.log(formatBuildManualReviewQueueResult(result, options.format));
}

function parseCliOptions(args: string[]): BuildManualReviewQueueOptions & { format: ManualReviewBuildFormat } {
  const options: BuildManualReviewQueueOptions & { format: ManualReviewBuildFormat } = {
    format: 'text'
  };

  for (const arg of args) {
    if (arg.startsWith('--search-run-id=')) {
      options.searchRunId = parsePositiveInteger('search-run-id', arg.slice('--search-run-id='.length));
      continue;
    }

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--set-key=')) {
      options.setKey = arg.slice('--set-key='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--include-existing') {
      options.includeExisting = true;
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

function parseFormat(value: string): ManualReviewBuildFormat {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }

  throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}

function parsePositiveInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/build-manual-review-queue.js',
      '  [--search-run-id=N]',
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `  [--set-key=${defaultEvaluationSearchSetKey()}]`,
      '  [--limit=25]',
      '  [--format=text|json]',
      '  [--dry-run]',
      '  [--include-existing]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Manual review queue build failed.');
  console.error(message);
  process.exitCode = 1;
});
