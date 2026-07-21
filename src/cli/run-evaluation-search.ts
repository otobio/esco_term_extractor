import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY
} from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import {
  defaultEvaluationSearchSetKey,
  EvaluationSearchRunPersister,
  type RunEvaluationSearchResult
} from '../search-runs/run-evaluation-search.js';

type CliOptions = {
  runLabel?: string;
  sourceName?: string;
  setKey?: string;
  modelKey?: string;
  limit?: number;
  siblingLimit?: number;
  maxQueries?: number;
  notes?: string;
  dryRun: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const result = await withConnection(async (connection) => {
    const persister = new EvaluationSearchRunPersister(connection);
    return persister.run(options);
  });

  console.log(formatResult(result));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--run-label=')) {
      options.runLabel = arg.slice('--run-label='.length).trim();
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

    if (arg.startsWith('--model-key=')) {
      options.modelKey = arg.slice('--model-key='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
      continue;
    }

    if (arg.startsWith('--sibling-limit=')) {
      options.siblingLimit = parseNonNegativeInteger('sibling-limit', arg.slice('--sibling-limit='.length));
      continue;
    }

    if (arg.startsWith('--max-queries=')) {
      options.maxQueries = parsePositiveInteger('max-queries', arg.slice('--max-queries='.length));
      continue;
    }

    if (arg.startsWith('--notes=')) {
      options.notes = arg.slice('--notes='.length);
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
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

function formatResult(result: RunEvaluationSearchResult): string {
  const lines = [
    `Phase 12 evaluation search ${result.dryRun ? 'dry run' : 'persistence'} complete.`,
    `run_label=${result.runLabel}`,
    `source_name=${result.sourceName}, set_key=${result.setKey}, model_key=${result.modelKey}, retrieval_profile=${result.retrievalProfile}, limit=${result.limit}, sibling_limit=${result.siblingLimit}, max_queries=${result.maxQueries ?? 'all'}`,
    `matching_queries=${result.matchingQueryCount}, processed_queries=${result.processedQueryCount}, selected=${result.selectedCount}, unresolved=${result.unresolvedCount}, result_rows=${result.insertedResultCount}`,
    result.dryRun ? 'search_run_id=none (dry-run: no rows written)' : `search_run_id=${result.searchRunId}`
  ];

  lines.push('This command persists Phase 12 experiment runs only. It does not change retrieval, resolver scoring, or write manual-review workflow rows.');

  return lines.join('\n');
}

function parsePositiveInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function parseNonNegativeInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${flagName} must be a non-negative integer. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/run-evaluation-search.js',
      '  [--run-label=phase12-search-run-...]',
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `  [--set-key=${defaultEvaluationSearchSetKey()}]`,
      `  [--model-key=${DEFAULT_MODEL_KEY}]`,
      '  [--limit=10]',
      `  [--sibling-limit=${DEFAULT_SIBLING_LIMIT}]`,
      '  [--max-queries=N]',
      '  [--notes="..."]',
      '  [--dry-run]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
