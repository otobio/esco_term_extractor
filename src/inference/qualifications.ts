/**
 * Qualification inference for the two BRITTLE subtypes where semantic/fuzzy
 * matching is unsafe and must be strictly context-gated:
 *
 *  - driving-license CLASS (b/c/ce/d) — the discriminator is a single letter, so
 *    embeddings can't tell B from C. We require a driving-license word in the
 *    clause AND take the class letter only when it qualifies a license word
 *    (so "category B products" / "plan B" never match).
 *  - language REQUIREMENT — a bare language name ("English CV") is not a
 *    requirement in body text, so we require a language-requirement cue nearby.
 *    In title mode ({@link FiniteInferOptions.titleMode}) that gate is loosened:
 *    a bare mention in a terse title ("(German)", "with German") is itself the
 *    signal, since titles rarely name a language incidentally the way body text does.
 *
 * The conceptual qualifications (degrees, certificates, registrations,
 * authorizations) stay on the hybrid semantic+lexical path; these two subtypes are
 * suppressed there and produced only here. Education terms are standardized onto a
 * shorter ladder with global/common forms plus per-locale idioms:
 * school_level_degree, short_cycle_tertiary_degree, 1c_degree, 2c_degree, and
 * 3c_degree.
 *
 * Gender restriction is captured only when the ad explicitly limits the role to
 * one gender ("female only", "doar bărbați") — the neutral "(m/f)"/"(m/w/d)"
 * marker means either gender is fine, so it is deliberately NOT captured (an
 * `any` value is as good as absent and cannot be filtered on). Patterns run on
 * the folded `loose` text (lowercased, diacritics stripped: bărbați→barbati,
 * nők→nok); the non-binary/diverse value exists for symmetry with EU forms
 * ("(m/f/x)" / "(m/w/d)") even though it is rare in practice.
 */

import { isNegated } from '../negation.js';
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import {
  applyIdioms,
  collector,
  type FiniteInferOptions,
  type IdiomRule,
  type InferredTerm,
  normalizeLoose,
} from './shared.js';

const DRIVING_KEYS: Record<string, string> = {
  a: 'qualification:license:driving_license_a',
  b: 'qualification:license:driving_license_b',
  c: 'qualification:license:driving_license_c',
  be: 'qualification:license:driving_license_be',
  ce: 'qualification:license:driving_license_ce',
  de: 'qualification:license:driving_license_de',
  d: 'qualification:license:driving_license_d',
};

interface DrivingLocale {
  language: string;
  strong: RegExp;
  qualifier: string;
}

const DRIVING: DrivingLocale[] = [
  {
    language: 'en',
    strong: /\b(driving licen[cs]e|driving permit|licen[cs]e)\b/,
    qualifier: '(?:driving licen[cs]e|licen[cs]e|category|class|cat)',
  },
  { language: 'ro', strong: /\b(permis|carnet)\b/, qualifier: '(?:permis(?: de conducere)?|categoria|cat)' },
  { language: 'hu', strong: /\b(jogositvany|vezetoi engedely)\b/, qualifier: '(?:jogositvany|kategoria|kat)' },
  { language: 'et', strong: /\b(juhiluba|juhilubade)\b/, qualifier: '(?:juhiluba|kategooria|kat)' },
];

interface LanguageRequirementRule {
  key: string;
  aliases: string[];
  requireContext?: boolean;
}

