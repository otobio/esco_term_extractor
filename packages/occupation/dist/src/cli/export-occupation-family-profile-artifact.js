import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { FAMILY_PROFILE_BINARY_SCHEMA_VERSION, buildOccupationFamilyProfileBinaryFiles, buildOccupationFamilyProfileRecords, defaultOccupationFamilyProfileManifestPath } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { defaultRuntimeReviewJsonlPath, runtimeReviewArtifactBaseName, writeRuntimeReviewJsonl } from '../runtime/runtime-review-artifacts.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const records = buildOccupationFamilyProfileRecords(searchMetaArtifact.getAllRecordsWithDetails());
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationFamilyProfileManifestPath(options.sourceName));
    const prefix = path.basename(manifestPath, '.manifest.json');
    const binary = buildOccupationFamilyProfileBinaryFiles(records, prefix);
    const reviewJsonlPath = options.reviewJsonlOutPath ? path.resolve(options.reviewJsonlOutPath) : null;
    const manifest = {
        schemaVersion: FAMILY_PROFILE_BINARY_SCHEMA_VERSION,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        count: records.length,
        localeProfileCount: binary.localeProfileCount,
        sourceRowCount: binary.sourceRowCount,
        tokenValueCount: binary.tokenValueCount,
        phraseValueCount: binary.phraseValueCount,
        leafTokenKeyCount: binary.leafTokenKeyCount,
        leafIdCount: binary.leafIdCount,
        profileTokenKeyCount: binary.profileTokenKeyCount,
        profileTokenPostingCount: binary.profileTokenPostingCount,
        stringCount: binary.stringCount,
        files: binary.manifestFiles
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    for (const [fileName, buffer] of binary.buffers) {
        await writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer);
    }
    if (reviewJsonlPath) {
        await writeRuntimeReviewJsonl(reviewJsonlPath, records);
    }
    console.log(`Exported ${manifest.count} occupation family-profile records to ${manifestPath}`);
    if (reviewJsonlPath) {
        console.log(`review_jsonl=${reviewJsonlPath}`);
    }
    console.log(`strings=${manifest.stringCount}`);
    console.log(`locale_profiles=${manifest.localeProfileCount}`);
    console.log(`source_rows=${manifest.sourceRowCount}`);
    console.log(`source=${manifest.sourceName}`);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: null,
        reviewJsonlOutPath: defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName('occupation-family-profiles', DEFAULT_ESCO_SOURCE_NAME))
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            options.reviewJsonlOutPath = defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName('occupation-family-profiles', options.sourceName));
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--review-jsonl-out=')) {
            options.reviewJsonlOutPath = arg.slice('--review-jsonl-out='.length).trim();
            continue;
        }
        if (arg === '--no-review-jsonl') {
            options.reviewJsonlOutPath = null;
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
        '[--out=artifacts/runtime/occupation-family-profiles.esco_1_2_1.manifest.json]',
        '[--review-jsonl-out=data/runtime-review/occupation-family-profiles.esco_1_2_1.jsonl]',
        '[--no-review-jsonl]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation family-profile artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
