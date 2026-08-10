import type { SupportedQueryLocale } from './query-preparation.js';
import { tokenMatchesLocaleVariant } from './token-variants.js';
import type { OccupationGroup } from '../api/occupation-family-taxonomy.js';
import { foldSearchText } from '../utils/texts.js';

export type QueryIntentTermKind =
  | 'role_head'
  | 'role_modifier'
  | 'venue_context'
  | 'domain_modifier'
  | 'seniority_modifier'
  | 'credential_modifier'
  | 'ambiguous_modifier'
  | 'unresolved_modifier';

export type QueryIntentDecision = {
  token: string;
  normalizedToken: string;
  index: number;
  kind: QueryIntentTermKind;
  reason: string;
};

export type OccupationQueryIntent = {
  roleTokens: string[];
  roleHeadTokens: string[];
  genericRoleHeadTokens: string[];
  authoritativeRoleHeadTokens: string[];
  occupationClassPreference: OccupationClassPreference;
  roleHeadRequiresContext: boolean;
  roleHeadHasContext: boolean;
  venueTokens: string[];
  domainTokens: string[];
  seniorityTokens: string[];
  credentialTokens: string[];
  ambiguousTokens: string[];
  unresolvedModifierTokens: string[];
  confidence: number;
  diagnostics: QueryIntentDecision[];
};

export type OccupationQueryIntentRoleHeadAuthority = Pick<
  OccupationQueryIntent,
  'genericRoleHeadTokens' | 'authoritativeRoleHeadTokens' | 'roleHeadRequiresContext' | 'roleHeadHasContext'
>;

export type OccupationClassPreference = {
  preferredFamilyGroups: OccupationGroup[];
  disfavoredFamilyGroups: OccupationGroup[];
};

export type OccupationIntentVocabularyLocale = {
  localeCode: SupportedQueryLocale | string;
  roleHeadTerms: string[];
  roleModifierTerms: string[];
  domainModifierTerms: string[];
  credentialModifierTerms: string[];
  ambiguousModifierTerms: string[];
  rolePhrases: string[];
  domainPhrases: string[];
};

export type OccupationIntentVocabulary = {
  localeProfiles: OccupationIntentVocabularyLocale[];
  resolveLocaleProfile?: (localeCode: string) => OccupationIntentVocabularyLocale | null;
};

export type ClassifyOccupationQueryIntentInput = {
  locale: SupportedQueryLocale;
  foldedTokens: string[];
  usefulFoldedTokens: string[];
  roleExpansionFoldedTokens?: string[];
  stopTokens: string[];
  noiseTokens: string[];
  modifierTokens: string[];
  vocabulary?: OccupationIntentVocabulary | null;
};

type IntentVocabularyLookup = {
  roleHeads: Set<string>;
  roleModifiers: Set<string>;
  domainModifiers: Set<string>;
  credentialModifiers: Set<string>;
  ambiguousModifiers: Set<string>;
  rolePhrasesByFirstToken: Map<string, IntentPhrase[]>;
  domainPhrasesByFirstToken: Map<string, IntentPhrase[]>;
  maxRolePhraseLength: number;
  maxDomainPhraseLength: number;
};

type IntentPhrase = {
  key: string;
  tokens: string[];
};

const VOCABULARY_LOOKUP_CACHE = new WeakMap<OccupationIntentVocabulary, Map<SupportedQueryLocale, IntentVocabularyLookup>>();

