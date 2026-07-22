import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY
} from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import {
  formatPipelineGoldenSuiteResult,
  PipelineGoldenSuiteRunner,
  type GoldenSuiteSelection,
  type PipelineGoldenSuiteOptions
} from '../search-pipeline/golden-suite.js';
import {
  parseRetrievalBackend,
  type RetrievalBackendKind
} from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';

type OutputFormat = 'text' | 'json';

type CliOptions = PipelineGoldenSuiteOptions & {
  format: OutputFormat;
  strict: boolean;
  retrievalBackend: RetrievalBackendKind | null;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    retrievalBackend: options.retrievalBackend ?? undefined
  });

  const result = await withConnection(async (connection) => {
    const runner = new PipelineGoldenSuiteRunner(connection);
    return runner.run({
      ...options,
      retrievalEngine: runtime.retrievalEngine
    });
  });

  console.log(formatPipelineGoldenSuiteResult(result, options.format));

  if (result.blockingFailed > 0 || (options.strict && result.failed > 0)) {
    process.exitCode = 1;
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
    strict: false,
    retrievalBackend: null
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--model-key=')) {
      options.modelKey = arg.slice('--model-key='.length).trim();
      continue;
    }

    if (arg.startsWith('--suite=')) {
      options.suite = parseSuiteSelection(arg.slice('--suite='.length));
      continue;
    }

    if (arg.startsWith('--retrieval-backend=')) {
      options.retrievalBackend = parseRetrievalBackend(arg.slice('--retrieval-backend='.length));
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

    if (arg.startsWith('--case-key=')) {
      options.caseKeys = [...(options.caseKeys ?? []), arg.slice('--case-key='.length).trim()];
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

    if (arg === '--strict') {
      options.strict = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseSuiteSelection(value: string): GoldenSuiteSelection {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'stable' || normalized === 'developing' || normalized === 'all') {
    return normalized;
  }

  throw new Error(`Unsupported suite "${value}". Use --suite=stable, --suite=developing, or --suite=all.`);
}

function parseFormat(value: string): OutputFormat {
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
      'Usage: node dist/cli/run-pipeline-golden-suite.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `[--model-key=${DEFAULT_MODEL_KEY}]`,
      '[--suite=stable|developing|all]',
      '[--retrieval-backend=opensearch|binary-cache]',
      '[--limit=10]',
      `[--sibling-limit=${DEFAULT_SIBLING_LIMIT}]`,
      '[--case-key=exact-software-developer]',
      '[--format=text|json]',
      '[--strict]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Pipeline golden suite failed.');
  console.error(message);
  process.exitCode = 1;
});