const LANGUAGE_REQUIREMENT_RULES: readonly LanguageRequirementRule[] = [
  {
    key: 'qualification:language_requirement:no_language_required',
    aliases: ['nem kell nyelvtudas', 'nyelvtudas nem szukseges', 'no language required', 'language not required'],
  },
  {
    key: 'qualification:language_requirement:english',
    aliases: [
      'engleza',
      'english',
      'angol',
      'inglise',
      'english language',
      'angol nyelv',
      'limba engleza',
      'limba engleza',
      'inglise keel',
    ],
  },
  {
    key: 'qualification:language_requirement:french',
    aliases: [
      'franceza',
      'french',
      'francia',
      'prantsuse',
      'french language',
      'francia nyelv',
      'limba franceza',
      'limba francia',
      'prantsuse keel',
    ],
  },
  {
    key: 'qualification:language_requirement:german',
    aliases: ['germana', 'german', 'nemet', 'saksa', 'german language', 'nemet nyelv', 'limba germana', 'saksa keel'],
  },
  {
    key: 'qualification:language_requirement:afrikaans',
    aliases: ['afrikai', 'afrikaans', 'afrikaans language', 'afrikaans nyelv'],
  },
  {
    key: 'qualification:language_requirement:albanian',
    aliases: ['alban', 'albanian', 'albán', 'alban nyelv'],
  },
  {
    key: 'qualification:language_requirement:arabic',
    aliases: ['arab', 'arabic', 'arab nyelv', 'limba araba', 'arabische taal'],
  },
  {
    key: 'qualification:language_requirement:bulgarian',
    aliases: ['bolgar', 'bulgarian', 'bulgar nyelv', 'limba bulgara'],
  },
  {
    key: 'qualification:language_requirement:bosnian',
    aliases: ['bosnyak', 'bosnian', 'bosnyak nyelv'],
  },
  {
    key: 'qualification:language_requirement:czech',
    aliases: ['cseh', 'ceha', 'czech', 'cseh nyelv', 'limba ceha'],
  },
  {
    key: 'qualification:language_requirement:danish',
    aliases: ['dan', 'danish', 'dan nyelv', 'limba daneza'],
  },
  {
    key: 'qualification:language_requirement:other',
    aliases: ['egyeb', 'other', 'other language', 'egyeb nyelv'],
  },
  {
    key: 'qualification:language_requirement:estonian',
    aliases: ['eszt', 'estonian', 'esz nyelv', 'estonian language', 'eesti keel'],
  },
  {
    key: 'qualification:language_requirement:finnish',
    aliases: ['finn', 'finnish', 'finn nyelv', 'suomi', 'suomi kieli'],
  },
  {
    key: 'qualification:language_requirement:flemish',
    aliases: ['flamand', 'flemish', 'flemish language'],
  },
  {
    key: 'qualification:language_requirement:greek',
    aliases: ['gorog', 'greek', 'greek language', 'gorog nyelv'],
  },
  {
    key: 'qualification:language_requirement:georgian',
    aliases: ['gruz', 'georgian', 'georgian language'],
  },
  {
    key: 'qualification:language_requirement:hebrew',
    aliases: ['heber', 'hebrew', 'hebrew language', 'ivrit'],
  },
  {
    key: 'qualification:language_requirement:hindi',
    aliases: ['hindi', 'hindi language'],
  },
  {
    key: 'qualification:language_requirement:dutch',
    aliases: ['holland', 'dutch', 'dutch language', 'nederlands'],
  },
  {
    key: 'qualification:language_requirement:croatian',
    aliases: ['horvat', 'croatian', 'croatian language', 'hrvatski'],
  },
  {
    key: 'qualification:language_requirement:irish',
    aliases: ['ir', 'irish', 'irish language', 'gaeilge'],
  },
  {
    key: 'qualification:language_requirement:japanese',
    aliases: ['japan', 'japanese', 'japanese language', 'nihongo'],
  },
  {
    key: 'qualification:language_requirement:catalan',
    aliases: ['katalan', 'catalan', 'catalan language'],
  },
  {
    key: 'qualification:language_requirement:chinese',
    aliases: ['kinai', 'chinese', 'chinese language', 'mandarin', 'putonghua'],
  },
  {
    key: 'qualification:language_requirement:korean',
    aliases: ['koreai', 'korean', 'korean language'],
  },
  {
    key: 'qualification:language_requirement:latin',
    aliases: ['latin', 'latin language'],
  },
  {
    key: 'qualification:language_requirement:polish',
    aliases: ['lengyel', 'poloneza', 'polish', 'polish language', 'polski'],
  },
  {
    key: 'qualification:language_requirement:latvian',
    aliases: ['lett', 'latvian', 'latvian language', 'latviesu'],
  },
  {
    key: 'qualification:language_requirement:lithuanian',
    aliases: ['litvan', 'lithuanian', 'lithuanian language', 'lietuviu'],
  },
  {
    key: 'qualification:language_requirement:macedonian',
    aliases: ['macedon', 'macedonian', 'macedonian language'],
  },
  {
    key: 'qualification:language_requirement:hungarian',
    aliases: ['magyar', 'hungarian', 'hungarian language', 'magyar nyelv'],
  },
  {
    key: 'qualification:language_requirement:hungarian_sign_language',
    aliases: ['magyar jelnyelv', 'hungarian sign language', 'hsl'],
  },
  {
    key: 'qualification:language_requirement:maltese',
    aliases: ['maltai', 'maltese', 'maltese language'],
  },
  {
    key: 'qualification:language_requirement:mongolian',
    aliases: ['mongol', 'mongolian', 'mongolian language'],
  },
  {
    key: 'qualification:language_requirement:norwegian',
    aliases: ['norveg', 'norwegian', 'norwegian language', 'norsk'],
  },
  {
    key: 'qualification:language_requirement:italian',
    aliases: ['olasz', 'italian', 'italian language', 'italiano'],
  },
  {
    key: 'qualification:language_requirement:russian',
    aliases: ['orosz', 'russian', 'russian language', 'russkiy'],
  },
  {
    key: 'qualification:language_requirement:armenian',
    aliases: ['ormeny', 'armenian', 'armenian language'],
  },
  {
    key: 'qualification:language_requirement:persian',
    aliases: ['perzsa', 'persian', 'persian language', 'farsi'],
  },
  {
    key: 'qualification:language_requirement:portuguese',
    aliases: ['portugal', 'portuguese', 'portuguese language', 'portugues'],
  },
  {
    key: 'qualification:language_requirement:romansh',
    aliases: ['retoroman', 'romansh', 'romansh language'],
  },
  {
    key: 'qualification:language_requirement:romani',
    aliases: ['roma', 'romani', 'romani language'],
  },
  {
    key: 'qualification:language_requirement:romanian',
    aliases: [
      'román',
      'roman',
      'romanian',
      'romaneste',
      'rumeenia',
      'romanian language',
      'romana nyelv',
      'limba romana',
    ],
  },
  {
    key: 'qualification:language_requirement:scottish_gaelic',
    aliases: ['skot', 'scottish gaelic', 'scottish', 'gaelic'],
  },
  {
    key: 'qualification:language_requirement:spanish',
    aliases: ['spanyol', 'spanish', 'spanish language', 'espanol', 'castellano'],
  },
  {
    key: 'qualification:language_requirement:swedish',
    aliases: ['sved', 'swedish', 'swedish language', 'svenska'],
  },
  {
    key: 'qualification:language_requirement:serbian',
    aliases: ['szerb', 'serbian', 'serbian language', 'srpski'],
  },
  {
    key: 'qualification:language_requirement:slovak',
    aliases: ['szlovak', 'slovak', 'slovak language', 'slovencina'],
  },
  {
    key: 'qualification:language_requirement:slovenian',
    aliases: ['szloven', 'slovenian', 'slovenian language', 'slovenscina'],
  },
  {
    key: 'qualification:language_requirement:thai',
    aliases: ['thai', 'thai language'],
  },
  {
    key: 'qualification:language_requirement:tibetan',
    aliases: ['tibeti', 'tibetan', 'tibetan language'],
  },
  {
    key: 'qualification:language_requirement:turkish',
    aliases: ['torok', 'turkish', 'turkish language', 'turkce'],
  },
  {
    key: 'qualification:language_requirement:ukrainian',
    aliases: ['ukran', 'ukrainian', 'ukrainian language', 'ukrayinska'],
  },
  {
    key: 'qualification:language_requirement:uzbek',
    aliases: ['uzbeg', 'uzbek', 'uzbek language'],
  },
  {
    key: 'qualification:language_requirement:vietnamese',
    aliases: ['vietnami', 'vietnamese', 'vietnamese language'],
  },
  {
    key: 'qualification:language_requirement:tagalog',
    aliases: ['tagalog', 'tagalog language', 'pilipino'],
  },
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LANG_NAMES: [RegExp, string, boolean?][] = LANGUAGE_REQUIREMENT_RULES.map((rule) => [
  new RegExp(`\\b(?:${rule.aliases.map(escapeRegex).join('|')})\\b`, 'gi'),
  rule.key,
  rule.requireContext === false,
]);

const STRUCTURED_EDUCATION_LABELS: IdiomRule[] = [
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\bmasters? degree\b/ },
  { key: 'qualification:education_requirement:1c_degree', score: 0.85, re: /\bdegree\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bdiploma\b/ },
  {
    key: 'qualification:education_requirement:school_level_degree',
    score: 0.85,
    re: /\bhigh school(?:\s+s\s+s\s+c\s+e)?\b/,
  },
  { key: 'qualification:education_requirement:school_level_degree', score: 0.85, re: /\bunskilled\b/ },
  { key: 'qualification:education_requirement:school_level_degree', score: 0.85, re: /\bstudent\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bqualified\b/ },
  { key: 'qualification:education_requirement:1c_degree', score: 0.85, re: /\bgraduate\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bhnd\b/ },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\bmba\b/ },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\bmsc\b/ },
  { key: 'qualification:education_requirement:1c_degree', score: 0.85, re: /\bmbbs\b/ },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\bmphil\b/ },
  { key: 'qualification:education_requirement:3c_degree', score: 0.85, re: /\bphd\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bn\s*c\s*e\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bond\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bvocational\b/ },
];

