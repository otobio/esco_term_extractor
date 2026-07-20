#!/usr/bin/env tsx
/**
 * FINITE-bucket eval for the rule-based inference modules, run DIRECTLY on the gold
 * set's full text (title + description). These modules are model-free and OS-free, so
 * this isolates the quality of our per-bucket inference — and, unlike the title-only
 * eval, it measures the buckets where the signal actually lives (mostly the body).
 *
 * acc = correct / N(gold present)  (recall over records that HAVE the bucket).
 *
 *   tsx scripts/eval-finite.ts [--gold data/gold.json] [--body|--title-only]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inferEmployment } from '../src/inference/employment.ts';
import { inferLevel } from '../src/inference/level.ts';
import { inferQualifications } from '../src/inference/qualifications.ts';
import { inferSchedule } from '../src/inference/schedule.ts';
import type { InferredTerm } from '../src/inference/shared.ts';
import { inferWorkplace } from '../src/inference/workplace.ts';
import { splitClauses } from '../src/tokenizer.ts';

const { values } = parseArgs({
  options: { gold: { type: 'string', default: 'data/gold.json' }, 'title-only': { type: 'boolean', default: false } },
});

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const slug = (key: string) => key.split(':').slice(1).join('_');

const INFER: Record<string, (c: ReturnType<typeof splitClauses>) => InferredTerm[]> = {
  employment: inferEmployment,
  schedule: inferSchedule,
  level: inferLevel,
  workplace: inferWorkplace,
  qualifications: inferQualifications,
};

/** Finite match: gold slug === inferred slug tail; qualifications = key contains gold. */
function hit(bucket: string, goldLabel: string, key: string): boolean {
  const g = norm(goldLabel);
  const s = norm(slug(key));
  if (bucket === 'qualifications') return norm(key).includes(g) || s.includes(g);
  return s === g;
}

interface GoldItem {
  title: string;
  description?: string;
  gold: Record<string, string[] | Record<string, unknown> | null>;
}

async function main() {
  const gold: GoldItem[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const agg: Record<string, { tp: number; fp: number; fn: number; fnEx: string[] }> = {};
  for (const b of Object.keys(INFER)) agg[b] = { tp: 0, fp: 0, fn: 0, fnEx: [] };

  for (const item of gold) {
    const text = values['title-only'] ? item.title : `${item.title}. ${item.description ?? ''}`;
    const clauses = splitClauses(text, 'text');
    for (const [b, fn] of Object.entries(INFER)) {
      const g = (item.gold[b] as string[]) ?? [];
      const keys = fn(clauses).map((t) => t.canonicalKey);
      const matchedG = g.filter((gl) => keys.some((k) => hit(b, gl, k)));
      const matchedK = keys.filter((k) => g.some((gl) => hit(b, gl, k)));
      agg[b].tp += matchedG.length;
      agg[b].fn += g.length - matchedG.length;
      agg[b].fp += keys.length - matchedK.length;
      for (const gl of g) if (!keys.some((k) => hit(b, gl, k))) agg[b].fnEx.push(gl);
    }
  }

  console.log(
    `\nFINITE INFERENCE EVAL over ${gold.length} listings — ${values['title-only'] ? 'TITLE only' : 'title + description'}\n`,
  );
  console.log(`${'bucket'.padEnd(16)}${'N(gold)'.padStart(8)}${'acc'.padStart(8)}${'prec'.padStart(8)}   (tp/fp/fn)`);
  console.log('-'.repeat(60));
  for (const [b, t] of Object.entries(agg)) {
    const n = t.tp + t.fn;
    const acc = n ? t.tp / n : 0;
    const p = t.tp + t.fp ? t.tp / (t.tp + t.fp) : 0;
    console.log(
      `${b.padEnd(16)}${String(n).padStart(8)}${(acc * 100).toFixed(0).padStart(7)}%${(p * 100).toFixed(0).padStart(7)}%   (${t.tp}/${t.fp}/${t.fn})`,
    );
  }
  const tally = (xs: string[]) => {
    const c: Record<string, number> = {};
    for (const x of xs) c[x] = (c[x] ?? 0) + 1;
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}×${n}`)
      .join(', ');
  };
  console.log(`\nTOP FN`);
  for (const [b, t] of Object.entries(agg)) if (t.fnEx.length) console.log(`[${b}] ${tally(t.fnEx)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
