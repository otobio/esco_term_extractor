import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { peelOccupationTitleNoise } from '../query/occupation-noise-peeling.js';
import { cleanOccupationTitleSignals } from '../query/occupation-signal-oov-cleaner.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.title?.trim()) {
        throw new Error('Provide --title="...".');
    }
    let result;
    switch (options.method) {
        case 'oov':
            result = await cleanOccupationTitleSignals({ title: options.title, locale: options.locale, sourceName: 'esco_1_2_1' });
            break;
        case 'peeler':
            result = peelOccupationTitleNoise(options.title, options.locale);
            break;
        default:
            result = await cleanOccupationQuerySurface(options.title, options.locale);
    }
    if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(`Occupation signal cleaner: "${options.title}"`);
    console.log(`locale=${options.locale}  method=${options.method}`);
    console.log(`cleaned="${result}"`);
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        format: 'text',
        method: 'oov_peeler'
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
        if (arg.startsWith('--method=')) {
            options.method = parseMethod(arg.slice('--method='.length).trim());
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
function parseMethod(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'oov_peeler' || normalized === 'oov' || normalized === 'peeler') {
        return normalized;
    }
    throw new Error(`Unsupported method "${value}". Use --method=oov or --method=peeler or --method=oov_peeler.`);
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
