import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationTitleSignals } from '../query/occupation-signal-oov-cleaner.js';
import { peelOccupationTitleNoise } from '../query/occupation-noise-peeling.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const csvText = await readFile(options.inputPath, 'utf8');
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true
    });
    const outputRows = await Promise.all(rows.map(async (row) => {
        const title = String(row[options.titleColumn] ?? '').trim();
        const peelingOnly = title ? peelOccupationTitleNoise(title, options.locale) : '';
        const oovOnly = title
            ? await cleanOccupationTitleSignals({
                sourceName: options.sourceName,
                locale: options.locale,
                title
            })
            : '';
        const both = peelingOnly
            ? await cleanOccupationTitleSignals({
                sourceName: options.sourceName,
                locale: options.locale,
                title: peelingOnly
            })
            : '';
        return {
            job_title: title,
            oov_only: oovOnly,
            peeler_v2_only: peelingOnly,
            both
        };
    }));
    const output = toCsv(outputRows, ['job_title', 'oov_only', 'peeler_v2_only', 'both']);
    if (options.outputPath) {
        await writeFile(options.outputPath, output, 'utf8');
        console.log(`Wrote occupation cleaning comparison to ${path.resolve(options.outputPath)}`);
        return;
    }
    process.stdout.write(output);
}
function toCsv(rows, columns) {
    const lines = [columns.map(escapeCsvCell).join(',')];
    for (const row of rows) {
        lines.push(columns.map((column) => escapeCsvCell(row[column] ?? '')).join(','));
    }
    return `${lines.join('\n')}\n`;
}
function escapeCsvCell(value) {
    const normalized = value.replace(/\r?\n/gu, ' ').trim();
    return `"${normalized.replace(/"/gu, '""')}"`;
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        locale: DEFAULT_RETRIEVAL_LOCALE,
        titleColumn: 'job_title',
        outputPath: null
    };
    for (const arg of args) {
        if (arg.startsWith('--input=')) {
            options.inputPath = arg.slice('--input='.length).trim();
            continue;
        }
        if (arg.startsWith('--output=')) {
            options.outputPath = arg.slice('--output='.length).trim();
            continue;
        }
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = arg.slice('--locale='.length).trim();
            continue;
        }
        if (arg.startsWith('--title-column=')) {
            options.titleColumn = arg.slice('--title-column='.length).trim();
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.inputPath) {
        throw new Error('Provide --input=/path/to/file.csv.');
    }
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/report-occupation-cleaning-comparison.js',
        '  --input=/path/to/file.csv',
        '  [--output=/path/to/output.csv]',
        `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        '  [--title-column=job_title]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation cleaning comparison failed.');
    console.error(message);
    process.exitCode = 1;
});
