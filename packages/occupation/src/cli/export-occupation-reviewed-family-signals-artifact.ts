import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildReviewedFamilySignalBinaryFiles,
  defaultOccupationReviewedFamilySignalsArtifactPath,
  parseReviewedFamilySignalArtifact
} from '../runtime/occupation-reviewed-family-signals.js';
import { defaultRuntimeReviewJsonPath, writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';

const DEFAULT_SEED_PATH = path.resolve('src/runtime/seeds/occupation-reviewed-family-signals.json');

type CliOptions = {
  seedPath: string;
  outPath: string;
  reviewJsonOutPath: string | null;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const seedContents = await readFile(options.seedPath, 'utf8');
  const artifact = parseReviewedFamilySignalArtifact(seedContents, options.seedPath);
  const manifestPath = path.resolve(options.outPath);
  const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
  const prefix = path.basename(manifestPath, '.manifest.json');
  const binary = buildReviewedFamilySignalBinaryFiles(artifact, prefix);
  const manifest = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    description: artifact.description,
    ruleCount: artifact.rules.length,
    stringCount: binary.stringCount,
    termIdCount: binary.termIdCount,
    files: binary.manifestFiles
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await Promise.all(
    Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer))
  );

  if (reviewJsonPath) {
    await writeRuntimeReviewJson(reviewJsonPath, artifact);
  }

  console.log(`Exported ${artifact.rules.length} reviewed family signal rules to ${manifestPath}`);
  console.log(`seed=${path.resolve(options.seedPath)}`);
  if (reviewJsonPath) {
    console.log(`review_json=${reviewJsonPath}`);
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    seedPath: DEFAULT_SEED_PATH,
    outPath: defaultOccupationReviewedFamilySignalsArtifactPath(),
    reviewJsonOutPath: defaultRuntimeReviewJsonPath('occupation-reviewed-family-signals')
  };

  for (const arg of args) {
    if (arg.startsWith('--seed=')) {
      options.seedPath = arg.slice('--seed='.length).trim();
      continue;
    }

    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim();
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

  return options;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-occupation-reviewed-family-signals-artifact.js',
      `[--seed=${DEFAULT_SEED_PATH}]`,
      `[--out=${defaultOccupationReviewedFamilySignalsArtifactPath()}]`,
      '[--review-json-out=data/runtime-review/occupation-reviewed-family-signals.json]',
      '[--no-review-json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation reviewed family signal artifact export failed.');
  console.error(message);
  process.exitCode = 1;
});
