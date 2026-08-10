import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import {
  buildOccupationFamilyTokenRelevanceReviewData,
  buildOccupationFamilyTokenRelevanceBinaryFiles,
  defaultOccupationFamilyTokenRelevanceManifestPath,
  FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION,
  type OccupationFamilyTokenRelevanceArtifactManifest
} from '../runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import {
  defaultRuntimeReviewJsonPath,
  runtimeReviewArtifactBaseName,
  writeRuntimeReviewJson
} from '../runtime/runtime-review-artifacts.js';

type CliOptions = {
  sourceName: string;
  outPath: string;
  reviewJsonOutPath: string | null;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
  const outPath = path.resolve(options.outPath);
  const directory = path.dirname(outPath);
  const prefix = path.basename(outPath, '.manifest.json');
  const records = searchMetaArtifact.getAllRecordsWithDetails();
  const binary = buildOccupationFamilyTokenRelevanceBinaryFiles(records, prefix);
  const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
  const manifest: OccupationFamilyTokenRelevanceArtifactManifest = {
    schemaVersion: FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION,
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
    await writeRuntimeReviewJson(reviewJsonPath, buildOccupationFamilyTokenRelevanceReviewData(records));
  }

  console.log(`Exported binary family-token relevance to ${outPath}`);
  if (reviewJsonPath) {
    console.log(`review_json=${reviewJsonPath}`);
  }
  console.log(
    [
      `source=${options.sourceName}`,
      `total_families=${binary.totalFamilies}`,
      `locales=${binary.locales.join(',')}`,
      `family_keys=${binary.familyKeyCount}`,
      `family_token_values=${binary.familyTokenValueCount}`
    ].join('  ')
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    outPath: defaultOccupationFamilyTokenRelevanceManifestPath(DEFAULT_ESCO_SOURCE_NAME),
    reviewJsonOutPath: defaultRuntimeReviewJsonPath(
      runtimeReviewArtifactBaseName('occupation-family-token-relevance', DEFAULT_ESCO_SOURCE_NAME)
    )
  };
  let outPathExplicit = false;

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      options.reviewJsonOutPath = defaultRuntimeReviewJsonPath(
        runtimeReviewArtifactBaseName('occupation-family-token-relevance', options.sourceName)
      );
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
    options.outPath = defaultOccupationFamilyTokenRelevanceManifestPath(options.sourceName);
  }

  return options;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-occupation-family-token-relevance-artifact.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `[--out=${defaultOccupationFamilyTokenRelevanceManifestPath(DEFAULT_ESCO_SOURCE_NAME)}]`,
      '[--review-json-out=data/runtime-review/occupation-family-token-relevance.esco_1_2_1.json]',
      '[--no-review-json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation family-token relevance artifact export failed.');
  console.error(message);
  process.exitCode = 1;
});