export const BUILTIN_INTENT_VOCABULARY: OccupationIntentVocabulary = {
  localeProfiles: [
    {
      localeCode: 'en',
      roleHeadTerms: [
        'accountant',
        'administrator',
        'advisor',
        'analyst',
        'architect',
        'assistant',
        'auditor',
        'baker',
        'carpenter',
        'clerk',
        'consultant',
        'coordinator',
        'cook',
        'counsellor',
        'cleaner',
        'designer',
        'developer',
        'driver',
        'electrician',
        'engineer',
        'examiner',
        'hairdresser',
        'housekeeper',
        'inspector',
        'installer',
        'instructor',
        'janitor',
        'lawyer',
        'manager',
        'mechanic',
        'nurse',
        'officer',
        'operator',
        'painter',
        'planner',
        'plumber',
        'programmer',
        'receptionist',
        'representative',
        'roofer',
        'specialist',
        'supervisor',
        'teacher',
        'technician',
        'therapist',
        'trainer',
        'waiter',
        'welder',
        'worker'
      ],
      roleModifierTerms: [
        'accounting',
        'aircraft',
        'application',
        'automotive',
        'backend',
        'business',
        'civil',
        'compliance',
        'construction',
        'data',
        'database',
        'electrical',
        'financial',
        'frontend',
        'fullstack',
        'health',
        'human',
        'industrial',
        'information',
        'maintenance',
        'marketing',
        'mechanical',
        'medical',
        'network',
        'occupational',
        'operations',
        'quality',
        'resources',
        'sales',
        'security',
        'software',
        'systems',
        'tax',
        'web'
      ],
      domainModifierTerms: [
        'airline',
        'bank',
        'banking',
        'education',
        'logistics',
        'manufacturing',
        'marine',
        'retail',
        'telecom',
        'transport'
      ],
      credentialModifierTerms: ['certified', 'chartered', 'licensed', 'registered'],
      ambiguousModifierTerms: [
        'administrative',
        'commercial',
        'customer',
        'digital',
        'environmental',
        'finance',
        'legal',
        'production',
        'technical'
      ],
      rolePhrases: [],
      domainPhrases: []
    },
    {
      localeCode: 'ro',
      roleHeadTerms: [
        'analist',
        'analista',
        'arhitect',
        'asistent',
        'asistenta',
        'bucatar',
        'bucatareasa',
        'contabil',
        'dezvoltator',
        'dezvoltatoare',
        'electrician',
        'inginer',
        'instalator',
        'lucrator',
        'manager',
        'mecanic',
        'operator',
        'profesor',
        'profesoara',
        'programator',
        'receptioner',
        'sofer',
        'specialist',
        'supervizor',
        'sudor',
        'sef',
        'tehnician'
      ],
      roleModifierTerms: [
        'audit',
        'comercial',
        'date',
        'logistica',
        'medical',
        'medicala',
        'montaj',
        'primar',
        'productie',
        'securitate',
        'sef',
        'software'
      ],
      domainModifierTerms: ['aviatie', 'bancar', 'educatie', 'logistica', 'manufactura', 'maritim', 'retail', 'telecom', 'transport'],
      credentialModifierTerms: [],
      ambiguousModifierTerms: ['comercial', 'productie', 'tehnic', 'tehnica'],
      rolePhrases: [],
      domainPhrases: []
    },
    {
      localeCode: 'hu',
      roleHeadTerms: ['elemzo', 'fejleszto', 'mernok', 'menedzser', 'operator', 'tanar', 'tanacsado', 'technik', 'vezeto'],
      roleModifierTerms: ['adat', 'biztonsagi', 'epitesi', 'gepi', 'gepipari', 'halozati', 'logisztikai', 'minoseg', 'orvosi', 'szoftver'],
      domainModifierTerms: [
        'banki',
        'gyartasi',
        'ipari',
        'kereskedelem',
        'legi',
        'logisztika',
        'oktatas',
        'oktatasi',
        'szallitasi',
        'telekom',
        'tengeri',
        'transport'
      ],
      credentialModifierTerms: [],
      ambiguousModifierTerms: ['muszaki'],
      rolePhrases: [],
      domainPhrases: []
    },
    {
      localeCode: 'et',
      roleHeadTerms: ['administraator', 'analuutik', 'arendaja', 'insener', 'juht', 'konsultant', 'operaator', 'opetaja', 'tehnik'],
      roleModifierTerms: ['andme', 'ehitus', 'hooldus', 'logistika', 'meditsiini', 'muugi', 'tarkvara', 'turbe', 'vorrgu', 'vorgu'],
      domainModifierTerms: [
        'haridus',
        'jaekaubandus',
        'logistika',
        'lennu',
        'mere',
        'pangandus',
        'panga',
        'telekom',
        'toostus',
        'transport'
      ],
      credentialModifierTerms: [],
      ambiguousModifierTerms: ['tehniline'],
      rolePhrases: [],
      domainPhrases: []
    },
    {
      localeCode: 'unknown',
      roleHeadTerms: [],
      roleModifierTerms: [],
      domainModifierTerms: [],
      credentialModifierTerms: [],
      ambiguousModifierTerms: [],
      rolePhrases: [],
      domainPhrases: []
    }
  ]
};

// Venue/context terms describe the place of work, not the occupation head.
// They should narrow generic-head disambiguation without becoming the role itself.
export const BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set([
    'airport',
    'branch',
    'clinic',
    'depot',
    'factory',
    'hospital',
    'hotel',
    'kitchen',
    'office',
    'plant',
    'restaurant',
    'school',
    'shop',
    'site',
    'store',
    'warehouse'
  ]),
  ro: new Set([
    'aeroport',
    'atelier',
    'birou',
    'brutarie',
    'bucatarie',
    'clinica',
    'depozit',
    'farmacie',
    'fabrica',
    'ferma',
    'hotel',
    'laborator',
    'magazin',
    'restaurant',
    'retail',
    'santier',
    'scoala',
    'spital',
    'uzina'
  ]),
  hu: new Set(['etterem', 'gyar', 'gyogyszertar', 'hotel', 'iroda', 'iskola', 'klinika', 'korhaz', 'labor', 'raktar', 'repuloter']),
  et: new Set(['apteek', 'haigla', 'hotell', 'kliinik', 'kontor', 'kool', 'labor', 'ladu', 'lennujaam', 'restoran', 'tehas']),
  unknown: new Set()
};

