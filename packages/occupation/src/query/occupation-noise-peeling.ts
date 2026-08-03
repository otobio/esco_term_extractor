export type OccupationNoiseOrigin = 'lead' | 'middle' | 'trail';
export type SupportedOccupationNoiseLocale = 'ro' | 'hu';

export type OccupationNoiseKind =
  | 'noise_ui_artifact'
  | 'noise_employment_flag'
  | 'noise_shift'
  | 'noise_date'
  | 'noise_salary'
  | 'noise_identifier'
  | 'noise_application_cta'
  | 'noise_language'
  | 'noise_location'
  | 'noise_employer_brand'
  | 'noise_parenthetical_info';

export interface OccupationNoiseRule {
  kind: OccupationNoiseKind;
  matchType: 'phrase' | 'token';
  confidence: number;
  terms?: readonly string[];
  regexes?: readonly RegExp[];
}

export interface OccupationNoisePeelingProfile {
  locale: string;
  noiseRules: readonly OccupationNoiseRule[];
  normalizedOccupationExemptions: readonly string[];
  normalizedLocationHints: readonly string[];
  normalizedLocationContextMarkers: readonly string[];
  normalizedLocationSuffixHints: readonly string[];
  normalizedShiftTerms: readonly string[];
}

export interface OccupationNoiseChunk {
  surface: string;
  normalizedSurface: string;
  origin: OccupationNoiseOrigin;
  isBracket: boolean;
  kind: OccupationNoiseKind | null;
  matchType: 'phrase' | 'token' | 'chunk' | null;
  confidence: number | null;
}

export interface OccupationNoisePeelingResult {
  locale: string;
  supportedLocale: boolean;
  originalTitle: string;
  normalizedTitle: string;
  chunks: OccupationNoiseChunk[];
  noiseChunks: OccupationNoiseChunk[];
  retainedChunks: OccupationNoiseChunk[];
  peeledTitle: string;
}

export interface BuildOccupationNoisePeelingProfileInput {
  locale: string;
  noiseRules: readonly OccupationNoiseRule[];
  occupationExemptions: readonly string[];
  locationHints: readonly string[];
  locationContextMarkers: readonly string[];
  locationSuffixHints: readonly string[];
}

