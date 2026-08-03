/**
 * Build the packed display-title lookup used by the ingest helper.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isUsableTerm, loadDictionary } from '../src/dictionary.js';
import { buildDisplayTitleArtifact, selectDisplayTitleEntries } from '../src/display-titles.js';

const inputPath = resolve('data/dictionary.jsonl');
const outPath = resolve('data/display-titles.gtb');

async function main(): Promise<void> {
  const terms = await loadDictionary(inputPath);
  const entries = selectDisplayTitleEntries(terms.filter(isUsableTerm));
  await mkdir(dirname(outPath), { recursive: true });
  await buildDisplayTitleArtifact(entries, outPath);
  console.log(`Wrote ${entries.length} display titles to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
