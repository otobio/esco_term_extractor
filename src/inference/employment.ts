/**
 * Employment-type inference (full_time, part_time, contract, temporary, seasonal,
 * internship, per_diem) from explicit idioms + numeric hours.
 *
 * Idiom rules are grouped per locale — each regex is single-language. Numeric
 * signals loop over LOCALES. Layered on top of alias/structured; negation-aware.
 */

import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { inferFacetTerms } from './facets.js';
import { LOCALES } from './locales.js';
import {
  applyIdioms,
  collector,
  type IdiomRule,
  type InferredTerm,
  normalizeLoose,
  parseDailyHours,
  parseWeeklyHours,
} from './shared.js';

const EN: IdiomRule[] = [
  { key: 'employment:internship', score: 0.9, re: /\b(internships?|interns?|traineeships?|trainee)\b/ },
  { key: 'employment:seasonal', score: 0.9, re: /\b(seasonal)\b/ },
  { key: 'employment:contract', score: 0.85, re: /\b(freelancer?|contractor|1099)\b/ },
  { key: 'employment:temporary', score: 0.8, re: /\b(temporary|temp|temp job|fixed[ -]?term)\b/ },
  { key: 'employment:full_time', score: 0.7, re: /\b(permanent|indefinite|permanent full[ -]?time)\b/ },
  { key: 'employment:per_diem', score: 0.8, re: /\b(per[ -]?diem|day labou?r)\b/ },
  { key: 'employment:full_time', score: 0.85, re: /\b(full[ -]?time|fulltime)\b/ },
  { key: 'employment:part_time', score: 0.85, re: /\b(part[ -]?time|parttime)\b/ },
];

const RO: IdiomRule[] = [
  { key: 'employment:internship', score: 0.9, re: /\b(stagiu|practica|ucenicie|internship)\b/ },
  { key: 'employment:seasonal', score: 0.9, re: /\b(sezonier[a]?|munca sezoniera)\b/ },
  { key: 'employment:contract', score: 0.85, re: /\b(contract de colaborare|contract de prestari|pfa)\b/ },
  {
    key: 'employment:temporary',
    score: 0.8,
    re: /\b(temporar[a]?|munca temporara|perioada determinata|pe determinat|determinat[a]?)\b/,
  },
  { key: 'employment:full_time', score: 0.7, re: /\b(perioada nedeterminata|nedeterminat[a]?|norma intreaga)\b/ },
  { key: 'employment:per_diem', score: 0.8, re: /\b(cu ziua|zilier[a]?)\b/ },
  { key: 'employment:part_time', score: 0.85, re: /\b(jumatate de norma|fractiune de norma|norma partiala)\b/ },
];

const HU: IdiomRule[] = [
  { key: 'employment:internship', score: 0.9, re: /\b(gyakornok|szakmai gyakorlat|tanulo)\b/ },
  { key: 'employment:seasonal', score: 0.9, re: /\b(szezonalis)\b/ },
  { key: 'employment:contract', score: 0.85, re: /\b(vallalkozoi|megbizasi)\b/ },
  { key: 'employment:temporary', score: 0.8, re: /\b(hatarozott|ideiglenes)\b/ },
  { key: 'employment:full_time', score: 0.7, re: /\b(hatarozatlan|teljes munkaido)\b/ },
  { key: 'employment:part_time', score: 0.85, re: /\b(reszmunkaido)\b/ },
];

const ET: IdiomRule[] = [
  { key: 'employment:internship', score: 0.9, re: /\b(praktika|opipoiss)\b/ },
  { key: 'employment:seasonal', score: 0.9, re: /\b(hooajaline)\b/ },
  { key: 'employment:contract', score: 0.85, re: /\b(kasundusleping|tovtuleping)\b/ },
  { key: 'employment:temporary', score: 0.8, re: /\b(ajutine|tahtajaline)\b/ },
  { key: 'employment:full_time', score: 0.7, re: /\b(tahtajatu|taistooaeg|taiskohaga)\b/ },
  { key: 'employment:part_time', score: 0.85, re: /\b(osaline tooaeg|osakoormus)\b/ },
];

const RULES: readonly IdiomRule[] = [...EN, ...RO, ...HU, ...ET];

export function inferEmployment(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[] {
  const { add, terms } = collector();
  for (const facet of inferFacetTerms('employment', clauses, languages))
    add(facet.canonicalKey, facet.score, facet.evidence);
  for (const c of clauses) {
    const loose = normalizeLoose(c.text);
    applyIdioms(loose, c.text, RULES, add);
    for (const L of LOCALES) {
      const weekly = parseWeeklyHours(loose, L);
      if (weekly !== null)
        add(
          weekly >= 35 ? 'employment:full_time' : weekly <= 30 ? 'employment:part_time' : 'employment:full_time',
          0.9,
          c.text,
        );
      const daily = parseDailyHours(loose, L);
      if (daily !== null && daily >= 7) add('employment:full_time', 0.8, c.text);
      else if (daily !== null && daily <= 5) add('employment:part_time', 0.8, c.text);
    }
  }
  return terms();
}
