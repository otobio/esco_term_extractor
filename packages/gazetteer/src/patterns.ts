/**
 * Location patterns, organized per locale so every supported language contributes
 * its own data and adding a locale is a single self-contained block. The gazetteer
 * consumes the MERGED views (`MAJOR_CITIES`, `STOP_NAMES`, `SUBDIVISIONS`) because
 * a posting in one language may still name a place in another.
 *
 * The structural resolver logic (corroboration, admin-level, county-seat,
 * abstention, hierarchy) is language-agnostic; these lists only add per-locale
 * precision/recall and are the place to extend as coverage grows.
 */
import type { SupportedLanguage } from './types.js';

export interface LocalePatterns {
  language: SupportedLanguage;
  /** normalized city name -> the slug of the parent subdivision it sits under
   *  (matched against an ancestor's `location:<...>:<slug>`, e.g. its county/state). */
  majorCities: Record<string, string>;
  /** common words that collide with place names (single-token free-text is dropped). */
  stopNames: string[];
  /** city subdivisions ("Sector 2", "kerület") -> the parent place they resolve to. */
  subdivisions?: { re: RegExp; parentKey: string }[];
  /** foreign / alternate-language names -> the canonical key they denote
   *  ("bucharest" -> location:depth2:bucuresti). Injected as extra exact surfaces so
   *  an exonym resolves to the same place as its native name. */
  exonyms?: Record<string, string>;
  /** Depth-shape rules this locale's listings commonly follow (see
   *  {@link SpecificityTemplate}); adding coverage for a new shape is a template
   *  reference here, not new resolver code. */
  specificityTemplates?: SpecificityTemplate[];
}

/**
 * Depth-shape rule for a duplicate-name collision between a place and its own
 * like-named ancestor (e.g. depth-2 "Bucharest" vs. depth-1 "București", both
 * matching the literal span "bucharest"). The generic disambiguation tie-break
 * prefers the coarser candidate — right for genuinely ambiguous same-named
 * places, wrong here since the mention is naming the specific place. When the
 * coarser candidate's own ancestor at `contextDepth` is *separately* resolved
 * elsewhere in the same text (already named explicitly, so it isn't standing
 * in for the specific place), the deeper candidate wins instead.
 *
 * Locales opt in by listing the named templates that match their common
 * listing conventions. Coverage for a new shape (a locale with a different
 * hierarchy depth, or a different common trailing qualifier) is a matter of
 * writing a new `pattern` string below, not a resolver code change.
 */
export interface SpecificityTemplate {
  name: string;
  /** Depth shape, e.g. "{DEPTH_2},{DEPTH_0}" — resolve to the first depth once
   *  the second depth is separately present elsewhere in the same text. */
  pattern: string;
  descendantDepth: number;
  contextDepth: number;
}

const DEPTH_PATTERN_RE = /^\{DEPTH_(\d+)\},\{DEPTH_(\d+)\}$/;

function specificityTemplate(name: string, pattern: string): SpecificityTemplate {
  const m = DEPTH_PATTERN_RE.exec(pattern);
  if (!m)
    throw new Error(`specificityTemplate ${name}: pattern must look like "{DEPTH_2},{DEPTH_0}", got "${pattern}"`);
  return { name, pattern, descendantDepth: Number(m[1]), contextDepth: Number(m[2]) };
}

/** "{city}, {country}" — the near-universal job-listing convention. */
export const TEMPLATE_CITY_COUNTRY = specificityTemplate('city_country', '{DEPTH_2},{DEPTH_0}');

