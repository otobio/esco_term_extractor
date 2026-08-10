import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import {
  defaultRuntimeReviewJsonlPath,
  runtimeReviewArtifactBaseName,
  writeRuntimeReviewJsonl
} from '../runtime/runtime-review-artifacts.js';

type CliOptions = {
  sourceName: string;
  reviewJsonlOutPath: string;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const artifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
  const reviewJsonlPath = path.resolve(options.reviewJsonlOutPath);

  await writeRuntimeReviewJsonl(reviewJsonlPath, artifact.getAllRecordsWithDetails());

  console.log(`Exported occupation search-meta review mirror to ${reviewJsonlPath}`);
  console.log(`source=${options.sourceName}`);
  console.log(`records=${artifact.artifact.count}`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    reviewJsonlOutPath: defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName('occupation-search-meta', DEFAULT_ESCO_SOURCE_NAME))
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      options.reviewJsonlOutPath = defaultRuntimeReviewJsonlPath(
        runtimeReviewArtifactBaseName('occupation-search-meta', options.sourceName)
      );
      continue;
    }

    if (arg.startsWith('--review-jsonl-out=')) {
      options.reviewJsonlOutPath = arg.slice('--review-jsonl-out='.length).trim();
      continue;
    }

    if (arg === '--help') {
      console.log(
        [
          'Usage: node dist/cli/export-occupation-search-meta-review-artifact.js',
          `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
          '[--review-jsonl-out=data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl]'
        ].join(' ')
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation search-meta review export failed.');
  console.error(message);
  process.exitCode = 1;
});