const LANG_CTX: string[][] = [
  [
    'language',
    'fluent',
    'fluency',
    'proficiency',
    'proficient',
    'native',
    'knowledge',
    'spoken',
    'written',
    'level',
    'advanced',
    'intermediate',
    'mother tongue',
    'b1',
    'b2',
    'c1',
    'c2',
    'a2',
  ],
  ['limba', 'nivel', 'cunostinte', 'fluent', 'vorbit', 'scris', 'avansat', 'materna'],
  ['nyelv', 'nyelvtudas', 'szint', 'folyekonyan', 'anyanyelv'],
  ['keel', 'keeleoskus', 'tase', 'valdab', 'emakeel'],
];

const CLASS_TOKEN = '(d\\s*\\+?\\s*e|c\\s*\\+?\\s*e|b\\s*\\+?\\s*e|de|ce|be|[abcd])';

type QualificationLocale = 'en' | 'ro' | 'hu' | 'et';

const QUALIFICATION_LOCALES: readonly QualificationLocale[] = ['en', 'ro', 'hu', 'et'];

const EN_EDUCATION: IdiomRule[] = [
  {
    key: 'qualification:education_requirement:school_level_degree',
    score: 0.85,
    re: /\b(primary school|elementary school|general school|school level degree|school level qualification|basic education|general education|secondary school|secondary school diploma|high school|middle school)\b/,
  },
  {
    key: 'qualification:education_requirement:short_cycle_tertiary_degree',
    score: 0.85,
    re: /\b(short cycle tertiary degree|short cycle tertiary education|short cycle tertiary|higher vocational education|higher vocational training|higher education vocational training|vocational diploma)\b/,
  },
  {
    key: 'qualification:education_requirement:1c_degree',
    score: 0.85,
    re: /\b(1c degree|first degree|first cycle degree|bachelor'?s? degree|undergraduate degree|college degree|university degree)\b/,
  },
  {
    key: 'qualification:education_requirement:2c_degree',
    score: 0.85,
    re: /\b(2c degree|master'?s? degree|master degree|graduate degree|postgraduate degree|master diploma|master level|mba|msc)\b/,
  },
  {
    key: 'qualification:education_requirement:3c_degree',
    score: 0.85,
    re: /\b(3c degree|ph\.?d\.?|phd|doctorate|doctoral degree|doctoral|doctor of philosophy)\b/,
  },
];

const RO_EDUCATION: IdiomRule[] = [
  {
    key: 'qualification:education_requirement:school_level_degree',
    score: 0.85,
    re: /\b(diploma de bacalaureat|liceu|liceu absolvit|studii medii|studii primare|studii gimnaziale|studii liceale|gimnazial|scoala generala)\b/,
  },
  {
    key: 'qualification:education_requirement:short_cycle_tertiary_degree',
    score: 0.85,
    re: /\b(diploma profesionala|studii profesionale|scoala profesionala)\b/,
  },
  {
    key: 'qualification:education_requirement:1c_degree',
    score: 0.85,
    re: /\b(diploma de licenta|studii superioare|licenta)\b/,
  },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\b(diploma de master|studii de master)\b/ },
  {
    key: 'qualification:education_requirement:3c_degree',
    score: 0.85,
    re: /\b(diploma de doctorat|studii de doctorat)\b/,
  },
  { key: 'qualification:education_requirement:3c_degree', score: 0.85, re: /\bdoctorat\b/ },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\bmasterat\b/ },
  { key: 'qualification:education_requirement:1c_degree', score: 0.85, re: /\bfacultate\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bcolegiu\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bstudii postliceale\b/ },
  { key: 'qualification:education_requirement:short_cycle_tertiary_degree', score: 0.85, re: /\bcalificat\b/ },
  { key: 'qualification:education_requirement:school_level_degree', score: 0.85, re: /\bliceu\b/ },
  {
    key: 'qualification:education_requirement:short_cycle_tertiary_degree',
    score: 0.85,
    re: /\bscoala profesionala\b/,
  },
  { key: 'qualification:education_requirement:school_level_degree', score: 0.85, re: /\bscoala generala\b/ },
];

