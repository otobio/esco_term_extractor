import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const SOURCE_FILES = [
  {
    source: 'ejobs',
    locale: 'ro',
    paths: ['/Users/otobio/Downloads/ejobs_job_titles.csv']
  },
  {
    source: 'profession',
    locale: 'hu',
    paths: [
      '/Users/otobio/Downloads/profession_job_titles_01.csv',
      '/Users/otobio/Downloads/profession_job_titles_02.csv',
      '/Users/otobio/Downloads/profession_job_titles.csv'
    ]
  }
];

const LOCALE_PROFILES = {};

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'data', 'taxonomy-review');
const DEFAULT_OUTPUT_BASENAME = 'job-title-noise-patterns';
const DEFAULT_SAMPLE_BASENAME = 'job-title-noise-patterns.sample';
const DEFAULT_AUDIT_BASENAME = 'job-title-noise-audit.sample';

const NOISE_RULES = [
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
      'm f x'
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
      'shift',
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
      'tura de noapte',
      'tura',
      'schimburi',
      'munca in ture',
      'munca în ture',
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
    terms: ['salary', 'bonus', 'net', 'gross', 'lei', 'eur', 'ron', 'ft', 'huf', 'eur', 'salary range']
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
    terms: ['apply', 'apply now', 'join us', 'we need', 'we are looking for', 'alj hozzank', 'jelentkezz', 'cautam', 'cauta', 'angajam']
  }
];

const OCCUPATION_EXEMPTIONS = [
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
];

const LOCATION_HINTS = [
  'bucurești',
  'bucuresti',
  'bucharest',
  'budapest',
  'bacau',
  'bacău',
  'craiova',
  'constanta',
  'constanța',
  'targu-mures',
  'târgu-mureș',
  'szeged',
  'szeged',
  'debrecen',
  'ecser',
  'veszprem',
  'szekesfehervar',
  'budaörs',
  'budapest',
  'pallady'
];

const LOCATION_CONTEXT_MARKERS = [
  'pe teren',
  'zona',
  'oras',
  'oraș',
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
  'terminal'
];

