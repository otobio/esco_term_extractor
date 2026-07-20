#!/usr/bin/env tsx
/**
 * Term-matcher CLI — resolve a surface phrase to a canonical key against the
 * live canonical_runtime_terms index. Output mirrors `bin/cli.ts extract`
 * (bucket header + score/bar/method/name/key rows) so the two are easy to
 * compare, with a resolution verdict line appended.
 *
 * Single shot:
 *   npm run match -- "pavator"                         # defaults to occupation
 *   npm run match -- occupation "pavator" ro           # bucket + surface + locale
 *   npm run match -- capabilities "project management" en
 *
 * Interactive:
 *   npm run match -- repl
 *     > pavator
 *     > occupation | șofer | ro
 */
import { createInterface } from 'node:readline';
import { openGazetteer } from '@term-extractor/gazetteer';
import { Embedder } from '../src/embedder.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { buildFilters, strategyForBucket } from '../src/matchers/resolve.ts';
import { foldSurface } from '../src/matchers/strategy.ts';
import type { OpenSearchClient } from '../src/matchers/types.ts';
import { type ProfileResult, resolveTitle, type Verifier } from '../src/profiles/index.ts';
import { splitClauses } from '../src/tokenizer.ts';
import { ALL_BUCKETS, type ExtractedTerm } from '../src/types.ts';

const useColor = process.stdout.isTTY;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const dim = (s: string) => c('2', s);
const cyan = (s: string) => c('36', s);
const green = (s: string) => c('32', s);
const yellow = (s: string) => c('33', s);
const red = (s: string) => c('31', s);

/** Bar relative to the top candidate (OS scores are unbounded, so normalize). */
function bar(score: number, max: number): string {
  const filled = max > 0 ? Math.round(Math.max(0, Math.min(1, score / max)) * 10) : 0;
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}
/** _source needed to display a hit (name, key, lang) + detect a term-anchored match. */
const DISPLAY_SOURCE = ['canonical_key', 'value', 'display_name', 'aliases', 'searchable', 'language_code'];

/** One result row in the shared extract-style layout: score · bar · tag · name · key[lang] · suffix. */
function row(
  score: number,
  max: number,
  tag: string,
  color: (s: string) => string,
  name: string,
  key: string,
  lang: string,
  suffix = '',
): string {
  return `  ${color(score.toFixed(2).padStart(8))} ${dim(bar(score, max))} ${color(tag.padEnd(8))} ${name}  ${dim(`${key} [${lang}]`)}${suffix}`;
}

async function resolveOne(client: OpenSearchClient, bucket: string, surface: string, locale?: string): Promise<void> {
  const ctx = { queryModelId: await client.queryModelId(), buildFilters };
  const strategy = strategyForBucket(bucket);
  const query = strategy.buildQuery({ bucket, surface, locale }, ctx) as Record<string, unknown> & {
    size?: number;
    _source?: string[];
  };
  query.size = 6;
  query._source = DISPLAY_SOURCE;
  const [response] = await client.msearch([query]);

  const folded = foldSurface(surface);
  const rows: { score: number; method: string; name: string; key: string; lang: string }[] = [];
  const seen = new Set<string>();
  for (const hit of ((response as any)?.hits?.hits ?? []) as any[]) {
    const src = hit._source ?? {};
    if (!src.canonical_key || seen.has(src.canonical_key)) continue;
    seen.add(src.canonical_key);
    const surfaces = [src.value, src.display_name, ...(src.aliases ?? [])].filter(Boolean).map(foldSurface);
    rows.push({
      score: hit._score,
      method: surfaces.includes(folded) ? 'exact' : 'soft',
      name: src.display_name ?? src.value ?? src.canonical_key,
      key: src.canonical_key,
      lang: src.language_code ?? '?',
    });
  }

  const max = rows.length ? rows[0].score : 0;
  console.log('');
  console.log(
    `${bold(cyan(bucket))} ${dim(`(${rows.length})`)}${dim(`  "${surface}"${locale ? ` [${locale}]` : ''}`)}`,
  );
  if (!rows.length) console.log(dim('  (no candidates)'));
  for (const r of rows) {
    console.log(row(r.score, max, r.method, r.method === 'exact' ? green : yellow, r.name, r.key, r.lang));
  }

  const res = strategy.select(response, { bucket, surface, locale }) as any;
  const verdict =
    res.status === 'resolved'
      ? green(`=> RESOLVED: ${res.key} (${res.score.toFixed(2)})`)
      : res.status === 'ambiguous'
        ? yellow(`=> AMBIGUOUS: ${res.candidates.join('  |  ')}`)
        : red('=> UNRESOLVED');
  console.log(`  ${verdict}`);
}

/**
 * Extract mode — mirror `bin/cli.ts extract`: same clause split, run ALL buckets
 * through the OS matcher, group results per bucket. Apples-to-apples with the
 * dense extractor (same clauses in; OpenSearch resolution instead of dense).
 */
