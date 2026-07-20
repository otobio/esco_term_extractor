/**
 * Ad-hoc experiment: pull N random titles from a listings index and run the
 * title profile, returning the SEPARATION (input span -> bucket) rather than the
 * resolved bucket matches. Mirrors the `[bucket] "span"` provenance that
 * match.ts --profile title already prints, inverted into span->bucket.
 *
 *   tsx scripts/title-separations.ts [--url ...] [--index ...] [--n 20] [--seed 7] [--locale ro]
 */

import { parseArgs } from 'node:util';
import { openGazetteer } from '@term-extractor/gazetteer';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import { inferOccupation } from '../src/inference/occupation.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { resolveTitle } from '../src/profiles/index.ts';
import type { SupportedLanguage } from '../src/types.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:9201' },
    index: { type: 'string', default: 'old-acme-localdev-listings-1' },
    n: { type: 'string', default: '20' },
    seed: { type: 'string', default: '7' },
    locale: { type: 'string', default: 'ro' },
    top: { type: 'boolean', default: false },
  },
});

const url = values.url!.replace(/\/$/, '');
const n = Number(values.n);
const locale = values.locale;

interface Listing {
  listing_id: string;
  title: string;
}

async function fetchRandom(): Promise<Listing[]> {
  const res = await opensearchFetch(`${url}/${values.index}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: n,
      _source: ['listing_id', 'title'],
      query: values.top
        ? { match_all: {} }
        : { function_score: { random_score: { seed: Number(values.seed), field: '_seq_no' } } },
    }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { hits: { hits: { _source: Listing }[] } };
  return data.hits.hits.map((h) => h._source).filter((l) => l.title?.trim());
}

async function main() {
  const client = createOpenSearchClient({ url });
  const lexical = await LexicalIndex.load('data');
  const gazetteer = await openGazetteer(); // package-owned data dir (gazetteer.gzb lives in @term-extractor/gazetteer)

  const listings = await fetchRandom();
  console.log(`# ${listings.length} random titles from ${values.index} (seed ${values.seed}), locale=${locale}\n`);

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const { byBucket } = await resolveTitle(l.title, { client, lexical, gazetteer, locale });

    // Invert byBucket -> span : [bucket, ...]. A span can carry >1 bucket.
    const sep: { span: string; bucket: string; name: string; status: string }[] = [];
    for (const [bucket, terms] of Object.entries(byBucket)) {
      for (const t of terms) sep.push({ span: t.span, bucket, name: t.name, status: t.status });
    }

    console.log(`#${i + 1} [${l.listing_id}] ${l.title}`);
    if (!sep.length) {
      console.log('   { }  (no separations)');
    } else {
      const obj: Record<string, string> = {};
      for (const s of sep) {
        obj[s.span] = obj[s.span] ? `${obj[s.span]} | ${s.bucket}` : s.bucket;
      }
      console.log(`   ${JSON.stringify(obj)}`);
      // detail line: what each span resolved to
      for (const s of sep) {
        console.log(`      · "${s.span}"  →  ${s.bucket}  (${s.name}${s.status === 'ambiguous' ? ', ambiguous' : ''})`);
      }
    }

    // Alt view from the occupation-search-engine package — NOT overriding the title
    // matcher's own occupation; surfaced side-by-side for visual comparison. Three
    // sections: leaf occupations, their family (occupation group), capabilities.
    try {
      const alt = await inferOccupation([{ text: l.title, source: 'title' }], locale as SupportedLanguage, 2);
      const line = (t: (typeof alt)[number]) =>
        `      ${t.score.toFixed(2)}  ${t.displayName}  (${t.canonicalKey}${t.bucket === 'capabilities' ? `, ${t.termType}` : ''})`;
      const leaves = alt.filter((t) => t.bucket === 'occupation' && t.termType === 'occupation');
      const families = alt.filter((t) => t.bucket === 'occupation' && t.termType === 'occupation_group');
      const caps = alt.filter((t) => t.bucket === 'capabilities');
      console.log(`   alt_occupation (${leaves.length})`);
      for (const t of leaves) console.log(line(t));
      console.log(`   alt_family_occupation (${families.length})`);
      for (const t of families) console.log(line(t));
      console.log(`   alt_capabilities (${caps.length})`);
      for (const t of caps) console.log(line(t));
    } catch (err) {
      console.log(`   alt occupation engine unavailable: ${(err as Error).message}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