const HU_EDUCATION: IdiomRule[] = [
  {
    key: 'qualification:education_requirement:school_level_degree',
    score: 0.85,
    re: /\b(altalanos iskola|gimnazium|kozepiskola|erettsegi|kozepiskolai vegzettseg)\b/,
  },
  {
    key: 'qualification:education_requirement:short_cycle_tertiary_degree',
    score: 0.85,
    re: /\b(szakkepzes|szakmai vegzettseg|szakkepesites|szakiskolai vegzettseg|szakiskola|szakmunkas kepzo|felsooktatasi szakkepzes)\b/,
  },
  {
    key: 'qualification:education_requirement:1c_degree',
    score: 0.85,
    re: /\b(foiskola|egyetem|alapdiploma|foiskolai diploma|egyetemi diploma)\b/,
  },
  {
    key: 'qualification:education_requirement:2c_degree',
    score: 0.85,
    re: /\b(mesterkepzes|mesterfokozat|mester diploma)\b/,
  },
  { key: 'qualification:education_requirement:3c_degree', score: 0.85, re: /\b(doktori|doktori iskola)\b/ },
];

const ET_EDUCATION: IdiomRule[] = [
  {
    key: 'qualification:education_requirement:school_level_degree',
    score: 0.85,
    re: /\b(pohiharidus|keskharidus|keskkooli diplom|keskkool)\b/,
  },
  {
    key: 'qualification:education_requirement:short_cycle_tertiary_degree',
    score: 0.85,
    re: /\b(kutseharidus|kutsetunnistus|kutsekool|rakenduskorgharidus|kutseharidus ylemine aste|rakenduslik korgharidus)\b/,
  },
  { key: 'qualification:education_requirement:1c_degree', score: 0.85, re: /\b(bakalaureusekraad)\b/ },
  { key: 'qualification:education_requirement:2c_degree', score: 0.85, re: /\b(magistrikraad)\b/ },
  { key: 'qualification:education_requirement:3c_degree', score: 0.85, re: /\b(doktorikraad)\b/ },
];