const COMMON_NOISE_RULES: readonly OccupationNoiseRule[] = [
  {
    kind: 'noise_ui_artifact',
    matchType: 'phrase',
    confidence: 0.99,
    terms: ['szures', 'ertekeld munkahelyedet', 'apply as', 'hiring', 'looking for', 'seeking']
  },
  {
    kind: 'noise_employment_flag',
    matchType: 'phrase',
    confidence: 0.98,
    terms: [
      'full time',
      'part time',
      'entry level',
      'diakmunka',
      'reszmunkaido',
      'teljes munkaido',
      'munkaido',
      'f m d',
      'm w d',
      'f m',
      'm f',
      'm/f',
      'f/m',
      'f m x',
      'm f x',
      'perioada determinata',
      'perioada nedeterminata',
      'cazare asigurata',
      'free accommodation'
    ]
  },
  {
    kind: 'noise_shift',
    matchType: 'phrase',
    confidence: 0.98,
    terms: [
      '2 schimburi',
      '3 schimburi',
      '1 schimb',
      'day shift',
      'night shift',
      'rotating shift',
      'program de lucru',
      'programul de lucru',
      'program flexibil',
      'program normal',
      'munca in ture',
      'munca în ture',
      'tura de zi',
      'tura de noapte',
      'ore pe zi',
      'ore/zi',
      'ore pe saptamana',
      'ore pe săptămână',
      'ore pe săptamana',
      '8 ore',
      '6 ore',
      '4 ore',
      '12 ore',
      '20 ore',
      '30 ore',
      'heti 30 oras',
      'heti 20 oras',
      'heti 40 oras',
      'full time',
      'part time',
      'full-time',
      'part-time',
      'részmunkaidő',
      'reszmunkaido',
      'teljes munkaidő',
      'teljes munkaido'
    ],
    regexes: [/\b\d+\s?(?:ore|ora|hours?|h)\b/iu, /\b\d+\s?\/\s?\d+\b/iu, /\b(?:2|3|4)\s*[-/]?\s*(?:shift|schimburi?|ture)\b/iu]
  },
  {
    kind: 'noise_date',
    matchType: 'phrase',
    confidence: 0.97,
    terms: [
      'start date',
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
      'ianuarie',
      'februarie',
      'martie',
      'aprilie',
      'iunie',
      'iulie',
      'septembrie',
      'octombrie',
      'noiembrie',
      'decembrie',
      'januar',
      'februar',
      'marcius',
      'aprilis',
      'majus',
      'junius',
      'julius',
      'augusztus',
      'szeptember',
      'oktober',
      'november',
      'december'
    ],
    regexes: [/\b\d{1,2}(st|nd|rd|th)?\b/iu]
  },
  {
    kind: 'noise_salary',
    matchType: 'phrase',
    confidence: 0.96,
    terms: ['salary', 'bonus', 'net', 'gross', 'lei', 'eur', 'ron', 'ft', 'huf', 'salary range']
  },
  {
    kind: 'noise_identifier',
    matchType: 'token',
    confidence: 0.95,
    regexes: [/\bwhc\d+\b/iu, /\bkh[_-]?\d+\b/iu, /\b[a-z]{1,4}\d{2,}\b/iu, /\b\d{3,}\b/iu, /\b[a-z]\d+[a-z\d-]*\b/iu]
  },
  {
    kind: 'noise_application_cta',
    matchType: 'phrase',
    confidence: 0.95,
    terms: [
      'apply',
      'apply now',
      'join us',
      'we need',
      'we are looking for',
      'alj hozzank',
      'jelentkezz',
      'cautam',
      'cauta',
      'angajam',
      'cauta colegi',
      'cautam colegi',
      'pebune'
    ]
  },
  {
    kind: 'noise_language',
    matchType: 'phrase',
    confidence: 0.92,
    terms: [
      'with english',
      'with german',
      'with french',
      'with italian',
      'with spanish',
      'with hungarian',
      'with romanian',
      'english required',
      'german required',
      'french required',
      'italian required',
      'spanish required',
      'hungarian required',
      'romanian required',
      'english language',
      'german language',
      'french language',
      'italian language',
      'spanish language',
      'hungarian language',
      'romanian language',
      'fluent english',
      'fluent german',
      'fluent french',
      'fluent italian',
      'fluent spanish',
      'fluent hungarian',
      'fluent romanian',
      'good english',
      'good german',
      'good french',
      'good italian',
      'good spanish',
      'good hungarian',
      'good romanian',
      'basic english',
      'basic german',
      'basic french',
      'basic italian',
      'basic spanish',
      'basic hungarian',
      'basic romanian',
      'english knowledge',
      'german knowledge',
      'french knowledge',
      'italian knowledge',
      'spanish knowledge',
      'hungarian knowledge',
      'romanian knowledge',
      'english speaking',
      'german speaking',
      'french speaking',
      'italian speaking',
      'spanish speaking',
      'hungarian speaking',
      'romanian speaking',
      'english speaker',
      'german speaker',
      'french speaker',
      'italian speaker',
      'spanish speaker',
      'hungarian speaker',
      'romanian speaker'
    ]
  }
] as const;

const COMMON_OCCUPATION_EXEMPTIONS: readonly string[] = [
  'engineer',
  'technician',
  'manager',
  'operator',
  'specialist',
  'assistant',
  'consultant',
  'analyst',
  'developer',
  'designer',
  'coordinator',
  'supervisor',
  'worker',
  'driver',
  'teacher',
  'nurse',
  'doctor',
  'receptionist',
  'accountant',
  'diszpécser',
  'dispatcher',
  'sales',
  'merchandiser',
  'producer',
  'installer',
  'mechanic',
  'electrician',
  'chef',
  'cook',
  'cleaner',
  'secretary',
  'guard',
  'representative',
  'architect',
  'advisor',
  'officer',
  'clerk',
  'buyer',
  'foreman',
  'hostess',
  'ambassador',
  'raktáros',
  'munkatárs',
  'értékesítő',
  'asszisztens',
  'mérnök',
  'technikus',
  'vezető',
  'szakács',
  'lakatos',
  'szerelő',
  'takarító',
  'eladó',
  'könyvelő',
  'tanár',
  'orvos',
  'adminisztratív',
  'műszaki',
  'inginer',
  'tehnician',
  'manager',
  'operator',
  'specialist',
  'asistent',
  'consilier',
  'analist',
  'dezvoltator',
  'designer',
  'coordonator',
  'supervizor',
  'lucrator',
  'șofer',
  'sofer',
  'profesor',
  'doctor',
  'recepționer',
  'contabil',
  'vânzări',
  'vanzari',
  'merchandiser',
  'instalator',
  'mecanic',
  'electrician',
  'bucatar',
  'vânzător',
  'vanzator',
  'jurist',
  'avocat'
] as const;