async function runExtract(client: OpenSearchClient, text: string, locale?: string): Promise<void> {
  const clauses = splitClauses(text, 'text');
  const ctx = { queryModelId: await client.queryModelId(), buildFilters };

  const items: { clause: string; bucket: string }[] = [];
  for (const cl of clauses) for (const b of ALL_BUCKETS) items.push({ clause: cl.text, bucket: b });
  const strategies = items.map((it) => strategyForBucket(it.bucket));
  const queries = items.map((it, i) => {
    const q = strategies[i].buildQuery({ bucket: it.bucket, surface: it.clause, locale }, ctx) as Record<
      string,
      unknown
    > & { _source?: string[] };
    q._source = DISPLAY_SOURCE;
    return q;
  });
  const responses = await client.msearch(queries);

  // Collect, per bucket, the resolved / ambiguous outcomes across all clauses.
  const byBucket = new Map<string, Map<string, { score: number; name: string; lang: string; tag: string }>>();
  const add = (bucket: string, key: string, score: number, name: string, lang: string, tag: string) => {
    const m = byBucket.get(bucket) ?? new Map();
    byBucket.set(bucket, m);
    const prev = m.get(key);
    if (!prev || score > prev.score) m.set(key, { score, name, lang, tag });
  };
  items.forEach((it, i) => {
    const hits = ((responses[i] as any)?.hits?.hits ?? []) as any[];
    const info = (h: any) => ({
      name: h?._source?.display_name ?? h?._source?.value ?? '?',
      lang: h?._source?.language_code ?? '?',
      score: h?._score ?? 0,
    });
    const res = strategies[i].select(responses[i], { bucket: it.bucket, surface: it.clause, locale }) as any;
    if (res.status === 'resolved') {
      const d = info(hits[0]);
      add(it.bucket, res.key, res.score, d.name, d.lang, 'resolved');
    } else if (res.status === 'ambiguous')
      for (const cand of res.candidates) {
        const d = info(hits.find((h) => h._source?.canonical_key === cand));
        add(it.bucket, cand, d.score, d.name, d.lang, 'ambig');
      }
  });

  console.log(dim(`\n  clauses: ${clauses.map((c) => `"${c.text}"`).join(' · ')}`));
  let any = false;
  for (const bucket of ALL_BUCKETS) {
    const m = byBucket.get(bucket);
    if (!m?.size) continue;
    any = true;
    const rows = [...m.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const max = rows[0].score;
    console.log('');
    console.log(`${bold(cyan(bucket))} ${dim(`(${rows.length})`)}`);
    for (const r of rows) {
      console.log(row(r.score, max, r.tag, r.tag === 'resolved' ? green : yellow, r.name, r.key, r.lang));
    }
  }
  if (!any) console.log(dim('\n  (no matches)'));
  console.log(dim(`\n  ${clauses.length} clauses analyzed`));
}

/** Pull `--flag value` out of args, returning the value and the remaining args. */
function takeFlag(args: string[], flag: string): { value?: string; rest: string[] } {
  const i = args.indexOf(flag);
  if (i === -1) return { rest: args };
  return { value: args[i + 1], rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

/** Pull a valueless `--flag` out of args, returning whether it was present. */
function takeBool(args: string[], flag: string): { present: boolean; rest: string[] } {
  const i = args.indexOf(flag);
  if (i === -1) return { present: false, rest: args };
  return { present: true, rest: [...args.slice(0, i), ...args.slice(i + 1)] };
}

/** Cosine of two L2-normalized vectors (the embedder normalizes) = their dot. */
const cosine = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * Dense verifier for `--verify`: embeds each (span, term) pair with the local
 * multilingual model and returns their cosine agreement. Opt-in only, so the
 * model loads solely when a semantic cross-check is requested.
 */
function makeVerifier(): Verifier {
  const embedder = new Embedder();
  return async (pairs) => {
    if (!pairs.length) return [];
    // Embed each span plus all its candidate texts in one pass; agreement = max
    // cosine over the texts (reward the closest same-locale phrasing).
    const flat: string[] = [];
    const layout = pairs.map((p) => {
      const start = flat.length;
      flat.push(p.span, ...p.texts);
      return { start, count: p.texts.length };
    });
    const vecs = await embedder.embed(flat);
    return pairs.map((_, i) => {
      const { start, count } = layout[i];
      let best = 0;
      for (let k = 0; k < count; k++) best = Math.max(best, cosine(vecs[start], vecs[start + 1 + k]));
      return best;
    });
  };
}

/** Render a profile result in the extract-style bucket layout. */
function renderProfile(result: ProfileResult): void {
  console.log(dim(`\n  clauses: ${result.clauses.map((c) => `"${c}"`).join(' · ')}`));
  let any = false;
  for (const bucket of ALL_BUCKETS) {
    const rows = (result.byBucket[bucket] ?? []).slice(0, 5);
    if (!rows.length) continue;
    any = true;
    const max = rows[0].score;
    console.log('');
    console.log(`${bold(cyan(bucket))} ${dim(`(${rows.length})`)}`);
    for (const r of rows) {
      const span = r.span.length > 40 ? `${r.span.slice(0, 39)}…` : r.span;
      // Optional dense-agreement stamp (--verify): ✓ when the span and the resolved
      // term are semantically close, ⚠ when they diverge (a likely fuzzy artifact).
      // "xl" marks a cross-lingual verify (no same-locale surface → compared to the
      // English display name), whose score runs lower and shouldn't be over-trusted.
      const stamp =
        r.agreement == null
          ? ''
          : (r.agreement >= 0.5 ? green(`✓${r.agreement.toFixed(2)}`) : red(`⚠${r.agreement.toFixed(2)}`)) +
            (r.agreementCrossLingual ? dim('ˣˡ') : '') +
            ' ';
      // Show the (tagged bucket, span) the decision came from — so a bad result
      // reads as weak-match (clean span, wrong term) vs weak-span (noisy surface),
      // and confirms the matcher resolved within the requested bucket.
      const suffix = `  ${stamp}${cyan('◂')} ${dim(`[${bucket}] "${span}"`)}`;
      console.log(row(r.score, max, r.status, r.status === 'resolved' ? green : yellow, r.name, r.key, r.lang, suffix));
    }
  }
  if (!any) console.log(dim('\n  (no matches)'));
}

/**
 * Alt view — the alternative occupation-search engine's output, now produced by the
 * title profile itself (`ProfileResult.altOccupation`) and just RENDERED here beside
 * the profile's own output for comparison, NOT overriding it. Two sections, one
 * canonical term per row (confidence · bar · key), like the matcher's own rows:
 *   alt_occupation         — the leaf occupations (termType `occupation`)
 *   alt_occupation_family  — their family (termType `occupation_group`)
 */
function renderAltOccupations(alt: ExtractedTerm[]): void {
  // Confidence is already in [0,1], so each bar is normalized against a full 1.0.
  const section = (label: string, terms: ExtractedTerm[]) => {
    console.log('');
    console.log(`${bold(cyan(label))} ${dim(`(${terms.length})`)}`);
    if (!terms.length) {
      console.log(dim('  —'));
      return;
    }
    for (const t of terms) {
      console.log(row(t.score, 1, '', t.score >= 0.5 ? green : yellow, t.displayName, t.canonicalKey, t.languageCode));
    }
  };

  section(
    'alt_occupation',
    alt.filter((t) => t.termType === 'occupation'),
  );
  section(
    'alt_occupation_family',
    alt.filter((t) => t.termType === 'occupation_group'),
  );
}

/** "surface" | "bucket | surface | locale" */
function parseLine(line: string): { bucket: string; surface: string; locale?: string } | null {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length === 1) return parts[0] ? { bucket: 'occupation', surface: parts[0] } : null;
  return parts[1] ? { bucket: parts[0] || 'occupation', surface: parts[1], locale: parts[2] || undefined } : null;
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);
  const profile = takeFlag(args, '--profile');
  args = profile.rest;
  const locale = takeFlag(args, '--locale');
  args = locale.rest;
  // Gazetteer country gate (ro/ng/hu/ee), distinct from --locale (text language).
  const country = takeFlag(args, '--country');
  args = country.rest;
  const verify = takeBool(args, '--verify');
  args = verify.rest;
  const client = createOpenSearchClient();

  // Optional profile pipeline (title …). Without --profile, behavior is unchanged.
  if (profile.value === 'title') {
    const lexical = await LexicalIndex.load('data');
    const gazetteer = await openGazetteer(); // package-owned data dir (gazetteer.gzb lives in @term-extractor/gazetteer)
    const title = args.join(' ');
    const result = await resolveTitle(title, {
      client,
      lexical,
      gazetteer,
      locale: locale.value,
      countryCode: country.value, // explicit country gate; falls back to locale in resolveTitle
      verify: verify.present ? makeVerifier() : undefined,
    });
    renderProfile(result);
    renderAltOccupations(result.altOccupation ?? []); // alt engine output now comes from the profile
    return;
  }
  if (profile.value) {
    console.error(`unknown profile: "${profile.value}" (known: title)`);
    process.exit(1);
  }

  if (args[0] === 'extract') {
    await runExtract(client, args.slice(1).join(' '));
    return;
  }

  if (args[0] && args[0] !== 'repl') {
    const item = args[1]
      ? { bucket: args[0], surface: args[1], locale: args[2] }
      : { bucket: 'occupation', surface: args[0] };
    await resolveOne(client, item.bucket, item.surface, item.locale);
    return;
  }

  console.log(bold('\nterm matcher REPL'));
  console.log(dim('  "<surface>"  or  "<bucket> | <surface> | <locale>". Ctrl-C to exit.'));
  console.log(dim(`  query model: ${await client.queryModelId()}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  for await (const line of rl) {
    const item = parseLine(line);
    if (item) {
      try {
        await resolveOne(client, item.bucket, item.surface, item.locale);
      } catch (err) {
        console.error(err);
      }
    }
    rl.prompt();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
