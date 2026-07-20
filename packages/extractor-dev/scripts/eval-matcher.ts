#!/usr/bin/env tsx
/**
 * Gold-set eval for the term MATCHER (surface → canonical key).
 *
 * The gold set is listing→phrases; the matcher is surface→key. So we treat each
 * gold occupation/capabilities phrase as a surface, resolve it through the
 * matcher against the live index, and score the resolution by semantic match
 * between the resolved concept's display_name and the gold phrase (cosine ≥
 * SEM_MATCH — same bar as eval-gold). Reports resolved-correct / resolved-wrong
 * / ambiguous / unresolved. No locale is passed (all-language search) — the
 * conservative case; real callers pass a locale and do better.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpenSearchClient } from '../../../src/matchers/os-client.ts';
import { buildFilters, strategyForBucket } from '../../../src/matchers/resolve.ts';
import { Embedder } from '../src/embedder.ts';

const SEM_MATCH = 0.62;
const BUCKETS = ['occupation', 'capabilities'] as const;

interface Item {
  bucket: string;
  surface: string;
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function main() {
  const gold = JSON.parse(await readFile(resolve('data/gold.json'), 'utf8')) as any[];
  const client = createOpenSearchClient();
  const modelId = await client.queryModelId();
  const ctx = { queryModelId: modelId, buildFilters };
  const embedder = new Embedder({ model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' });

  const items: Item[] = [];
  for (const it of gold)
    for (const b of BUCKETS) for (const s of it.gold?.[b] ?? []) items.push({ bucket: b, surface: s });

  // Resolve all surfaces, chunked into msearch batches; keep the top hit's display_name.
  type Res = { item: Item; status: string; key?: string; displayName?: string };
  const results: Res[] = [];
  const CHUNK = 100;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK);
    const strategies = batch.map((it) => strategyForBucket(it.bucket));
    const responses = await client.msearch(batch.map((it, j) => strategies[j].buildQuery(it, ctx)));
    batch.forEach((it, j) => {
      const r = strategies[j].select(responses[j], it) as any;
      const top = (responses[j] as any)?.hits?.hits?.[0]?._source;
      results.push({
        item: it,
        status: r.status,
        key: r.key,
        displayName: r.status === 'resolved' ? top?.display_name : undefined,
      });
    });
    process.stdout.write(`\r  resolved ${Math.min(i + CHUNK, items.length)}/${items.length}`);
  }
  process.stdout.write('\n');

  // Embed gold phrase + resolved displayName for the semantic correctness check.
  const toEmbed = new Set<string>();
  for (const r of results) {
    toEmbed.add(norm(r.item.surface));
    if (r.displayName) toEmbed.add(norm(r.displayName));
  }
  const list = [...toEmbed].filter(Boolean);
  const vecs = await embedder.embed(list);
  const cache = new Map(list.map((s, i) => [s, vecs[i]]));
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
  const correct = (a: string, b?: string) => {
    const va = cache.get(norm(a));
    const vb = b ? cache.get(norm(b)) : undefined;
    return va && vb ? dot(va, vb) >= SEM_MATCH : false;
  };

  for (const b of BUCKETS) {
    const rs = results.filter((r) => r.item.bucket === b);
    const resolved = rs.filter((r) => r.status === 'resolved');
    const good = resolved.filter((r) => correct(r.item.surface, r.displayName)).length;
    const bad = resolved.length - good;
    const amb = rs.filter((r) => r.status === 'ambiguous').length;
    const un = rs.filter((r) => r.status === 'unresolved').length;
    const pct = (n: number) => `${((n / rs.length) * 100).toFixed(0)}%`;
    console.log(`\n${b} (${rs.length} gold surfaces)`);
    console.log(`  resolved-correct: ${good} (${pct(good)})`);
    console.log(`  resolved-WRONG:   ${bad} (${pct(bad)})`);
    console.log(`  ambiguous:        ${amb} (${pct(amb)})`);
    console.log(`  unresolved:       ${un} (${pct(un)})`);
    console.log(
      `  precision (correct / resolved): ${resolved.length ? ((good / resolved.length) * 100).toFixed(0) : 0}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