const ROLE_FRAME_MARKERS_BY_LOCALE: Record<SupportedQueryLocale, string[]> = {
  en: [
    'assistant',
    'associate',
    'coordinator',
    'representative',
    'officer',
    'operator',
    'clerk',
    'worker',
    'technician',
    'specialist',
    'consultant',
    'analyst',
    'administrator',
    'manager',
    'supervisor'
  ],
  ro: [
    'asistent',
    'asociat',
    'coordonator',
    'reprezentant',
    'ofiter',
    'operator',
    'functionar',
    'lucrator',
    'tehnician',
    'specialist',
    'consilier',
    'analist',
    'administrator',
    'manager',
    'sef'
  ],
  hu: [
    'asszisztens',
    'munkatars',
    'koordinator',
    'kepviselo',
    'ugyintezo',
    'operator',
    'hivatalnok',
    'dolgozo',
    'technik',
    'szakerto',
    'tanacsado',
    'elemzo',
    'adminisztrator',
    'menedzser',
    'vezeto'
  ],
  et: [
    'assistent',
    'kaastootaja',
    'koordinaator',
    'esindaja',
    'ametnik',
    'operaator',
    'tootaja',
    'tehnik',
    'spetsialist',
    'konsultant',
    'analuutik',
    'administraator',
    'juht',
    'supervisor'
  ],
  unknown: []
};

const GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE: Record<SupportedQueryLocale, 1 | -1> = {
  en: -1,
  ro: 1,
  hu: 1,
  et: 1,
  unknown: -1
};

const ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE: Record<SupportedQueryLocale, Map<string, number>> = {
  en: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.en),
  ro: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.ro),
  hu: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.hu),
  et: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.et),
  unknown: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.unknown)
};

const GENERIC_ROLE_HEAD_TERMS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set(['assistant', 'associate', 'manager', 'officer', 'operator', 'specialist', 'supervisor', 'technician', 'worker']),
  ro: new Set(['asistent', 'lucrator', 'manager', 'operator', 'sef', 'specialist', 'supervizor', 'tehnician']),
  hu: new Set(['asszisztens', 'dolgozo', 'menedzser', 'operator', 'szakerto', 'technik', 'vezeto']),
  et: new Set(['assistent', 'juht', 'operaator', 'spetsialist', 'tehnik', 'tootaja']),
  unknown: new Set()
};

/**
 * This is intentionally limited to explicit management/executive intent.
 * Other occupation classes should not bias family ranking here.
 */
export const OCCUPATION_CLASS_HINTS_BY_LOCALE: Record<SupportedQueryLocale, Record<string, OccupationClassPreference>> = {
  en: {
    manager: classPreference(['executive'], ['professional']),
    director: classPreference(['executive'], ['professional']),
    chief: classPreference(['executive'], ['professional']),
    executive: classPreference(['executive'], ['professional'])
  },

  ro: {
    manager: classPreference(['executive'], ['professional']),
    sef: classPreference(['executive'], ['professional']),
    director: classPreference(['executive'], ['professional'])
  },

  hu: {
    menedzser: classPreference(['executive'], ['professional']),
    vezeto: classPreference(['executive'], ['professional']),
    igazgato: classPreference(['executive'], ['professional'])
  },

  et: {
    juht: classPreference(['executive'], ['professional']),
    direktor: classPreference(['executive'], ['professional'])
  },

  unknown: {}
};

