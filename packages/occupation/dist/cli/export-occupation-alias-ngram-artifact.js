import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOccupationAliasNgramRecords } from '../retrieval/alias-ngram-retriever.js';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { ALIAS_NGRAM_BINARY_SCHEMA_VERSION, buildAliasNgramBinaryFiles, defaultOccupationAliasNgramBinaryManifestPath } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const searchMetaRecords = searchMetaArtifact.getAllRecordsWithDetails();
    if (options.outPath && options.locales.length !== 1) {
        throw new Error('--out can only be used with exactly one locale.');
    }
    for (const locale of options.locales) {
        const records = buildOccupationAliasNgramRecords(searchMetaRecords, {
            sourceName: options.sourceName,
            locale,
            includeFamilySupportingAliases: options.includeFamilySupportingAliases
        });
        const binaryManifestPath = path.resolve(options.outPath ?? defaultOccupationAliasNgramBinaryManifestPath(options.sourceName, locale, options.includeFamilySupportingAliases));
        const binaryPrefix = path.basename(binaryManifestPath, '.manifest.json');
        const binaryFiles = buildAliasNgramBinaryFiles(records, binaryPrefix);
        const binaryManifest = {
            schemaVersion: ALIAS_NGRAM_BINARY_SCHEMA_VERSION,
            sourceName: options.sourceName,
            locale,
            includeFamilySupportingAliases: options.includeFamilySupportingAliases,
            generatedAt: new Date().toISOString(),
            count: records.length,
            stringCount: binaryFiles.stringCount,
            featurePostingKeyCount: binaryFiles.featurePostingKeyCount,
            featureValueCount: binaryFiles.featureValueCount,
            files: Object.fromEntries(Object.entries(binaryFiles.manifestFiles).map(([key, value]) => [
                key,
                path.relative(path.dirname(binaryManifestPath), path.join(path.dirname(binaryManifestPath), value))
            ]))
        };
        await mkdir(path.dirname(binaryManifestPath), { recursive: true });
        await writeFile(binaryManifestPath, `${JSON.stringify(binaryManifest, null, 2)}\n`, 'utf8');
        for (const [file, buffer] of binaryFiles.buffers) {
            await writeFile(path.join(path.dirname(binaryManifestPath), file), buffer);
        }
        console.log(`Exported ${binaryManifest.count} occupation alias-ngram binary records to ${binaryManifestPath}`);
        console.log(`source=${binaryManifest.sourceName}`);
        console.log(`locale=${binaryManifest.locale}`);
        console.log(`family_support=${binaryManifest.includeFamilySupportingAliases ? 'yes' : 'no'}`);
    }
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        locales: [DEFAULT_RETRIEVAL_LOCALE],
        includeFamilySupportingAliases: false,
        outPath: null
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locales = parseLocales(arg.slice('--locale='.length));
            continue;
        }
        if (arg.startsWith('--locales=')) {
            options.locales = parseLocales(arg.slice('--locales='.length));
            continue;
        }
        if (arg === '--include-family-supporting') {
            options.includeFamilySupportingAliases = true;
            continue;
        }
        if (arg === '--no-family-supporting') {
            options.includeFamilySupportingAliases = false;
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.locales.length === 0) {
        throw new Error('--locale/--locales must include at least one locale.');
    }
    return options;
}
function parseLocales(value) {
    return Array.from(new Set(value
        .split(',')
        .map((locale) => locale.trim())
        .filter(Boolean))).sort();
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-alias-ngram-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `[--locale=${DEFAULT_RETRIEVAL_LOCALE}|--locales=en,ro,hu,et]`,
        '[--include-family-supporting|--no-family-supporting]',
        '[--out=artifacts/runtime/occupation-alias-ngrams.esco_1_2_1.en.family.binary.manifest.json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation alias-ngram artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
