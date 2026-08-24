import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../search-pipeline/occupation-search-pipeline.js';
import { preparedQuerySupportsSpecializationKind } from '../runtime/occupation-leaf-structure-rules.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        retrievalBackend: 'binary-cache',
        leafStructureRuntime: true
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const rows = await readCsvRows(options);
    const seen = new Set();
    const findings = [];
    let scanned = 0;
    for (const row of rows) {
        const jobTitle = String(row[options.titleColumn] ?? '').trim();
        if (!jobTitle || seen.has(jobTitle)) {
            continue;
        }
        seen.add(jobTitle);
        scanned += 1;
        const result = await pipeline.run({
            query: jobTitle,
            locale: options.locale,
            sourceName: options.sourceName,
            limit: 20
        });
        // Only leaf-level decisions actually assert a specific leaf to the caller; a family-level
        // decision is the pipeline correctly declining to pick one (e.g. hasUnsafeSpecializedLeafTie
        // downgrading an over-specific top-ranked leaf), so it must not count as an unsupported-
        // specialization "winner" here.
        const topLeaf = result.decision.decisionType === 'leaf' ? (result.rankedLeaves[0] ?? null) : null;
        const structure = topLeaf?.leafStructure ?? null;
        if (!topLeaf || !structure) {
            continue;
        }
        for (const kind of structure.specializationKinds) {
            if (!preparedQuerySupportsSpecializationKind(result.preparedQuery, kind)) {
                findings.push({
                    jobTitle,
                    topLeaf: topLeaf.canonicalLabel,
                    topFamily: topLeaf.familyLabel,
                    kind
                });
            }
        }
    }
    reportFindings(scanned, findings);
}
function reportFindings(scanned, findings) {
    console.log(`Scanned ${scanned} unique job titles.`);
    console.log(`Unsupported-specialization winners: ${findings.length}`);
    const byKind = new Map();
    for (const finding of findings) {
        const bucket = byKind.get(finding.kind) ?? [];
        bucket.push(finding);
        byKind.set(finding.kind, bucket);
    }
    const rankedKinds = Array.from(byKind.entries()).sort((left, right) => right[1].length - left[1].length);
    for (const [kind, bucket] of rankedKinds) {
        console.log(`\n=== ${kind} (${bucket.length}) ===`);
        for (const finding of bucket.slice(0, 15)) {
            console.log(`  "${finding.jobTitle}" -> "${finding.topLeaf}" [${finding.topFamily}]`);
        }
        if (bucket.length > 15) {
            console.log(`  ... and ${bucket.length - 15} more`);
        }
    }
}
async function readCsvRows(options) {
    const inputStream = createReadStream(options.inputPath, { encoding: 'utf8' });
    const parser = inputStream.pipe(parse({
        bom: true,
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true
    }));
    const rows = [];
    for await (const row of parser) {
        rows.push(row);
        if (options.limit !== null && rows.length >= options.limit) {
            break;
        }
    }
    return rows;
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        titleColumn: 'job_title',
        limit: null
    };
    for (const arg of args) {
        if (arg.startsWith('--input=')) {
            options.inputPath = arg.slice('--input='.length).trim();
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
        if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger(arg.slice('--limit='.length).trim(), '--limit');
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
function parsePositiveInteger(value, flag) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/audit-occupation-leaf-specialization.js',
        '  --input=/path/to/file.csv',
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '  [--title-column=job_title]',
        '  [--limit=N]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation leaf-specialization audit failed.');
    console.error(message);
    process.exitCode = 1;
});
