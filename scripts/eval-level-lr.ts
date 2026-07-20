#!/usr/bin/env tsx
/**
 * OS-FREE evaluation of the LEVEL bucket on the held-out gold set — isolates the
 * seniority classifier from the rest of the pipeline (no OpenSearch, no dense model).
 * Runs three sources over each gold TITLE and scores each against gold level labels:
 *
 *   regex        — inferLevel() alone (today's baseline for this bucket)
 *   lr           — the logistic-regression classifier alone
 *   regex+lr     — their union (max-score per key), i.e. what shipping the LR as an
 *                  additional source would actually produce
 *
 * "acc" = recall over listings that HAVE a level label; "prec" = tp/(tp+fp). Same
 * definitions as scripts/eval-title.ts, so the numbers are directly comparable.
 *
 *   tsx scripts/eval-level-lr.ts [--gold data/gold.json] [--model data/level-lr.json] [--threshold 0.5]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inferLevelLr, loadLevelLr } from '../src/classifier/level-lr.ts';
import { inferLevel } from '../src/inference/level.ts';
import type { InferredTerm } from '../src/inference/shared.ts';
import { splitClauses } from '../src/tokenizer.ts';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: 'data/gold.json' },
    model: { type: 'string', default: 'data/level-lr.json' },
    threshold: { type: 'string', default: '0.5' },
    locale: { type: 'string', default: 'ro' },
    verbose: { type: 'boolean', default: false },
  },
});

const slug = (key: string) => key.split(':').slice(1).join('_');

interface Gold {
  title: string;
  gold: { level?: string[] | null };
}
interface Tally {
  tp: number;
  fp: number;
  fn: number;
}
const newTally = (): Tally => ({ tp: 0, fp: 0, fn: 0 });

function score(t: Tally, gold: string[], predKeys: string[]) {
  const preds = predKeys.map(slug);
  const matchedG = gold.filter((g) => preds.includes(g));
  t.tp += matchedG.length;
  t.fn += gold.length - matchedG.length;
  t.fp += preds.filter((p) => !gold.includes(p)).length;
}

const row = (label: string, t: Tally) => {
  const n = t.tp + t.fn;
  const acc = n ? (t.tp / n) * 100 : 0;
  const prec = t.tp + t.fp ? (t.tp / (t.tp + t.fp)) * 100 : 0;
  return `${label.padEnd(12)} N=${String(n).padStart(3)}  acc=${acc.toFixed(0).padStart(3)}%  prec=${prec.toFixed(0).padStart(3)}%  (tp ${t.tp} / fp ${t.fp})`;
};

async function main() {
  const gold: Gold[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const model = JSON.parse(await readFile(resolve(values.model!), 'utf8'));
  const threshold = Number(values.threshold);
  const locale = values.locale;
  const loaded = loadLevelLr(model);

  const agg = { regex: newTally(), lr: newTally(), union: newTally(), fold: newTally() };
  const perBand: Record<string, { regex: Tally; lr: Tally; union: Tally }> = {};
  const band = (b: string) => (perBand[b] ??= { regex: newTally(), lr: newTally(), union: newTally() });

  for (const item of gold) {
    const g = item.gold?.level ?? [];
    if (!g?.length) continue;
    const clauses = splitClauses(item.title, 'text');

    const regexTerms = inferLevel(clauses, [locale as never]);
    const lrTerms = inferLevelLr(clauses, loaded, { threshold });
    // Union: max score per canonical key (mirrors aliasLookup.finalize).
    const byKey = new Map<string, InferredTerm>();
    for (const t of [...regexTerms, ...lrTerms]) {
      const prev = byKey.get(t.canonicalKey);
      if (!prev || t.score > prev.score) byKey.set(t.canonicalKey, t);
    }
    // Folded production path: inferLevel with the LR enabled (override-reconcile).
    const foldKeys = inferLevel(clauses, [locale as never], {
      enableLr: true,
      lrModel: loaded,
      lrThreshold: threshold,
    }).map((t) => t.canonicalKey);

    const regexKeys = regexTerms.map((t) => t.canonicalKey);
    const lrKeys = lrTerms.map((t) => t.canonicalKey);
    const unionKeys = [...byKey.keys()];

    score(agg.regex, g, regexKeys);
    score(agg.lr, g, lrKeys);
    score(agg.union, g, unionKeys);
    score(agg.fold, g, foldKeys);
    for (const gb of g) {
      score(band(gb).regex, [gb], regexKeys);
      score(band(gb).lr, [gb], lrKeys);
      score(band(gb).union, [gb], unionKeys);
    }

    if (values.verbose && JSON.stringify(regexKeys.map(slug).sort()) !== JSON.stringify(unionKeys.map(slug).sort())) {
      console.log(
        `  gold=${JSON.stringify(g)}  regex=${JSON.stringify(regexKeys.map(slug))}  lr=${JSON.stringify(lrKeys.map(slug))}  | ${item.title}`,
      );
    }
  }

  console.log(`\nLEVEL eval on gold (OS-free), locale=${locale}, lr-threshold=${threshold}\n`);
  console.log(row('regex', agg.regex));
  console.log(row('lr', agg.lr));
  console.log(row('regex+lr', agg.union));
  console.log(row('fold(override)', agg.fold), '  ← inferLevel(enableLr:true)');
  console.log('\nper-band recall (tp/N present) — regex → union:');
  for (const b of Object.keys(perBand).sort()) {
    const p = perBand[b];
    const n = p.regex.tp + p.regex.fn;
    console.log(
      `  ${b.padEnd(12)} N=${String(n).padStart(2)}  regex ${p.regex.tp}/${n}  lr ${p.lr.tp}/${n}  union ${p.union.tp}/${n}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
