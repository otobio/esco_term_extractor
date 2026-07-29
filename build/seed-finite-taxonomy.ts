#!/usr/bin/env tsx
/**
 * Seed the finite taxonomy from code-owned bucket definitions into MySQL.
 *
 * This is a build-time backfill only: it mirrors the finite rows and facet
 * aliases into `esco_jobs_domain_v2` so the runtime packed artifact can be
 * generated directly from the database later. No deletes, no runtime dependency.
 */

import { parseArgs } from 'node:util';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { FINITE_VALUES } from '../src/finite-values.js';
import { FINITE_FACET_RECORDS, normalizeFacetSurface } from '../src/inference/facets.js';

type FocusBucket = 'employment' | 'schedule' | 'level' | 'workplace';
type Locale = 'en' | 'et' | 'hu' | 'ro';

const TERM_TYPE: Record<FocusBucket, string> = {
  employment: 'employment_type',
  schedule: 'schedule_type',
  level: 'seniority',
  workplace: 'workplace_type',
};

const BUCKET_ORDER: FocusBucket[] = ['employment', 'schedule', 'level', 'workplace'];
const DEFAULT_BUCKETS = BUCKET_ORDER.join(',');

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: process.env.MYSQL_HOST ?? '127.0.0.1' },
    port: { type: 'string', default: process.env.MYSQL_PORT ?? '3306' },
    user: { type: 'string', default: process.env.MYSQL_USER ?? 'root' },
    password: { type: 'string', default: process.env.MYSQL_PASSWORD ?? 'root' },
    database: { type: 'string', default: process.env.MYSQL_DATABASE ?? 'esco_jobs_domain_v2' },
    buckets: { type: 'string', default: DEFAULT_BUCKETS },
    'dry-run': { type: 'boolean', default: false },
  },
});

interface CanonicalSeed {
  bucket: FocusBucket;
  canonicalKey: string;
  termType: string;
  value: string;
  displayName: string;
}

interface AliasSeed {
  canonicalKey: string;
  keyword: string;
  normalizedKeyword: string;
  languageCode: Locale;
  aliasType: string;
  source: string;
  confidence: number;
  isPrimary: number;
}

