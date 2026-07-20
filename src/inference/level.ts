/**
 * Seniority-level inference (entry_level, junior, mid_level, senior, lead, manager,
 * director, executive) from title tokens, years of experience, and team-management
 * idioms. Idiom rules per locale (single-language regexes); years loop over LOCALES.
 *
 * A years→level guess is only added when NO explicit seniority band (entry/junior/
 * mid/senior) was found in the text — the stated band wins over the heuristic.
 *
 * Optionally folds in the logistic-regression classifier (see {@link InferLevelOptions}
 * `enableLr`, OFF by default): it runs alongside the regex and a confident band
 * overrides a disagreeing regex band on the same clause. Default path stays pure regex.
 */

import { defaultLevelLrModel, inferLevelLr, type LoadedLevelLr, reconcileLevel } from '../classifier/level-lr.js';
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
  parseExperienceYears,
} from './shared.js';

const BAND_KEYS = new Set(['level:entry_level', 'level:junior', 'level:mid_level', 'level:senior']);

const EN: IdiomRule[] = [
  {
    key: 'level:entry_level',
    score: 0.85,
    re: /\b(entry[ -]?level|entry (position|role)|no (prior )?experience|no experience (needed|required)|beginner|starter role|trainee|apprentice|helper|unskilled)\b/,
  },
  { key: 'level:junior', score: 0.85, re: /\b(junior|jr)\b/ },
  { key: 'level:mid_level', score: 0.8, re: /\b(mid[ -]?level|mid[ -]?career|intermediate)\b/ },
  {
    key: 'level:senior',
    score: 0.85,
    re: /\b(senior|snr|sr|principal|staff (engineer|software)|master (technician|craftsperson|tradesperson)|(fully )?qualified (tradesperson)?)\b/,
  },
  {
    key: 'level:lead',
    score: 0.8,
    re: /\b(team lead(er)?|tech(nical)? lead(er)?|shift lead(er)?|crew lead(er)?|line lead|site lead|(site |working )?foreman|chargehand)\b/,
  },
  {
    key: 'level:manager',
    score: 0.8,
    re: /\b(manager|management|people management|direct reports|(shift|site|works|general) supervisor|supervisor|operations manager)\b/,
  },
  { key: 'level:director', score: 0.85, re: /\b(director|head of|department head)\b/ },
  {
    key: 'level:executive',
    score: 0.85,
    re: /\b(c[ -]?level|chief (executive|officer|technology|financial|operating)|ceo|cto|cfo|coo|vp|vice president)\b/,
  },
];

const RO: IdiomRule[] = [
  {
    key: 'level:entry_level',
    score: 0.85,
    re: /\b(fara experienta|fara experienta necesara|fara calificare|necalificat|debutant|incepator|ucenic|ajutor)\b/,
  },
  { key: 'level:junior', score: 0.85, re: /\b(junior)\b/ },
  { key: 'level:mid_level', score: 0.8, re: /\b(nivel intermediar|nivel mediu|experienta medie)\b/ },
  {
    key: 'level:senior',
    score: 0.85,
    re: /\b(senior|experimentat|(muncitor|lucrator|specialist) calificat|maistru specialist)\b/,
  },
  {
    key: 'level:lead',
    score: 0.8,
    re: /\b(coordonator|coordon\w+ (o )?echip\w+|coordonator de tura|sef de echipa|sef echipa|sef formatie|maistru|maistru de echipa)\b/,
  },
  {
    key: 'level:manager',
    score: 0.8,
    re: /\b(manager|supervizor|sef de tura|responsabil de tura|responsabil de echipa|sef de santier|conduce (o )?echipa|gestioneaza (o )?echipa)\b/,
  },
  { key: 'level:director', score: 0.85, re: /\b(director|sef departament)\b/ },
];

