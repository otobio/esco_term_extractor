import { withConnection } from '../db/mysql.js';
import { buildAutomatedAliasReview, DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR, DEFAULT_EURES_ALIAS_REPORT_PATH, DEFAULT_ONET_ALIAS_REPORT_PATH } from './enrichment/review/build-automated-alias-review.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const result = await withConnection((connection) => buildAutomatedAliasReview(connection, {
        onetReportPath: options.onetReportPath,
        euresReportPath: options.euresReportPath,
        decisionsPath: options.decisionsPath,
        manualQueuePath: options.manualQueuePath,
        includeOnet: options.includeOnet,
        includeEures: options.includeEures
    }));
    console.log('Automated alias review completed.');
    console.log(`decisions=${result.decisionsPath}`);
    console.log(`manual_queue=${result.manualQueuePath}`);
    console.log([
        `groups_reviewed=${result.groupsReviewed}`,
        `automated_decisions=${result.automatedDecisions}`,
        `manual_queue_items=${result.manualQueueItems}`
    ].join('  '));
    console.log(Object.entries(result.byRuleId)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ruleId, count]) => `rule.${ruleId}=${count}`)
        .join('  '));
}
function parseCliOptions(args) {
    const options = {
        includeOnet: true,
        includeEures: true
    };
    for (const arg of args) {
        if (arg.startsWith('--onet-report-path=')) {
            options.onetReportPath = arg.slice('--onet-report-path='.length).trim();
            continue;
        }
        if (arg.startsWith('--eures-report-path=')) {
            options.euresReportPath = arg.slice('--eures-report-path='.length).trim();
            continue;
        }
        if (arg.startsWith('--decisions-path=')) {
            options.decisionsPath = arg.slice('--decisions-path='.length).trim();
            continue;
        }
        if (arg.startsWith('--manual-queue-path=')) {
            options.manualQueuePath = arg.slice('--manual-queue-path='.length).trim();
            continue;
        }
        if (arg === '--onet-only') {
            options.includeOnet = true;
            options.includeEures = false;
            continue;
        }
        if (arg === '--eures-only') {
            options.includeOnet = false;
            options.includeEures = true;
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
function printHelp() {
    console.log([
        'Usage: node dist/cli/build-automated-alias-review.js [options]',
        '',
        'Options:',
        `  --onet-report-path=${DEFAULT_ONET_ALIAS_REPORT_PATH}`,
        `  --eures-report-path=${DEFAULT_EURES_ALIAS_REPORT_PATH}`,
        `  --decisions-path=${DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR}/automated-review-decisions.csv`,
        `  --manual-queue-path=${DEFAULT_AUTOMATED_ALIAS_REVIEW_DIR}/manual-review-queue.csv`,
        '  --onet-only',
        '  --eures-only',
        '  --help',
        '',
        'Writes CSV review decisions only. This command does not mutate graph aliases or search-meta.'
    ].join('\n'));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Automated alias review failed.');
    console.error(message);
    process.exitCode = 1;
});
