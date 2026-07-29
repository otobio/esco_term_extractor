import { withConnection } from '../db/mysql.js';
import { DEFAULT_ONET_ALIAS_REPORT_PATH, promoteOnetEscoAliasCandidates } from '../enrichment/onet/promote-onet-esco-alias-candidates.js';

type CliOptions = {
  reportPath?: string;
  minConfidence?: number;
  limit?: number;
  dryRun?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await withConnection((connection) =>
    promoteOnetEscoAliasCandidates(connection, {
      reportPath: options.reportPath,
      minConfidence: options.minConfidence,
      limit: options.limit,
      dryRun: options.dryRun
    })
  );

  console.log('O*NET ESCO alias candidate promotion completed.');
  console.log(`report=${result.reportPath}`);
  console.log(
    [
      `dry_run=${result.dryRun ? 'yes' : 'no'}`,
      `min_confidence=${result.minConfidence}`,
      `eligible=${result.eligible}`,
      `inserted=${result.inserted}`,
      `skipped=${result.skipped}`
    ].join('  ')
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--report-path=')) {
      options.reportPath = arg.slice('--report-path='.length).trim();
      continue;
    }

    if (arg.startsWith('--min-confidence=')) {
      const minConfidence = Number.parseFloat(arg.slice('--min-confidence='.length));

      if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
        throw new Error(`--min-confidence must be between 0 and 1. Received: ${arg}`);
      }

      options.minConfidence = minConfidence;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const limit = Number.parseInt(arg.slice('--limit='.length), 10);

      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer. Received: ${arg}`);
      }

      options.limit = limit;
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

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/promote-onet-esco-alias-candidates.js [options]',
      '',
      'Options:',
      `  --report-path=${DEFAULT_ONET_ALIAS_REPORT_PATH}`,
      '  --min-confidence=0.9',
      '  --limit=100',
      '  --dry-run',
      '  --help',
      '',
      'Only candidateMode=generate records are eligible. Review records are handled by the automated/manual review workflow.'
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('O*NET ESCO alias candidate promotion failed.');
  console.error(message);
  process.exitCode = 1;
});