export function classifyOccupationQueryIntent(input: ClassifyOccupationQueryIntentInput): OccupationQueryIntent {
  const vocabulary = vocabularyLookup(input.vocabulary ?? BUILTIN_INTENT_VOCABULARY, input.locale);
  const venueContextTerms = BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE[input.locale] ?? BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE.unknown;
  const stopTokens = new Set(input.stopTokens);
  const noiseTokens = new Set(input.noiseTokens);
  const seniorityTokens = new Set(input.modifierTokens);
  const usefulTokenSet = new Set(input.usefulFoldedTokens);
  const roleExpansionTokens = new Set(input.roleExpansionFoldedTokens?.map(normalizeIntentToken) ?? []);
  const normalizedIntentTokens = input.foldedTokens
    .map((token, index) => ({ token, normalizedToken: normalizeIntentToken(token), index }))
    .filter(({ token, normalizedToken }) => normalizedToken.length >= 3 && !stopTokens.has(token) && !noiseTokens.has(token));
  const normalizedRolePhraseMatches = findIntentPhraseMatches(
    normalizedIntentTokens,
    vocabulary.rolePhrasesByFirstToken,
    vocabulary.maxRolePhraseLength
  );
  const normalizedDomainPhraseMatches = findIntentPhraseMatches(
    normalizedIntentTokens,
    vocabulary.domainPhrasesByFirstToken,
    vocabulary.maxDomainPhraseLength
  );
  const protectedPhraseIndexes = new Set<number>();

  for (const match of [...normalizedRolePhraseMatches, ...normalizedDomainPhraseMatches]) {
    for (const term of match.terms) {
      protectedPhraseIndexes.add(term.index);
    }
  }

  const termTokens = normalizedIntentTokens.filter(
    ({ token, normalizedToken, index }) =>
      protectedPhraseIndexes.has(index) ||
      usefulTokenSet.has(token) ||
      seniorityTokens.has(token) ||
      isKnownIntentVocabularyTerm(normalizedToken, vocabulary, input.locale)
  );

  if (termTokens.length === 0) {
    return emptyIntent();
  }

  const roleHead = findRoleHead(termTokens, vocabulary, input.locale);
  const roleIndexes = new Set<number>();
  const phraseRoleIndexes = new Set<number>();
  const phraseDomainIndexes = new Set<number>();
  const phraseRoleReasons = new Map<number, string>();
  const phraseDomainReasons = new Map<number, string>();
  const phraseRoleReasonLengths = new Map<number, number>();
  const phraseDomainReasonLengths = new Map<number, number>();
  const rolePhraseMatches = normalizedRolePhraseMatches
    .map((match) => rehydratePhraseMatch(match, termTokens))
    .filter(
      (match): match is { phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> } => match !== null
    );
  const domainPhraseMatches = normalizedDomainPhraseMatches
    .map((match) => rehydratePhraseMatch(match, termTokens))
    .filter(
      (match): match is { phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> } => match !== null
    );
  const venueTokens: string[] = [];
  const domainTokens: string[] = [];
  const seniority: string[] = [];
  const credentials: string[] = [];
  const ambiguous: string[] = [];
  const unresolved: string[] = [];
  const diagnostics: QueryIntentDecision[] = [];
  let selectedRoleHeadIndex = roleHead?.index ?? -1;
  let fallbackReason = 'rightmost useful token fallback';

  if (roleHead) {
    roleIndexes.add(roleHead.index);

    let hasAnchoredLeftRolePhrase = false;

    for (const match of rolePhraseMatches) {
      for (const term of match.terms) {
        const currentLength = phraseRoleReasonLengths.get(term.index) ?? 0;

        if (currentLength > match.phrase.tokens.length) {
          continue;
        }

        phraseRoleIndexes.add(term.index);
        phraseRoleReasons.set(term.index, `matched generated role phrase "${match.phrase.key}"`);
        phraseRoleReasonLengths.set(term.index, match.phrase.tokens.length);
      }
    }

    for (const match of domainPhraseMatches) {
      for (const term of match.terms) {
        const currentLength = phraseDomainReasonLengths.get(term.index) ?? 0;

        if (currentLength > match.phrase.tokens.length) {
          continue;
        }

        phraseDomainIndexes.add(term.index);
        phraseDomainReasons.set(term.index, `matched generated domain phrase "${match.phrase.key}"`);
        phraseDomainReasonLengths.set(term.index, match.phrase.tokens.length);
      }
    }

    for (let cursor = roleHead.termIndex - 1; cursor >= 0; cursor -= 1) {
      const term = termTokens[cursor];

      if (!term) {
        continue;
      }

      if (seniorityTokens.has(term.token) || tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
        continue;
      }

      if (phraseRoleIndexes.has(term.index)) {
        roleIndexes.add(term.index);
        hasAnchoredLeftRolePhrase = true;
        continue;
      }

      if (
        hasRoleModifierAuthority(term.normalizedToken, vocabulary, roleExpansionTokens, input.locale) ||
        tokenInSetOrVariant(term.normalizedToken, vocabulary.roleHeads, input.locale)
      ) {
        roleIndexes.add(term.index);
        hasAnchoredLeftRolePhrase = true;
        continue;
      }

      if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
        break;
      }

      if (phraseDomainIndexes.has(term.index)) {
        break;
      }

      if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
        break;
      }

      if (tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)) {
        roleIndexes.add(term.index);
        ambiguous.push(term.token);
        continue;
      }

      if (hasAnchoredLeftRolePhrase) {
        break;
      }

      if (phraseRoleIndexes.has(term.index)) {
        roleIndexes.add(term.index);
        continue;
      }

      roleIndexes.add(term.index);
    }

    const scanDirection = GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE[input.locale] ?? GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE.unknown;

    if (scanDirection === 1) {
      for (let cursor = roleHead.termIndex + 1; cursor < termTokens.length; cursor += 1) {
        const term = termTokens[cursor];

        if (!term) {
          continue;
        }

        if (seniorityTokens.has(term.token) || tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
          continue;
        }

        if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
          break;
        }

        if (phraseDomainIndexes.has(term.index)) {
          break;
        }

        if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
          break;
        }

        roleIndexes.add(term.index);
      }
    }
  } else {
    // No known role head was found. English still prefers the rightmost useful token because its
    // generic fallback is usually a head-final noun phrase. Other locales use the leftmost useful
    // token so the fallback behaves more like the surface order of their titles.
    let fallback: (typeof termTokens)[number] | undefined;
    const scanDirection = GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE[input.locale] ?? GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE.unknown;
    const startIndex = scanDirection === -1 ? termTokens.length - 1 : 0;
    const endIndex = scanDirection === -1 ? -1 : termTokens.length;
    fallbackReason = scanDirection === -1 ? 'rightmost useful token fallback' : 'leftmost useful token fallback';

    for (let cursor = startIndex; cursor !== endIndex; cursor += scanDirection) {
      const term = termTokens[cursor];

      if (!term) {
        continue;
      }

      if (
        seniorityTokens.has(term.token) ||
        tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale) ||
        tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale) ||
        tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)
      ) {
        continue;
      }

      fallback = term;
      break;
    }

    if (fallback) {
      roleIndexes.add(fallback.index);
      selectedRoleHeadIndex = fallback.index;
    }
  }

  for (const term of termTokens) {
    if (seniorityTokens.has(term.token)) {
      seniority.push(term.token);
      diagnostics.push(decision(term, 'seniority_modifier', 'known job-level modifier'));
      continue;
    }

    if (tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
      credentials.push(term.token);
      diagnostics.push(decision(term, 'credential_modifier', 'known credential or license modifier'));
      continue;
    }

    if (roleIndexes.has(term.index)) {
      diagnostics.push(
        decision(
          term,
          term.index === selectedRoleHeadIndex ? 'role_head' : 'role_modifier',
          phraseRoleReasons.get(term.index) ??
            (term.index === roleHead?.index
              ? 'rightmost known role anchor'
              : term.index === selectedRoleHeadIndex
                ? fallbackReason
                : 'left role-specialty modifier')
        )
      );
      continue;
    }

    if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
      venueTokens.push(term.token);
      diagnostics.push(decision(term, 'venue_context', 'known venue/context modifier outside role phrase'));
      continue;
    }

    if (phraseDomainIndexes.has(term.index)) {
      domainTokens.push(term.token);
      diagnostics.push(decision(term, 'domain_modifier', phraseDomainReasons.get(term.index) ?? 'matched generated domain phrase'));
      continue;
    }

    if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
      domainTokens.push(term.token);
      diagnostics.push(decision(term, 'domain_modifier', 'known domain/context modifier outside role phrase'));
      continue;
    }

    if (tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)) {
      ambiguous.push(term.token);
      diagnostics.push(decision(term, 'ambiguous_modifier', 'known ambiguous modifier outside role phrase'));
      continue;
    }

    unresolved.push(term.token);
    diagnostics.push(decision(term, 'unresolved_modifier', 'useful token was not classified as role or domain'));
  }

  const sortedRoleTerms = termTokens.filter((term) => roleIndexes.has(term.index)).sort((left, right) => left.index - right.index);
  const roleTokens = unique(sortedRoleTerms.map((term) => term.token));
  const roleHeadTokens = unique(sortedRoleTerms.filter((term) => term.index === selectedRoleHeadIndex).map((term) => term.token));
  const roleHeadAuthority = resolveRoleHeadAuthority({
    locale: input.locale,
    roleTokens,
    roleHeadTokens,
    venueTokens,
    domainTokens,
    ambiguousTokens: ambiguous
  });
  const roleHeadTokenSet = new Set(roleHeadTokens);
  const sortedDiagnostics = diagnostics
    .map((entry) =>
      entry.kind === 'role_head' &&
      roleHeadTokenSet.has(entry.token) &&
      roleHeadAuthority.roleHeadRequiresContext &&
      !roleHeadAuthority.roleHeadHasContext
        ? {
            ...entry,
            reason: `${entry.reason}; generic role head requires additional context`
          }
        : entry
    )
    .sort((left, right) => left.index - right.index);

  return {
    roleTokens,
    roleHeadTokens,
    occupationClassPreference: inferOccupationClassPreference({
      locale: input.locale,
      roleHeadTokens,
      authoritativeRoleHeadTokens: roleHeadAuthority.authoritativeRoleHeadTokens,
      roleExpansionTokens
    }),
    ...roleHeadAuthority,
    venueTokens: unique(venueTokens),
    domainTokens: unique(domainTokens),
    seniorityTokens: unique(seniority),
    credentialTokens: unique(credentials),
    ambiguousTokens: unique(ambiguous),
    unresolvedModifierTokens: unique(unresolved),
    confidence: confidenceScore(
      Boolean(roleHead),
      roleTokens.length,
      domainTokens.length,
      unresolved.length,
      roleHeadAuthority.roleHeadRequiresContext && !roleHeadAuthority.roleHeadHasContext
    ),
    diagnostics: sortedDiagnostics
  };
}