const EDUCATION_RULES: Record<QualificationLocale, readonly IdiomRule[]> = {
  en: EN_EDUCATION,
  ro: RO_EDUCATION,
  hu: HU_EDUCATION,
  et: ET_EDUCATION,
};

const GENDER_RESTRICTION: [RegExp, string][] = [
  [
    /\b(?:(?:female|women|woman|ladies)[\s-]+only|only[\s-]+(?:female|women|woman)|(?:doar|numai|exclusiv)[\s-]+femei|femei[\s-]+(?:doar|numai)|csak[\s-]+nok|ainult[\s-]+naised)\b/,
    'qualification:gender_requirement:female_only',
  ],
  [
    /\b(?:(?:male|men|man|gentlemen)[\s-]+only|only[\s-]+(?:male|men|man)|(?:doar|numai|exclusiv)[\s-]+barbati|barbati[\s-]+(?:doar|numai)|csak[\s-]+ferfiak|ainult[\s-]+mehed)\b/,
    'qualification:gender_requirement:male_only',
  ],
  [
    /\b(?:(?:non[\s-]?binary|genderqueer|diverse|divers|nichtbinar|nonbinar|enby)[\s-]+(?:only|nur|doar|numai|exclusiv)|(?:only|nur|doar|numai|exclusiv)[\s-]+(?:non[\s-]?binary|genderqueer|diverse|divers|nichtbinar|nonbinar|enby))\b/,
    'qualification:gender_requirement:x_only',
  ],
];

