/**
 * Snapshot occupation → capability/knowledge edges (essential & optional) into a
 * packed binary (data/occupation_capabilities.ocb, zero-parse at load time). Used
 * to re-rank/backfill extracted capabilities toward the ones the taxonomy says the
 * occupation actually needs.
 *
 *   tsx scripts/snapshot-occupation-capabilities.ts [--url http://localhost:9201]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import { packOccupationCapabilities } from '../src/capabilities-bin.js';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' },
    index: { type: 'string', default: 'canonical_relationships' },
    out: { type: 'string', default: 'data/occupation_capabilities.ocb' },
  },
});

const url = values.url!.replace(/\/$/, '');
const outPath = resolve(values.out!);
const ESSENTIAL = new Set(['occupation_to_essential_capability', 'occupation_to_essential_knowledge']);
const OPTIONAL = new Set(['occupation_to_optional_capability', 'occupation_to_optional_knowledge']);

interface Src {
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
  const essential = new Map<string, Set<string>>();
  const optional = new Map<string, Set<string>>();
  const query = { terms: { relationship_type: [...ESSENTIAL, ...OPTIONAL] } };

  let scroll: string | undefined;
  let total = 0;
  let page = await post(`/${values.index}/_search?scroll=2m`, {
    size: 5000,
    _source: ['parent_canonical_key', 'child_canonical_key', 'relationship_type'],
    query,
  });
  while (true) {
    const hits = page.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) {
      const s = h._source as Src;
      const target = ESSENTIAL.has(s.relationship_type) ? essential : optional;
      let set = target.get(s.parent_canonical_key);
      if (!set) target.set(s.parent_canonical_key, (set = new Set()));
      set.add(s.child_canonical_key);
    }
    total += hits.length;
    scroll = page._scroll_id;
    process.stdout.write(`\r  fetched ${total}`);
    page = await post('/_search/scroll', { scroll: '2m', scroll_id: scroll });
  }
  process.stdout.write('\n');
  if (scroll)
    await opensearchFetch(`${url}/_search/scroll`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_id: [scroll] }),
    }).catch(() => undefined);

  const occs = new Set([...essential.keys(), ...optional.keys()]);
  const entries = [...occs].map((occ) => ({
    occupationKey: occ,
    essential: [...(essential.get(occ) ?? [])],
    optional: [...(optional.get(occ) ?? [])],
  }));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, packOccupationCapabilities(entries));
  console.log(`Wrote ${occs.size} occupations (${total} edges) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
