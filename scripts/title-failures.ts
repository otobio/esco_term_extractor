#!/usr/bin/env tsx
/**
 * Title failure-pattern scan.
 *
 * Runs every gold title through the title profile and classifies the OUTPUT by
 * pattern (not strict gold-correctness — the profile sees the title only, while
 * gold covers title+description). The point is to surface *systemic* patterns we
 * can fix by rule, each with example titles:
 *
 *   occupation → clean-span | whole-clause (weak/un-anchored) | ambiguous | miss
 *   capabilities → whole-clause noise
 *   location → resolved | none
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openGazetteer } from '@term-extractor/gazetteer';
import { LexicalIndex } from '../src/lexical-index.ts';
import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { type ProfileResult, resolveTitle } from '../src/profiles/index.ts';

/** A result whose span is a whole MULTI-WORD clause = un-anchored/weak span.
 *  (Single-word clauses like "Sudor" resolving fine aren't weak.) */
const fromWholeClause = (r: ProfileResult, term: { span: string }) =>
  r.clauses.includes(term.span) && term.span.trim().split(/\s+/).length > 1;

interface Pattern {
  count: number;
  examples: string[];
}
const bump = (p: Record<string, Pattern>, key: string, title: string) => {
  const e = (p[key] ??= { count: 0, examples: [] });
  e.count++;
  if (e.examples.length < 5) e.examples.push(title);
};

async function main() {
  const gold = JSON.parse(await readFile(resolve('data/gold.json'), 'utf8')) as { title: string }[];
  const titles = gold.map((g) => g.title).filter(Boolean);

  const client = createOpenSearchClient();
  const lexical = await LexicalIndex.load('data');
  const gazetteer = await openGazetteer(); // package-owned data dir (gazetteer.gzb lives in @term-extractor/gazetteer)

  const occ: Record<string, Pattern> = {};
  const cap: Record<string, Pattern> = {};
  const loc: Record<string, Pattern> = {};

  for (const title of titles) {
    const r = await resolveTitle(title, { client, lexical, gazetteer });

    const occupation = r.byBucket.occupation ?? [];
    if (!occupation.length) bump(occ, 'miss (no occupation)', title);
    else {
      const top = occupation[0];
      if (top.status === 'ambiguous') bump(occ, 'ambiguous', title);
      else if (fromWholeClause(r, top)) bump(occ, 'whole-clause (un-anchored/weak span)', title);
      else bump(occ, 'clean span', title);
    }

    const capabilities = r.byBucket.capabilities ?? [];
    const capNoise = capabilities.filter((t) => fromWholeClause(r, t)).length;
    if (capNoise) bump(cap, 'whole-clause noise', title);

    bump(loc, r.byBucket.location?.length ? 'resolved' : 'none', title);
  }

  const report = (label: string, p: Record<string, Pattern>) => {
    console.log(`\n=== ${label} (${titles.length} titles) ===`);
    for (const [k, v] of Object.entries(p).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${String(v.count).padStart(3)}  ${k}`);
      for (const ex of v.examples) console.log(`         · ${ex.slice(0, 70)}`);
    }
  };
  report('OCCUPATION', occ);
  report('CAPABILITIES', cap);
  report('LOCATION', loc);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