const GLOBAL_RULES: IdiomRule[] = [
  {
    key: 'qualification:certificate:forklift_certificate',
    score: 0.85,
    re: /\b(forklift (certificate|licen[cs]e|permit)|reach truck certificate|atestat stivuitorist|autorizatie stivuitorist|permis stivuitor|targonca engedely|tostuki luba)\b/,
  },
  {
    key: 'qualification:certificate:welding_certificate',
    score: 0.85,
    re: /\b(welding certificate|welder certification|certificat sudor|autorizatie sudor|atestat sudor|hegesztoi bizonyitvany|keevitaja sertifikaat)\b/,
  },
  {
    key: 'qualification:certificate:adr_certificate',
    score: 0.85,
    re: /\b(adr certificate|adr cert|atestat adr|certificat adr|adr bizonyitvany|adr tunnistus)\b/,
  },
  {
    key: 'qualification:certificate:driver_cpc',
    score: 0.85,
    re: /\b(driver cpc|cpc card|certificate of professional competence|atestat cpc|cpc sofer|gki kartya)\b/,
  },
  {
    key: 'qualification:certificate:first_aid_certificate',
    score: 0.85,
    re: /\b(first aid (certificate|certification)|certificat prim ajutor|curs prim ajutor|elsosegely bizonyitvany|esmaabi sertifikaat)\b/,
  },
  {
    key: 'qualification:certificate:food_safety_certificate',
    score: 0.85,
    re: /\b(food (safety|hygiene|handling) certificate|certificat siguranta alimentara|certificat igiena alimentara|toiduohutuse sertifikaat)\b/,
  },
  {
    key: 'qualification:license:electrician_authorization',
    score: 0.85,
    re: /\b(electrician (licen[cs]e|authorization)|electrical authorization|autorizatie electrician|autorizatie electrica|autorizatie anre)\b/,
  },
];

function qualificationLocales(languages?: SupportedLanguage[]): QualificationLocale[] {
  if (!languages) return QUALIFICATION_LOCALES as QualificationLocale[];
  if (languages.length === 0) return [];
  if (languages.includes('global')) return QUALIFICATION_LOCALES as QualificationLocale[];

  const allowed = new Set<QualificationLocale>();
  for (const lang of languages) {
    if (lang === 'en' || lang === 'ng') allowed.add('en');
    else if (lang === 'ro' || lang === 'hu' || lang === 'et') allowed.add(lang);
  }
  return QUALIFICATION_LOCALES.filter((lang) => allowed.has(lang));
}

function hasCtx(window: string): boolean {
  for (const words of LANG_CTX) {
    for (const w of words) {
      if (w.length < 2) continue;
      if (new RegExp(`(?:^|[^a-z])${w}(?:$|[^a-z])`).test(window)) return true;
    }
  }
  return false;
}

export function inferQualifications(
  clauses: Clause[],
  languages?: SupportedLanguage[],
  options?: FiniteInferOptions,
): InferredTerm[] {
  const { add, terms } = collector();
  const allowedLocales = qualificationLocales(languages);

  for (const c of clauses) {
    const loose = normalizeLoose(c.text);

    for (const [re, key] of GENDER_RESTRICTION) {
      const m = re.exec(loose);
      if (m && !isNegated(c.text, m[0])) add(key, 0.9, c.text);
    }

    for (const L of DRIVING) {
      if (!L.strong.test(loose)) continue;
      const re = new RegExp(`${L.qualifier}\\s*\\.?\\s*${CLASS_TOKEN}\\b`, 'gi');
      for (const m of loose.matchAll(re)) {
        const cls = m[1].replace(/[\s+]/g, '');
        const key = DRIVING_KEYS[cls];
        if (key && !isNegated(c.text, m[0])) add(key, 0.9, c.text);
      }
    }

    for (const [nameRe, key, allowBare] of LANG_NAMES) {
      const g = new RegExp(nameRe.source, 'gi');
      let m: RegExpExecArray | null;
      while ((m = g.exec(loose))) {
        const window = loose.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25);
        if ((allowBare || options?.titleMode || hasCtx(window)) && !isNegated(c.text, m[0])) add(key, 0.85, c.text);
      }
    }

    if (options?.titleMode) applyIdioms(loose, c.text, STRUCTURED_EDUCATION_LABELS, add);

    if (allowedLocales.length > 0) {
      applyIdioms(loose, c.text, GLOBAL_RULES, add);
      for (const locale of allowedLocales) applyIdioms(loose, c.text, EDUCATION_RULES[locale], add);
    }
  }

  return terms();
}