const HU: IdiomRule[] = [
  { key: 'level:entry_level', score: 0.85, re: /\b(tapasztalat nelkul|kezdo|palyakezdo)\b/ },
  { key: 'level:junior', score: 0.85, re: /\b(junior)\b/ },
  { key: 'level:senior', score: 0.85, re: /\b(senior|tapasztalt)\b/ },
  { key: 'level:lead', score: 0.8, re: /\b(csapatvezeto)\b/ },
  { key: 'level:manager', score: 0.8, re: /\b(vezeto|menedzser)\b/ },
  { key: 'level:director', score: 0.85, re: /\b(igazgato)\b/ },
];

const ET: IdiomRule[] = [
  { key: 'level:entry_level', score: 0.85, re: /\b(kogemuseta|algaja)\b/ },
  { key: 'level:junior', score: 0.85, re: /\b(noorem|junior)\b/ },
  { key: 'level:senior', score: 0.85, re: /\b(vanem|senior|kogenud)\b/ },
  { key: 'level:lead', score: 0.8, re: /\b(meeskonnajuht)\b/ },
  { key: 'level:manager', score: 0.8, re: /\b(juhataja)\b/ },
  { key: 'level:director', score: 0.85, re: /\b(direktor)\b/ },
];

const RULES: readonly IdiomRule[] = [...EN, ...RO, ...HU, ...ET];

function levelFromYears(years: number): { key: string; score: number } {
  if (years === 0) return { key: 'level:entry_level', score: 0.75 };
  if (years <= 2) return { key: 'level:junior', score: 0.7 };
  if (years <= 4) return { key: 'level:mid_level', score: 0.7 };
  return { key: 'level:senior', score: 0.75 };
}

/**
 * Options for the level classifier fold. `enableLr` is OFF by default, so the default
 * path is pure regex (today's behavior, no model/data-file dependency). Turning it on
 * runs the logistic-regression classifier ({@link inferLevelLr}) and reconciles it with
 * the regex via {@link reconcileLevel} — a confident LR band overrides a disagreeing
 * regex band on the same clause, rather than blindly unioning.
 *
 * (Kept synchronous on purpose — the LR core is pure CPU. When `infer<Bucket>` is later
 * unified to async, this signature moves with it; nothing here needs a Promise today.)
 */
export interface InferLevelOptions {
  /** Fold the LR classifier into the result. Default false → regex-only. */
  enableLr?: boolean;
  /** Injected model (tests / callers holding one). Falls back to the lazily-loaded
   *  `data/level-lr.json`; if that's absent too, LR is skipped (regex-only). */
  lrModel?: LoadedLevelLr;
  /** Probability floor for an LR band (default {@link DEFAULT_LR_THRESHOLD}). */
  lrThreshold?: number;
}

export function inferLevel(
  clauses: Clause[],
  languages?: SupportedLanguage[],
  options?: InferLevelOptions,
): InferredTerm[] {
  const { add, terms } = collector();
  let bandStated = false;
  const yearsHits: { years: number; evidence: string }[] = [];

  for (const facet of inferFacetTerms('level', clauses, languages)) {
    add(facet.canonicalKey, facet.score, facet.evidence);
    if (BAND_KEYS.has(facet.canonicalKey)) bandStated = true;
  }

  for (const c of clauses) {
    const loose = normalizeLoose(c.text);
    applyIdioms(loose, c.text, RULES, (key, score, evidence) => {
      add(key, score, evidence);
      if (BAND_KEYS.has(key)) bandStated = true;
    });
    for (const L of LOCALES) {
      const years = parseExperienceYears(loose, L);
      if (years !== null) yearsHits.push({ years, evidence: c.text });
    }
  }

  // Years → band only when no explicit band token was stated (the stated band wins).
  if (!bandStated) {
    for (const { years, evidence } of yearsHits) {
      const lvl = levelFromYears(years);
      add(lvl.key, lvl.score, evidence);
    }
  }

  const base = terms();
  if (!options?.enableLr) return base; // default: pure regex, no model/data dependency

  const model = options.lrModel ?? defaultLevelLrModel();
  if (!model) return base; // no model available → graceful regex-only fallback
  return reconcileLevel(base, inferLevelLr(clauses, model, { threshold: options.lrThreshold }));
}