// --------------------------------------------------------------------------- RO
const RO: LocalePatterns = {
  language: 'ro',
  majorCities: {
    'cluj napoca': 'cluj',
    timisoara: 'timis',
    iasi: 'iasi',
    constanta: 'constanta',
    craiova: 'dolj',
    brasov: 'brasov',
    galati: 'galati',
    ploiesti: 'prahova',
    oradea: 'bihor',
    braila: 'braila',
    arad: 'arad',
    pitesti: 'arges',
    sibiu: 'sibiu',
    bacau: 'bacau',
    'targu mures': 'mures',
    'baia mare': 'maramures',
    buzau: 'buzau',
    botosani: 'botosani',
    'satu mare': 'satu_mare',
    'ramnicu valcea': 'valcea',
    suceava: 'suceava',
    'piatra neamt': 'neamt',
    'drobeta turnu severin': 'mehedinti',
    focsani: 'vrancea',
    targoviste: 'dambovita',
    resita: 'caras_severin',
    tulcea: 'tulcea',
    slatina: 'olt',
    calarasi: 'calarasi',
    'alba iulia': 'alba',
    giurgiu: 'giurgiu',
    deva: 'hunedoara',
    hunedoara: 'hunedoara',
    zalau: 'salaj',
    'sfantu gheorghe': 'covasna',
    bistrita: 'bistrita_nasaud',
    vaslui: 'vaslui',
    slobozia: 'ialomita',
    alexandria: 'teleorman',
    'miercurea ciuc': 'harghita',
    // Notable non-seat towns (trusted bare like the county seats). Ambiguous names
    // (turda, onesti also exist elsewhere) promote only under the parent named here.
    barlad: 'vaslui',
    mioveni: 'arges',
    turda: 'cluj',
    medias: 'sibiu',
    onesti: 'bacau',
    // Bucharest-ring towns (very common in RO tech postings).
    otopeni: 'ilfov',
    voluntari: 'ilfov',
    buftea: 'ilfov',
    chiajna: 'ilfov',
    'popesti leordeni': 'ilfov',
  },
  exonyms: { bucharest: 'location:depth2:bucuresti' },
  specificityTemplates: [TEMPLATE_CITY_COUNTRY],
  stopNames: [
    'centru',
    'vest',
    'est',
    'nord',
    'sud',
    'mijloc',
    'alba',
    'mare',
    'mica',
    'micu',
    'noua',
    'nou',
    'vechi',
    'veche',
    'lunga',
    'lung',
    'verde',
    'rosu',
    'rosie',
    'negru',
    'neagra',
    'frumoasa',
    'seaca',
    'adanca',
    'luna',
    'fata',
    'munca',
    'masina',
    'casa',
    'deal',
    'dealu',
    'vale',
    'valea',
    'apa',
    'camp',
    'campu',
    'padure',
    'padurea',
    'gura',
    'varf',
    'varfu',
    'izvor',
    'izvoru',
    'balta',
    'movila',
    'poiana',
    'lunca',
    'magina',
    'ostrov',
    'ferma',
    'gara',
    'piata',
    'strada',
    'drum',
    'pod',
    'moara',
    'biserica',
    'scoala',
    'spital',
    'parc',
    'lac',
    'limba',
    'viata',
    'tara',
    'lume',
    'floare',
    'brad',
    'plop',
    'salcia',
    'cruce',
    'pentru',
    'tau',
    'legii',
    'independenta',
    'unirea',
    'victoria',
    'libertatii',
  ],
  subdivisions: [{ re: /\bsector\s*([1-6])\b/gi, parentKey: 'location:depth2:bucuresti' }],
};

// --------------------------------------------------------------------------- HU
const HU: LocalePatterns = {
  language: 'hu',
  majorCities: {
    budapest: 'fovaros',
    debrecen: 'hajdu_bihar',
    szeged: 'csongrad_csanad',
    miskolc: 'borsod_abauj_zemplen',
    pecs: 'baranya',
    gyor: 'gyor_moson_sopron',
    nyiregyhaza: 'szabolcs_szatmar_bereg',
    kecskemet: 'bacs_kiskun',
    szekesfehervar: 'fejer',
    szombathely: 'vas',
    szolnok: 'jasz_nagykun_szolnok',
    tatabanya: 'komarom_esztergom',
    kaposvar: 'somogy',
    bekescsaba: 'bekes',
    veszprem: 'veszprem',
    zalaegerszeg: 'zala',
    eger: 'heves',
    szekszard: 'tolna',
    salgotarjan: 'nograd',
  },
  stopNames: [
    'uj',
    'nagy',
    'kis',
    'also',
    'felso',
    'kozep',
    'puszta',
    'falu',
    'varos',
    'telep',
    'hegy',
    'to',
    'viz',
    'ut',
    'ter',
    'haz',
    'kert',
    'sziget',
    'part',
    'mezo',
    'erdo',
    'patak',
    'volgy',
    'domb',
    'ret',
    'liget',
    'ujfalu',
    'megye',
    'kerulet',
  ],
  // "III. kerület" / "kerület" (Budapest districts).
  subdivisions: [{ re: /\bker[uü]let\b/gi, parentKey: 'location:depth2:fovaros' }],
};

