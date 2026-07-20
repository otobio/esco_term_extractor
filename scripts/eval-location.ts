#!/usr/bin/env tsx
/**
 * Model-free location accuracy eval: score the gazetteer resolver against the
 * location labels in the gold set (data/gold.json). No embeddings — pure gazetteer
 * — so it runs without the dense model and is a fast per-locale regression check.
 *
 *   tsx scripts/eval-location.ts [--gold data/gold.json] [--locale ro] [--verbose]
 *
 * Matching mirrors eval-gold's location rule (norm contains either direction OR
 * token Jaccard >= 0.5), compared against each resolved term's display + bare name.
 * P/R are approximate (place-name synonymy, hierarchy ancestors count as extra
 * predictions) — the value is the DELTA across a patterns change, and the FN/FP
 * lists that show exactly which places are missed or spuriously matched.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openGazetteer } from '@term-extractor/gazetteer';
import { inferLocation, setGazetteer } from '../src/inference/location.ts';
import { splitClauses } from '../src/tokenizer.ts';
import type { SupportedLanguage } from '../src/types.ts';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: 'data/gold.json' },
    'data-dir': { type: 'string' }, // override; defaults to the gazetteer package's data dir
    locale: { type: 'string', default: 'ro' },
    verbose: { type: 'boolean', default: false },
  },
});

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const bare = (s: string) => norm(s.split(',')[0]);
const toks = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
};

/** A gold place label matches a resolved term (display or bare name). */
function hit(goldLabel: string, displayName: string): boolean {
  const g = norm(goldLabel);
  if (!g) return false;
  for (const cand of [norm(displayName), bare(displayName)]) {
    if (cand.includes(g) || g.includes(cand)) return true;
    if (jaccard(toks(goldLabel), new Set(cand.split(' ').filter(Boolean))) >= 0.5) return true;
  }
  return false;
}

interface GoldItem {
  listing_id: string;
  title: string;
  description: string;
  gold: Record<string, unknown>;
}

async function main() {
  const gold: GoldItem[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const resolver = await openGazetteer(values['data-dir'] ? resolve(values['data-dir']) : undefined);
  if (!resolver) throw new Error('no gazetteer found (build the dataset + pack the binary)');
  setGazetteer(resolver); // install as the inferLocation global
  const locale = values.locale as SupportedLanguage;

  let tp = 0,
    fp = 0,
    fn = 0;
  const missed: string[] = [];
  const spurious: string[] = [];
  let scored = 0;

  for (const item of gold) {
    const g = (item.gold.location as string[]) ?? [];
    if (!g.length) continue;
    scored++;
    const text = `${item.title}. ${item.description ?? ''}`;
    const clauses = splitClauses(text, 'text');
    const resolved = inferLocation(clauses, locale);
    const terms = resolved.map((t) => t.displayName);
    // Inferred-only ancestors (every evidence is "inferred from …") are hierarchy
    // enrichment, not independent claims — they can satisfy recall but must not be
    // penalized as false positives when the gold lists only the specific place.
    const direct = resolved
      .filter((t) => !(t.evidence ?? []).every((e) => e.clause.startsWith('inferred from')))
      .map((t) => t.displayName);

    const matchedG = g.filter((gl) => terms.some((d) => hit(gl, d)));
    tp += matchedG.length;
    fn += g.length - matchedG.length;
    fp += direct.filter((d) => !g.some((gl) => hit(gl, d))).length;

    const miss = g.filter((gl) => !terms.some((d) => hit(gl, d)));
    const spur = direct.filter((d) => !g.some((gl) => hit(gl, d)));
    if (values.verbose && (miss.length || spur.length)) {
      console.log(`[${item.listing_id}] ${item.title.slice(0, 60)}`);
      if (miss.length) console.log(`   FN gold not found: ${miss.join(' | ')}`);
      if (spur.length) console.log(`   FP extra resolved: ${spur.join(' | ')}`);
    }
    missed.push(...miss);
    spurious.push(...spur);
  }

  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + r ? (2 * p * r) / (p + r) : 0;
  console.log(`\nLOCATION EVAL (gazetteer only) — ${scored} listings with location gold, locale=${locale}`);
  console.log(
    `  P ${(p * 100).toFixed(0)}%   R ${(r * 100).toFixed(0)}%   F1 ${(f1 * 100).toFixed(0)}%   (tp ${tp} / fp ${fp} / fn ${fn})`,
  );
  const tally = (xs: string[]) => {
    const counts: Record<string, number> = {};
    for (const x of xs) counts[x] = (counts[x] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };
  console.log(
    `\n  top missed (FN):   ${tally(missed)
      .slice(0, 15)
      .map(([k, n]) => `${k}×${n}`)
      .join(', ')}`,
  );
  console.log(
    `  top spurious (FP): ${tally(spurious)
      .slice(0, 15)
      .map(([k, n]) => `${k}×${n}`)
      .join(', ')}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
