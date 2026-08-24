import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { buildOccupationFamilyCapabilityRelevanceReviewData, buildOccupationFamilyCapabilityRelevanceBinaryFiles, defaultOccupationFamilyCapabilityRelevanceManifestPath, FAMILY_CAPABILITY_RELEVANCE_BINARY_SCHEMA_VERSION } from '../runtime/occupation-family-capability-relevance-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { defaultRuntimeReviewJsonPath, runtimeReviewArtifactBaseName, writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const outPath = path.resolve(options.outPath);
    const directory = path.dirname(outPath);
    const prefix = path.basename(outPath, '.manifest.json');
    const records = searchMetaArtifact.getAllRecordsWithDetails();
    const binary = buildOccupationFamilyCapabilityRelevanceBinaryFiles(records, prefix);
    const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
    const manifest = {
        schemaVersion: FAMILY_CAPABILITY_RELEVANCE_BINARY_SCHEMA_VERSION,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        totalFamilies: binary.totalFamilies,
        locales: binary.locales,
        lowConfidenceLocales: binary.lowConfidenceLocales,
        stringCount: binary.stringCount,
        familyKeyCount: binary.familyKeyCount,
        familyTokenValueCount: binary.familyTokenValueCount,
        genericityLocaleCount: binary.genericityLocaleCount,
        genericityTokenValueCount: binary.genericityTokenValueCount,
        files: binary.manifestFiles
    };
    await mkdir(directory, { recursive: true });
    await Promise.all([
        writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
        ...Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(directory, fileName), buffer))
    ]);
    if (reviewJsonPath) {
        await writeRuntimeReviewJson(reviewJsonPath, buildOccupationFamilyCapabilityRelevanceReviewData(records));
    }
    console.log(`Exported binary family-capability relevance to ${outPath}`);
    if (reviewJsonPath) {
        console.log(`review_json=${reviewJsonPath}`);
    }
    console.log([
        `source=${options.sourceName}`,
        `total_families=${binary.totalFamilies}`,
        `locales=${binary.locales.join(',')}`,
        `family_keys=${binary.familyKeyCount}`,
        `family_token_values=${binary.familyTokenValueCount}`
    ].join('  '));
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: defaultOccupationFamilyCapabilityRelevanceManifestPath(DEFAULT_ESCO_SOURCE_NAME),
        reviewJsonOutPath: defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-family-capability-relevance', DEFAULT_ESCO_SOURCE_NAME))
    };
    let outPathExplicit = false;
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            options.reviewJsonOutPath = defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-family-capability-relevance', options.sourceName));
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            outPathExplicit = true;
            continue;
        }
        if (arg.startsWith('--review-json-out=')) {
            options.reviewJsonOutPath = arg.slice('--review-json-out='.length).trim();
            continue;
        }
        if (arg === '--no-review-json') {
            options.reviewJsonOutPath = null;
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (!outPathExplicit) {
        options.outPath = defaultOccupationFamilyCapabilityRelevanceManifestPath(options.sourceName);
    }
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-family-capability-relevance-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `[--out=${defaultOccupationFamilyCapabilityRelevanceManifestPath(DEFAULT_ESCO_SOURCE_NAME)}]`,
        '[--review-json-out=data/runtime-review/occupation-family-capability-relevance.esco_1_2_1.json]',
        '[--no-review-json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation family-capability relevance artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
