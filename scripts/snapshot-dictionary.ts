/**
 * Snapshot the OpenSearch `canonical_runtime_terms` index (cluster @ :9201) into a
 * self-contained JSONL dictionary the extractor can build from offline.
 *
 * Usage:
 *   tsx scripts/snapshot-dictionary.ts \
 *     [--url http://localhost:9201] [--index canonical_runtime_terms] \
 *     [--out data/dictionary.jsonl] [--languages en,global] [--buckets occupation]
 *
 * Only the fields the extractor needs are pulled; the heavy sparse_embedding /
 * runtime_alias_records fields are excluded server-side.
 *
 * `location` is excluded by default because the gazetteer owns that bucket. Pass
 * `--exclude-buckets ''` if you need a full snapshot for a one-off rebuild.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import { serializeTerm } from '../src/dictionary.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';

interface SourceDoc {
  canonical_key: string;
  bucket: BucketName;
  term_type: string;
  display_name: string;
  value?: string;
  language_code: SupportedLanguage;
  aliases?: string[];
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' },
    index: { type: 'string', default: 'canonical_runtime_terms' },
    out: { type: 'string', default: 'data/dictionary.jsonl' },
    languages: { type: 'string' },
    buckets: { type: 'string' },
    'exclude-buckets': { type: 'string', default: 'location' },
    size: { type: 'string', default: '2000' },
  },
});

const url = values.url!.replace(/\/$/, '');
const index = values.index!;
const outPath = resolve(values.out!);
const pageSize = Number(values.size);
const langFilter = values.languages
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const bucketFilter = values.buckets
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const excludeBucketFilter = values['exclude-buckets']
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildQuery(): unknown {
  const filters: unknown[] = [];
  const exclusions: unknown[] = [];
  if (langFilter?.length) filters.push({ terms: { language_code: langFilter } });
  if (bucketFilter?.length) filters.push({ terms: { bucket: bucketFilter } });
  if (excludeBucketFilter?.length) exclusions.push({ terms: { bucket: excludeBucketFilter } });
  if (filters.length || exclusions.length) return { bool: { filter: filters, must_not: exclusions } };
  return { match_all: {} };
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await opensearchFetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function toTerm(src: SourceDoc): DictionaryTerm {
  return {
    canonicalKey: src.canonical_key,
    bucket: src.bucket,
    termType: src.term_type,
    displayName: src.display_name,
    value: src.value ?? src.display_name,
    languageCode: src.language_code,
    aliases: src.aliases ?? [],
  };
}

async function main() {
  console.log(`Snapshotting ${url}/${index} -> ${outPath}`);
  await mkdir(dirname(outPath), { recursive: true });

  const source = ['canonical_key', 'bucket', 'term_type', 'display_name', 'value', 'language_code', 'aliases'];
  let scroll: string | undefined;
  const lines: string[] = [];
  let total = 0;

  let page = await post(`/${index}/_search?scroll=2m`, {
    size: pageSize,
    _source: source,
    query: buildQuery(),
  });

  while (true) {
    const hits = page.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) lines.push(serializeTerm(toTerm(h._source as SourceDoc)));
    total += hits.length;
    scroll = page._scroll_id;
    process.stdout.write(`\r  fetched ${total}`);
    page = await post('/_search/scroll', { scroll: '2m', scroll_id: scroll });
  }
  process.stdout.write('\n');

  if (scroll) {
    await opensearchFetch(`${url}/_search/scroll`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_id: [scroll] }),
    }).catch(() => undefined);
  }

  await writeFile(outPath, `${lines.join('\n')}\n`);
  console.log(`Wrote ${total} terms to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
