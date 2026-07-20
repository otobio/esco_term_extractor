#!/usr/bin/env tsx
/**
 * Generate a labeled training set for the logistic-regression level classifier.
 *
 * There is no real title corpus to weak-label, so titles are SYNTHESIZED as
 * (occupation core) × (seniority template), where the templates encode a CORRECTED
 * per-locale seniority grammar authored by hand (NOT the dictionary aliases, which
 * carry the known bug "sef de tura → manager"). Pairing each marker with hundreds of
 * different occupation cores teaches the model to key on the seniority marker and
 * ignore the surrounding occupation — the generalization a flat rule can't give.
 *
 * Emits, per example, {title, locale, label} where label is a level canonical key or
 * `none` (a seniority-free bare occupation, so the model learns to abstain).
 * data/gold.json is NEVER used here — it stays fully held out for evaluation.
 *
 *   tsx scripts/gen-level-dataset.ts [--out data/level-train.jsonl] [--seed 7]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dict: { type: 'string', default: 'data/dictionary.jsonl' },
    out: { type: 'string', default: 'data/level-train.jsonl' },
    seed: { type: 'string', default: '7' },
  },
});

type Locale = 'ro' | 'en' | 'hu' | 'et';
const K = (b: string) => `level:${b}`;

/**
 * CORRECTED seniority grammar. `{c}` is the occupation core. Ordering of the head vs
 * the scope modifier is the whole point: shift-scope ("de tura/schimb") → lead;
 * org-unit scope ("departament/fabrica/santier") or a bare head → manager.
 */
const GRAMMAR: Record<Locale, Record<string, string[]>> = {
  ro: {
    [K('entry_level')]: [
      '{c} debutant',
      '{c} fara experienta',
      'Angajam {c} necalificat',
      '{c} - incepator',
      'Ucenic {c}',
    ],
    [K('junior')]: ['{c} junior', 'Junior {c}', '{c} - nivel junior'],
    [K('mid_level')]: ['{c} - nivel intermediar', '{c} cu experienta medie', '{c} nivel mediu'],
    [K('senior')]: ['{c} senior', 'Senior {c}', '{c} experimentat', 'Maistru {c}', '{c} specialist calificat'],
    [K('lead')]: [
      'Sef de tura {c}',
      '{c} - sef de schimb',
      'Responsabil de tura {c}',
      'Coordonator {c}',
      '{c} coordonator de echipa',
      'Sef de echipa {c}',
      'Sef formatie {c}',
      '{c} team lead',
    ],
    [K('manager')]: [
      'Manager {c}',
      '{c} manager',
      'Sef {c}',
      'Sef departament {c}',
      'Sef fabrica {c}',
      'Responsabil {c}',
      'Supervizor {c}',
      '{c} - sef de santier',
    ],
    [K('director')]: ['Director {c}', '{c} director', 'Director general {c}'],
    [K('executive')]: ['Director general executiv {c}', '{c} - C-level', 'Director financiar {c}'],
  },
  en: {
    [K('entry_level')]: ['Trainee {c}', 'Apprentice {c}', '{c} - Entry Level', 'Graduate {c}', '{c} (No Experience)'],
    [K('junior')]: ['Junior {c}', 'Jr {c}', '{c} (Junior)'],
    [K('mid_level')]: ['{c} (Mid-Level)', 'Intermediate {c}', 'Mid {c}', '{c} - middle'],
    [K('senior')]: ['Senior {c}', 'Sr {c}', 'Principal {c}', 'Staff {c}', '{c} (Senior)'],
    [K('lead')]: [
      '{c} Team Lead',
      'Lead {c}',
      'Tech Lead {c}',
      '{c} - Shift Leader',
      'Foreman {c}',
      'Head of {c} Team',
      '{c} Crew Lead',
    ],
    [K('manager')]: ['{c} Manager', 'Manager {c}', '{c} Supervisor', 'Operations Manager {c}', 'Shift Supervisor {c}'],
    [K('director')]: ['Director of {c}', 'Head of {c}', '{c} Director', 'Department Head {c}'],
    [K('executive')]: ['Chief {c} Officer', 'VP of {c}', '{c} VP', 'Head of {c} (C-level)'],
  },
  hu: {
    [K('entry_level')]: ['{c} - palyakezdo', 'Kezdo {c}'],
    [K('junior')]: ['Junior {c}', '{c} junior'],
    [K('senior')]: ['Senior {c}', 'Tapasztalt {c}'],
    [K('lead')]: ['{c} csoportvezeto', 'Muszakvezeto {c}'],
    [K('manager')]: ['{c} menedzser', 'Vezeto {c}', 'Osztalyvezeto {c}'],
    [K('director')]: ['Igazgato {c}'],
  },
  et: {
    [K('entry_level')]: ['{c} - algaja', 'Algaja {c}'],
    [K('junior')]: ['Noorem {c}', 'Junior {c}'],
    [K('senior')]: ['Vanem {c}', 'Senior {c}', 'Kogenud {c}'],
    [K('lead')]: ['{c} meeskonnajuht', 'Vahetusevanem {c}'],
    [K('manager')]: ['{c} juhataja', 'Osakonnajuht {c}'],
    [K('director')]: ['Direktor {c}'],
  },
};

