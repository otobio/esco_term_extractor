/**
 * Ad-hoc accuracy eval: pull N random listings (title + description) from the
 * acme-localdev-listings index and run the extractor over them, dumping compact,
 * reviewable output + a full JSON sidecar. Ground-truth tags in the index are
 * unreliable, so this is for human review of the raw matches.
 *
 *   tsx scripts/eval-listings.ts [--url ...] [--index acme-localdev-listings-1] \
 *     [--n 60] [--seed 7] [--languages en,ro] [--out /tmp/eval.json]
 */

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import { TermExtractor } from '../src/extractor.ts';
import type { BucketName, ExtractionResult, SupportedLanguage } from '../src/types.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:9201' },
    index: { type: 'string', default: 'acme-localdev-listings-1' },
    'data-dir': { type: 'string', default: 'data' },
    n: { type: 'string', default: '60' },
    seed: { type: 'string', default: '7' },
    languages: { type: 'string', default: 'en,ro' },
    out: { type: 'string', default: '/tmp/term-eval.json' },
  },
});

const url = values.url!.replace(/\/$/, '');
const n = Number(values.n);
const languages = values.languages!.split(',').map((s) => s.trim() as SupportedLanguage);

interface Listing {
  listing_id: string;
  title: string;
  description: string;
}

async function fetchRandom(): Promise<Listing[]> {
  const res = await opensearchFetch(`${url}/${values.index}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: n,
      _source: ['listing_id', 'title', 'description'],
      query: { function_score: { random_score: { seed: Number(values.seed), field: '_seq_no' } } },
    }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { hits: { hits: { _source: Listing }[] } };
  return data.hits.hits.map((h) => h._source);
}

const SHOW: BucketName[] = [
  'occupation',
  'capabilities',
  'location',
  'level',
  'employment',
  'workplace',
  'schedule',
  'benefits',
  'company_type',
  'qualifications',
  'compensation',
];

function line(bucket: BucketName, result: ExtractionResult, max: number): string | null {
  const terms = result.matchesByBucket[bucket];
  if (!terms?.length) return null;
  const items = terms.slice(0, max).map((t) => `${t.displayName}(${t.score.toFixed(2)}${t.method[0]})`);
  return `    ${bucket.padEnd(14)} ${items.join(', ')}`;
}

async function main() {
  console.log(`Loading extractor from ${values['data-dir']}...`);
  const extractor = await TermExtractor.load({ dataDir: values['data-dir']!, defaultLanguages: languages });
  const listings = await fetchRandom();
  console.log(`Evaluating ${listings.length} listings (languages: ${languages.join(',')})\n`);

  const full: any[] = [];
  const coverage: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let totalMs = 0;

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const t0 = Date.now();
    const result = await extractor.extract({ title: l.title, description: l.description });
    totalMs += Date.now() - t0;

    console.log(`#${i + 1} [${l.listing_id}] ${l.title}`);
    for (const b of SHOW) {
      const ln = line(b, result, b === 'capabilities' ? 6 : 4);
      if (ln) console.log(ln);
      const terms = result.matchesByBucket[b];
      if (terms?.length) {
        coverage[b] = (coverage[b] ?? 0) + 1;
        counts[b] = (counts[b] ?? 0) + terms.length;
      }
    }
    console.log('');
    full.push({ listing_id: l.listing_id, title: l.title, description: l.description, result });
  }

  console.log('='.repeat(70));
  console.log(`STATS over ${listings.length} listings — avg ${(totalMs / listings.length).toFixed(0)}ms/listing`);
  console.log('bucket           coverage%   avg#/listing-with-matches');
  for (const b of SHOW) {
    const cov = coverage[b] ?? 0;
    const avg = cov ? (counts[b] / cov).toFixed(1) : '0';
    console.log(`  ${b.padEnd(14)} ${((cov / listings.length) * 100).toFixed(0).padStart(5)}%      ${avg}`);
  }

  await writeFile(values.out!, JSON.stringify(full, null, 2));
  console.log(`\nFull results -> ${values.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
