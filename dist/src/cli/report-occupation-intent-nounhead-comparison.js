import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { prepareQuery } from '../query/query-preparation.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
const OUTPUT_COLUMNS = ['job_title', 'cleaned_title', 'role_head', 'role_modifiers', 'domain_modifiers', 'confidence', 'reason'];
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const csvText = await readFile(options.inputPath, 'utf8');
    const allRows = parse(csvText, {
        columns: true,
        skip_empty_lines: true
    });
    const rows = options.limit === null ? allRows.slice(options.offset) : allRows.slice(options.offset, options.offset + options.limit);
    const outputRows = await Promise.all(rows.map(async (row) => {
        const title = String(row[options.titleColumn] ?? '').trim();
        if (!title) {
            return {
                job_title: '',
                cleaned_title: '',
                role_head: '',
                role_modifiers: '',
                domain_modifiers: '',
                confidence: '',
                reason: ''
            };
        }
        const cleanedTitle = await cleanOccupationQuerySurface(title, options.locale);
        const prepared = await prepareQuery(cleanedTitle || title, options.locale, { sourceName: options.sourceName });
        const intent = prepared.intent;
        return {
            job_title: title,
            cleaned_title: cleanedTitle,
            role_head: intent.roleHeadTokens.join(' '),
            role_modifiers: intent.roleTokens.filter((token) => !intent.roleHeadTokens.includes(token)).join(' '),
            domain_modifiers: intent.domainTokens.join(' '),
            confidence: formatPercent(intent.confidence),
            reason: intent.diagnostics.find((item) => item.kind === 'role_head')?.reason ?? ''
        };
    }));
    const output = toCsv(outputRows, OUTPUT_COLUMNS);
    if (options.outputPath) {
        await writeFile(options.outputPath, output, 'utf8');
        console.log(`Wrote occupation intent noun-head comparison to ${path.resolve(options.outputPath)}`);
        return;
    }
    process.stdout.write(output);
}
function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
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
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        titleColumn: 'job_title',
        outputPath: null,
        offset: 0,
        limit: null
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
        if (arg.startsWith('--locale=')) {
            options.locale = arg.slice('--locale='.length).trim();
            continue;
        }
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--title-column=')) {
            options.titleColumn = arg.slice('--title-column='.length).trim();
            continue;
        }
        if (arg.startsWith('--offset=')) {
            options.offset = parseNonNegativeInteger(arg.slice('--offset='.length).trim(), '--offset');
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = parseNonNegativeInteger(arg.slice('--limit='.length).trim(), '--limit');
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
function parseNonNegativeInteger(value, flag) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${flag} must be a non-negative integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/report-occupation-intent-nounhead-comparison.js',
        '  --input=/path/to/file.csv',
        '  [--output=/path/to/output.csv]',
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '  [--title-column=job_title]',
        '  [--offset=0]',
        '  [--limit=N]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation intent noun-head comparison failed.');
    console.error(message);
    process.exitCode = 1;
});
