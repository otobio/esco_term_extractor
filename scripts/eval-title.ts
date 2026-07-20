#!/usr/bin/env tsx
/**
 * TITLE-only evaluation against the labeled gold set (data/gold.json). Runs the title
 * profile (`resolveTitle`) over each gold TITLE — description is ignored on purpose,
 * to isolate title-matching quality — alongside the occupation-search-engine's
 * inference (`inferOccupation`), and reports two ways:
 *
 *   1. FINITE / slug buckets (level, employment, schedule, collar_kind, workplace,
 *      location, qualifications) are scored here with P/R/F1 — for these, exact slug
 *      / string matching against gold is fair.
 *
 *   2. OCCUPATION and CAPABILITIES are SEMANTIC — lexical overlap misses true matches
 *      (e.g. "commercial worker" ≈ "shelf filler"). So we DON'T score them here; we
 *      export predictions to a JSON sidecar for LLM judging. For occupation the gauge
 *      is the ALT engine's FIRST leaf (top-1, taken regardless of score) vs the OWN
 *      title matcher's occupation. Capabilities are exported (own + alt) for judging.
 *
 * The title matcher loads no local model (occupation/capabilities resolve via
 * OpenSearch neural_sparse server-side; the rest is lexical/gazetteer); the alt engine
 * loads its own model. This script itself embeds nothing.
 *
 *   tsx scripts/eval-title.ts [--gold data/gold.json] [--locale ro|en] [--n 99] [--out PATH]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openGazetteer } from '@term-extractor/gazetteer';
import { CollarMap } from '../src/derive/collar.ts';
import { inferOccupation } from '../src/inference/occupation.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { resolveTitle } from '../src/profiles/index.ts';
import type { BucketName, SupportedLanguage } from '../src/types.ts';

const { values } = parseArgs({
  options: {
    gold: { type: 'string', default: 'data/gold.json' },
    locale: { type: 'string', default: 'ro' },
    // Gazetteer COUNTRY gate — distinct from locale. This gold set is a Romanian-market
    // dataset (all places are `ro`) regardless of whether a title is English or Romanian,
    // so country stays `ro` even when --locale=en.
    country: { type: 'string', default: 'ro' },
    n: { type: 'string' },
    out: { type: 'string' },
  },
});

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const slug = (key: string) => key.split(':').slice(1).join('_');
const toks = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
};

const FINITE = new Set<string>(['employment', 'schedule', 'level', 'workplace', 'collar_kind']);
// Buckets scored lexically here (exact slug / string match is fair for these).
const SCORED: BucketName[] = [
  'location',
  'level',
  'employment',
  'schedule',
  'collar_kind',
  'workplace',
  'qualifications',
];

type Cand = { canonicalKey: string; displayName: string };

/** Lexical match for FINITE/location/qualifications buckets. */
function matches(bucket: string, goldLabel: string, term: Cand): boolean {
  const g = norm(goldLabel);
  if (!g) return false;
  if (FINITE.has(bucket)) return norm(slug(term.canonicalKey)) === g || norm(term.displayName) === g;
  if (bucket === 'qualifications') {
    const key = norm(term.canonicalKey);
    const target = goldLabel.startsWith('language:') ? `language requirement ${norm(goldLabel.slice(9))}` : g;
    return key.includes(target) || key.includes(g);
  }
  const d = norm(term.displayName);
  if (d.includes(g) || g.includes(d)) return true;
  return jaccard(toks(goldLabel), toks(term.displayName)) >= 0.5;
}

interface GoldItem {
  listing_id: string;
  title: string;
  gold: Record<string, string[] | Record<string, unknown> | null>;
}

interface Tally {
  tp: number;
  fp: number;
  fn: number;
  fn_ex: string[];
}
const newTally = (): Tally => ({ tp: 0, fp: 0, fn: 0, fn_ex: [] });

function score(t: Tally, goldLabels: string[], cands: Cand[], bucket: string) {
  const hit = (gl: string, e: Cand) => matches(bucket, gl, e);
  const matchedG = goldLabels.filter((gl) => cands.some((e) => hit(gl, e)));
  const matchedE = cands.filter((e) => goldLabels.some((gl) => hit(gl, e)));
  t.tp += matchedG.length;
  t.fn += goldLabels.length - matchedG.length;
  t.fp += cands.length - matchedE.length;
  for (const gl of goldLabels) if (!cands.some((e) => hit(gl, e))) t.fn_ex.push(gl);
}