function emptyIntent(): OccupationQueryIntent {
  return {
    roleTokens: [],
    roleHeadTokens: [],
    genericRoleHeadTokens: [],
    authoritativeRoleHeadTokens: [],
    occupationClassPreference: emptyOccupationClassPreference(),
    roleHeadRequiresContext: false,
    roleHeadHasContext: false,
    venueTokens: [],
    domainTokens: [],
    seniorityTokens: [],
    credentialTokens: [],
    ambiguousTokens: [],
    unresolvedModifierTokens: [],
    confidence: 0,
    diagnostics: []
  };
}

export function inferOccupationClassPreference(input: {
  locale: SupportedQueryLocale;
  roleHeadTokens: string[];
  authoritativeRoleHeadTokens: string[];
  roleExpansionTokens?: ReadonlySet<string> | readonly string[];
}): OccupationClassPreference {
  const preferredFamilyGroups = new Set<OccupationGroup>();
  const disfavoredFamilyGroups = new Set<OccupationGroup>();
  const tokens = input.authoritativeRoleHeadTokens.length > 0 ? input.authoritativeRoleHeadTokens : input.roleHeadTokens;
  const expansions = input.roleExpansionTokens instanceof Set ? Array.from(input.roleExpansionTokens) : (input.roleExpansionTokens ?? []);
  const candidates = [...tokens, ...expansions];

  for (const token of candidates) {
    const hint = occupationClassHint(input.locale, token);

    if (!hint) {
      continue;
    }

    for (const group of hint.preferredFamilyGroups) {
      preferredFamilyGroups.add(group);
    }

    for (const group of hint.disfavoredFamilyGroups) {
      disfavoredFamilyGroups.add(group);
    }
  }

  return {
    preferredFamilyGroups: Array.from(preferredFamilyGroups),
    disfavoredFamilyGroups: Array.from(disfavoredFamilyGroups)
  };
}

