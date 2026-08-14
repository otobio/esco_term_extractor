import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.title?.trim()) {
        throw new Error('Provide --title="...".');
    }
    const result = await cleanTitle(options.title, options);
    if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(`Occupation signal cleaner: "${options.title}"`);
    console.log(`locale=${options.locale}  cleaner=cleanOccupationQuerySurface`);
    console.log(`cleaned="${result}"`);
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        format: 'text'
    };
    for (const arg of args) {
        if (arg.startsWith('--title=')) {
            options.title = arg.slice('--title='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = arg.slice('--locale='.length).trim();
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
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'json') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}
async function cleanTitle(title, options) {
    return cleanOccupationQuerySurface(title, options.locale);
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/clean-occupation-query-signals.js --title="Fuel Validation Officer-Numan,Adamawa State"',
        `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        '[--format=text|json]'
    ].join(' '));
}
main().catch((error) => {
    console.error('Occupation signal cleaning failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
