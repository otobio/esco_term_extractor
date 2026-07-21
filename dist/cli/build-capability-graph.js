import { withConnection } from '../db/mysql.js';
import { CapabilityGraphBuilder } from '../graph/capability/build-capability-graph.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    await withConnection(async (connection) => {
        const builder = new CapabilityGraphBuilder(connection);
        await builder.run({
            sourceName: options.sourceName,
            locales: options.locales
        });
    });
    const localeSummary = options.locales && options.locales.length > 0 ? options.locales.join(', ') : 'all available locales';
    const sourceSummary = options.sourceName?.trim() || 'esco_1_2_1';
    console.log(`Capability graph build completed for source "${sourceSummary}" and ${localeSummary}.`);
}
function parseCliOptions(args) {
    const options = {};
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--locales=')) {
            options.locales = arg
                .slice('--locales='.length)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
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
    console.log('Usage: node dist/cli/build-capability-graph.js [--source-name=esco_1_2_1] [--locales=en,ro]');
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Capability graph build failed.');
    console.error(message);
    process.exitCode = 1;
});