const COMMON_LOCATION_HINTS: readonly string[] = [
  'bucuresti',
  'bucharest',
  'budapest',
  'bacau',
  'craiova',
  'constanta',
  'targu-mures',
  'szeged',
  'debrecen',
  'ecser',
  'veszprem',
  'szekesfehervar',
  'budaors',
  'pallady'
];
const KNOWN_OCCUPATIONAL_ACRONYM_ALLOWLIST = new Set([
  'ai',
  'bi',
  'cad',
  'cnc',
  'crm',
  'erp',
  'hr',
  'hvac',
  'hvacr',
  'it',
  'pmo',
  'plc',
  'qa',
  'sql',
  'ui',
  'ux'
]);
const COMMON_NOISE_TOKENS = new Set([
  'with',
  'and',
  'for',
  'pentru',
  'cu',
  'pizza',
  'hut',
  'free',
  'delissima',
  'english',
  'german',
  'french',
  'italian',
  'spanish',
  'hungarian',
  'romanian',
  'irish',
  'understanding',
  'required',
  'knowledge',
  'speaking',
  'speaker',
  'language',
  'autoturism',
  'propriu',
  'bringo',
  'cautam',
  'colegi',
  'apply',
  'hiring',
  'looking',
  'seeking',
  'join',
  'need',
  'needs'
]);
const OCCUPATION_CORE_TOKENS = new Set([
  'administrator',
  'agent',
  'analyst',
  'architect',
  'assistant',
  'auditor',
  'buyer',
  'consultant',
  'coordinator',
  'designer',
  'developer',
  'director',
  'doctor',
  'driver',
  'electrician',
  'engineer',
  'enginer',
  'inspector',
  'manager',
  'mechanic',
  'operator',
  'planner',
  'planning',
  'plannificare',
  'patiserie',
  'receptioner',
  'reprezentant',
  'responsabil',
  'sales',
  'scientist',
  'specialist',
  'supervisor',
  'teacher',
  'technician',
  'tehnician',
  'worker'
]);
const COMMON_EMPLOYER_BRAND_PHRASES: readonly string[] = ['bringo', 'pizza hut', 'travel free', 'delissima bakery', 'delissima'];
const COMMON_LOCATION_CONTEXT_MARKERS: readonly string[] = [
  'pe teren',
  'zona',
  'oras',
  'municipiul',
  'jud',
  'jud.',
  'judet',
  'judetul',
  'comuna',
  'sat',
  'sector',
  'cartier',
  'strada',
  'bulevard',
  'bd',
  'autoturism propriu',
  'localitatea',
  'regiunea',
  'district',
  'county',
  'county road',
  'dr',
  'dn',
  'e85',
  'e60',
  'e68',
  'nr',
  'numarul',
  'numărul',
  'parcul',
  'park',
  'mall',
  'plaza',
  'hipermarket',
  'supermarket',
  'centrul',
  'centru',
  'platforma',
  'platform',
  'depozit',
  'showroom',
  'campus',
  'terminal',
  'kerulet',
  'utca',
  'ut',
  'utja',
  'ter',
  'kozpont',
  'telephely',
  'uzem',
  'bevasarlokozpont',
  'allomas',
  'palyaudvar',
  'varos',
  'megye',
  'korzet',
  'kornyeke',
  'munkavegzes',
  'muszak',
  'muszakos'
] as const;

