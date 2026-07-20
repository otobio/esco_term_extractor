/**
 * Snapshot the location hierarchy from OpenSearch `canonical_relationships` into a
 * self-contained JSONL file. Each row is a `parent contains child` edge; the
 * gazetteer build walks these to attach every place to its county + region.
 *
 *   tsx scripts/snapshot-relationships.ts [--url http://localhost:9201]
 *     [--index canonical_relationships] [--out data/relationships.jsonl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' },
    index: { type: 'string', default: 'canonical_relationships' },
    out: { type: 'string', default: 'data/relationships.jsonl' },
    size: { type: 'string', default: '5000' },
  },
});

const url = values.url!.replace(/\/$/, '');
const outPath = resolve(values.out!);

interface RelSource {
  parent_canonical_key: string;
  child_canonical_key: string;
  relationship_type: string;
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await opensearchFetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`Snapshotting location edges from ${url}/${values.index} -> ${outPath}`);
  await mkdir(dirname(outPath), { recursive: true });

  const query = {
    bool: {
      filter: [{ term: { relationship_type: 'location_contains' } }, { prefix: { parent_canonical_key: 'location:' } }],
    },
  };

  const lines: string[] = [];
  let scroll: string | undefined;
  let total = 0;
  let page = await post(`/${values.index}/_search?scroll=2m`, {
    size: Number(values.size),
    _source: ['parent_canonical_key', 'child_canonical_key'],
    query,
  });

  while (true) {
    const hits = page.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) {
      const s = h._source as RelSource;
      lines.push(JSON.stringify({ parentKey: s.parent_canonical_key, childKey: s.child_canonical_key }));
    }
    total += hits.length;
    scroll = page._scroll_id;
    process.stdout.write(`\r  fetched ${total}`);
    page = await post('/_search/scroll', { scroll: '2m', scroll_id: scroll });
  }
  process.stdout.write('\n');

  if (scroll) {
    await opensearchFetch(`${url}/_search/scroll`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_id: [scroll] }),
    }).catch(() => undefined);
  }

  await writeFile(outPath, `${lines.join('\n')}\n`);
  console.log(`Wrote ${total} location edges to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
