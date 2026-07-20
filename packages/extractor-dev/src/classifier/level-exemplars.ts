/**
 * Curated seniority-band EXEMPLAR PHRASES for the semantic level classifier.
 *
 * This is hand-curated PRODUCTION DATA (like the ESCO dictionary), not test
 * fixture data: a small set of short, natural phrases per band per locale that a
 * job TITLE is compared against by cosine similarity. It exists because the
 * hand-written regex rules in `level.ts` pattern-match a single trigger word in
 * isolation ("manager", "sef", "head of") and so miscalibrate when the SAME word
 * means a different band depending on the whole phrase it sits in. Comparing the
 * whole title against these phrase exemplars lets the model weigh phrase-level
 * semantics the regex can't.
 *
 * Seeded from the phrases already encoded in `level.ts`'s regexes (validated once)
 * PLUS phrases that resolve the known band-boundary miscalibrations, e.g. for RO
 * "sef de tura" / "responsabil de tura" sit in `lead` (not `manager`) and "sef
 * departament" in `manager` (not `director`); for EN "head of <technical area>"
 * leans `lead` while "head of department" leans `director`.
 *
 * The ordinal scale is soft: entry_level < junior < mid_level < senior < lead <
 * manager < director < executive. Keep phrases SHORT and natural (not single
 * trigger words) — the whole point is judging phrase-level distance, and adjacent
 * bands (junior/mid_level, manager/director) are the confusion pairs to keep apart.
 */

import type { SupportedLanguage } from '../types.ts';

export interface LevelExemplarGroup {
  /** Canonical level key, e.g. `level:lead`. */
  key: string;
  /** Exemplar locale — matched against the query's language set (locale + en + global). */
  locale: SupportedLanguage | 'global';
  /** Short natural phrases characteristic of this band in this locale. */
  phrases: readonly string[];
}

export const LEVEL_EXEMPLARS: readonly LevelExemplarGroup[] = [
  // ── English ────────────────────────────────────────────────────────────────
  {
    key: 'level:entry_level',
    locale: 'en',
    phrases: [
      'entry level role',
      'no experience required',
      'no prior experience needed',
      'beginner position',
      'trainee',
      'apprentice',
      'unskilled helper',
      'starter role',
    ],
  },
  {
    key: 'level:junior',
    locale: 'en',
    phrases: ['junior developer', 'junior analyst', 'jr engineer', 'junior associate', 'junior specialist'],
  },
  {
    key: 'level:mid_level',
    locale: 'en',
    phrases: ['mid level engineer', 'intermediate developer', 'mid career professional', 'middle developer'],
  },
  {
    key: 'level:senior',
    locale: 'en',
    phrases: [
      'senior engineer',
      'senior specialist',
      'principal engineer',
      'staff software engineer',
      'experienced professional',
      'senior associate',
    ],
  },
  {
    key: 'level:lead',
    locale: 'en',
    phrases: [
      'team lead',
      'technical lead',
      'tech lead',
      'shift leader',
      'crew lead',
      'site foreman',
      'chargehand',
      'head of engineering team',
      'head of infrastructure',
    ],
  },
  {
    key: 'level:manager',
    locale: 'en',
    phrases: [
      'operations manager',
      'people manager with direct reports',
      'shift supervisor',
      'site supervisor',
      'store manager',
      'department manager',
    ],
  },
  {
    key: 'level:director',
    locale: 'en',
    phrases: ['director of operations', 'head of department', 'department head', 'head of division'],
  },
  {
    key: 'level:executive',
    locale: 'en',
    phrases: [
      'chief executive officer',
      'chief technology officer',
      'chief financial officer',
      'vice president',
      'c level executive',
    ],
  },

  // ── Romanian ───────────────────────────────────────────────────────────────
  {
    key: 'level:entry_level',
    locale: 'ro',
    phrases: [
      'fara experienta',
      'fara experienta necesara',
      'necalificat',
      'fara calificare',
      'debutant',
      'incepator',
      'ucenic',
    ],
  },
  {
    key: 'level:junior',
    locale: 'ro',
    phrases: ['junior', 'nivel junior', 'asistent junior'],
  },
  {
    key: 'level:mid_level',
    locale: 'ro',
    phrases: ['nivel intermediar', 'nivel mediu', 'experienta medie'],
  },
  {
    key: 'level:senior',
    locale: 'ro',
    phrases: ['senior', 'experimentat', 'muncitor calificat', 'specialist calificat', 'maistru specialist'],
  },
  {
    key: 'level:lead',
    locale: 'ro',
    phrases: [
      // Shift/team leadership → LEAD (the fix: "sef/responsabil de tura" is NOT manager).
      'sef de tura',
      'responsabil de tura',
      'sef de schimb',
      'responsabil de schimb',
      'sef de echipa',
      'coordonator de echipa',
      'sef formatie',
      'maistru',
      'team lead',
      'supervizor de tura',
    ],
  },
  {
    key: 'level:manager',
    locale: 'ro',
    phrases: [
      'manager',
      'supervizor',
      // Department/site/factory/store-wide responsibility → MANAGER (the fix: "sef
      // departament" is NOT director).
      'sef departament',
      'sef de departament',
      'sef fabrica',
      'sef de santier',
      'responsabil magazin',
      'manager magazin',
    ],
  },
  {
    key: 'level:director',
    locale: 'ro',
    phrases: ['director', 'director general', 'director executiv'],
  },
  {
    key: 'level:executive',
    locale: 'ro',
    phrases: ['director general executiv', 'ceo', 'director financiar'],
  },

  // ── Hungarian (seeded from regex; stub to grow) ─────────────────────────────
  { key: 'level:entry_level', locale: 'hu', phrases: ['tapasztalat nelkul', 'kezdo', 'palyakezdo'] },
  { key: 'level:junior', locale: 'hu', phrases: ['junior'] },
  { key: 'level:senior', locale: 'hu', phrases: ['senior', 'tapasztalt'] },
  { key: 'level:lead', locale: 'hu', phrases: ['csapatvezeto', 'muszakvezeto'] },
  { key: 'level:manager', locale: 'hu', phrases: ['vezeto', 'menedzser', 'osztalyvezeto'] },
  { key: 'level:director', locale: 'hu', phrases: ['igazgato'] },

  // ── Estonian (seeded from regex; stub to grow) ──────────────────────────────
  { key: 'level:entry_level', locale: 'et', phrases: ['kogemuseta', 'algaja'] },
  { key: 'level:junior', locale: 'et', phrases: ['noorem', 'junior'] },
  { key: 'level:senior', locale: 'et', phrases: ['vanem', 'senior', 'kogenud'] },
  { key: 'level:lead', locale: 'et', phrases: ['meeskonnajuht', 'vahetusevanem'] },
  { key: 'level:manager', locale: 'et', phrases: ['juhataja', 'osakonnajuht'] },
  { key: 'level:director', locale: 'et', phrases: ['direktor', 'tegevjuht'] },
];
