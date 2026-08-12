import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationTitleSignals } from '../query/occupation-signal-oov-cleaner.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.title?.trim()) {
        throw new Error('Provide --title="...".');
    }
    const result = await cleanOccupationTitleSignals({
        sourceName: options.sourceName,
        locale: options.locale,
        title: options.title
    });
    if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(`Occupation signal cleaner: "${options.title}"`);
    console.log(`locale=${result.locale}  source=${result.sourceName}`);
    console.log(`kept=${result.keptSignals.length}/${result.signals.length}`);
    console.log('');
    console.log('Signals');
    for (const decision of result.decisions) {
        const status = decision.kept ? 'keep' : 'drop';
        const coverage = Math.round(decision.tokenCoverage * 100);
        const anchor = decision.hasOccupationAnchor ? ' anchor=yes' : '';
        console.log(`- ${status} "${decision.signal}" score=${Math.round(decision.score * 100)}% coverage=${coverage}% phrase=${decision.longestPhraseLength}${anchor} reason=${decision.reason}`);
    }
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
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
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
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
function printHelp() {
    console.log([
        'Usage: node dist/cli/clean-occupation-query-signals.js --title="Fuel Validation Officer-Numan,Adamawa State"',
        `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--format=text|json]'
    ].join(' '));
}
main().catch((error) => {
    console.error('Occupation signal cleaning failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
