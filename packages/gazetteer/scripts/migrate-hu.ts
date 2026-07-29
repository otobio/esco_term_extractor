/**
 * Safe HU gazetteer migration.
 *
 * Adds the HU surface updates directly to the DB so the dataset can be rebuilt
 * from the migrated source of truth without hand-editing generated artifacts.
 *
 * Default mode is dry-run. Pass `--apply` to write the missing rows.
 */
import { parseArgs } from 'node:util';
import { normalizeText } from '../src/normalize.ts';

interface Target {
  label: string;
  primaryKey: string;
  countryCode: string;
  depth: number;
  names: string[];
  addSurfaces: string[];
}

const TARGETS: Target[] = [
  {
    label: 'Hungary country',
    primaryKey: 'location:depth0:hungary',
    countryCode: 'hu',
    depth: 0,
    names: ['Hungary'],
    addSurfaces: ['Magyarország'],
  },
  {
    label: 'Csongrád county',
    primaryKey: 'location:depth1:csongrad_megye',
    countryCode: 'hu',
    depth: 1,
    names: ['Csongrád megye', 'Csongrád-Csanád megye'],
    addSurfaces: ['Csongrád-Csanád megye', 'Csongrád-Csanád county'],
  },
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
    },
  });

  const conn = await (async () => {
    const mysql = await import('mysql2/promise');
    return mysql.createConnection({
      host: process.env.MYSQL_HOST ?? 'localhost',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? 'root',
      database: process.env.MYSQL_DATABASE ?? 'location_search_engine',
      multipleStatements: true,
    });
  })();

  try {
    const plan: Array<{ label: string; placeKey: string; addSurfaces: string[] }> = [];
    for (const target of TARGETS) {
      const [rows] = await conn.query<Array<{ key: string }>>(
        'SELECT `key` AS `key` FROM place WHERE `key` = ? OR (country_code = ? AND depth = ? AND name IN (?)) ORDER BY `key` LIMIT 1',
        [target.primaryKey, target.countryCode, target.depth, target.names],
      );
      const placeKey = rows[0]?.key;
      if (!placeKey) throw new Error(`Could not resolve ${target.label} in place`);
      const surfaces: string[] = [];
      for (const raw of target.addSurfaces) {
        const surface = normalizeText(raw);
        const [existing] = await conn.query<Array<{ n: number }>>(
          'SELECT 1 AS n FROM place_surface WHERE place_key = ? AND surface = ? LIMIT 1',
          [placeKey, surface],
        );
        if (!existing.length) surfaces.push(surface);
      }
      if (surfaces.length) plan.push({ label: target.label, placeKey, addSurfaces: surfaces });
    }

    if (!values.apply) {
      if (!plan.length) {
        console.log('dry-run: no HU surface changes needed');
        return;
      }
      for (const p of plan) console.log(`dry-run: ${p.label} -> ${p.placeKey}: ${p.addSurfaces.join(', ')}`);
      console.log('re-run with --apply to write the missing rows');
      return;
    }

    if (!plan.length) {
      console.log('HU migration: nothing to do');
      return;
    }

    await conn.beginTransaction();
    try {
      for (const p of plan) {
        for (const surface of p.addSurfaces) {
          await conn.query('INSERT INTO place_surface (place_key, surface, surface_kind) VALUES (?, ?, ?)', [
            p.placeKey,
            surface,
            'alt',
          ]);
        }
        console.log(`added ${p.addSurfaces.join(', ')} -> ${p.placeKey}`);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
