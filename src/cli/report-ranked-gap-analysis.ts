import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from './audits/search-meta/audit-occupation-search-meta.js';
import { defaultEvaluationSearchSetKey } from '../search-runs/run-evaluation-search.js';
import {
  formatRankedGapAnalysisReport,
  RankedGapAnalysisReporter,
  type RankedGapAnalysisFormat,
  type ReportRankedGapAnalysisOptions
} from '../search-readiness/report-ranked-gap-analysis.js';

type CliOptions = ReportRankedGapAnalysisOptions & {
  format: RankedGapAnalysisFormat;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const report = await withConnection(async (connection) => {
    const reporter = new RankedGapAnalysisReporter(connection);
    return reporter.run(options);
  });

  console.log(formatRankedGapAnalysisReport(report, options.format));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {
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

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.searchRunId === undefined) {
    throw new Error('Provide --search-run-id=N.');
  }

  return options as CliOptions;
}

function parseFormat(value: string): RankedGapAnalysisFormat {
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
      'Usage: node dist/cli/report-ranked-gap-analysis.js',
      '  --search-run-id=N',
      `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `  [--set-key=${defaultEvaluationSearchSetKey()}]`,
      '  [--limit=20]',
      '  [--format=text|json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Ranked gap analysis failed.');
  console.error(message);
  process.exitCode = 1;
});