const OCCUPATION_NOISE_PROFILE_INPUTS: Record<SupportedOccupationNoiseLocale, BuildOccupationNoisePeelingProfileInput> = {
  ro: {
    locale: 'ro',
    noiseRules: COMMON_NOISE_RULES,
    occupationExemptions: COMMON_OCCUPATION_EXEMPTIONS,
    locationHints: [
      ...COMMON_LOCATION_HINTS,
      'otopeni',
      'timisoara',
      'timișoara',
      'iasi',
      'iași',
      'galati',
      'galați',
      'buftea',
      'harghita',
      'acatari',
      'acăţari',
      'medgidia'
    ],
    locationContextMarkers: COMMON_LOCATION_CONTEXT_MARKERS,
    locationSuffixHints: [
      'jud',
      'jud.',
      'judet',
      'judetul',
      'municipiul',
      'oras',
      'oraș',
      'sector',
      'localitatea',
      'nr',
      'numarul',
      'numărul',
      'dr',
      'dn',
      'e85',
      'e60',
      'e68',
      'mall',
      'park',
      'plaza',
      'depozit',
      'platforma',
      'campus',
      'terminal'
    ]
  },
  hu: {
    locale: 'hu',
    noiseRules: COMMON_NOISE_RULES,
    occupationExemptions: COMMON_OCCUPATION_EXEMPTIONS,
    locationHints: [
      ...COMMON_LOCATION_HINTS,
      'budapest',
      'kistarcsa',
      'gyor',
      'szeged',
      'miskolc',
      'debrecen',
      'pecs',
      'veszprem',
      'szekesfehervar',
      'bekescsaba',
      'sopron',
      'kecskemet',
      'godollo',
      'dunaharaszti',
      'vecses',
      'budaors',
      'budakeszi',
      'nyiregyhaza',
      'eger',
      'komarom',
      'bicske',
      'mosonudvar',
      'satoraljaujhely',
      'szombathely',
      'nagykanizsa',
      'kormend',
      'westend',
      'arkad',
      'allee',
      'campona',
      'savoya',
      'lurdy',
      'zone park',
      'market central',
      'blaha lujza',
      'moricz',
      'deak',
      'etele',
      'nyugati',
      'pasareti',
      'ujbuda',
      'soroksar',
      'fovam ter',
      'szell kalman ter'
    ],
    locationContextMarkers: COMMON_LOCATION_CONTEXT_MARKERS,
    locationSuffixHints: [
      'kerulet',
      'utca',
      'ut',
      'utja',
      'ter',
      'park',
      'centrum',
      'kozpont',
      'telephely',
      'uzem',
      'bevasarlokozpont',
      'allomas',
      'palyaudvar',
      'varos',
      'megye',
      'korzet',
      'kornyeke',
      'munkavegzes',
      'muszak',
      'muszakos'
    ]
  }
};

export function buildOccupationNoisePeelingProfile(input: BuildOccupationNoisePeelingProfileInput): OccupationNoisePeelingProfile {
  return {
    locale: input.locale,
    noiseRules: input.noiseRules.map((rule) => ({
      ...rule,
      terms: Array.isArray(rule.terms) ? rule.terms.map(normalizeSearchText).filter(Boolean) : [],
      regexes: Array.isArray(rule.regexes) ? [...rule.regexes] : []
    })),
    normalizedOccupationExemptions: input.occupationExemptions.map(normalizeSearchText).filter(Boolean),
    normalizedLocationHints: input.locationHints.map(normalizeSearchText).filter(Boolean),
    normalizedLocationContextMarkers: input.locationContextMarkers.map(normalizeSearchText).filter(Boolean),
    normalizedLocationSuffixHints: input.locationSuffixHints.map(normalizeSearchText).filter(Boolean),
    normalizedShiftTerms: (input.noiseRules.find((rule) => rule.kind === 'noise_shift')?.terms ?? [])
      .map(normalizeSearchText)
      .filter(Boolean)
  };
}

export function getOccupationNoisePeelingProfile(locale: string | undefined): OccupationNoisePeelingProfile | null {
  const normalizedLocale = normalizeOccupationNoiseLocale(locale);
  if (!normalizedLocale) {
    return null;
  }

  return buildOccupationNoisePeelingProfile(OCCUPATION_NOISE_PROFILE_INPUTS[normalizedLocale]);
}

function normalizeOccupationNoiseLocale(locale: string | undefined): SupportedOccupationNoiseLocale | null {
  const normalized = String(locale ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'ro' || normalized === 'hu') {
    return normalized;
  }

  return null;
}

export function peelOccupationTitleNoise(title: string, locale: string | undefined): OccupationNoisePeelingResult {
  const profile = getOccupationNoisePeelingProfile(locale);
  if (!profile) {
    return createNoopOccupationNoisePeelingResult(title, locale);
  }

  return peelOccupationTitleNoiseWithProfile(title, profile);
}

