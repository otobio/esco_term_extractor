#!/usr/bin/env tsx
/**
 * Train the multinomial logistic-regression level classifier on the synthetic set
 * from gen-level-dataset.ts, and write the model to data/level-lr.json.
 *
 * Plain SGD with softmax cross-entropy + L2 — no Python, no ML dependency. The
 * corpus is ~1k short titles, so this converges in seconds. An EXPLICIT vocabulary
 * (min document frequency) keeps the model small and every weight interpretable.
 * Near-zero weights are pruned on save so the JSON stays a few hundred KB.
 *
 *   tsx scripts/train-level-lr.ts [--data data/level-train.jsonl] [--out data/level-lr.json]
 *     [--epochs 300] [--lr 0.5] [--l2 1e-4] [--min-df 2]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { levelFeatures, vectorize } from '../src/classifier/level-features.ts';
import type { LevelLrModel } from '../src/classifier/level-lr.ts';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/level-train.jsonl' },
    out: { type: 'string', default: 'data/level-lr.json' },
    epochs: { type: 'string', default: '300' },
    lr: { type: 'string', default: '0.5' },
    l2: { type: 'string', default: '1e-4' },
    'min-df': { type: 'string', default: '2' },
    'prune-below': { type: 'string', default: '0.01' },
    seed: { type: 'string', default: '13' },
  },
});

interface Row {
  title: string;
  label: string;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const epochs = Number(values.epochs);
  const lr0 = Number(values.lr);
  const l2 = Number(values.l2);
  const minDf = Number(values['min-df']);
  const pruneBelow = Number(values['prune-below']);
  const rand = rng(Number(values.seed));

  const raw = await readFile(resolve(values.data!), 'utf8');
  const rows: Row[] = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  // Vocabulary: features seen in ≥ minDf distinct titles (drops singletons/noise).
  const df = new Map<string, number>();
  for (const r of rows) {
    for (const f of new Set(levelFeatures(r.title))) df.set(f, (df.get(f) ?? 0) + 1);
  }
  const vocab = new Map<string, number>();
  for (const [f, n] of df) if (n >= minDf) vocab.set(f, vocab.size);
  const V = vocab.size;

  const classes = [...new Set(rows.map((r) => r.label))].sort();
  const classIx = new Map(classes.map((c, i) => [c, i]));
  const C = classes.length;

  // Pre-vectorize every example once.
  const data = rows.map((r) => ({ x: vectorize(r.title, vocab), y: classIx.get(r.label)! }));

  // Dense weights during training (C×V); sparsified on save.
  const W = Array.from({ length: C }, () => new Float64Array(V));
  const b = new Float64Array(C);
  const z = new Float64Array(C);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const lr = lr0 / (1 + 0.05 * epoch);
    // Shuffle indices each epoch.
    const order = data.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let loss = 0;
    for (const idx of order) {
      const { x, y } = data[idx];
      // forward
      for (let c = 0; c < C; c++) {
        let s = b[c];
        const wc = W[c];
        for (const [k, v] of x) s += wc[k] * v;
        z[c] = s;
      }
      let mx = -Infinity;
      for (let c = 0; c < C; c++) if (z[c] > mx) mx = z[c];
      let sum = 0;
      for (let c = 0; c < C; c++) {
        z[c] = Math.exp(z[c] - mx);
        sum += z[c];
      }
      loss += -Math.log(z[y] / sum + 1e-12);
      // backward
      for (let c = 0; c < C; c++) {
        const dz = z[c] / sum - (c === y ? 1 : 0);
        b[c] -= lr * dz;
        const wc = W[c];
        for (const [k, v] of x) wc[k] -= lr * (dz * v + l2 * wc[k]);
      }
    }
    if (epoch % 50 === 0 || epoch === epochs - 1) {
      process.stderr.write(`  epoch ${epoch}  mean loss ${(loss / data.length).toFixed(4)}\n`);
    }
  }

  // Training accuracy (sanity only — real eval is gold, OS-free, in eval-level-lr.ts).
  let correct = 0;
  for (const { x, y } of data) {
    for (let c = 0; c < C; c++) {
      let s = b[c];
      for (const [k, v] of x) s += W[c][k] * v;
      z[c] = s;
    }
    let arg = 0;
    for (let c = 1; c < C; c++) if (z[c] > z[arg]) arg = c;
    if (arg === y) correct++;
  }

  // Sparsify: keep weights whose magnitude clears the prune floor.
  const weights: Record<number, number>[] = W.map((wc) => {
    const row: Record<number, number> = {};
    for (let k = 0; k < V; k++) if (Math.abs(wc[k]) >= pruneBelow) row[k] = Number(wc[k].toFixed(5));
    return row;
  });
  const kept = weights.reduce((n, r) => n + Object.keys(r).length, 0);

  const model: LevelLrModel = {
    classes,
    vocab: Object.fromEntries(vocab),
    bias: [...b].map((x) => Number(x.toFixed(5))),
    weights,
  };
  await writeFile(resolve(values.out!), JSON.stringify(model));

  console.log(`\nclasses=${C}  vocab=${V}  kept weights=${kept} (pruned <|${pruneBelow}|)`);
  console.log(`train accuracy=${((correct / data.length) * 100).toFixed(1)}%  → wrote ${values.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