/** One record exported for LLM judging of the semantic buckets. */
interface JudgeRecord {
  listing_id: string;
  title: string;
  gold_occupation: string[];
  gold_capabilities: string[];
  own_occupation: string[]; // current title matcher
  alt_occupation_top1: string | null; // engine's first leaf — the gauge, regardless of score
  alt_family: string | null; // winning family (occupation group)
  alt_capabilities: string[]; // engine capabilities from the title's occupation
}

async function main() {
  const gold: GoldItem[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const items = values.n ? gold.slice(0, Number(values.n)) : gold;
  const locale = values.locale as SupportedLanguage;
  const outPath = values.out ?? `/tmp/eval-title-${locale}.judge.json`;

  const client = createOpenSearchClient();
  const lexical = await LexicalIndex.load('data');
  const gazetteer = await openGazetteer(); // package-owned data dir
  const collar = await CollarMap.load('data');

  const agg: Record<string, Tally> = {};
  for (const b of SCORED) agg[b] = newTally();
  const records: JudgeRecord[] = [];

  let done = 0;
  for (const item of items) {
    const profile = await resolveTitle(item.title, {
      client,
      lexical,
      gazetteer,
      locale,
      countryCode: values.country,
      collar,
    });
    const alt = await inferOccupation([{ text: item.title, source: 'title' }], locale, 2);
    const altLeaves = alt.filter((x) => x.bucket === 'occupation' && x.termType === 'occupation');
    const altFam = alt.find((x) => x.bucket === 'occupation' && x.termType === 'occupation_group');
    const altCaps = alt.filter((x) => x.bucket === 'capabilities');

    const byBucket: Record<string, Cand[]> = {};
    for (const [b, terms] of Object.entries(profile.byBucket)) {
      byBucket[b] = terms.map((tm) => ({ canonicalKey: tm.key, displayName: tm.name }));
    }

    for (const b of SCORED) score(agg[b], (item.gold[b] as string[]) ?? [], byBucket[b] ?? [], b);

    records.push({
      listing_id: item.listing_id,
      title: item.title,
      gold_occupation: (item.gold.occupation as string[]) ?? [],
      gold_capabilities: (item.gold.capabilities as string[]) ?? [],
      own_occupation: (byBucket.occupation ?? []).map((c) => c.displayName),
      alt_occupation_top1: altLeaves[0]?.displayName ?? null, // first leaf, regardless of score
      alt_family: altFam?.displayName ?? null,
      alt_capabilities: altCaps.map((c) => c.displayName),
    });

    done++;
    if (done % 10 === 0) process.stderr.write(`  …${done}/${items.length}\n`);
  }

  await writeFile(outPath, JSON.stringify(records, null, 2));

  // N(gold) = labels actually present for this bucket = the denominator. "acc" is
  // correct-out-of-present (= recall): the % the user reads is over the N that HAVE
  // the bucket, never over all 99.
  const rowStr = (label: string, t: Tally) => {
    const n = t.tp + t.fn; // gold present
    const acc = n ? t.tp / n : 0; // correct out of present
    const p = t.tp + t.fp ? t.tp / (t.tp + t.fp) : 0;
    return `${label.padEnd(16)}${String(n).padStart(6)}${(acc * 100).toFixed(0).padStart(7)}%${(p * 100).toFixed(0).padStart(7)}%   (tp ${t.tp} / fp ${t.fp})`;
  };

  console.log(`\nTITLE-ONLY EVAL over ${items.length} gold listings, locale=${locale}`);
  console.log(`(occupation + capabilities are SEMANTIC → exported to ${outPath} for LLM judging)\n`);
  console.log(
    `${'bucket'.padEnd(16)}${'N(gold)'.padStart(6)}${'acc'.padStart(8)}${'prec'.padStart(8)}   (acc = correct / N present)`,
  );
  console.log('-'.repeat(62));
  for (const b of SCORED) console.log(rowStr(b, agg[b]));

  const tally = (xs: string[]) => {
    const c: Record<string, number> = {};
    for (const x of xs) c[x] = (c[x] ?? 0) + 1;
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}×${n}`)
      .join(', ');
  };
  console.log(`\nTOP GAPS (lexical buckets)\n`);
  for (const b of SCORED) {
    if (agg[b].fn_ex.length) console.log(`[${b}] FN: ${tally(agg[b].fn_ex)}`);
  }
  console.log(`\nExported ${records.length} records for LLM occupation/capability judging → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