export function peelOccupationTitleNoiseWithProfile(title: string, profile: OccupationNoisePeelingProfile): OccupationNoisePeelingResult {
  const originalTitle = String(title ?? '').trim();
  const normalizedTitle = normalizeSearchText(originalTitle);
  const chunks = extractOccupationTitleChunks(originalTitle);
  const classified = chunks.flatMap((chunk) => classifyOccupationNoiseChunk(chunk, profile));
  const noiseChunks = classified.filter((chunk) => chunk.kind !== null);
  const retainedChunks = classified.filter((chunk) => chunk.kind === null);
  const peeledTitle =
    noiseChunks.length === 0 && !didTransformChunks(chunks, classified)
      ? originalTitle
      : retainedChunks
          .map((chunk) => chunk.surface)
          .join(' ')
          .trim();

  return {
    locale: profile.locale,
    supportedLocale: true,
    originalTitle,
    normalizedTitle,
    chunks: classified,
    noiseChunks,
    retainedChunks,
    peeledTitle
  };
}

function didTransformChunks(
  originalChunks: Array<{ surface: string; origin: OccupationNoiseOrigin; isBracket: boolean }>,
  classifiedChunks: OccupationNoiseChunk[]
): boolean {
  if (originalChunks.length !== classifiedChunks.length) {
    return true;
  }

  return originalChunks.some((chunk, index) => {
    const classified = classifiedChunks[index];
    return !classified || classified.surface !== chunk.surface || classified.kind !== null;
  });
}

function createNoopOccupationNoisePeelingResult(title: string, locale: string | undefined): OccupationNoisePeelingResult {
  const originalTitle = String(title ?? '').trim();
  const normalizedTitle = normalizeSearchText(originalTitle);
  const chunk = {
    surface: originalTitle,
    normalizedSurface: normalizedTitle,
    origin: 'middle' as OccupationNoiseOrigin,
    isBracket: false,
    kind: null,
    matchType: null,
    confidence: null
  };

  return {
    locale: String(locale ?? ''),
    supportedLocale: false,
    originalTitle,
    normalizedTitle,
    chunks: [chunk],
    noiseChunks: [],
    retainedChunks: [chunk],
    peeledTitle: originalTitle
  };
}

export function extractOccupationTitleChunks(title: string): Array<{ surface: string; origin: OccupationNoiseOrigin; isBracket: boolean }> {
  const text = String(title ?? '');
  const pieces: Array<{ surface: string; origin: OccupationNoiseOrigin; isBracket: boolean }> = [];
  const bracketPattern = /\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/gu;
  const bracketChunks: Array<{ surface: string; isBracket: true }> = [];

  for (;;) {
    const match = bracketPattern.exec(text);

    if (match === null) {
      break;
    }

    const bracket = match[1] ?? match[2] ?? match[3] ?? '';
    const cleaned = cleanText(bracket);
    if (cleaned) {
      bracketChunks.push({ surface: cleaned, isBracket: true });
    }
  }

  const stripped = cleanText(text.replace(bracketPattern, ' '));
  const parts = stripped
    .split(/\s+(?:[/|]|[-–—])\s+/u)
    .map(cleanText)
    .filter(Boolean);

  if (parts.length === 0) {
    for (const bracketChunk of bracketChunks) {
      pieces.push({ surface: bracketChunk.surface, origin: 'trail', isBracket: true });
    }
    return pieces;
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const origin = index === 0 ? 'lead' : index === parts.length - 1 ? 'trail' : 'middle';
    pieces.push({ surface: part, origin, isBracket: false });
  }

  for (const bracketChunk of bracketChunks) {
    pieces.push({ surface: bracketChunk.surface, origin: 'trail', isBracket: true });
  }

  return pieces;
}

