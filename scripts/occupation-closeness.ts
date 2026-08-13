#!/usr/bin/env tsx
/**
 * Occupation-closeness inspection: feed a flat file of job titles (one per line)
 * and stream a CSV of how the title profile's OWN occupation resolution compares
 * to the alt engine's (`inferOccupation`) leaf + family picks — nothing else runs.
 * No gold set required; this is for eyeballing quality/closeness, not scoring.
 *
 * Row shape: title | internal_occupation | alt_occupation | alt_family_occupation
 * (each column ';'-joined when a title/role yields more than one term)
 *
 * Rows print as they resolve, both ways at once:
 *   - a color-banded table on stdout, for watching the run live in-terminal
 *   - a real .csv file (BOM'd for Excel/Numbers), appended row by row, for handing
 *     off / opening in a spreadsheet GUI. Defaults to /tmp/occupation-closeness.csv;
 *     override with --out.
 *
 *   tsx scripts/occupation-closeness.ts --file data/titles.txt --locale ro
 *   npm run occupation:closeness -- --file data/titles.txt --locale ro --out /tmp/out.csv
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openGazetteer } from '@term-extractor/gazetteer';
import { CollarMap } from '../src/derive/collar.ts';
import { inferOccupation } from '../src/inference/occupation.ts';
import { LexicalIndex } from '../src/lexical-index.ts';
import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { resolveTitle } from '../src/profiles/index.ts';
import type { SupportedLanguage } from '../src/types.ts';

const { values } = parseArgs({
  options: {
    file: { type: 'string', default: 'data/titles.txt' },
    locale: { type: 'string', default: 'ro' },
    country: { type: 'string', default: 'ro' },
    n: { type: 'string' },
    out: { type: 'string', default: '/tmp/occupation-closeness.csv' },
  },
});

const HEADERS = ['title', 'internal_occupation', 'alt_occupation', 'alt_family_occupation'];

const csvField = (s: string) => `"${s.replace(/"/g, '""')}"`;
const csvRow = (cols: string[]) => cols.map(csvField).join(',');

// Terminal table rendering: fixed column widths; a cell with multiple leaves wraps
// onto its own line within the row block (one leaf per line) instead of truncating,
// so the top leaves are always fully visible. Alternating background bands make a
// long scan easy to read row-by-row by eye.
const WIDTHS = [28, 24, 30, 30];
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BAND_A = '\x1b[48;5;235m'; // dark grey
const BAND_B = '\x1b[48;5;238m'; // slightly lighter grey
const BOLD = '\x1b[1m';

function padCell(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

/** Cols are arrays of lines (one per leaf); shorter columns pad with blank lines. */
function tableRowBlock(cols: string[][], band: string | null): string {
  const height = Math.max(1, ...cols.map((c) => c.length));
  const lines: string[] = [];
  for (let r = 0; r < height; r++) {
    const cells = cols.map((c, i) => padCell(c[r] ?? '', WIDTHS[i])).join('  ');
    lines.push(band ? `${band}${cells}${RESET}` : cells);
  }
  return lines.join('\n');
}

async function main() {
  const locale = values.locale as SupportedLanguage;
  const raw = await readFile(resolve(values.file!), 'utf8');
  const titles = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const items = values.n ? titles.slice(0, Number(values.n)) : titles;

  const client = createOpenSearchClient();
  const lexical = await LexicalIndex.load('data');
  const gazetteer = await openGazetteer();
  const collar = await CollarMap.load('data');

  const outPath = resolve(values.out!);
  // BOM so Excel/Numbers detect UTF-8 instead of guessing Latin-1.
  await writeFile(outPath, `﻿${csvRow(HEADERS)}\n`);

  console.log(
    `${BOLD}${tableRowBlock(
      HEADERS.map((h) => [h]),
      null,
    )}${RESET}`,
  );
  console.log(DIM + '-'.repeat(WIDTHS.reduce((a, b) => a + b + 2, 0)) + RESET);

  let i = 0;
  for (const title of items) {
    const profile = await resolveTitle(title, {
      client,
      lexical,
      gazetteer,
      locale,
      countryCode: values.country,
      collar,
    });
    const internal = (profile.byBucket.occupation ?? []).map((t) => t.name);

    const alt = await inferOccupation([{ text: title, source: 'title' }], locale, { limit: 5 });
    const altLeaves = alt
      .filter((x) => x.bucket === 'occupation' && x.termType === 'occupation')
      .map((x) => x.displayName);
    const altFamilies = alt
      .filter((x) => x.bucket === 'occupation' && x.termType === 'occupation_group')
      .map((x) => x.displayName);

    // CSV keeps every leaf; the terminal table shows only the top 2 (one per line).
    const csvCols = [title, internal.join('; '), altLeaves.join('; '), altFamilies.join('; ')];
    await appendFile(outPath, `${csvRow(csvCols)}\n`);

    const tableCols = [[title], internal.slice(0, 2), altLeaves.slice(0, 2), altFamilies.slice(0, 2)];
    console.log(tableRowBlock(tableCols, i % 2 === 0 ? BAND_A : BAND_B));
    i++;
  }

  console.error(`\nWrote ${items.length} rows → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
