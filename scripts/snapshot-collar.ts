/**
 * Snapshot the occupation → collar_kind edges from `canonical_relationships` into a
 * compact map (data/occupation_collar.json). collar_kind is almost never stated in
 * a job post but is a property of the occupation, so we derive it from the
 * extracted occupation via this map — see src/derive/collar.ts.
 *
 *   tsx scripts/snapshot-collar.ts [--url http://localhost:9201]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' },
    index: { type: 'string', default: 'canonical_relationships' },
    out: { type: 'string', default: 'data/occupation_collar.json' },
  },
});

const url = values.url!.replace(/\/$/, '');
const outPath = resolve(values.out!);

interface Src {
  parent_canonical_key: string;
  child_canonical_key: string;
  confidence?: number;
  weight?: number;
}

async function main() {
  const res = await opensearchFetch(`${url}/${values.index}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: 10000,
      _source: ['parent_canonical_key', 'child_canonical_key', 'confidence', 'weight'],
      query: { term: { relationship_type: 'occupation_to_collar_kind' } },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = (await res.json()) as { hits: { hits: { _source: Src }[] } };

  // Keep the highest-weight collar per occupation (data is 1:1, but be safe).
  const best = new Map<string, { collar: string; confidence: number; weight: number }>();
  for (const h of data.hits.hits) {
    const s = h._source;
    const prev = best.get(s.parent_canonical_key);
    const weight = s.weight ?? 0;
    if (!prev || weight > prev.weight) {
      best.set(s.parent_canonical_key, { collar: s.child_canonical_key, confidence: s.confidence ?? 0.9, weight });
    }
  }

  const map: Record<string, { collar: string; confidence: number }> = {};
  for (const [occ, v] of best) map[occ] = { collar: v.collar, confidence: v.confidence };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(map));
  console.log(`Wrote ${Object.keys(map).length} occupation→collar_kind entries to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
