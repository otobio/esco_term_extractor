import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { buildOccupationFamilyProfileRecords, defaultOccupationFamilyProfileManifestPath, defaultOccupationFamilyProfileRecordsPath } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationSearchMetaArtifactWithDetailsRequired } from '../runtime/occupation-search-meta-artifact.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactWithDetailsRequired(options.sourceName);
    const records = buildOccupationFamilyProfileRecords(searchMetaArtifact.artifact.records);
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationFamilyProfileManifestPath(options.sourceName));
    const recordsPath = path.resolve(path.dirname(manifestPath), path.basename(defaultOccupationFamilyProfileRecordsPath(options.sourceName)));
    const manifest = {
        schemaVersion: 1,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        count: records.length,
        recordsPath: path.relative(path.dirname(manifestPath), recordsPath)
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(recordsPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    console.log(`Exported ${manifest.count} occupation family-profile records to ${manifestPath}`);
    console.log(`records=${recordsPath}`);
    console.log(`source=${manifest.sourceName}`);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: null
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
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
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-family-profile-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--out=artifacts/runtime/occupation-family-profiles.esco_1_2_1.manifest.json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation family-profile artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
