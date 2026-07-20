import { OpenSearchClient } from '../opensearch/client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig } from '../opensearch/config.js';
import { OccupationOpenSearchIndexManager } from '../opensearch/occupations-index.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const config = getOpenSearchConfig();
    const manager = new OccupationOpenSearchIndexManager(new OpenSearchClient(config), config);
    const result = await manager.createOrUpdate({
        indexName: options.indexName,
        templateName: options.templateName,
        recreate: options.recreate,
        includeVectorField: options.includeVectorField
    });
    const action = result.recreated ? 'recreated' : result.created ? 'created' : 'updated in place';
    const vectorSummary = result.vectorField ? `vector field "${result.vectorField}" enabled` : 'vector field disabled';
    console.log(`OpenSearch occupation index ${action}: index="${result.indexName}", template="${result.templateName}", ${vectorSummary}.`);
}
function parseCliOptions(args) {
    const options = {
        includeVectorField: true
    };
    for (const arg of args) {
        if (arg.startsWith('--index-name=')) {
            options.indexName = arg.slice('--index-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--template-name=')) {
            options.templateName = arg.slice('--template-name='.length).trim();
            continue;
        }
        if (arg === '--recreate') {
            options.recreate = true;
            continue;
        }
        if (arg === '--no-vector-field') {
            options.includeVectorField = false;
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
    const config = getOpenSearchConfig();
    console.log([
        'Usage: node dist/cli/create-opensearch-occupations-index.js',
        `[--index-name=${config.occupationsIndex}]`,
        `[--template-name=${defaultOpenSearchTemplateName(config.occupationsIndex)}]`,
        '[--recreate]',
        '[--no-vector-field]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('OpenSearch occupation index creation failed.');
    console.error(message);
    process.exitCode = 1;
});
