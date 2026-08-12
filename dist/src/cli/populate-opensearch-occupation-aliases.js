import { withConnection } from '../db/mysql.js';
import { OpenSearchClient } from '../opensearch/client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig } from '../opensearch/config.js';
import { OccupationAliasOpenSearchBulkIndexer } from '../opensearch/occupation-aliases-index.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const config = getOpenSearchConfig();
    const result = await withConnection(async (connection) => {
        const indexer = new OccupationAliasOpenSearchBulkIndexer(connection, new OpenSearchClient(config), config);
        return indexer.run({
            sourceName: options.sourceName,
            indexName: options.indexName,
            templateName: options.templateName,
            chunkSize: options.chunkSize,
            limit: options.limit,
            ensureIndex: options.ensureIndex,
            recreateIndex: options.recreateIndex,
            refresh: options.refresh,
            onProgress: (progress) => {
                const remainingSummary = progress.remaining === undefined ? '' : `, remaining ${progress.remaining}`;
                console.log(`Indexed chunk of ${progress.chunkDocumentCount} occupation alias docs through graph_node_id=${progress.lastGraphNodeId}; indexed ${progress.indexedDocumentCount}, failed ${progress.failedDocumentCount}${remainingSummary}.`);
            }
        });
    });
    console.log(`OpenSearch occupation alias population completed for index "${result.indexName}" from source "${result.sourceName}" with chunk size ${result.chunkSize}.`);
    console.log(`Attempted ${result.attemptedDocumentCount}/${result.totalCandidateCount} alias documents, indexed ${result.indexedDocumentCount}, failed ${result.failedDocumentCount}.`);
}
function parseCliOptions(args) {
    const options = {
        ensureIndex: true,
        refresh: true
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--index-name=')) {
            options.indexName = arg.slice('--index-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--template-name=')) {
            options.templateName = arg.slice('--template-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--chunk-size=')) {
            options.chunkSize = parsePositiveInteger('chunk-size', arg.slice('--chunk-size='.length));
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
            continue;
        }
        if (arg === '--skip-create') {
            options.ensureIndex = false;
            continue;
        }
        if (arg === '--recreate-index') {
            options.recreateIndex = true;
            continue;
        }
        if (arg === '--no-refresh') {
            options.refresh = false;
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
function parsePositiveInteger(flagName, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    const config = getOpenSearchConfig();
    console.log([
        'Usage: node dist/cli/populate-opensearch-occupation-aliases.js',
        '[--source-name=esco_1_2_1]',
        `[--index-name=${config.occupationAliasesIndex}]`,
        `[--template-name=${defaultOpenSearchTemplateName(config.occupationAliasesIndex)}]`,
        '[--chunk-size=10000]',
        '[--limit=N]',
        '[--skip-create]',
        '[--recreate-index]',
        '[--no-refresh]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('OpenSearch occupation alias population failed.');
    console.error(message);
    process.exitCode = 1;
});
