import { getEscoConfig } from '../config/esco.js';
import { withConnection } from '../db/mysql.js';
import { EscoSourceImporter } from '../importers/esco/import-esco-source.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const config = getEscoConfig(options);
    const runId = await withConnection(async (connection) => {
        const importer = new EscoSourceImporter(connection, config);
        return importer.run();
    });
    console.log(`ESCO source import completed. Run ${runId} loaded source "${config.sourceName}" for locales: ${config.locales.join(', ')}.`);
}
function parseCliOptions(args) {
    const options = {};
    for (const arg of args) {
        if (arg.startsWith('--downloads-dir=')) {
            options.downloadsDir = arg.slice('--downloads-dir='.length);
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
        if (arg.startsWith('--version=')) {
            options.version = arg.slice('--version='.length).trim();
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
    console.log(`Usage: node dist/cli/import-esco-source.js [--downloads-dir=PATH] [--locales=en,ro] [--version=1.2.1]`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('ESCO source import failed.');
    console.error(message);
    process.exitCode = 1;
});
