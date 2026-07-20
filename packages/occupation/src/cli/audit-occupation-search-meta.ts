import {
  DEFAULT_ESCO_SOURCE_NAME,
  formatAuditReport,
  OccupationSearchMetaAuditor,
  type AuditOutputFormat
} from '../audits/search-meta/audit-occupation-search-meta.js';
import { withConnection } from '../db/mysql.js';

type CliOptions = {
  sourceName?: string;
  locales?: string[];
  format: AuditOutputFormat;
  sampleLimit?: number;
  weakEnglishBackboneThreshold?: number;
  insertReviewQueue?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const report = await withConnection(async (connection) => {
    const auditor = new OccupationSearchMetaAuditor(connection);

    return auditor.run({
      sourceName: options.sourceName,
      locales: options.locales,
      sampleLimit: options.sampleLimit,
      weakEnglishBackboneThreshold: options.weakEnglishBackboneThreshold,
      insertReviewQueue: options.insertReviewQueue
    });
  });

  console.log(formatAuditReport(report, options.format));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text'
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--locales=')) {
      options.locales = parseLocaleList(arg.slice('--locales='.length));
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parsePositiveInteger('sample-limit', arg.slice('--sample-limit='.length));
      continue;
    }

    if (arg.startsWith('--weak-english-backbone-threshold=')) {
      options.weakEnglishBackboneThreshold = parseThreshold(
        'weak-english-backbone-threshold',
        arg.slice('--weak-english-backbone-threshold='.length)
      );
      continue;
    }

    if (arg === '--insert-review-queue') {
      options.insertReviewQueue = true;
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

function parseLocaleList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFormat(value: string): AuditOutputFormat {
  const format = value.trim().toLowerCase();

  if (format === 'text' || format === 'json') {
    return format;
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

function parseThreshold(flagName: string, value: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`--${flagName} must be a number between 0 and 1. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    `Usage: node dist/cli/audit-occupation-search-meta.js [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--locales=en,ro] [--format=text|json] [--sample-limit=10] [--weak-english-backbone-threshold=0.5] [--insert-review-queue]`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation search meta audit failed.');
  console.error(message);
  process.exitCode = 1;
});
