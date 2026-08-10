import { withConnection } from '../db/mysql.js';
import {
  formatSearchReadinessReport,
  SearchReadinessReporter,
  type ReportSearchReadinessOptions,
  type SearchReadinessFormat
} from '../search-readiness/report-search-readiness.js';
import { DEFAULT_ESCO_SOURCE_NAME } from './audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';

type CliOptions = ReportSearchReadinessOptions & {
  format: SearchReadinessFormat;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const report = await withConnection(async (connection) => {
    const reporter = new SearchReadinessReporter(connection);
    return reporter.run(options);
  });

  console.log(formatSearchReadinessReport(report, options.format));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text'
  };

  for (const arg of args) {
    if (arg.startsWith('--baseline-run-id=')) {
      options.baselineRunId = parsePositiveInteger('baseline-run-id', arg.slice('--baseline-run-id='.length));
      continue;
    }

    if (arg.startsWith('--candidate-run-id=')) {
      options.candidateRunId = parsePositiveInteger('candidate-run-id', arg.slice('--candidate-run-id='.length));
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

function parseFormat(value: string): SearchReadinessFormat {
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
      'Usage: node dist/cli/report-search-readiness.js',
      '  [--baseline-run-id=N]',
      '  [--candidate-run-id=N]',
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `  [--set-key=${defaultEvaluationSearchSetKey()}]`,
      '  [--format=text|json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Search readiness report failed.');
  console.error(message);
  process.exitCode = 1;
});