export function resolveRoleHeadAuthority(input: {
  locale: SupportedQueryLocale;
  roleTokens: string[];
  roleHeadTokens: string[];
  venueTokens?: string[];
  domainTokens?: string[];
  ambiguousTokens?: string[];
}): OccupationQueryIntentRoleHeadAuthority {
  const genericRoleHeadTokens = input.roleHeadTokens.filter((token) => isGenericRoleHeadToken(token, input.locale));
  const roleHeadRequiresContext = genericRoleHeadTokens.length > 0;
  const roleHeadHasContext =
    input.roleTokens.length > input.roleHeadTokens.length ||
    (input.venueTokens?.length ?? 0) > 0 ||
    (input.domainTokens?.length ?? 0) > 0 ||
    (input.ambiguousTokens?.length ?? 0) > 0;

  return {
    genericRoleHeadTokens,
    authoritativeRoleHeadTokens: roleHeadRequiresContext && !roleHeadHasContext ? [] : input.roleHeadTokens,
    roleHeadRequiresContext,
    roleHeadHasContext
  };
}

function vocabularyLookup(vocabulary: OccupationIntentVocabulary, locale: SupportedQueryLocale): IntentVocabularyLookup {
  const localeCache = VOCABULARY_LOOKUP_CACHE.get(vocabulary) ?? new Map<SupportedQueryLocale, IntentVocabularyLookup>();
  const cached = localeCache.get(locale);

  if (cached) {
    return cached;
  }

  const profiles = localeProfilesWithEnglishBackbone(vocabulary, locale);
  const builtinProfiles = localeProfilesWithEnglishBackbone(BUILTIN_INTENT_VOCABULARY, locale);

  const lookup = {
    roleHeads: setFromTerms([...flatProfileTerms(profiles, 'roleHeadTerms'), ...flatProfileTerms(builtinProfiles, 'roleHeadTerms')]),
    roleModifiers: setFromTerms([
      ...flatProfileTerms(profiles, 'roleModifierTerms'),
      ...flatProfileTerms(builtinProfiles, 'roleModifierTerms')
    ]),
    domainModifiers: setFromTerms([
      ...flatProfileTerms(profiles, 'domainModifierTerms'),
      ...flatProfileTerms(builtinProfiles, 'domainModifierTerms')
    ]),
    credentialModifiers: setFromTerms([
      ...flatProfileTerms(profiles, 'credentialModifierTerms'),
      ...flatProfileTerms(builtinProfiles, 'credentialModifierTerms')
    ]),
    ambiguousModifiers: setFromTerms([
      ...flatProfileTerms(profiles, 'ambiguousModifierTerms'),
      ...flatProfileTerms(builtinProfiles, 'ambiguousModifierTerms')
    ]),
    ...phraseLookup(
      [...flatProfileTerms(profiles, 'rolePhrases'), ...flatProfileTerms(builtinProfiles, 'rolePhrases')],
      [...flatProfileTerms(profiles, 'domainPhrases'), ...flatProfileTerms(builtinProfiles, 'domainPhrases')]
    )
  };

  localeCache.set(locale, lookup);
  VOCABULARY_LOOKUP_CACHE.set(vocabulary, localeCache);
  return lookup;
}

function occupationClassHint(locale: SupportedQueryLocale, token: string): OccupationClassPreference | null {
  const normalizedToken = token;
  const localeHints = OCCUPATION_CLASS_HINTS_BY_LOCALE[locale] ?? OCCUPATION_CLASS_HINTS_BY_LOCALE.unknown;

  if (!normalizedToken) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(localeHints, normalizedToken)) {
    return localeHints[normalizedToken as keyof typeof localeHints] ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(OCCUPATION_CLASS_HINTS_BY_LOCALE.en, normalizedToken)) {
    return OCCUPATION_CLASS_HINTS_BY_LOCALE.en[normalizedToken as keyof typeof OCCUPATION_CLASS_HINTS_BY_LOCALE.en] ?? null;
  }

  return null;
}

function classPreference(
  preferredFamilyGroups: OccupationGroup[],
  disfavoredFamilyGroups: OccupationGroup[] = []
): OccupationClassPreference {
  return {
    preferredFamilyGroups,
    disfavoredFamilyGroups
  };
}

function emptyOccupationClassPreference(): OccupationClassPreference {
  return {
    preferredFamilyGroups: [],
    disfavoredFamilyGroups: []
  };
}

function localeProfilesWithEnglishBackbone(
  vocabulary: OccupationIntentVocabulary,
  locale: SupportedQueryLocale
): OccupationIntentVocabularyLocale[] {
  const profiles: OccupationIntentVocabularyLocale[] = [];
  const seen = new Set<string>();

  for (const localeCode of [locale, 'en', 'unknown']) {
    if (seen.has(localeCode)) {
      continue;
    }

    const profile =
      vocabulary.resolveLocaleProfile?.(localeCode) ?? vocabulary.localeProfiles.find((record) => record.localeCode === localeCode) ?? null;

    if (profile) {
      profiles.push(profile);
      seen.add(localeCode);
    }
  }

  return profiles;
}

