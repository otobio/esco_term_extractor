/**
 * Company-size inference → 7 headcount tiers (startup/small/mid_growing/
 * mid_stable/large/enterprise/global). Signals: employee counts ("50
 * employees", "peste 200 de angajați", "team of 20") are the primary,
 * description-driven signal; explicit stage words (startup, SME, corporation,
 * multinational, …) are a secondary, fuzzier signal mapped onto the nearest
 * tier. Counts are context-gated (an employee word required, non-employee
 * counts excluded), the way salary is. Per-locale word lists; single-language
 * regexes, pre-compiled once at module load (not per-clause) — this module
 * runs over every clause of every job description, so avoiding a `new RegExp`
 * per word per clause matters. Negation-aware.
 */

import { isNegated } from '../negation.js';
import type { Clause } from '../tokenizer.js';
import { collector, type InferredTerm, normalizeLoose } from './shared.js';

const STARTUP = 'company_size:startup';
const SMALL = 'company_size:small';
const MID_GROWING = 'company_size:mid_growing';
const MID_STABLE = 'company_size:mid_stable';
const LARGE = 'company_size:large';
const ENTERPRISE = 'company_size:enterprise';
const GLOBAL = 'company_size:global';

/** Escapes regex metacharacters in a literal dictionary word/phrase. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses a headcount number that may use European (1.000,5) or US (1,000.5)
 * thousands/decimal separators, or plain space-grouped digits ("10 000").
 */
function parseHeadcountNumber(raw: string): number {
  let norm = raw.trim().replace(/\s+/g, '');
  if (norm.includes('.') && norm.includes(',')) {
    norm = norm.indexOf('.') < norm.indexOf(',') ? norm.replace(/\./g, '').replace(',', '.') : norm.replace(/,/g, '');
  } else if (norm.includes(',')) {
    norm = /^\d{1,3}(,\d{3})+$/.test(norm) ? norm.replace(/,/g, '') : norm.replace(',', '.');
  } else if (norm.includes('.') && /^\d{1,3}(\.\d{3})+$/.test(norm)) {
    norm = norm.replace(/\./g, '');
  }
  return Math.floor(Number.parseFloat(norm));
}

function stageFromCount(n: number): string {
  return n <= 10
    ? STARTUP
    : n <= 50
      ? SMALL
      : n <= 200
        ? MID_GROWING
        : n <= 500
          ? MID_STABLE
          : n <= 1000
            ? LARGE
            : n <= 5000
              ? ENTERPRISE
              : GLOBAL;
}

// Words shortly AFTER a stage word that mean it describes a product / customer /
// culture, not the hiring company's size ("enterprise software", "startup mindset",
// "small business segment", "enterprise clients", "global market presence").
const STAGE_DISQUALIFIER =
  /\b(software|architecture|account|accounts|client|clients|customer|customers|solution|solutions|application|applications|system|systems|segment|sector|sales|market|markets|mindset|culture|environment|vibe|spirit|mentality|resource|grade|level|agreement|deal|deals|presence|reach|expansion|footprint)\b/;

// Words shortly BEFORE a stage word that mean it's a customer/target segment, not
// the hiring company ("servicii pentru IMM", "segmentul Small Business").
const STAGE_PRE_DISQUALIFIER =
  /\b(segment\w*|adresat\w*|pentru|servicii|serving|targeting|clienti|clients|customers|catre)\b/;

interface RawLoc {
  stages: { key: string; words: string[] }[];
  employee: string[];
  team: string[]; // "team of" framings
  exclude: string[];
}

const RAW_LOCS: RawLoc[] = [
  {
    stages: [
      { key: STARTUP, words: ['startup', 'start-up', 'early stage', 'early-stage'] },
      { key: SMALL, words: ['sme', 'small business', 'small company'] },
      { key: MID_GROWING, words: ['scaleup', 'scale-up', 'growth company', 'scaling company'] },
      {
        key: MID_STABLE,
        words: ['mid-size company', 'mid size company', 'established company', 'stable company'],
      },
      { key: LARGE, words: ['large company', 'large corporation'] },
      { key: ENTERPRISE, words: ['enterprise', 'corporation', 'corporate group', 'conglomerate'] },
      {
        key: GLOBAL,
        words: ['global company', 'fortune 500', 'multinational', 'worldwide company', 'global corporation'],
      },
    ],
    employee: ['employees', 'employee', 'staff', 'people', 'team members', 'colleagues', 'headcount', 'workforce'],
    team: ['team of', 'a team of'],
    exclude: [
      'clients',
      'customers',
      'stores',
      'users',
      'products',
      'years',
      'countries',
      'projects',
      'branches',
      'locations',
      'markets',
    ],
  },
  {
    stages: [
      { key: STARTUP, words: ['startup', 'start-up'] },
      { key: SMALL, words: ['imm', 'companie mica', 'afacere mica'] },
      { key: MID_GROWING, words: ['scaleup', 'scale-up', 'companie in crestere'] },
      { key: MID_STABLE, words: ['companie de dimensiune medie', 'companie stabila', 'companie consacrata'] },
      { key: LARGE, words: ['companie mare'] },
      { key: ENTERPRISE, words: ['corporatie', 'concern', 'grup de firme'] },
      {
        key: GLOBAL,
        words: [
          'companie globala',
          'corporatie globala',
          'multinationala',
          'multinational',
          'prezenta in intreaga lume',
        ],
      },
    ],
    employee: ['angajati', 'angajat', 'colegi', 'oameni', 'persoane', 'salariati', 'membri'],
    team: ['echipa de', 'o echipa de'],
    exclude: [
      'clienti',
      'magazine',
      'orase',
      'utilizatori',
      'produse',
      'ani',
      'tari',
      'proiecte',
      'sucursale',
      'piete',
    ],
  },
  {
    stages: [
      { key: STARTUP, words: ['startup'] },
      { key: SMALL, words: ['kkv', 'kisvallalat'] },
      { key: MID_GROWING, words: ['novekvo vallalat', 'novekedesi szakaszban levo vallalat'] },
      { key: MID_STABLE, words: ['kozepvallalat', 'stabil vallalat', 'bejaratott vallalat'] },
      { key: LARGE, words: ['nagyvallalat'] },
      { key: ENTERPRISE, words: ['vallalatcsoport'] },
      {
        key: GLOBAL,
        words: ['globalis vallalat', 'multinacionalis', 'vilagcegcsoport', 'vilagszerte jelen levo vallalat'],
      },
    ],
    employee: ['alkalmazott', 'munkatars', 'dolgozo'],
    team: ['csapat'],
    exclude: ['ugyfel', 'uzlet', 'termek', 'orszag'],
  },
  {
    stages: [
      { key: STARTUP, words: ['startup'] },
      { key: SMALL, words: ['vke', 'vaikeettevote'] },
      { key: MID_GROWING, words: ['kasvav ettevote', 'kasvuettevote'] },
      { key: MID_STABLE, words: ['keskmise suurusega ettevote', 'stabiilne ettevote', 'valjakujunenud ettevote'] },
      { key: LARGE, words: ['suurettevote'] },
      { key: ENTERPRISE, words: ['kontsern'] },
      {
        key: GLOBAL,
        words: ['globaalne ettevote', 'rahvusvaheline kontsern', 'rahvusvaheline', 'ule maailma tegutsev ettevote'],
      },
    ],
    employee: ['tootajat', 'tootaja', 'inimest', 'kolleegi'],
    team: ['meeskond'],
    exclude: ['klient', 'kauplus', 'toode', 'aasta', 'riik'],
  },
];

