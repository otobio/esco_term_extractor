import { formatAuditReport, DEFAULT_ESCO_SOURCE_NAME, EscoSourceAuditor } from './audits/esco-source/audit-esco-source.js';
import { withConnection } from '../db/mysql.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const report = await withConnection(async (connection) => {
        const auditor = new EscoSourceAuditor(connection);
        return auditor.run({
            sourceName: options.sourceName,
            locales: options.locales,
            sampleLimit: options.sampleLimit,
            collectionLimit: options.collectionLimit
        });
    });
    console.log(formatAuditReport(report, options.format));
}
function parseCliOptions(args) {
    const options = {
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
        if (arg.startsWith('--collection-limit=')) {
            options.collectionLimit = parsePositiveInteger('collection-limit', arg.slice('--collection-limit='.length));
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
function parseLocaleList(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseFormat(value) {
    const format = value.trim().toLowerCase();
    if (format === 'text' || format === 'json') {
        return format;
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
    console.log(`Usage: node dist/cli/audit-esco-source.js [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--locales=en,ro] [--format=text|json] [--sample-limit=8] [--collection-limit=12]`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ESCO source audit failed.');
    console.error(message);
    process.exitCode = 1;
});
