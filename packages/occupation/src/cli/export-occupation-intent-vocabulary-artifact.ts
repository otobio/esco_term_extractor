import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import {
  INTENT_VOCABULARY_BINARY_SCHEMA_VERSION,
  buildOccupationIntentVocabularyBinaryFiles,
  buildOccupationIntentVocabularyRecords,
  defaultOccupationIntentVocabularyOverridePath,
  defaultOccupationIntentVocabularyManifestPath,
  defaultOccupationIntentVocabularyReviewJsonlPath,
  loadOccupationIntentVocabularyOverridesIfPresent,
  type OccupationIntentVocabularyArtifactManifest
} from '../runtime/occupation-intent-vocabulary-artifact.js';
import { writeRuntimeReviewJsonl } from '../runtime/runtime-review-artifacts.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';

type CliOptions = {
  sourceName: string;
  outPath: string | null;
  reviewJsonlOutPath: string | null;
  overridePaths: string[];
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
  const overrides = await loadOccupationIntentVocabularyOverridesIfPresent(options.overridePaths);
  const records = buildOccupationIntentVocabularyRecords(searchMetaArtifact.getAllRecordsWithDetails(), overrides);
  const manifestPath = path.resolve(options.outPath ?? defaultOccupationIntentVocabularyManifestPath(options.sourceName));
  const reviewJsonlPath = options.reviewJsonlOutPath ? path.resolve(options.reviewJsonlOutPath) : null;
  const prefix = path.basename(manifestPath, '.manifest.json');
  const binary = buildOccupationIntentVocabularyBinaryFiles(records, prefix);
  const manifest = {
    schemaVersion: INTENT_VOCABULARY_BINARY_SCHEMA_VERSION,
    sourceName: options.sourceName,
    generatedAt: new Date().toISOString(),
    localeCount: records.length,
    stringCount: binary.stringCount,
    termIdCount: binary.termIdCount,
    phraseIdCount: binary.phraseIdCount,
    files: binary.manifestFiles
  } satisfies OccupationIntentVocabularyArtifactManifest;

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await Promise.all(
    Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer))
  );

  if (reviewJsonlPath) {
    await writeRuntimeReviewJsonl(reviewJsonlPath, records);
  }

  console.log(`Exported ${manifest.localeCount} occupation intent-vocabulary locale records to ${manifestPath}`);
  console.log(`strings=${path.resolve(path.dirname(manifestPath), manifest.files.strings)}`);
  console.log(`locale_rows=${path.resolve(path.dirname(manifestPath), manifest.files.localeRows)}`);
  if (reviewJsonlPath) {
    console.log(`review_jsonl=${reviewJsonlPath}`);
  }
  console.log(`source=${manifest.sourceName}`);
  for (const record of records) {
    console.log(
      [
        `locale=${record.localeCode}`,
        `role_heads=${record.roleHeadTerms.length}`,
        `role_modifiers=${record.roleModifierTerms.length}`,
        `domain_modifiers=${record.domainModifierTerms.length}`,
        `ambiguous=${record.ambiguousModifierTerms.length}`,
        `role_phrases=${record.rolePhrases?.length ?? 0}`
      ].join('  ')
    );
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    outPath: null,
    reviewJsonlOutPath: defaultOccupationIntentVocabularyReviewJsonlPath(DEFAULT_ESCO_SOURCE_NAME),
    overridePaths: ['en', 'ro', 'hu', 'et', 'unknown'].map((localeCode) => defaultOccupationIntentVocabularyOverridePath(localeCode))
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      if (options.reviewJsonlOutPath === defaultOccupationIntentVocabularyReviewJsonlPath(DEFAULT_ESCO_SOURCE_NAME)) {
        options.reviewJsonlOutPath = defaultOccupationIntentVocabularyReviewJsonlPath(options.sourceName);
      }
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

    if (arg.startsWith('--override=')) {
      options.overridePaths.push(arg.slice('--override='.length).trim());
      continue;
    }

    if (arg === '--no-overrides') {
      options.overridePaths = [];
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

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-occupation-intent-vocabulary-artifact.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--out=artifacts/runtime/occupation-intent-vocabulary.esco_1_2_1.binary.manifest.json]',
      '[--review-jsonl-out=data/runtime-review/occupation-intent-vocabulary.esco_1_2_1.jsonl]',
      '[--override=data/runtime-review/occupation-intent-vocabulary.overrides.ro.json]',
      '[--no-overrides]',
      '[--no-review-jsonl]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation intent-vocabulary artifact export failed.');
  console.error(message);
  process.exitCode = 1;
});