// Words under 3 letters are too generic/ambiguous across languages to trust as a
// standalone token match (e.g. Hungarian "ev" = "year" is a common substring).
const MIN_WORD_LEN = 3;

interface CompiledLoc {
  stageMatchers: { key: string; regex: RegExp }[];
  countPatterns: RegExp[];
  excludeRegex?: RegExp;
}

// A number: 1-3 digits optionally followed by ",./ "-grouped triplets ("10.000",
// "10,000", "10 000"), or any other run of digits ("50000"). Word-bounded so it
// never grabs a trailing digit from an adjacent, unrelated token.
const NUM_PATTERN = String.raw`\b\d{1,3}(?:[.,\s]\d{3})*\b|\b\d+\b`;

const COMPILED_LOCS: CompiledLoc[] = RAW_LOCS.map((loc) => {
  const stageMatchers = loc.stages.flatMap(({ key, words }) => {
    const kept = words.filter((w) => w.length >= MIN_WORD_LEN);
    if (!kept.length) return [];
    const pattern = kept.map(escapeRegex).join('|');
    return [{ key, regex: new RegExp(`(?:^|[^\\p{L}])(${pattern})(?=$|[^\\p{L}])`, 'giu') }];
  });

  const empGroup = loc.employee.map(escapeRegex).join('|');
  const teamGroup = loc.team.map(escapeRegex).join('|');
  const countPatterns = [
    // number, optional +/range, optional "de"/"of" connector, then employee word
    new RegExp(
      `(${NUM_PATTERN})\\s*(?:\\+)?\\s*(?:-\\s*(?:${NUM_PATTERN})\\s*)?(?:de\\s+|of\\s+)?(?:${empGroup})`,
      'giu',
    ),
    // "team of <n>" / "echipa de <n>"
    new RegExp(`(?:${teamGroup})\\s*(?:de\\s+|of\\s+)?(${NUM_PATTERN})`, 'giu'),
  ];

  const excludeWords = loc.exclude.filter((w) => w.length >= MIN_WORD_LEN);
  const excludeRegex = excludeWords.length
    ? new RegExp(`(?:^|[^\\p{L}])(?:${excludeWords.map(escapeRegex).join('|')})(?:$|[^\\p{L}])`, 'iu')
    : undefined;

  return { stageMatchers, countPatterns, excludeRegex };
});

export function inferCompanySize(clauses: Clause[]): InferredTerm[] {
  const { add, terms } = collector();

  for (const c of clauses) {
    const loose = normalizeLoose(c.text);

    for (const loc of COMPILED_LOCS) {
      // Explicit stage words — skipped when an immediately following word shows the
      // term describes a product/customer/culture rather than the company's size.
      for (const { key, regex } of loc.stageMatchers) {
        regex.lastIndex = 0;
        for (const m of loose.matchAll(regex)) {
          const idx = m.index ?? 0;
          const word = m[1];
          const after = loose.slice(idx + m[0].length, idx + m[0].length + 30);
          const before = loose.slice(Math.max(0, idx - 30), idx);
          if (STAGE_DISQUALIFIER.test(after) || STAGE_PRE_DISQUALIFIER.test(before)) continue;
          if (isNegated(c.text, word)) continue;
          add(key, 0.9, c.text);
          break;
        }
      }

      // Employee counts: "<n> employees" / "peste <n> angajați" / "team of <n>".
      for (const re of loc.countPatterns) {
        re.lastIndex = 0;
        for (const m of loose.matchAll(re)) {
          const idx = m.index ?? 0;
          const window = loose.slice(Math.max(0, idx - 30), idx + m[0].length + 30);
          if (loc.excludeRegex?.test(window)) continue;
          const n = parseHeadcountNumber(m[1]);
          if (!Number.isNaN(n) && n >= 1 && n <= 2_000_000) add(stageFromCount(n), 0.8, c.text);
        }
      }
    }
  }

  return terms();
}
