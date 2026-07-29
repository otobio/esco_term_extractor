#!/usr/bin/env tsx
/**
 * Build the packed runtime artifacts directly from MySQL.
 *
 * The root package uses this to refresh the small, shipped binary artifacts
 * without routing through the OpenSearch snapshot or the `-dev` package.
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import mysql from 'mysql2/promise';
import { isUsableTerm } from '../src/dictionary.js';
import { buildDisplayTitleArtifact, selectDisplayTitleEntries } from '../src/display-titles.js';
import { LexicalIndex } from '../src/lexical-index.js';
import type { BucketName, DictionaryTerm } from '../src/types.js';

const FINITE_BUCKETS: BucketName[] = [
  'employment',
  'schedule',
  'level',
  'workplace',
  'benefits',
  'compensation',
  'qualifications',
  'sector',
  'job_function',
  'company_size',
];

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: process.env.MYSQL_HOST ?? '127.0.0.1' },
    port: { type: 'string', default: process.env.MYSQL_PORT ?? '3306' },
    user: { type: 'string', default: process.env.MYSQL_USER ?? 'root' },
    password: { type: 'string', default: process.env.MYSQL_PASSWORD ?? 'root' },
    database: { type: 'string', default: process.env.MYSQL_DATABASE ?? 'esco_jobs_domain_v2' },
    buckets: { type: 'string', default: FINITE_BUCKETS.join(',') },
    'data-dir': { type: 'string', default: 'data' },
  },
});

type TermRow = {
  id: number;
  canonical_key: string;
  bucket: BucketName;
  term_type: string;
  display_name: string;
  value: string | null;
  language_code: string;
  alias_keyword: string | null;
};

function selectedBuckets(): BucketName[] {
  const requested = new Set(
    values.buckets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as BucketName[],
  );
  return FINITE_BUCKETS.filter((bucket) => requested.has(bucket));
}

function sortTerms(a: DictionaryTerm, b: DictionaryTerm): number {
  return (
    a.bucket.localeCompare(b.bucket) ||
    a.canonicalKey.localeCompare(b.canonicalKey) ||
    a.languageCode.localeCompare(b.languageCode)
  );
}

async function main(): Promise<void> {
  const buckets = selectedBuckets();
  const dataDir = resolve(values['data-dir']);
  const connection = await mysql.createConnection({
    host: values.host,
    port: Number(values.port),
    user: values.user,
    password: values.password,
    database: values.database,
    multipleStatements: false,
  });

  try {
    const placeholders = buckets.map(() => '?').join(',');
    const [rows] = await connection.query<TermRow[]>(
      `
      SELECT
        t.id,
        t.canonical_key,
        t.bucket,
        t.term_type,
        t.display_name,
        t.value,
        a.language_code,
        a.keyword AS alias_keyword
      FROM taxonomy_canonical_terms t
      LEFT JOIN taxonomy_canonical_aliases a
        ON a.canonical_term_id = t.id
       AND a.is_active = 1
      WHERE t.bucket IN (${placeholders})
      ORDER BY t.bucket, t.canonical_key, a.is_primary DESC, a.keyword
      `,
      buckets,
    );

    const byKeyAndLang = new Map<
      string,
      DictionaryTerm & {
        aliasSet: Set<string>;
      }
    >();

    for (const row of rows) {
      if (!row.language_code || row.language_code === 'global') continue;
      const rowKey = `${row.id}|${row.language_code}`;
      let term = byKeyAndLang.get(rowKey);
      if (!term) {
        term = {
          canonicalKey: row.canonical_key,
          bucket: row.bucket,
          termType: row.term_type,
          displayName: row.display_name?.trim() || row.value?.trim() || row.canonical_key,
          value: row.value?.trim() || row.display_name?.trim() || row.canonical_key,
          languageCode: row.language_code as DictionaryTerm['languageCode'],
          aliases: [],
          aliasSet: new Set<string>(),
        };
        byKeyAndLang.set(rowKey, term);
      }

      const alias = row.alias_keyword?.trim();
      if (alias) term.aliasSet.add(alias);
    }

    const terms = [...byKeyAndLang.values()]
      .map(({ aliasSet, ...term }) => ({
        ...term,
        aliases: [...aliasSet],
      }))
      .sort(sortTerms);

    await mkdir(dataDir, { recursive: true });
    await LexicalIndex.build(dataDir, terms);

    const displayEntries = selectDisplayTitleEntries(terms.filter(isUsableTerm));
    await buildDisplayTitleArtifact(displayEntries, resolve(dataDir, 'display-titles.gtb'));
    console.log(
      `Built ${terms.length} runtime terms -> ${resolve(dataDir, 'lexical.lxb')} and ${resolve(dataDir, 'display-titles.gtb')} from ${values.database}`,
    );
  } finally {
    await connection.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
