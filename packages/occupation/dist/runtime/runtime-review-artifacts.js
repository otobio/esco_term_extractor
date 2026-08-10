import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeFileSegment } from '../utils/validation.js';
const DEFAULT_RUNTIME_REVIEW_DIR = path.join(process.cwd(), 'data', 'runtime-review');
export function defaultRuntimeReviewDir() {
    return DEFAULT_RUNTIME_REVIEW_DIR;
}
export function defaultRuntimeReviewJsonPath(baseName) {
    return path.join(DEFAULT_RUNTIME_REVIEW_DIR, `${baseName}.json`);
}
export function defaultRuntimeReviewJsonlPath(baseName) {
    return path.join(DEFAULT_RUNTIME_REVIEW_DIR, `${baseName}.jsonl`);
}
export function runtimeReviewArtifactBaseName(name, sourceName) {
    return sourceName ? `${name}.${safeFileSegment(sourceName)}` : name;
}
export function defaultOccupationAliasNgramReviewJsonlPath(sourceName, locale, includeFamilySupportingAliases) {
    return defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName(`occupation-alias-ngrams.${safeFileSegment(sourceName)}.${safeFileSegment(locale)}.${includeFamilySupportingAliases ? 'family' : 'nofamily'}`));
}
export async function writeRuntimeReviewJson(reviewPath, value) {
    await mkdir(path.dirname(reviewPath), { recursive: true });
    await writeFile(reviewPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export async function writeRuntimeReviewJsonl(reviewPath, records) {
    await mkdir(path.dirname(reviewPath), { recursive: true });
    const lines = Array.from(records, (record) => JSON.stringify(record));
    await writeFile(reviewPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}
