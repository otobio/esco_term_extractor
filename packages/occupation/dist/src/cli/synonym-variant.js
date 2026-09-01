import { englishModifierEquivalentsFromLeafStructure } from '../query/token-variants.js';
const DEFAULT_SOURCE_NAME = 'esco_1_2_1';
function parseCliOptions(argv) {
    let query;
    let locale = 'ro';
    let sourceName = DEFAULT_SOURCE_NAME;
    for (const arg of argv) {
        if (arg.startsWith('--query=')) {
            query = arg.slice('--query='.length);
        }
        else if (arg.startsWith('--locale=')) {
            locale = arg.slice('--locale='.length);
        }
        else if (arg.startsWith('--source=')) {
            sourceName = arg.slice('--source='.length);
        }
    }
    if (!query) {
        throw new Error('Usage: synonym:variant --query="<word or phrase>" [--locale=ro] [--source=esco_1_2_1]');
    }
    return { query, locale, sourceName };
}
async function main() {
    const { query, locale, sourceName } = parseCliOptions(process.argv.slice(2));
    for (const token of query.split(/\s+/u).filter(Boolean)) {
        const equivalents = await englishModifierEquivalentsFromLeafStructure(token, locale, sourceName);
        console.log(`${token} (${locale}) -> ${equivalents.length > 0 ? equivalents.join(', ') : '(no match)'}`);
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