// --------------------------------------------------------------------------- ET
const ET: LocalePatterns = {
  language: 'et',
  // Tallinn is stored bare; the other seats are stored as "<City> linn" depth-2
  // municipalities (already trusted containers), so their bare seat name is exposed
  // as an exonym rather than a (dead) major-city promotion.
  majorCities: { tallinn: 'harju_maakond' },
  exonyms: {
    tartu: 'location:depth2:tartu_linn_tartu_maakond',
    narva: 'location:depth2:narva_linn_ida_viru_maakond',
    parnu: 'location:depth2:parnu_linn_parnu_maakond',
    viljandi: 'location:depth2:viljandi_linn_viljandi_maakond',
    voru: 'location:depth2:voru_linn_voru_maakond',
    'kohtla jarve': 'location:depth2:kohtla_jarve_linn_ida_viru_maakond',
    rakvere: 'location:depth2:rakvere_linn_laane_viru_maakond',
  },
  stopNames: [
    'uus',
    'vana',
    'suur',
    'vaike',
    'linn',
    'vald',
    'kula',
    'alevik',
    'alev',
    'jarv',
    'magi',
    'mets',
    'metsa',
    'oja',
    'soo',
    'laane',
    'ida',
    'pohja',
    'kesk',
    'nomme',
    'ranna',
    'mae',
    'oru',
    'maakond',
  ],
};

// --------------------------------------------------------------------------- NG
// Nigeria: 2 tiers (state > LGA-leaf). States are containers (trusted bare); the
// well-known cities are LGA leaves promoted to their state. Several state names ARE
// common English words (Delta, Plateau, Niger) — listed as stop-names so a bare
// free-text mention is not a location signal (a corroborated one still resolves).
const NG: LocalePatterns = {
  language: 'ng',
  majorCities: {
    ikeja: 'lagos',
    abuja: 'federal_capital_territory',
    'port harcourt': 'rivers',
    uyo: 'akwa_ibom',
    maiduguri: 'borno',
    numan: 'adamawa',
  },
  stopNames: ['delta', 'plateau', 'niger'],
};

// ------------------------------------------------------------------- merged view
export const LOCALE_PATTERNS: readonly LocalePatterns[] = [RO, HU, ET, NG];

export const MAJOR_CITIES: ReadonlyMap<string, string> = new Map(
  LOCALE_PATTERNS.flatMap((l) => Object.entries(l.majorCities)),
);

export const STOP_NAMES: ReadonlySet<string> = new Set(LOCALE_PATTERNS.flatMap((l) => l.stopNames));

export const SUBDIVISIONS: readonly { re: RegExp; parentKey: string }[] = LOCALE_PATTERNS.flatMap(
  (l) => l.subdivisions ?? [],
);

/** normalized exonym -> canonical key (merged across locales). */
export const EXONYMS: ReadonlyMap<string, string> = new Map(
  LOCALE_PATTERNS.flatMap((l) => Object.entries(l.exonyms ?? {})),
);

/** language -> its opted-in specificity templates (per-locale, not merged flat —
 *  depth semantics differ by country, so a template must only apply to its own). */
export const SPECIFICITY_TEMPLATES: ReadonlyMap<SupportedLanguage, readonly SpecificityTemplate[]> = new Map(
  LOCALE_PATTERNS.map((l) => [l.language, l.specificityTemplates ?? []]),
);
