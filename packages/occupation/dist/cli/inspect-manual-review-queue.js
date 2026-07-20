import { withConnection } from '../db/mysql.js';
import { formatManualReviewInspection, ManualReviewQueueInspector } from '../manual-review/inspect-manual-review-queue.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const rows = await withConnection(async (connection) => {
        const inspector = new ManualReviewQueueInspector(connection);
        return inspector.run(options);
    });
    console.log(formatManualReviewInspection(rows, options.format));
}
function parseCliOptions(args) {
    const options = {
        status: 'pending',
        format: 'text'
    };
    for (const arg of args) {
        if (arg.startsWith('--status=')) {
            options.status = parseStatus(arg.slice('--status='.length));
            continue;
        }
        if (arg.startsWith('--review-type=')) {
            options.reviewType = parseReviewType(arg.slice('--review-type='.length));
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
    return options;
}
function parseStatus(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pending' || normalized === 'approved' || normalized === 'rejected' || normalized === 'ignored') {
        return normalized;
    }
    throw new Error(`Unsupported status "${value}". Use pending, approved, rejected, or ignored.`);
}
function parseReviewType(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'alias_conflict' ||
        normalized === 'generic_head' ||
        normalized === 'hierarchy_gap' ||
        normalized === 'relatedness_gap' ||
        normalized === 'cross_locale_gap' ||
        normalized === 'dense_candidate') {
        return normalized;
    }
    throw new Error(`Unsupported review type "${value}". Use alias_conflict, generic_head, hierarchy_gap, relatedness_gap, cross_locale_gap, or dense_candidate.`);
}
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'json') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}
function parsePositiveInteger(flagName, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/inspect-manual-review-queue.js',
        '  [--status=pending|approved|rejected|ignored]',
        '  [--review-type=alias_conflict|generic_head|hierarchy_gap|relatedness_gap|cross_locale_gap|dense_candidate]',
        '  [--limit=25]',
        '  [--format=text|json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Manual review queue inspection failed.');
    console.error(message);
    process.exitCode = 1;
});