function flatProfileTerms(
  profiles: OccupationIntentVocabularyLocale[],
  field: keyof Omit<OccupationIntentVocabularyLocale, 'localeCode'>
): string[] {
  return profiles.flatMap((profile) => profile[field]);
}

function findRoleHead(
  terms: Array<{ token: string; normalizedToken: string; index: number }>,
  vocabulary: IntentVocabularyLookup,
  locale: SupportedQueryLocale
): { token: string; normalizedToken: string; index: number; termIndex: number } | null {
  const framePriorityByToken = ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE[locale] ?? ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE.unknown;
  const headCandidates: Array<{ token: string; normalizedToken: string; index: number; termIndex: number; framePriority: number }> = [];

  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    const term = terms[termIndex];

    if (!term || !tokenInSetOrVariant(term.normalizedToken, vocabulary.roleHeads, locale)) {
      continue;
    }

    headCandidates.push({
      ...term,
      termIndex,
      framePriority: framePriorityByToken.get(term.normalizedToken) ?? -1
    });
  }

  if (headCandidates.length === 0) {
    return null;
  }

  const nonFrameCandidates = headCandidates.filter((candidate) => candidate.framePriority < 0);
  const preferredCandidates = nonFrameCandidates.length > 0 ? nonFrameCandidates : headCandidates;
  const bestCandidate = preferredCandidates.sort((left, right) => {
    return right.framePriority - left.framePriority || right.termIndex - left.termIndex || left.index - right.index;
  })[0];

  return bestCandidate ?? null;
}

function decision(
  term: { token: string; normalizedToken: string; index: number },
  kind: QueryIntentTermKind,
  reason: string
): QueryIntentDecision {
  return {
    token: term.token,
    normalizedToken: term.normalizedToken,
    index: term.index,
    kind,
    reason
  };
}

