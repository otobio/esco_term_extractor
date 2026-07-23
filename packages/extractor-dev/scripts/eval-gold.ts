/**
 * Measure the extractor against the hand/agent-labeled gold set (data/gold.json).
 * Per bucket: precision / recall / F1 (set matching, tolerant for open buckets).
 * Salary is scored field-by-field. Finite buckets match on canonical slug; open
 * buckets (occupation/capabilities/location/…) match fuzzily (contains / token
 * Jaccard ≥ 0.5) — those numbers are approximate due to synonymy.
 *
 *   tsx scripts/eval-gold.ts [--gold data/gold.json] [--data-dir data]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BucketName, ExtractionResult } from '../../../src/types.ts';
import { Embedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

/** Cosine threshold for matching a gold phrase to an extracted ESCO label. */
const SEM_MATCH = 0.62;

const { values } = parseArgs({
  options: { gold: { type: 'string', default: 'data/gold.json' }, 'data-dir': { type: 'string', default: 'data' } },
});

const FINITE = new Set<BucketName>(['employment', 'schedule', 'level', 'workplace', 'collar_kind']);
// Open buckets matched SEMANTICALLY (gold phrase vs ESCO label). location stays
// string-matched (place names). qualifications uses slug matching.
const SEMANTIC = new Set<BucketName>(['occupation', 'capabilities', 'benefits', 'sector', 'compensation']);
const BUCKETS: BucketName[] = [...FINITE, ...SEMANTIC, 'location', 'qualifications'];

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const slug = (key: string) => key.split(':').slice(1).join('_');
const toks = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}

interface GoldItem {
  listing_id: string;
  title: string;
  description: string;
  gold: Record<
    string,
    string[] | { min?: number; max?: number; currency?: string; period?: string; taxMode?: string } | null
  >;
}

/** Does an extracted term satisfy a gold label for this bucket? */
function matches(bucket: BucketName, goldLabel: string, term: { canonicalKey: string; displayName: string }): boolean {
  const g = norm(goldLabel);
  if (!g) return false;
  if (FINITE.has(bucket)) return norm(slug(term.canonicalKey)) === g || norm(term.displayName) === g.replace(/ /g, ' ');
  if (bucket === 'qualifications') {
    const key = norm(term.canonicalKey);
    const target = goldLabel.startsWith('language:') ? `language requirement ${norm(goldLabel.slice(9))}` : g;
    return key.includes(target.replace(/ /g, ' ')) || key.includes(g);
  }
  // open buckets: contains either direction OR token overlap
  const d = norm(term.displayName);
  if (d.includes(g) || g.includes(d)) return true;
  return jaccard(toks(goldLabel), toks(term.displayName)) >= 0.5;
}

async function main() {
  const gold: GoldItem[] = JSON.parse(await readFile(resolve(values.gold!), 'utf8'));
  const extractor = await TermExtractor.load({ dataDir: resolve(values['data-dir']!), defaultLanguages: ['ro', 'en'] });
  const embedder = new Embedder({ model: extractor.model });

  // Embed every gold phrase + extracted displayName for the semantic buckets once.
  const vecCache = new Map<string, Float32Array>();
  const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
  const semMatch = (g: string, e: string) => {
    const gv = vecCache.get(norm(g));
    const ev = vecCache.get(norm(e));
    return gv && ev ? dot(gv, ev) >= SEM_MATCH : false;
  };

  const agg: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const b of BUCKETS) agg[b] = { tp: 0, fp: 0, fn: 0 };
  const sal = { total: 0, cur: 0, per: 0, tax: 0, minOk: 0, present: 0, goldPresent: 0 };

  for (const item of gold) {
    const r: ExtractionResult = await extractor.extract(
      { title: item.title, description: item.description },
      { languages: ['ro', 'en'] },
    );

    // Embed all strings involved in semantic buckets for this listing.
    const toEmbed = new Set<string>();
    for (const b of SEMANTIC) {
      for (const gl of (item.gold[b] as string[]) ?? []) toEmbed.add(norm(gl));
      for (const t of r.matchesByBucket[b] ?? []) toEmbed.add(norm(t.displayName));
    }
    const missing = [...toEmbed].filter((s) => s && !vecCache.has(s));
    if (missing.length) {
      const vecs = await embedder.embed(missing);
      missing.forEach((s, i) => vecCache.set(s, vecs[i]));
    }

    for (const b of BUCKETS) {
      const g = (item.gold[b] as string[]) ?? [];
      const ex = (r.matchesByBucket[b] ?? []).map((t) => ({
        canonicalKey: t.canonicalKey,
        displayName: t.displayName,
      }));
      const hit = (gl: string, e: { canonicalKey: string; displayName: string }) =>
        SEMANTIC.has(b) ? semMatch(gl, e.displayName) : matches(b, gl, e);
      const matchedG = g.filter((gl) => ex.some((e) => hit(gl, e)));
      const matchedE = ex.filter((e) => g.some((gl) => hit(gl, e)));
      agg[b].tp += matchedG.length;
      agg[b].fn += g.length - matchedG.length;
      agg[b].fp += ex.length - matchedE.length;
    }
    // salary
    const gs = item.gold.salary as GoldItem['gold'][string];
    const es = r.salary?.[0];
    if (gs && typeof gs === 'object') {
      sal.goldPresent++;
      if (es) {
        sal.present++;
        sal.total++;
        if (es.currency === (gs as any).currency) sal.cur++;
        if (es.period === (gs as any).period) sal.per++;
        if ((es.taxMode ?? null) === ((gs as any).taxMode ?? null)) sal.tax++;
        const gm = (gs as any).min;
        if (gm && es.minAmount && Math.abs(es.minAmount - gm) / gm <= 0.15) sal.minOk++;
      }
    }
  }

  console.log(`GOLD EVAL over ${gold.length} listings (title+description only)\n`);
  console.log(`${'bucket'.padEnd(15)}${'P'.padStart(6)}${'R'.padStart(7)}${'F1'.padStart(7)}   (tp/fp/fn)`);
  console.log('-'.repeat(58));
  let mf = 0;
  for (const b of BUCKETS) {
    const { tp, fp, fn } = agg[b];
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    const f1 = p + r ? (2 * p * r) / (p + r) : 0;
    mf += f1;
    console.log(
      `${b.padEnd(15)}${(p * 100).toFixed(0).padStart(5)}%${(r * 100).toFixed(0).padStart(6)}%${(f1 * 100).toFixed(0).padStart(6)}%   (${tp}/${fp}/${fn})`,
    );
  }
  console.log('-'.repeat(58));
  console.log(`macro-F1: ${((mf / BUCKETS.length) * 100).toFixed(0)}%`);
  console.log(
    `\nsalary: gold has ${sal.goldPresent}, extractor found ${sal.present} of them | of matched: currency ${sal.cur}/${sal.total}, period ${sal.per}/${sal.total}, tax ${sal.tax}/${sal.total}, min±15% ${sal.minOk}/${sal.total}`,
  );
  console.log('\n(open buckets P/R are approximate — synonymy between gold phrases and ESCO labels)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
