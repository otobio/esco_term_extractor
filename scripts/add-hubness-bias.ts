/**
 * Backfill the hubness bias into an already-built index without re-embedding:
 * loads vectors.bin + index.meta.json, computes each term's similarity to the
 * global centroid, writes it back into the meta (and bumps the schema version).
 *
 *   tsx scripts/add-hubness-bias.ts --data-dir data-ml
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { INDEX_SCHEMA_VERSION, VectorStore } from '../src/vector-store.ts';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string', default: 'data-ml' } } });
const dir = values['data-dir']!;

async function main() {
  const meta = JSON.parse(await readFile(join(dir, 'index.meta.json'), 'utf8'));
  const buf = await readFile(join(dir, 'vectors.bin'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const vectors = new Float32Array(ab);

  console.log(`Computing hubness bias for ${meta.count} x ${meta.dim} vectors...`);
  const bias = VectorStore.computeBias(meta.dim, vectors, meta.count);

  // Quick sanity: report the highest-bias (most hub-like) terms.
  const idx = [...bias.keys()].sort((a, b) => bias[b] - bias[a]);
  console.log('Top hub terms (highest centroid similarity):');
  for (const i of idx.slice(0, 12)) {
    console.log(`  ${bias[i].toFixed(3)}  ${meta.terms[i].bucket}: ${meta.terms[i].displayName}`);
  }

  meta.bias = Array.from(bias);
  meta.schemaVersion = INDEX_SCHEMA_VERSION;
  await writeFile(join(dir, 'index.meta.json'), JSON.stringify(meta));
  console.log(`\nWrote bias into ${dir}/index.meta.json (schemaVersion ${INDEX_SCHEMA_VERSION}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
