import { withConnection } from '../db/mysql.js';
import { DEFAULT_ONET_DOWNLOAD_DIR, DEFAULT_ONET_REPORT_DIR, importOnetEscoAliasCandidates } from './enrichment/onet/import-onet-esco-alias-candidates.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const result = await withConnection((connection) => importOnetEscoAliasCandidates(connection, {
        sourceName: options.sourceName,
        downloadDir: options.downloadDir,
        reportDir: options.reportDir,
        sampleLimit: options.sampleLimit,
        writeArtifact: options.writeArtifact
    }));
    console.log('O*NET ESCO alias candidate import completed.');
    console.log(`source=${result.sourceName} report=${result.reportPath}`);
    console.log([
        `crosswalk_rows=${result.summary.crosswalkRows}`,
        `job_title_rows=${result.summary.jobTitleRows}`,
        `reported_title_rows=${result.summary.reportedTitleRows}`,
        `unique_aliases=${result.summary.uniqueAliases}`,
        `generate=${result.summary.generate}`,
        `review=${result.summary.review}`,
        `exclude=${result.summary.exclude}`,
        `unmatched_crosswalk_targets=${result.summary.unmatchedCrosswalkTargets}`
    ].join('  '));
}
function parseCliOptions(args) {
    const options = {
        writeArtifact: true
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--download-dir=')) {
            options.downloadDir = arg.slice('--download-dir='.length).trim();
            continue;
        }
        if (arg.startsWith('--report-dir=')) {
            options.reportDir = arg.slice('--report-dir='.length).trim();
            continue;
        }
        if (arg.startsWith('--sample-limit=')) {
            const sampleLimit = Number.parseInt(arg.slice('--sample-limit='.length), 10);
            if (!Number.isInteger(sampleLimit) || sampleLimit < 0) {
                throw new Error(`--sample-limit must be a non-negative integer. Received: ${arg}`);
            }
            options.sampleLimit = sampleLimit;
            continue;
        }
        if (arg === '--no-write-artifact') {
            options.writeArtifact = false;
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
        'Usage: node dist/cli/import-onet-esco-alias-candidates.js [options]',
        '',
        'Options:',
        '  --source-name=esco_1_2_1',
        `  --download-dir=${DEFAULT_ONET_DOWNLOAD_DIR}`,
        `  --report-dir=${DEFAULT_ONET_REPORT_DIR}`,
        '  --sample-limit=20',
        '  --no-write-artifact',
        '  --help',
        '',
        'This command stages O*NET-derived English alias candidates for review. It does not promote aliases into the graph.'
    ].join('\n'));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('O*NET ESCO alias candidate import failed.');
    console.error(message);
    process.exitCode = 1;
});
