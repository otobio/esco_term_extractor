import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeFileSegment } from '../utils/validation.js';

const DEFAULT_RUNTIME_REVIEW_DIR = path.join(process.cwd(), 'data', 'runtime-review');

export function defaultRuntimeReviewDir(): string {
  return DEFAULT_RUNTIME_REVIEW_DIR;
}

export function defaultRuntimeReviewJsonPath(baseName: string): string {
  return path.join(DEFAULT_RUNTIME_REVIEW_DIR, `${baseName}.json`);
}

export function defaultRuntimeReviewJsonlPath(baseName: string): string {
  return path.join(DEFAULT_RUNTIME_REVIEW_DIR, `${baseName}.jsonl`);
}

export function runtimeReviewArtifactBaseName(name: string, sourceName?: string): string {
  return sourceName ? `${name}.${safeFileSegment(sourceName)}` : name;
}

export function defaultOccupationAliasNgramReviewJsonlPath(
  sourceName: string,
  locale: string,
  includeFamilySupportingAliases: boolean
): string {
  return defaultRuntimeReviewJsonlPath(
    runtimeReviewArtifactBaseName(
      `occupation-alias-ngrams.${safeFileSegment(sourceName)}.${safeFileSegment(locale)}.${
        includeFamilySupportingAliases ? 'family' : 'nofamily'
      }`
    )
  );
}

export async function writeRuntimeReviewJson(reviewPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeRuntimeReviewJsonl(reviewPath: string, records: Iterable<unknown>): Promise<void> {
  await mkdir(path.dirname(reviewPath), { recursive: true });
  const lines = Array.from(records, (record) => JSON.stringify(record));
  await writeFile(reviewPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}
