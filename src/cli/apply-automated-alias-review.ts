import { withConnection } from '../db/mysql.js';
import {
  applyAutomatedAliasReview,
  DEFAULT_AUTOMATED_ALIAS_DECISIONS_PATH
} from '../enrichment/review/apply-automated-alias-review.js';

type CliOptions = {
  decisionsPath?: string;
  dryRun: boolean;
  limit?: number;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await withConnection((connection) =>
    applyAutomatedAliasReview(connection, {
      decisionsPath: options.decisionsPath,
      dryRun: options.dryRun,
      limit: options.limit
    })
  );

  console.log('Automated alias review apply completed.');
  console.log(`decisions=${result.decisionsPath}`);
  console.log(
    [
      `dry_run=${result.dryRun ? 'yes' : 'no'}`,
      `eligible=${result.eligible}`,
      `inserted=${result.inserted}`,
      `skipped=${result.skipped}`
    ].join('  ')
  );
  console.log(
    Object.entries(result.byRuleId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ruleId, count]) => `rule.${ruleId}=${count}`)
      .join('  ')
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--decisions-path=')) {
      options.decisionsPath = arg.slice('--decisions-path='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));

      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`Invalid --limit value: ${arg}`);
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
      'Usage: node dist/cli/apply-automated-alias-review.js [options]',
      '',
      'Options:',
      `  --decisions-path=${DEFAULT_AUTOMATED_ALIAS_DECISIONS_PATH}`,
      '  --dry-run',
      '  --limit=N',
      '  --help',
      '',
      'Applies approved family-support CSV decisions as reviewed graph aliases.',
      'This command does not apply leaf promotions or reject bookkeeping.'
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Automated alias review apply failed.');
  console.error(message);
  process.exitCode = 1;
});