function humanizeValue(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function selectedBuckets(): FocusBucket[] {
  const requested = new Set(
    values.buckets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as FocusBucket[],
  );
  return BUCKET_ORDER.filter((bucket) => requested.has(bucket));
}

function canonicalValues(bucket: FocusBucket): string[] {
  const valuesForBucket = [...(FINITE_VALUES[bucket] ?? [])];
  if (bucket === 'workplace') return valuesForBucket.filter((v) => v !== 'field_based');
  return valuesForBucket;
}

function canonicalSeeds(buckets: FocusBucket[]): CanonicalSeed[] {
  const out: CanonicalSeed[] = [];
  for (const bucket of buckets) {
    for (const value of canonicalValues(bucket)) {
      out.push({
        bucket,
        canonicalKey: `${bucket}:${value}`,
        termType: TERM_TYPE[bucket],
        value,
        displayName: humanizeValue(value),
      });
    }
  }
  return out;
}

function aliasSeeds(buckets: FocusBucket[], canonicalByKey: Map<string, CanonicalSeed>): AliasSeed[] {
  const keep = new Set(buckets);
  const seen = new Map<string, AliasSeed & { priority: number }>();
  const push = (row: AliasSeed, priority: number) => {
    const key = `${row.canonicalKey}|${row.languageCode}|${row.normalizedKeyword}`;
    const prev = seen.get(key);
    if (!prev || priority > prev.priority) seen.set(key, { ...row, priority });
  };

  for (const seed of canonicalByKey.values()) {
    push(
      {
        canonicalKey: seed.canonicalKey,
        keyword: seed.displayName,
        normalizedKeyword: normalizeFacetSurface(seed.displayName),
        languageCode: 'en',
        aliasType: 'display_name',
        source: 'canonical',
        confidence: 1,
        isPrimary: 1,
      },
      2,
    );
  }

  for (const record of FINITE_FACET_RECORDS) {
    if (!keep.has(record.bucket as FocusBucket)) continue;
    for (const key of record.keys) {
      if (!canonicalByKey.has(key)) continue;
      for (const keyword of record.surfaces) {
        const normalizedKeyword = normalizeFacetSurface(keyword);
        if (!normalizedKeyword) continue;
        push(
          {
            canonicalKey: key,
            keyword,
            normalizedKeyword,
            languageCode: record.locale,
            aliasType: 'finite_facet',
            source: 'finite_facet',
            confidence: 1,
            isPrimary: 0,
          },
          1,
        );
      }
    }
  }

  return [...seen.values()]
    .sort(
      (a, b) =>
        a.canonicalKey.localeCompare(b.canonicalKey) ||
        a.languageCode.localeCompare(b.languageCode) ||
        a.normalizedKeyword.localeCompare(b.normalizedKeyword),
    )
    .map(({ priority: _priority, ...row }) => row);
}

async function main(): Promise<void> {
  const buckets = selectedBuckets();
  const canonical = canonicalSeeds(buckets);
  const canonicalByKey = new Map(canonical.map((row) => [row.canonicalKey, row]));
  const aliases = aliasSeeds(buckets, canonicalByKey);

  console.log(
    `Seed plan: ${canonical.length} canonical rows, ${aliases.length} alias rows, buckets=${buckets.join(',')}`,
  );

  if (values['dry-run']) return;

  const connection = await mysql.createConnection({
    host: values.host,
    port: Number(values.port),
    user: values.user,
    password: values.password,
    database: values.database,
    multipleStatements: false,
  });

  try {
    await connection.beginTransaction();

    const termSql = `
      INSERT INTO taxonomy_canonical_terms
        (canonical_key, bucket, term_type, value, normalized_value, display_name, status,
         is_finite, is_searchable, is_conversational, is_inferable, is_sensitive,
         source_confidence, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 1, 0, 1, 0, 1.0000, 'seed_import')
      ON DUPLICATE KEY UPDATE
        bucket = VALUES(bucket),
        term_type = VALUES(term_type),
        value = VALUES(value),
        normalized_value = VALUES(normalized_value),
        display_name = VALUES(display_name),
        status = VALUES(status),
        is_finite = VALUES(is_finite),
        is_searchable = VALUES(is_searchable),
        is_conversational = VALUES(is_conversational),
        is_inferable = VALUES(is_inferable),
        is_sensitive = VALUES(is_sensitive),
        source_confidence = VALUES(source_confidence)
    `;

    for (const row of canonical) {
      await connection.execute(termSql, [
        row.canonicalKey,
        row.bucket,
        row.termType,
        row.value,
        normalizeFacetSurface(row.value),
        row.displayName,
      ]);
    }

    const keyPlaceholders = canonical.map(() => '?').join(',');
    const [rows] = await connection.query<(RowDataPacket & { id: number; canonical_key: string })[]>(
      `SELECT id, canonical_key FROM taxonomy_canonical_terms WHERE canonical_key IN (${keyPlaceholders})`,
      canonical.map((row) => row.canonicalKey),
    );
    const ids = new Map(rows.map((row) => [row.canonical_key, row.id]));

    for (const row of canonical) {
      if (!ids.has(row.canonicalKey)) throw new Error(`missing canonical id for ${row.canonicalKey}`);
    }

    const aliasSql = `
      INSERT INTO taxonomy_canonical_aliases
        (canonical_term_id, keyword, normalized_keyword, language_code, alias_type, source, confidence, is_primary, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        keyword = VALUES(keyword),
        alias_type = VALUES(alias_type),
        source = VALUES(source),
        confidence = VALUES(confidence),
        is_primary = GREATEST(is_primary, VALUES(is_primary)),
        is_active = VALUES(is_active)
    `;

    for (const row of aliases) {
      const canonicalId = ids.get(row.canonicalKey);
      if (!canonicalId) throw new Error(`missing canonical id for alias ${row.canonicalKey}`);
      await connection.execute(aliasSql, [
        canonicalId,
        row.keyword,
        row.normalizedKeyword,
        row.languageCode,
        row.aliasType,
        row.source,
        row.confidence,
        row.isPrimary,
      ]);
    }

    await connection.commit();
    console.log(`Seeded ${canonical.length} canonical rows and ${aliases.length} alias rows into ${values.database}`);
  } catch (err) {
    await connection.rollback().catch(() => undefined);
    throw err;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