LOCALE_PROFILES.ro = buildLocaleProfile({
  locale: 'ro',
  noiseRules: NOISE_RULES,
  occupationExemptions: OCCUPATION_EXEMPTIONS,
  locationHints: [
    ...LOCATION_HINTS,
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
  locationContextMarkers: LOCATION_CONTEXT_MARKERS,
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
});

LOCALE_PROFILES.hu = buildLocaleProfile({
  locale: 'hu',
  noiseRules: NOISE_RULES,
  occupationExemptions: OCCUPATION_EXEMPTIONS,
  locationHints: [
    ...LOCATION_HINTS,
    'budapest',
    'kistarcsa',
    'ecser',
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
  locationContextMarkers: [
    ...LOCATION_CONTEXT_MARKERS,
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
  ],
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
});

function buildLocaleProfile({ locale, noiseRules, occupationExemptions, locationHints, locationContextMarkers, locationSuffixHints }) {
  const normalizedOccupationExemptions = occupationExemptions.map(normalizeSearchText);
  const normalizedLocationHints = locationHints.map(normalizeSearchText);
  const normalizedLocationContextMarkers = locationContextMarkers.map(normalizeSearchText);
  const normalizedLocationSuffixHints = locationSuffixHints.map(normalizeSearchText);
  const normalizedShiftTerms = (noiseRules.find((rule) => rule.kind === 'noise_shift')?.terms ?? [])
    .map(normalizeSearchText)
    .filter(Boolean);

  return {
    locale,
    noiseRules: noiseRules.map((rule) => ({
      ...rule,
      normalizedTerms: Array.isArray(rule.terms) ? rule.terms.map(normalizeSearchText).filter(Boolean) : []
    })),
    normalizedOccupationExemptions,
    normalizedLocationHints,
    normalizedLocationContextMarkers,
    normalizedLocationSuffixHints,
    normalizedShiftTerms
  };
}

function getLocaleProfile(locale) {
  return LOCALE_PROFILES[locale] ?? LOCALE_PROFILES.ro;
}

function main() {
  const sampleLimit = parseIntegerArg('--sample');
  const sampleSeed = getArgValue('--seed') ?? 'ejobs-noise';
  const outBasePath =
    getArgValue('--out') ?? path.join(DEFAULT_OUTPUT_DIR, sampleLimit ? DEFAULT_SAMPLE_BASENAME : DEFAULT_OUTPUT_BASENAME);
  const sourceFilter = getArgValue('--source');
  const keepNoiseLocationSingletons = Boolean(sampleLimit);
  const localeRows = new Map();

  for (const source of SOURCE_FILES) {
    if (sourceFilter && sourceFilter !== source.source) {
      continue;
    }

    const sourcePath = source.paths.find((candidate) => existsSync(candidate));
    if (!sourcePath) {
      console.warn(`Skipping ${source.source}: no source file found`);
      continue;
    }

    const sourceRows = parse(readFileSync(sourcePath, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    const selectedRows = sampleLimit ? sampleRows(sourceRows, sampleLimit, sampleSeed) : sourceRows;
    const profile = getLocaleProfile(source.locale);

    const bucket = new Map();

    for (const row of selectedRows) {
      const title = String(row.job_title ?? '').trim();
      if (!title) {
        continue;
      }

      const chunks = extractChunks(title);
      for (const chunk of chunks) {
        const surface = String(chunk.surface ?? '');
        const normalized = fold(surface);
        if (!normalized) {
          continue;
        }

        const match = classifyNoiseChunk(surface, normalized, profile, chunk.origin, chunk);
        if (!match) {
          continue;
        }

        const key = `${source.locale}|${match.kind}|${normalized}`;
        const entry = bucket.get(key) ?? createEntry(source, match, surface, normalized);
        entry.titleCount += 1;
        entry.sourceCounts[source.source] += 1;
        entry.originCounts[match.origin] += 1;
        if (entry.examples.length < 5 && !entry.examples.includes(title)) {
          entry.examples.push(title);
        }
        bucket.set(key, entry);
      }
    }

    const rows = Array.from(bucket.values())
      .filter((entry) => entry.titleCount >= 2 || entry.kind !== 'noise_location' || keepNoiseLocationSingletons)
      .map((entry) => finalizeEntry(entry));

    localeRows.set(source.locale, rows);

    if (sampleLimit) {
      console.log(`sampled ${selectedRows.length} titles from ${source.source} using seed=${sampleSeed}`);
    }

    if (sampleLimit) {
      const auditBasePath = getArgValue('--audit-out') ?? path.join(DEFAULT_OUTPUT_DIR, DEFAULT_AUDIT_BASENAME);
      const auditPath = sourceFilter ? ensureCsvPathWithLocale(auditBasePath, source.locale) : getLocalePath(auditBasePath, source.locale);
      const auditRows = buildSampleAuditRows(selectedRows, profile);
      writeFileSync(auditPath, `${renderAuditCsv(auditRows)}\n`, 'utf8');
      console.log(`Wrote ${auditRows.length} sampled title audit rows to ${auditPath}`);
    }
  }

  const sortedLocales = Array.from(localeRows.keys()).sort((left, right) => left.localeCompare(right));
  for (const locale of sortedLocales) {
    const rows = localeRows.get(locale) ?? [];
    rows.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      if (right.titleCount !== left.titleCount) {
        return right.titleCount - left.titleCount;
      }
      return left.normalized_surface.localeCompare(right.normalized_surface);
    });

    const outPath = getLocalePath(outBasePath, locale);
    writeFileSync(outPath, `${renderCsv(rows)}\n`, 'utf8');
    console.log(`Wrote ${rows.length} noise pattern rows to ${outPath}`);
    console.log(
      [
        `locale=${locale}`,
        `sample=${sampleLimit ?? 'none'}`,
        `rows=${rows.length}`,
        `noise_location=${rows.filter((row) => row.kind === 'noise_location').length}`,
        `noise_employment=${rows.filter((row) => row.kind === 'noise_employment_flag').length}`,
        `noise_date=${rows.filter((row) => row.kind === 'noise_date').length}`,
        `noise_salary=${rows.filter((row) => row.kind === 'noise_salary').length}`,
        `noise_identifier=${rows.filter((row) => row.kind === 'noise_identifier').length}`,
        `noise_parenthetical=${rows.filter((row) => row.kind === 'noise_parenthetical_info').length}`,
        `noise_ui=${rows.filter((row) => row.kind === 'noise_ui_artifact').length}`,
        `noise_cta=${rows.filter((row) => row.kind === 'noise_application_cta').length}`
      ].join('  ')
    );
  }
}

function buildSampleAuditRows(sampleRows, profile) {
  return sampleRows.map((row, index) => {
    const title = String(row.job_title ?? '').trim();
    const chunks = extractChunks(title);
    const matched = [];
    const hints = [];

    for (const chunk of chunks) {
      const surface = String(chunk.surface ?? '');
      const normalized = fold(surface);
      if (!normalized) {
        continue;
      }

      const match = classifyNoiseChunk(surface, normalized, profile, chunk.origin, chunk);
      if (match) {
        matched.push(`${match.kind}:${surface}`);
      }
    }

    const normalizedTitle = normalizeSearchText(title);
    const shiftHint = detectShiftHint(normalizedTitle, profile);
    const locationHint = detectLocationHint(normalizedTitle, profile);
    const employmentHint = detectEmploymentHint(normalizedTitle, profile);
    const locationMarkers = collectLocationMarkers(normalizedTitle, profile);
    if (shiftHint && !matched.some((entry) => entry.startsWith('noise_shift:'))) {
      hints.push(`shift:${shiftHint}`);
    }
    if ((locationHint || locationMarkers.length > 0) && !matched.some((entry) => entry.startsWith('noise_location:'))) {
      if (locationHint) {
        hints.push(`location:${locationHint}`);
      }
      for (const marker of locationMarkers) {
        hints.push(`location_marker:${marker}`);
      }
    }
    if (locationHint && matched.some((entry) => entry.startsWith('noise_location:'))) {
      hints.push(`location:${locationHint}`);
    }
    if (employmentHint && !matched.some((entry) => entry.startsWith('noise_employment_flag:'))) {
      hints.push(`employment:${employmentHint}`);
    }

    return {
      row_index: index + 1,
      title,
      normalized_title: normalizedTitle,
      chunk_count: chunks.length,
      matched_noise: matched.join(' || '),
      matched_noise_count: matched.length,
      obvious_hints: hints.join(' || '),
      obvious_hint_count: hints.length
    };
  });
}

function sampleRows(rows, limit, seed) {
  const items = Array.from(rows);
  if (items.length <= limit) {
    return items;
  }

  const random = mulberry32(hashSeed(seed));
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items.slice(0, limit);
}

function createEntry(source, match, surface, normalizedSurface) {
  return {
    locale: source.locale,
    source: source.source,
    kind: match.kind,
    matchType: match.matchType,
    surface,
    normalizedSurface,
    titleCount: 0,
    sourceCounts: {
      ejobs: 0,
      profession: 0
    },
    originCounts: {
      lead: 0,
      middle: 0,
      trail: 0
    },
    confidence: match.confidence,
    examples: []
  };
}

function finalizeEntry(entry) {
  const totalSources = entry.sourceCounts.ejobs + entry.sourceCounts.profession;
  const trailBias = entry.originCounts.trail / Math.max(1, entry.titleCount);
  const leadBias = entry.originCounts.lead / Math.max(1, entry.titleCount);
  const exclusivity = totalSources === 0 ? 0 : Math.max(entry.sourceCounts.ejobs, entry.sourceCounts.profession) / totalSources;
  const confidence = clamp(
    entry.confidence * 0.55 + Math.min(1, entry.titleCount / 20) * 0.2 + exclusivity * 0.15 + Math.max(trailBias, leadBias) * 0.1
  );

  return {
    locale: entry.locale,
    kind: entry.kind,
    match_type: entry.matchType,
    surface: entry.surface,
    normalized_surface: entry.normalizedSurface,
    source: entry.source,
    ejobs_count: entry.sourceCounts.ejobs,
    profession_count: entry.sourceCounts.profession,
    title_count: entry.titleCount,
    lead_count: entry.originCounts.lead,
    middle_count: entry.originCounts.middle,
    trail_count: entry.originCounts.trail,
    confidence: round(confidence),
    action: 'strip_before_scoring',
    examples: entry.examples.join(' || ')
  };
}

function classifyNoiseChunk(surface, normalized, profile, originHint = 'middle', chunk = null) {
  const text = String(surface ?? '');
  const folded = normalized;
  const searchText = normalizeSearchText(text);
  const searchFolded = normalizeSearchText(folded);

  if (chunk?.isBracket) {
    return {
      kind: 'noise_parenthetical_info',
      matchType: 'chunk',
      confidence: 0.9,
      origin: classifyOrigin(text, normalized, 'noise_parenthetical_info', profile.locale, 'trail')
    };
  }

  for (const rule of profile.noiseRules) {
    if (matchesNoiseRule(rule, text, folded, searchText, searchFolded, profile)) {
      return {
        kind: rule.kind,
        matchType: rule.matchType,
        confidence: rule.confidence,
        origin: classifyOrigin(text, normalized, rule.kind, profile.locale, originHint)
      };
    }
  }

  if (looksLikeLocation(text, normalized, profile)) {
    return {
      kind: 'noise_location',
      matchType: 'chunk',
      confidence: 0.9,
      origin: classifyOrigin(text, normalized, 'noise_location', profile.locale, originHint)
    };
  }

  if (looksLikeEmployerBrand(text, normalized, profile)) {
    return {
      kind: 'noise_employer_brand',
      matchType: 'chunk',
      confidence: 0.8,
      origin: classifyOrigin(text, normalized, 'noise_employer_brand', profile.locale, originHint)
    };
  }

  return null;
}

function matchesNoiseRule(rule, text, folded, searchText, searchFolded, profile) {
  if (rule.kind === 'noise_date' && hasAddressContext(searchText, profile)) {
    return false;
  }

  if (
    Array.isArray(rule.normalizedTerms) &&
    rule.normalizedTerms.some((term) => containsNormalizedTerm(searchText, term) || containsNormalizedTerm(searchFolded, term))
  ) {
    return true;
  }

  if (Array.isArray(rule.regexes) && rule.regexes.some((regex) => regex.test(text) || regex.test(folded))) {
    return true;
  }

  return false;
}

function classifyOrigin(surface, normalized, kind, locale, originHint = 'middle') {
  if (kind === 'noise_location') {
    return 'trail';
  }

  if (kind === 'noise_salary' || kind === 'noise_date' || kind === 'noise_shift' || kind === 'noise_identifier') {
    return 'middle';
  }

  if (kind === 'noise_parenthetical_info') {
    return 'trail';
  }

  if (kind === 'noise_employment_flag' || kind === 'noise_ui_artifact' || kind === 'noise_application_cta') {
    return 'lead';
  }

  if (kind === 'noise_employer_brand') {
    return /^[A-Z0-9&./-]{2,}$/u.test(surface) ? 'lead' : 'middle';
  }

  if (originHint === 'lead' || originHint === 'middle' || originHint === 'trail') {
    return originHint;
  }

  return locale === 'hu' && normalized.includes('munkaidő') ? 'trail' : 'middle';
}

function looksLikeLocation(surface, normalized, profile) {
  if (looksLikeLocationContext(surface, normalized, profile)) {
    return true;
  }

  if (containsOccupationHint(normalized, profile)) {
    return false;
  }

  if (profile.normalizedLocationHints.some((hint) => normalized.includes(hint))) {
    return true;
  }
  return false;
}

function looksLikeEmployerBrand(surface, normalized, profile) {
  const text = String(surface ?? '');
  if (containsOccupationHint(normalized, profile)) {
    return false;
  }

  if (looksLikeAcronymNoise(text)) {
    return true;
  }

  if (/^[A-Z0-9&./-]{4,}$/u.test(text) && /[&./-]|\d/u.test(text)) {
    return true;
  }

  const tokens = normalizeSearchText(text).split(/\s+/u).filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }

  if (/\b(?:kft|zrt|rt|llc|inc|ltd|gmbh|srl|sa|group|holding|company|store|shop|mall|hotel|action|drk|park|market)\b/iu.test(normalized)) {
    return true;
  }

  return false;
}

function containsOccupationHint(normalized, profile) {
  return profile.normalizedOccupationExemptions.some((hint) => normalized.includes(hint));
}

function extractChunks(title) {
  const text = String(title ?? '');
  const pieces = [];
  const bracketPattern = /\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/gu;
  const bracketChunks = [];

  for (;;) {
    const match = bracketPattern.exec(text);

    if (match === null) {
      break;
    }

    const bracket = match[1] ?? match[2] ?? match[3] ?? '';
    const cleaned = clean(bracket);
    if (cleaned) {
      bracketChunks.push({ surface: cleaned, isBracket: true });
    }
  }

  const stripped = clean(text.replace(bracketPattern, ' '));
  const parts = stripped
    .split(/\s+(?:[/|]|[-–—])\s+/u)
    .map(clean)
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

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'“”‘’.,;:!?-]+/gu, '')
    .replace(/[\s"'“”‘’.,;:!?-]+$/gu, '')
    .trim();
}

function normalizeSearchText(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containsNormalizedTerm(text, term) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  return ` ${text} `.includes(` ${normalizedTerm} `);
}

function isAcronymToken(token) {
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

function looksLikeAcronymNoise(surface) {
  const text = String(surface ?? '');
  const compact = text.replace(/[\s"'“”‘’.,;:!?-]+/gu, '');
  if (!compact || compact.length > 6) {
    return false;
  }

  return isAcronymToken(compact);
}

function hasAddressContext(searchText, profile) {
  return profile.normalizedLocationSuffixHints.some((term) => containsNormalizedTerm(searchText, term));
}

function looksLikeLocationContext(surface, _normalized, profile) {
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
  if (trailingTokens.length === 0) {
    const leadingTokens = tokens.slice(0, markerIndex);
    return leadingTokens.some((token) => isLikelyPlaceToken(token, profile));
  }

  if (trailingTokens.some((token) => isLikelyPlaceToken(token, profile))) {
    return true;
  }

  const leadingTokens = tokens.slice(0, markerIndex);
  if (leadingTokens.some((token) => isLikelyPlaceToken(token, profile))) {
    return true;
  }

  return false;
}

function detectShiftHint(searchText, profile) {
  if (profile.normalizedShiftTerms.some((term) => containsNormalizedTerm(searchText, term))) {
    return 'shift_word';
  }

  if (/\b\d+\s?(?:ore|ora|hours?|h)\b/iu.test(searchText)) {
    return 'hours_phrase';
  }

  if (/\b\d+\s?\/\s?\d+\b/iu.test(searchText)) {
    return 'rotation_ratio';
  }

  if (
    containsNormalizedTerm(searchText, 'full time') ||
    containsNormalizedTerm(searchText, 'part time') ||
    containsNormalizedTerm(searchText, 'részmunkaidő') ||
    containsNormalizedTerm(searchText, 'teljes munkaidő')
  ) {
    return 'employment_schedule';
  }

  return null;
}

function detectLocationHint(searchText, profile) {
  if (detectLocationContextHint(searchText, profile)) {
    return 'location_context';
  }

  for (const hint of profile.normalizedLocationHints) {
    if (containsNormalizedTerm(searchText, hint)) {
      return hint;
    }
  }

  return null;
}

function collectLocationMarkers(searchText, profile) {
  const markers = [];
  for (const marker of profile.normalizedLocationContextMarkers) {
    if (containsNormalizedTerm(searchText, marker) && !markers.includes(marker)) {
      markers.push(marker);
    }
  }
  return markers;
}

function detectLocationContextHint(searchText, profile) {
  if (!profile.normalizedLocationContextMarkers.some((marker) => containsNormalizedTerm(searchText, marker))) {
    return null;
  }

  if (containsNormalizedTerm(searchText, 'autoturism propriu')) {
    return 'autoturism propriu';
  }

  if (containsNormalizedTerm(searchText, 'pe teren')) {
    return 'pe teren';
  }

  if (containsNormalizedTerm(searchText, 'zona')) {
    return 'zona';
  }

  if (
    containsNormalizedTerm(searchText, 'jud') ||
    containsNormalizedTerm(searchText, 'kerulet') ||
    containsNormalizedTerm(searchText, 'megye')
  ) {
    return 'jud';
  }

  if (
    containsNormalizedTerm(searchText, 'oras') ||
    containsNormalizedTerm(searchText, 'oraș') ||
    containsNormalizedTerm(searchText, 'varos')
  ) {
    return 'oras';
  }

  if (containsNormalizedTerm(searchText, 'municipiul')) {
    return 'municipiul';
  }

  if (containsNormalizedTerm(searchText, 'dr') || containsNormalizedTerm(searchText, 'dn') || /\be\d{1,3}\b/iu.test(searchText)) {
    return 'road';
  }

  if (
    containsNormalizedTerm(searchText, 'mall') ||
    containsNormalizedTerm(searchText, 'park') ||
    containsNormalizedTerm(searchText, 'plaza') ||
    containsNormalizedTerm(searchText, 'arkad') ||
    containsNormalizedTerm(searchText, 'westend') ||
    containsNormalizedTerm(searchText, 'campona') ||
    containsNormalizedTerm(searchText, 'allee')
  ) {
    return 'mall_park';
  }

  if (
    containsNormalizedTerm(searchText, 'depozit') ||
    containsNormalizedTerm(searchText, 'platforma') ||
    containsNormalizedTerm(searchText, 'campus') ||
    containsNormalizedTerm(searchText, 'terminal') ||
    containsNormalizedTerm(searchText, 'telephely') ||
    containsNormalizedTerm(searchText, 'uzem')
  ) {
    return 'site_context';
  }

  return 'location_context';
}

function isLikelyPlaceToken(token, profile) {
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

function detectEmploymentHint(searchText) {
  if (
    containsNormalizedTerm(searchText, 'f m') ||
    containsNormalizedTerm(searchText, 'm f') ||
    containsNormalizedTerm(searchText, 'm w d') ||
    containsNormalizedTerm(searchText, 'f m d')
  ) {
    return 'gender_marker';
  }

  if (containsNormalizedTerm(searchText, 'diakmunka') || containsNormalizedTerm(searchText, 'entry level')) {
    return 'employment_status';
  }

  return null;
}

function getLocalePath(basePath, locale) {
  const ext = path.extname(basePath);
  if (!ext || ext === '.sample') {
    return `${basePath}.${locale}.csv`;
  }

  const dir = path.dirname(basePath);
  const name = path.basename(basePath, ext);
  return path.join(dir, `${name}.${locale}${ext}`);
}

function ensureCsvPathWithLocale(basePath, locale) {
  const ext = path.extname(basePath);
  if (ext && ext !== '.sample') {
    return getLocalePath(basePath, locale);
  }

  return `${basePath}.${locale}.csv`;
}

function renderAuditCsv(rows) {
  const header = [
    'row_index',
    'title',
    'normalized_title',
    'chunk_count',
    'matched_noise',
    'matched_noise_count',
    'obvious_hints',
    'obvious_hint_count'
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.row_index,
        row.title,
        row.normalized_title,
        row.chunk_count,
        row.matched_noise,
        row.matched_noise_count,
        row.obvious_hints,
        row.obvious_hint_count
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  return lines.join('\n');
}

function fold(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function renderCsv(rows) {
  const header = [
    'locale',
    'kind',
    'match_type',
    'surface',
    'normalized_surface',
    'source',
    'ejobs_count',
    'profession_count',
    'title_count',
    'lead_count',
    'middle_count',
    'trail_count',
    'confidence',
    'action',
    'examples'
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.locale,
        row.kind,
        row.match_type,
        row.surface,
        row.normalized_surface,
        row.source,
        row.ejobs_count,
        row.profession_count,
        row.title_count,
        row.lead_count,
        row.middle_count,
        row.trail_count,
        row.confidence,
        row.action,
        row.examples
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  return lines.join('\n');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/u.test(text)) {
    return text;
  }

  return `"${text.replace(/"/gu, '""')}"`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseIntegerArg(name) {
  const value = getArgValue(name);
  if (value == null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main();
