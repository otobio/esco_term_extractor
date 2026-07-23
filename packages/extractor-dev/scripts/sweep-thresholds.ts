/**
 * Threshold sweep for the SEMANTIC buckets against the gold set.
 *
 * Adding alias vectors to the index raises correct-match scores but also lifts
 * some noise, so the old thresholds under-perform. This captures every candidate
 * once (semanticThreshold dropped to 0), then replays P/R/F1 across a grid of
 * thresholds offline — finding the F1-optimal operating point per bucket in a
 * single model pass instead of one slow gold run per candidate threshold.
 *
 *   tsx scripts/sweep-thresholds.ts [--gold data/gold.json] [--data-dir data]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BucketName } from '../../../src/types.ts';
import { Embedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

const SEM_MATCH = 0.62; // same gold-vs-label match bar as eval-gold.ts
const GRID = [0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.64, 0.66];
const SEMANTIC: BucketName[] = ['occupation', 'capabilities', 'benefits', 'sector', 'compensation'];
const CAPS: Record<string, number> = {
  occupation: 5,
  capabilities: 15,
  benefits: 10,
  sector: 4,
  compensation: 8,
};

const { values } = parseArgs({
  options: { gold: { type: 'string', default: 'data/gold.json' }, 'data-dir': { type: 'string', default: 'data' } },
});

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface GoldItem {
  title: string;
  description: string;
  gold: Record<string, string[] | null>;
}
interface Cand {
  displayName: string;
  score: number;
}

async function main() {
  const gold: GoldItem[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const extractor = await TermExtractor.load({ dataDir: resolve(values['data-dir']!), defaultLanguages: ['ro', 'en'] });
  const embedder = new Embedder({ model: extractor.model });

  // Capture, per listing per bucket: gold phrases + all candidates (score>=0).
  const captured: { gold: Record<string, string[]>; cand: Record<string, Cand[]> }[] = [];
  const overrides = Object.fromEntries(SEMANTIC.map((b) => [b, { semanticThreshold: 0, maxPerBucket: 50 }]));
  for (const item of gold) {
    const r = await extractor.extract(
      { title: item.title, description: item.description },
      { languages: ['ro', 'en'], bucketOverrides: overrides },
    );
    const g: Record<string, string[]> = {};
    const c: Record<string, Cand[]> = {};
    for (const b of SEMANTIC) {
      g[b] = (item.gold[b] as string[]) ?? [];
      c[b] = (r.matchesByBucket[b] ?? []).map((t) => ({ displayName: t.displayName, score: t.score }));
    }
    captured.push({ gold: g, cand: c });
  }

  // Embed every gold phrase + candidate displayName once for semantic matching.
  const vecCache = new Map<string, Float32Array>();
  const toEmbed = new Set<string>();
  for (const cap of captured)
    for (const b of SEMANTIC) {
      for (const gl of cap.gold[b]) if (norm(gl)) toEmbed.add(norm(gl));
      for (const cd of cap.cand[b]) if (norm(cd.displayName)) toEmbed.add(norm(cd.displayName));
    }
  const list = [...toEmbed];
  const vecs = await embedder.embed(list);
  list.forEach((s, i) => vecCache.set(s, vecs[i]));
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
  const semMatch = (g: string, e: string) => {
    const gv = vecCache.get(norm(g));
    const ev = vecCache.get(norm(e));
    return gv && ev ? dot(gv, ev) >= SEM_MATCH : false;
  };

  // Sweep.
  console.log(`\nTHRESHOLD SWEEP (F1 %, best per bucket marked *)\n`);
  console.log(`${'bucket'.padEnd(14)}${GRID.map((t) => t.toFixed(2).padStart(6)).join('')}`);
  console.log('-'.repeat(14 + GRID.length * 6));
  for (const b of SEMANTIC) {
    const f1s = GRID.map((t) => {
      let tp = 0,
        fp = 0,
        fn = 0;
      for (const cap of captured) {
        const g = cap.gold[b];
        const ex = cap.cand[b]
          .filter((c) => c.score >= t)
          .sort((a, z) => z.score - a.score)
          .slice(0, CAPS[b]);
        const matchedG = g.filter((gl) => ex.some((e) => semMatch(gl, e.displayName)));
        const matchedE = ex.filter((e) => g.some((gl) => semMatch(gl, e.displayName)));
        tp += matchedG.length;
        fn += g.length - matchedG.length;
        fp += ex.length - matchedE.length;
      }
      const p = tp + fp ? tp / (tp + fp) : 0,
        r = tp + fn ? tp / (tp + fn) : 0;
      return p + r ? (2 * p * r) / (p + r) : 0;
    });
    const best = Math.max(...f1s);
    const row = f1s.map((f) => `${(f * 100).toFixed(0)}${f === best ? '*' : ' '}`.padStart(6)).join('');
    console.log(`${b.padEnd(14)}${row}   best t=${GRID[f1s.indexOf(best)].toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