function confidenceScore(
  hasKnownRoleHead: boolean,
  roleTokenCount: number,
  domainTokenCount: number,
  unresolvedCount: number,
  hasUncontextualizedGenericHead: boolean
): number {
  const score =
    (hasKnownRoleHead ? 0.68 : 0.34) +
    Math.min(roleTokenCount, 3) * 0.08 +
    Math.min(domainTokenCount, 2) * 0.03 -
    (hasUncontextualizedGenericHead ? 0.26 : 0) -
    Math.min(unresolvedCount, 3) * 0.08;
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

function isGenericRoleHeadToken(token: string, locale: SupportedQueryLocale): boolean {
  const genericHeads = GENERIC_ROLE_HEAD_TERMS_BY_LOCALE[locale] ?? GENERIC_ROLE_HEAD_TERMS_BY_LOCALE.unknown;
  return tokenInSetOrVariant(normalizeIntentToken(token), genericHeads, locale);
}

function tokenInSetOrVariant(token: string, values: Set<string>, locale: SupportedQueryLocale): boolean {
  return tokenMatchesLocaleVariant(token, values, locale);
}

function isKnownIntentVocabularyTerm(token: string, vocabulary: IntentVocabularyLookup, locale: SupportedQueryLocale): boolean {
  const venueContextTerms = BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE[locale] ?? BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE.unknown;

  return (
    tokenInSetOrVariant(token, vocabulary.roleHeads, locale) ||
    tokenInSetOrVariant(token, vocabulary.roleModifiers, locale) ||
    tokenInSetOrVariant(token, venueContextTerms, locale) ||
    tokenInSetOrVariant(token, vocabulary.domainModifiers, locale) ||
    tokenInSetOrVariant(token, vocabulary.credentialModifiers, locale) ||
    tokenInSetOrVariant(token, vocabulary.ambiguousModifiers, locale)
  );
}

function findIntentPhraseMatches(
  terms: Array<{ token: string; normalizedToken: string; index: number }>,
  phrasesByFirstToken: Map<string, IntentPhrase[]>,
  maxPhraseLength: number
): Array<{ phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> }> {
  if (maxPhraseLength < 2 || terms.length < 2) {
    return [];
  }

  const matches: Array<{ phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> }> = [];

  for (let start = 0; start < terms.length; start += 1) {
    const firstTerm = terms[start];

    if (!firstTerm) {
      continue;
    }

    const phraseCandidates = phrasesByFirstToken.get(firstTerm.normalizedToken);

    if (!phraseCandidates) {
      continue;
    }

    for (const phrase of phraseCandidates) {
      if (phrase.tokens.length > maxPhraseLength || start + phrase.tokens.length > terms.length) {
        continue;
      }

      const candidateTerms = terms.slice(start, start + phrase.tokens.length);

      if (phrase.tokens.every((token, offset) => phraseTokenMatches(candidateTerms[offset]?.normalizedToken ?? '', token))) {
        matches.push({ phrase, terms: candidateTerms });
      }
    }
  }

  return matches;
}

function rehydratePhraseMatch(
  match: { phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> },
  availableTerms: Array<{ token: string; normalizedToken: string; index: number }>
): { phrase: IntentPhrase; terms: Array<{ token: string; normalizedToken: string; index: number }> } | null {
  const termsByIndex = new Map(availableTerms.map((term) => [term.index, term]));
  const hydratedTerms = match.terms
    .map((term) => termsByIndex.get(term.index))
    .filter((term): term is { token: string; normalizedToken: string; index: number } => term !== undefined);

  if (hydratedTerms.length !== match.terms.length) {
    return null;
  }

  return {
    phrase: match.phrase,
    terms: hydratedTerms
  };
}

function phraseLookup(
  rolePhrases: string[],
  domainPhrases: string[]
): Pick<IntentVocabularyLookup, 'rolePhrasesByFirstToken' | 'domainPhrasesByFirstToken' | 'maxRolePhraseLength' | 'maxDomainPhraseLength'> {
  const rolePhrasesByFirstToken = buildPhraseIndex(rolePhrases);
  const domainPhrasesByFirstToken = buildPhraseIndex(domainPhrases);

  return {
    rolePhrasesByFirstToken,
    domainPhrasesByFirstToken,
    maxRolePhraseLength: maxPhraseLength(rolePhrasesByFirstToken),
    maxDomainPhraseLength: maxPhraseLength(domainPhrasesByFirstToken)
  };
}

function buildPhraseIndex(phrases: string[]): Map<string, IntentPhrase[]> {
  const byFirstToken = new Map<string, IntentPhrase[]>();
  const seen = new Set<string>();

  for (const phrase of phrases) {
    const parsed = parsePhrase(phrase);

    if (!parsed || seen.has(parsed.key)) {
      continue;
    }

    seen.add(parsed.key);
    const firstToken = parsed.tokens[0] as string;
    const bucket = byFirstToken.get(firstToken) ?? [];
    bucket.push(parsed);
    byFirstToken.set(firstToken, bucket);
  }

  for (const bucket of byFirstToken.values()) {
    bucket.sort((left, right) => right.tokens.length - left.tokens.length || left.key.localeCompare(right.key));
  }

  return byFirstToken;
}

/**
 * Every locale lookup indexes its own phrases plus the English backbone, so the
 * same raw phrase is parsed once per locale. Memoising the parse keeps one copy
 * of each phrase record and its tokens, and — because the backbone dominates —
 * turns the repeat locales into map lookups instead of split/map/filter/join
 * over tens of thousands of phrases. `null` marks phrases that index to fewer
 * than two usable tokens, so they are rejected without re-splitting too.
 */
const PHRASE_TOKEN_POOL = new Map<string, string>();
const PARSED_PHRASE_BY_RAW = new Map<string, IntentPhrase | null>();

function parsePhrase(phrase: string): IntentPhrase | null {
  const memoized = PARSED_PHRASE_BY_RAW.get(phrase);

  if (memoized !== undefined) {
    return memoized;
  }

  const tokens: string[] = [];

  for (const rawToken of phrase.split(/\s+/u)) {
    const token = normalizeIntentToken(rawToken);

    if (token.length >= 3) {
      tokens.push(internPhraseToken(token));
    }
  }

  const parsed = tokens.length < 2 ? null : { key: tokens.join(' '), tokens };
  PARSED_PHRASE_BY_RAW.set(phrase, parsed);
  return parsed;
}

function internPhraseToken(token: string): string {
  const pooled = PHRASE_TOKEN_POOL.get(token);

  if (pooled !== undefined) {
    return pooled;
  }

  PHRASE_TOKEN_POOL.set(token, token);
  return token;
}

function maxPhraseLength(index: Map<string, IntentPhrase[]>): number {
  let max = 0;

  for (const phrases of index.values()) {
    for (const phrase of phrases) {
      max = Math.max(max, phrase.tokens.length);
    }
  }

  return max;
}

function phraseTokenMatches(candidateToken: string, phraseToken: string): boolean {
  if (candidateToken === phraseToken) {
    return true;
  }

  return simpleEnglishVariants(candidateToken).includes(phraseToken);
}

function hasRoleModifierAuthority(
  token: string,
  vocabulary: IntentVocabularyLookup,
  roleExpansionTokens: Set<string>,
  locale: SupportedQueryLocale
): boolean {
  return roleExpansionTokens.has(token) || tokenInSetOrVariant(token, vocabulary.roleModifiers, locale);
}

function simpleEnglishVariants(token: string): string[] {
  if (token.endsWith('ies') && token.length > 4) {
    return [`${token.slice(0, -3)}y`];
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return [token.slice(0, -1)];
  }

  return [];
}

function setFromTerms(values: string[]): Set<string> {
  return new Set(values.map(normalizeIntentToken).filter((value) => value.length >= 3));
}

function normalizeIntentToken(value: string): string {
  return foldSearchText(value).trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildFrameMarkerPriorityIndex(markers: string[]): Map<string, number> {
  const prioritized = new Map<string, number>();

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];

    if (!marker) {
      continue;
    }

    prioritized.set(marker, index);
  }

  return prioritized;
}