/** How many DISTINCT occupation cores to draw per (locale, band). Templates cycle. */
const CORES_PER_BAND: Record<Locale, number> = { ro: 34, en: 34, hu: 16, et: 16 };
/** Bare-occupation `none` examples per locale (the abstain class). */
const NONE_PER_LOCALE: Record<Locale, number> = { ro: 90, en: 60, hu: 30, et: 30 };

/**
 * Hand-authored NATURAL examples (the LLM contribution): realistic phrasings that
 * templates miss, including the compositional edge cases — deliberately NOT any gold
 * title verbatim, only the same patterns on different specifics.
 */
const NATURAL: [string, Locale, string][] = [
  ['Responsabil de tura hala productie', 'ro', K('lead')],
  ['Sef tura linie ambalare', 'ro', K('lead')],
  ['Sef de schimb depozit frigorific', 'ro', K('lead')],
  ['Coordonator echipa curatenie', 'ro', K('lead')],
  ['Sef depozit logistica', 'ro', K('manager')],
  ['Sef departament vanzari', 'ro', K('manager')],
  ['Responsabil magazin alimentar', 'ro', K('manager')],
  ['Sef fabrica confectii', 'ro', K('manager')],
  ['Manager zona retail', 'ro', K('manager')],
  ['Sudor senior cu experienta', 'ro', K('senior')],
  ['Electrician debutant santier', 'ro', K('entry_level')],
  ['Ospatar junior restaurant', 'ro', K('junior')],
  ['Contabil nivel intermediar', 'ro', K('mid_level')],
  ['Director general fabrica', 'ro', K('director')],
  ['Shift Leader warehouse operations', 'en', K('lead')],
  ['Team Lead customer support', 'en', K('lead')],
  ['Head of Platform Engineering Team', 'en', K('lead')],
  ['Head of Finance', 'en', K('director')],
  ['Head of Sales Department', 'en', K('director')],
  ['Warehouse Shift Supervisor', 'en', K('manager')],
  ['Regional Operations Manager', 'en', K('manager')],
  ['Senior Backend Engineer', 'en', K('senior')],
  ['Principal Data Scientist', 'en', K('senior')],
  ['Junior QA Analyst', 'en', K('junior')],
  ['Graduate Software Engineer', 'en', K('entry_level')],
  ['Chief Operating Officer', 'en', K('executive')],
  ['VP of Engineering', 'en', K('executive')],
  ['Muszakvezeto gyartas', 'hu', K('lead')],
  ['Osztalyvezeto logisztika', 'hu', K('manager')],
  ['Senior fejleszto', 'hu', K('senior')],
  ['Vahetusevanem tootmine', 'et', K('lead')],
  ['Osakonnajuht ladu', 'et', K('manager')],
  ['Vanem raamatupidaja', 'et', K('senior')],
];

/** Deterministic PRNG (mulberry32) — reproducible dataset from a seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Occupation display names per locale, filtered to short, clean cores (1–3 alpha words). */
async function loadCores(dictPath: string): Promise<Record<Locale, string[]>> {
  const cores: Record<Locale, Set<string>> = { ro: new Set(), en: new Set(), hu: new Set(), et: new Set() };
  const text = await readFile(dictPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (d.bucket !== 'occupation') continue;
    const loc = d.languageCode as Locale;
    if (!(loc in cores)) continue;
    const name = String(d.displayName ?? '').trim();
    const words = name.split(/\s+/);
    if (words.length >= 1 && words.length <= 3 && /^[\p{L}\s-]+$/u.test(name)) cores[loc].add(name);
  }
  return { ro: [...cores.ro], en: [...cores.en], hu: [...cores.hu], et: [...cores.et] };
}

async function main() {
  const rand = rng(Number(values.seed));
  const cores = await loadCores(resolve(values.dict!));
  const rows: { title: string; locale: Locale; label: string }[] = [];

  for (const locale of Object.keys(GRAMMAR) as Locale[]) {
    const pool = shuffle(cores[locale], rand);
    let cursor = 0;
    const draw = () => pool[cursor++ % pool.length];

    for (const [label, templates] of Object.entries(GRAMMAR[locale])) {
      for (let i = 0; i < CORES_PER_BAND[locale]; i++) {
        const core = draw();
        const tpl = templates[i % templates.length];
        rows.push({ title: tpl.replace('{c}', core), locale, label });
      }
    }
    // `none` — bare occupation cores, no marker.
    for (let i = 0; i < NONE_PER_LOCALE[locale]; i++) rows.push({ title: draw(), locale, label: 'none' });
  }

  for (const [title, locale, label] of NATURAL) rows.push({ title, locale, label });

  const shuffled = shuffle(rows, rand);
  await writeFile(resolve(values.out!), `${shuffled.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const byLabel: Record<string, number> = {};
  for (const r of shuffled) byLabel[r.label] = (byLabel[r.label] ?? 0) + 1;
  console.log(`Wrote ${shuffled.length} examples → ${values.out}`);
  console.log(
    Object.entries(byLabel)
      .sort()
      .map(([k, n]) => `  ${k.padEnd(20)} ${n}`)
      .join('\n'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