export function normalizeSearchText(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function classifyOccupationNoiseChunk(
  chunk: { surface: string; origin: OccupationNoiseOrigin; isBracket: boolean },
  profile: OccupationNoisePeelingProfile
): OccupationNoiseChunk[] {
  const surface = String(chunk.surface ?? '');
  const normalizedSurface = normalizeSearchText(surface);

  if (!normalizedSurface) {
    return [
      {
        surface,
        normalizedSurface,
        origin: chunk.origin,
        isBracket: chunk.isBracket,
        kind: null,
        matchType: null,
        confidence: null
      }
    ];
  }

  if (chunk.isBracket) {
    return [
      {
        surface,
        normalizedSurface,
        origin: 'trail',
        isBracket: true,
        kind: 'noise_parenthetical_info',
        matchType: 'chunk',
        confidence: 0.9
      }
    ];
  }

  const searchText = normalizedSurface;
  const foldedText = normalizedSurface;

  for (const rule of profile.noiseRules) {
    if (matchesNoiseRule(rule, surface, foldedText, searchText, profile)) {
      return maybeRetainMixedNoiseSurface(surface, profile, chunk.origin, rule.kind, rule.matchType, rule.confidence);
    }
  }

  if (looksLikeLocation(surface, normalizedSurface, profile)) {
    return maybeRetainMixedNoiseSurface(surface, profile, chunk.origin, 'noise_location', 'chunk', 0.9);
  }

  if (looksLikeEmployerBrand(surface, normalizedSurface, profile)) {
    return maybeRetainMixedNoiseSurface(surface, profile, chunk.origin, 'noise_employer_brand', 'chunk', 0.8);
  }

  if (looksLikeLanguageQualifier(normalizedSurface)) {
    return maybeRetainMixedNoiseSurface(surface, profile, chunk.origin, 'noise_language', 'chunk', 0.92);
  }

  return [
    {
      surface,
      normalizedSurface,
      origin: chunk.origin,
      isBracket: false,
      kind: null,
      matchType: null,
      confidence: null
    }
  ];
}

function maybeRetainMixedNoiseSurface(
  surface: string,
  profile: OccupationNoisePeelingProfile,
  origin: OccupationNoiseOrigin,
  kind: OccupationNoiseKind,
  matchType: 'phrase' | 'token' | 'chunk',
  confidence: number
): OccupationNoiseChunk[] {
  const retainedSurface = peelMixedNoiseSurface(surface, profile);

  if (retainedSurface && retainedSurface !== surface.trim()) {
    return [
      {
        surface: retainedSurface,
        normalizedSurface: normalizeSearchText(retainedSurface),
        origin,
        isBracket: false,
        kind: null,
        matchType: null,
        confidence: null
      }
    ];
  }

  if (kind === 'noise_shift' && hasOccupationCoreToken(surface)) {
    return [
      {
        surface,
        normalizedSurface: normalizeSearchText(surface),
        origin,
        isBracket: false,
        kind: null,
        matchType: null,
        confidence: null
      }
    ];
  }

  return [
    {
      surface,
      normalizedSurface: normalizeSearchText(surface),
      origin: classifyOrigin(surface, normalizeSearchText(surface), kind, profile.locale, origin),
      isBracket: false,
      kind,
      matchType,
      confidence
    }
  ];
}

function peelMixedNoiseSurface(surface: string, profile: OccupationNoisePeelingProfile): string {
  const tokens = String(surface ?? '')
    .split(/\s+/u)
    .map((token) => token.replace(/^[\s"'“”‘’.,;:!?-]+|[\s"'“”‘’.,;:!?-]+$/gu, ''))
    .filter(Boolean);

  const retained: string[] = [];

  for (const token of tokens) {
    if (!isPureNoisePeelToken(token, profile)) {
      retained.push(token);
    }
  }

  return retained.join(' ').trim();
}

function hasOccupationCoreToken(surface: string): boolean {
  const tokens = normalizeSearchText(surface).split(/\s+/u).filter(Boolean);
  return tokens.some((token) => OCCUPATION_CORE_TOKENS.has(token));
}

function isPureNoisePeelToken(token: string, profile: OccupationNoisePeelingProfile): boolean {
  const normalized = normalizeSearchText(token);

  if (!normalized) {
    return true;
  }

  if (profile.normalizedLocationHints.some((hint) => normalized === hint || normalized.includes(hint))) {
    return true;
  }

  if (COMMON_NOISE_TOKENS.has(normalized)) {
    return true;
  }

  if (looksLikeLanguageToken(normalized)) {
    return true;
  }

  if (looksLikeVisibleAcronymBrand(token, profile)) {
    return true;
  }

  if (looksLikeAcronymNoise(token) && !KNOWN_OCCUPATIONAL_ACRONYM_ALLOWLIST.has(normalized)) {
    return true;
  }

  return false;
}

function matchesNoiseRule(
  rule: OccupationNoiseRule,
  surface: string,
  foldedText: string,
  searchText: string,
  profile: OccupationNoisePeelingProfile
): boolean {
  if (rule.kind === 'noise_date' && hasAddressContext(searchText, profile)) {
    return false;
  }

  if (
    Array.isArray(rule.terms) &&
    rule.terms.some((term) => containsNormalizedTerm(searchText, term) || containsNormalizedTerm(foldedText, term))
  ) {
    return true;
  }

  if (Array.isArray(rule.regexes) && rule.regexes.some((regex) => regex.test(surface) || regex.test(foldedText))) {
    return true;
  }

  return false;
}

function classifyOrigin(
  surface: string,
  normalized: string,
  kind: OccupationNoiseKind,
  locale: string,
  originHint: OccupationNoiseOrigin
): OccupationNoiseOrigin {
  if (kind === 'noise_location' || kind === 'noise_parenthetical_info') {
    return 'trail';
  }

  if (kind === 'noise_salary' || kind === 'noise_date' || kind === 'noise_shift' || kind === 'noise_identifier') {
    return 'middle';
  }

  if (kind === 'noise_employment_flag' || kind === 'noise_ui_artifact' || kind === 'noise_application_cta') {
    return 'lead';
  }

  if (kind === 'noise_language') {
    return 'middle';
  }

  if (kind === 'noise_employer_brand') {
    return /^[A-Z0-9&./-]{2,}$/u.test(surface) ? 'lead' : 'middle';
  }

  if (originHint === 'lead' || originHint === 'middle' || originHint === 'trail') {
    return originHint;
  }

  return locale === 'hu' && normalized.includes('munkaidő') ? 'trail' : 'middle';
}

function looksLikeLocation(surface: string, normalized: string, profile: OccupationNoisePeelingProfile): boolean {
  if (looksLikeLocationContext(surface, normalized, profile)) {
    return true;
  }

  return profile.normalizedLocationHints.some((hint) => normalized.includes(hint));
}

function looksLikeLocationContext(surface: string, _normalized: string, profile: OccupationNoisePeelingProfile): boolean {
  const text = String(surface ?? '');
  const searchText = normalizeSearchText(text);
  const hasMarker = profile.normalizedLocationContextMarkers.some((marker) => containsNormalizedTerm(searchText, marker));
  const hasSuffix = profile.normalizedLocationSuffixHints.some((suffix) => containsNormalizedTerm(searchText, suffix));

  if (!hasMarker && !hasSuffix) {
    return false;
  }

  const tokens = text
    .split(/\s+/u)
    .map((token) => token.replace(/[^\p{L}\p{N}./-]+/gu, ''))
    .filter(Boolean);

  const markerIndex = tokens.findIndex((token) =>
    profile.normalizedLocationContextMarkers.some((marker) => containsNormalizedTerm(normalizeSearchText(token), marker))
  );

  if (markerIndex === -1) {
    return false;
  }

  const trailingTokens = tokens.slice(markerIndex + 1);
  if (trailingTokens.some((token) => isLikelyPlaceToken(token, profile))) {
    return true;
  }

  const leadingTokens = tokens.slice(0, markerIndex);
  return leadingTokens.some((token) => isLikelyPlaceToken(token, profile));
}

function looksLikeEmployerBrand(surface: string, normalized: string, profile: OccupationNoisePeelingProfile): boolean {
  if (containsKnownEmployerBrand(normalized)) {
    return true;
  }

  if (looksLikeVisibleAcronymBrand(surface, profile)) {
    return true;
  }

  if (containsOccupationHint(normalized, profile)) {
    return false;
  }

  if (looksLikeAcronymNoise(surface)) {
    return true;
  }

  if (/^[A-Z0-9&./-]{4,}$/u.test(surface) && /[&./-]|\d/u.test(surface)) {
    return true;
  }

  const tokens = normalizeSearchText(surface).split(/\s+/u).filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }

  return /\b(?:kft|zrt|rt|llc|inc|ltd|gmbh|srl|sa|group|holding|company|store|shop|mall|hotel|park|market)\b/iu.test(normalized);
}

function containsKnownEmployerBrand(normalized: string): boolean {
  return COMMON_EMPLOYER_BRAND_PHRASES.some((phrase) => containsNormalizedTerm(normalized, phrase));
}

function looksLikeVisibleAcronymBrand(surface: string, profile: OccupationNoisePeelingProfile): boolean {
  const normalizedSurface = normalizeSearchText(surface);
  const tokens = String(surface ?? '')
    .split(/\s+/u)
    .map((token) => token.replace(/^[\s"'“”‘’.,;:!?-]+|[\s"'“”‘’.,;:!?-]+$/gu, ''))
    .filter(Boolean);

  if (tokens.length < 2) {
    return false;
  }

  for (const token of tokens) {
    const compact = token.replace(/[\s"'“”‘’.,;:!?-]+/gu, '');
    if (!compact || compact.length > 12) {
      continue;
    }

    if (!/^[A-Z0-9&./-]+$/u.test(compact)) {
      continue;
    }

    if (/^(?:hr|it|qa|ui|ux|b2b|b2c|b2e|b2g)$/iu.test(compact)) {
      continue;
    }

    if (containsOccupationHint(normalizeSearchText(compact), profile)) {
      continue;
    }

    if (
      (/[&./-]|\d/u.test(compact) ||
        /\b(?:kft|zrt|rt|llc|inc|ltd|gmbh|srl|sa|group|holding|company|store|shop|mall|hotel|park|market)\b/iu.test(normalizedSurface)) &&
      (/^[A-Z]{2,12}$/u.test(compact) || /^[A-Z]{1,5}\d+[A-Z\d]*$/u.test(compact) || /^\d+[A-Z]{1,5}[A-Z\d]*$/u.test(compact))
    ) {
      return true;
    }
  }

  return false;
}

function containsOccupationHint(normalized: string, profile: OccupationNoisePeelingProfile): boolean {
  return profile.normalizedOccupationExemptions.some((hint) => normalized.includes(hint));
}

function containsNormalizedTerm(text: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  return ` ${text} `.includes(` ${normalizedTerm} `);
}

function hasAddressContext(searchText: string, profile: OccupationNoisePeelingProfile): boolean {
  return profile.normalizedLocationSuffixHints.some((term) => containsNormalizedTerm(searchText, term));
}

function isLikelyPlaceToken(token: string, profile: OccupationNoisePeelingProfile): boolean {
  const stripped = String(token ?? '').replace(/^[\s"'“”‘’.,;:!?-]+|[\s"'“”‘’.,;:!?-]+$/gu, '');
  if (!stripped) {
    return false;
  }

  const normalized = normalizeSearchText(stripped);
  if (containsOccupationHint(normalized, profile)) {
    return false;
  }

  if (/^\d{1,3}$/.test(stripped) || /^e\d{1,3}$/iu.test(stripped) || /^dn\d{1,3}$/iu.test(stripped)) {
    return true;
  }

  return /^[\p{Lu}][\p{L}\p{M}-]{2,}$/u.test(stripped) || /^[A-Z0-9&./-]{3,}$/u.test(stripped);
}

function looksLikeAcronymNoise(surface: string): boolean {
  const text = String(surface ?? '');
  const compact = text.replace(/[\s"'“”‘’.,;:!?-]+/gu, '');
  if (!compact || compact.length > 6) {
    return false;
  }

  return isAcronymToken(compact);
}

function looksLikeLanguageQualifier(normalized: string): boolean {
  const text = ` ${normalized} `;

  if (/\b(?:english|german|french|italian|spanish|hungarian|romanian)\s+teacher\b/iu.test(text)) {
    return false;
  }

  return (
    /\bwith\s+(?:english|german|french|italian|spanish|hungarian|romanian)\b/iu.test(text) ||
    /\b(?:english|german|french|italian|spanish|hungarian|romanian)\s+(?:required|knowledge|speaking|speaker|language)\b/iu.test(text) ||
    /\b(?:fluent|good|basic|advanced)\s+(?:english|german|french|italian|spanish|hungarian|romanian)\b/iu.test(text)
  );
}

function looksLikeLanguageToken(normalized: string): boolean {
  return /^(?:english|german|french|italian|spanish|hungarian|romanian|irish|understanding|required|knowledge|speaking|speaker|language)$/iu.test(
    normalized
  );
}

function isAcronymToken(token: string): boolean {
  const normalized = String(token ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!normalized) {
    return false;
  }

  if (/^(?:b2b|b2c|b2e|b2g|hr|it|qa|ui|ux)$/iu.test(normalized)) {
    return false;
  }

  if (/^[A-Z]{2,6}$/u.test(normalized)) {
    return true;
  }

  return /^[A-Z]{1,5}\d+[A-Z\d]*$/u.test(normalized) || /^\d+[A-Z]{1,5}[A-Z\d]*$/u.test(normalized);
}

function cleanText(value: string): string {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'“”‘’.,;:!?-]+/gu, '')
    .replace(/[\s"'“”‘’.,;:!?-]+$/gu, '')
    .trim();
}
