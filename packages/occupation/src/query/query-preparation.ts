import {
  foldSearchLookupText as foldUtilityLookupText,
  foldSearchText as foldUtilityText,
  isAcronymToken as isUtilityAcronymToken,
  normalizeSearchSurfaceText as normalizeUtilitySurfaceText,
  normalizeSearchText as normalizeUtilityText
} from '../utils/texts.js';
import { findCommonRolePhraseMatch, type CommonRolePhraseMatch } from './common-role-phrase-atlas.js';
import { findFamilyAliasMatch, type FamilyAliasMatch } from './family-alias-atlas.js';
import { peelOccupationTitleNoise } from './occupation-noise-peeling.js';
import { cleanOccupationSemanticSurface } from './occupation-semantic-lexicon.js';
import {
  classifyOccupationQueryIntent,
  inferOccupationClassPreference,
  resolveRoleHeadAuthority,
  type OccupationIntentVocabulary,
  type OccupationQueryIntent
} from './query-intent.js';
import { expandLocaleTokenVariantArray } from './token-variants.js';

export type SupportedQueryLocale = 'en' | 'ro' | 'hu' | 'et' | 'unknown';

export type PreparedQuery = {
  raw: string;
  locale: SupportedQueryLocale;
  normalized: string;
  folded: string;
  surfaceTokens: string[];
  tokens: string[];
  foldedTokens: string[];
  usefulTokens: string[];
  usefulFoldedTokens: string[];
  expandedTokens: string[];
  expandedFoldedTokens: string[];
  genericTokens: string[];
  stopTokens: string[];
  noiseTokens: string[];
  modifierTokens: string[];
  acronymTokens: string[];
  compoundSplitTokens: string[];
  compoundSplitFoldedTokens: string[];
  intent: OccupationQueryIntent;
  commonRolePhraseMatch?: CommonRolePhraseMatch | null;
  familyAliasMatch?: FamilyAliasMatch | null;
  isGenericShape: boolean;
};

export type FamilyScopedPreparedQuery = PreparedQuery & {
  familyScopedTokens: string[];
  familyScopedFoldedTokens: string[];
};

export type PreparedOccupationQueryInput = {
  raw: string;
  locale: SupportedQueryLocale;
  signals: string[];
};

export type PrepareQueryOptions = {
  sourceName?: string;
  intentVocabulary?: OccupationIntentVocabulary | null;
};

const DEFAULT_INTENT_VOCABULARY_SOURCE_NAME = 'esco_1_2_1';

const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦|/&]+|\s+[\p{Pd}]\s+|(?<=\p{L})-(?=\p{Lu})|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;
const BRACKETED_TEXT = /\s*[\p{Ps}[{<][^)\]}>]*[\p{Pe}\]}>]\s*/gu;

const FUNCTION_WORDS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'it', 'of', 'on', 'or', 'the', 'to', 'who', 'with']),
  ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'un', 'în', 'și']),
  hu: new Set(['a', 'az', 'egy', 'es', 'és', 'hogy', 'meg', 'vagy']),
  et: new Set(['ja', 'koos', 'ning', 'on', 'voi', 'või']),
  unknown: new Set()
};

const GENERIC_ROLE_TERMS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set([
    'assistant',
    'associate',
    'consultant',
    'coordinator',
    'developer',
    'developers',
    'employee',
    'expert',
    'job',
    'jobs',
    'officer',
    'operator',
    'role',
    'roles',
    'specialist',
    'staff',
    'supervisor',
    'technician',
    'worker'
  ]),
  ro: new Set([
    'angajat',
    'asistent',
    'asociat',
    'consultant',
    'coordonator',
    'expert',
    'job',
    'joburi',
    'lucrator',
    'muncitor',
    'ofiter',
    'operator',
    'personal',
    'rol',
    'roluri',
    'specialist',
    'supervizor',
    'tehnician'
  ]),
  hu: new Set([
    'allas',
    'allasok',
    'alkalmazott',
    'asszisztens',
    'dolgozo',
    'kezelo',
    'koordinator',
    'munka',
    'munkas',
    'munkatars',
    'operator',
    'specialista',
    'szakember',
    'szakerto',
    'szemelyzet',
    'szerep',
    'szerepek',
    'tanacsado',
    'technikus',
    'tisztviselo',
    'felugyelo'
  ]),
  et: new Set([
    'ametnik',
    'assistent',
    'ekspert',
    'jarelevaataja',
    'kaastootaja',
    'konsultant',
    'koordinaator',
    'operaator',
    'personal',
    'roll',
    'rollid',
    'spetsialist',
    'tehnik',
    'too',
    'tood',
    'tootaja'
  ]),
  unknown: new Set()
};

const SAFE_JOB_LEVEL_MODIFIERS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set([
    'apprentice',
    'certified',
    'graduate',
    'intern',
    'junior',
    'lead',
    'licensed',
    'principal',
    'registered',
    'senior',
    'trainee'
  ]),
  ro: new Set(['debutant', 'incepator', 'junior', 'senior', 'stagiar', 'ucenic', 'începător']),
  hu: new Set(['gyakornok', 'junior', 'palyakezdo', 'pályakezdő', 'senior', 'tanulo', 'tanuló']),
  et: new Set(['algaja', 'juunior', 'noorem', 'praktikant', 'senior', 'vanem']),
  unknown: new Set()
};

const COMMON_TITLE_NOISE_PHRASES_BY_LOCALE: Record<SupportedQueryLocale, string[][]> = {
  en: [['apply', 'as'], ['hiring'], ['hiring', 'for'], ['looking', 'for'], ['need'], ['need', 'a'], ['seeking'], ['seeking', 'a']],
  ro: [['angajez'], ['angajam'], ['angajăm'], ['caut'], ['cautam'], ['căutăm'], ['aplica', 'pentru'], ['aplică', 'pentru']],
  hu: [['allas'], ['állás'], ['felveszunk'], ['felveszünk'], ['keresunk'], ['keresünk'], ['jelentkezz']],
  et: [['kandideeri'], ['otsime'], ['toopakkumine'], ['tööpakkumine'], ['vajame']],
  unknown: []
};

const COMPOUND_SPLIT_PARTS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set(),
  ro: new Set(),
  hu: new Set([
    'adat',
    'elemző',
    'elemzo',
    'fejlesztő',
    'fejleszto',
    'mérnök',
    'mernok',
    'programozó',
    'programozo',
    'szoftver',
    'tanár',
    'tanar',
    'tervező',
    'tervezo',
    'vezető',
    'vezeto'
  ]),
  et: new Set(['andme', 'analuutik', 'analüütik', 'arendaja', 'insener', 'juht', 'opetaja', 'õpetaja', 'spetsialist', 'tarkvara']),
  unknown: new Set()
};

const ACRONYM_EXPANSIONS_BY_LOCALE: Record<SupportedQueryLocale, Map<string, string[]>> = {
  en: new Map([
    ['AI', ['artificial', 'intelligence']],
    ['BI', ['business', 'intelligence']],
    ['CAD', ['computer', 'aided', 'design']],
    ['CNC', ['computer', 'numerical', 'control']],
    ['HR', ['human', 'resources']],
    ['HVAC', ['heating', 'ventilation', 'air', 'conditioning']],
    ['HVACR', ['heating', 'ventilation', 'air', 'conditioning', 'refrigeration']],
    ['IT', ['information', 'technology']],
    ['QA', ['quality', 'assurance']],
    ['UI', ['user', 'interface']],
    ['UX', ['user', 'experience']]
  ]),
  ro: new Map([
    ['AI', ['inteligenta', 'artificiala']],
    ['BI', ['business', 'intelligence']],
    ['CAD', ['proiectare', 'asistata', 'de', 'calculator']],
    ['CNC', ['control', 'numeric', 'computerizat']],
    ['HR', ['resurse', 'umane']],
    ['HVAC', ['ventilatie', 'si', 'climatizare']],
    ['HVACR', ['ventilatie', 'climatizare', 'si', 'refrigerare']],
    ['IT', ['tehnologia', 'informatiei']],
    ['QA', ['asigurarea', 'calitatii']],
    ['UI', ['interfata', 'utilizator']],
    ['UX', ['experienta', 'utilizatorului']]
  ]),
  hu: new Map([
    ['AI', ['mesterseges', 'intelligencia']],
    ['BI', ['uzleti', 'intelligencia']],
    ['CAD', ['szamitogepes', 'tervezes']],
    ['CNC', ['szamitogepes', 'numerikus', 'vezerles']],
    ['HR', ['emberi', 'eroforras']],
    ['HVAC', ['futes', 'szellozes', 'legkondicionalas']],
    ['HVACR', ['futes', 'szellozes', 'legkondicionalas', 'hutes']],
    ['IT', ['informatikai', 'technologia']],
    ['QA', ['minosegbiztositas']],
    ['UI', ['felhasznaloi', 'felulet']],
    ['UX', ['felhasznaloi', 'elmeny']]
  ]),
  et: new Map([
    ['AI', ['tehisintellekt']],
    ['BI', ['arianaluutika']],
    ['CAD', ['arvutipohine', 'disain']],
    ['CNC', ['arvutijuhtimine']],
    ['HVAC', ['ventilatsioon', 'ja', 'kliimaseadmed']],
    ['HVACR', ['ventilatsioon', 'kliimaseadmed', 'ja', 'jahutus']],
    ['IT', ['infotehnoloogia']],
    ['QA', ['kvaliteedikontroll']],
    ['UI', ['kasutajaliides']],
    ['UX', ['kasutajakogemus']]
  ]),
  unknown: new Map()
};

export function prepareOccupationQueryInput(value: string, locale: string | undefined): PreparedOccupationQueryInput {
  const resolvedLocale = normalizeQueryLocale(locale);
  const clauses = splitOccupationSignalClauses(value);
  const preparedClauses = clauses
    .map((clause) => ({
      raw: clause,
      signal: prepareOccupationSignalClause(clause, resolvedLocale)
    }))
    .filter((clause) => clause.signal);
  const extractedSignals = preparedClauses.map((clause) => clause.signal);
  const fallbackClause = extractedSignals.length > 0 ? extractedSignals : [normalizeSearchSurfaceText(value)];
  const signals = uniqueNonEmpty(fallbackClause);

  return {
    raw: value,
    locale: resolvedLocale,
    signals
  };
}

export async function prepareQuery(value: string, locale: string | undefined, options: PrepareQueryOptions = {}): Promise<PreparedQuery> {
  const resolvedLocale = normalizeQueryLocale(locale);
  const semanticCleaned =
    resolvedLocale === 'ro' || resolvedLocale === 'hu' ? await cleanOccupationSemanticSurface(value, resolvedLocale) : value;
  const surface = normalizeSearchSurfaceText(semanticCleaned);
  const normalized = normalizeSearchText(semanticCleaned);
  const folded = foldSearchText(semanticCleaned);
  const surfaceTokens = tokenizeSurfaceText(surface);
  const tokens = tokenizeNormalizedText(normalized);
  const foldedTokens = tokenizeNormalizedText(folded);
  const compoundSplitTokens = splitCompoundTokens(tokens, resolvedLocale);
  const compoundSplitFoldedTokens = splitCompoundTokens(foldedTokens, resolvedLocale);
  const acronymExpansionTokens = expandAcronyms(surfaceTokens, resolvedLocale);
  const acronymExpansionFoldedTokens = acronymExpansionTokens.map((token) => foldSearchText(token));
  const intentFoldedTokens = expandAcronymsInlineForIntent(surfaceTokens, foldedTokens, resolvedLocale);
  const lexicalTokens = appendUnique(tokens, compoundSplitTokens);
  const lexicalFoldedTokens = appendUnique(foldedTokens, compoundSplitFoldedTokens);
  const noiseTokens = Array.from(new Set(findCommonTitleNoiseTokens(foldedTokens, resolvedLocale))).sort();
  const noiseTokenSet = new Set(noiseTokens);
  const usefulTokens = lexicalTokens.filter((token, index) => {
    const surfaceToken = surfaceTokens[index];

    if (surfaceToken && isAcronymToken(surfaceToken)) {
      return !isGenericQueryToken(token, resolvedLocale) && !isSafeJobLevelModifierToken(token, resolvedLocale);
    }

    return (
      !noiseTokenSet.has(foldSearchText(token)) &&
      !isSafeJobLevelModifierToken(token, resolvedLocale) &&
      isUsefulQueryToken(token, resolvedLocale)
    );
  });
  const usefulFoldedTokens = lexicalFoldedTokens.filter((token, index) => {
    const surfaceToken = surfaceTokens[index];

    if (surfaceToken && isAcronymToken(surfaceToken)) {
      return !isGenericQueryToken(token, resolvedLocale) && !isSafeJobLevelModifierToken(token, resolvedLocale);
    }

    return !noiseTokenSet.has(token) && !isSafeJobLevelModifierToken(token, resolvedLocale) && isUsefulQueryToken(token, resolvedLocale);
  });
  const expandedUsefulTokens = appendUnique(usefulTokens, acronymExpansionTokens);
  const expandedUsefulFoldedTokens = appendUnique(usefulFoldedTokens, acronymExpansionFoldedTokens);
  const intentExpandedUsefulFoldedTokens = expandTokenVariants(expandedUsefulFoldedTokens, resolvedLocale);
  const expandedTokens = expandTokenVariants(expandedUsefulTokens, resolvedLocale);
  const expandedFoldedTokens = expandTokenVariants(expandedUsefulFoldedTokens, resolvedLocale);
  const genericTokens = Array.from(new Set(foldedTokens.filter((token) => isGenericQueryToken(token, resolvedLocale)))).sort();
  const stopTokens = Array.from(
    new Set(foldedTokens.filter((token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isStopQueryToken(token, resolvedLocale)))
  ).sort();
  const modifierTokens = Array.from(
    new Set(
      foldedTokens.filter(
        (token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isSafeJobLevelModifierToken(token, resolvedLocale)
      )
    )
  ).sort();
  const acronymTokens = Array.from(new Set(surfaceTokens.filter((token) => isAcronymToken(token)))).sort();
  const intentVocabulary =
    options.intentVocabulary ?? (await loadRequiredIntentVocabulary(options.sourceName ?? DEFAULT_INTENT_VOCABULARY_SOURCE_NAME));
  const intent = classifyOccupationQueryIntent({
    locale: resolvedLocale,
    foldedTokens: intentFoldedTokens,
    usefulFoldedTokens: intentExpandedUsefulFoldedTokens,
    roleExpansionFoldedTokens: appendUnique(compoundSplitFoldedTokens, acronymExpansionFoldedTokens),
    stopTokens,
    noiseTokens,
    modifierTokens,
    vocabulary: intentVocabulary
  });
  const commonRolePhraseMatch = findCommonRolePhraseMatch(value, resolvedLocale);
  const familyAliasMatch = commonRolePhraseMatch ? null : findFamilyAliasMatch(value, resolvedLocale);
  const anchoredIntent = commonRolePhraseMatch
    ? anchorIntentWithCommonRolePhrase(intent, commonRolePhraseMatch)
    : familyAliasMatch
      ? anchorIntentWithFamilyAlias(intent, familyAliasMatch)
      : intent;

  return {
    raw: value,
    locale: resolvedLocale,
    normalized,
    folded,
    surfaceTokens,
    tokens,
    foldedTokens,
    usefulTokens: expandedUsefulTokens,
    usefulFoldedTokens: expandedUsefulFoldedTokens,
    expandedTokens,
    expandedFoldedTokens,
    genericTokens,
    stopTokens,
    noiseTokens,
    modifierTokens,
    acronymTokens,
    compoundSplitTokens,
    compoundSplitFoldedTokens,
    intent: anchoredIntent,
    commonRolePhraseMatch,
    familyAliasMatch,
    isGenericShape: isGenericQueryShape(foldedTokens, resolvedLocale)
  };
}

export async function prepareFamilyScopedQuery(
  value: string,
  locale: string | undefined,
  options: PrepareQueryOptions = {}
): Promise<FamilyScopedPreparedQuery> {
  const prepared = await prepareQuery(value, locale, options);
  return prepareFamilyScopedQueryFromPrepared(prepared);
}

export function prepareFamilyScopedQueryFromPrepared(prepared: PreparedQuery): FamilyScopedPreparedQuery {
  const lexicalTokens = appendUnique(prepared.tokens, prepared.compoundSplitTokens);
  const lexicalFoldedTokens = appendUnique(prepared.foldedTokens, prepared.compoundSplitFoldedTokens);
  const usefulExpansionTokens = prepared.usefulTokens.filter((token) => !lexicalTokens.includes(token));
  const usefulExpansionFoldedTokens = prepared.usefulFoldedTokens.filter((token) => !lexicalFoldedTokens.includes(token));
  const noiseTokenSet = new Set(prepared.noiseTokens);
  const acronymTokenSet = new Set(prepared.acronymTokens.map((token) => foldSearchText(token)));
  const familyScopedTokens = appendUnique(
    lexicalTokens.filter((token) => isFamilyScopedUsefulToken(token, prepared)),
    usefulExpansionTokens
  );
  const familyScopedFoldedTokens = appendUnique(
    lexicalFoldedTokens.filter((token) => isFamilyScopedUsefulToken(token, prepared)),
    usefulExpansionFoldedTokens
  );

  return {
    ...prepared,
    familyScopedTokens,
    familyScopedFoldedTokens,
    usefulTokens: familyScopedTokens,
    usefulFoldedTokens: familyScopedFoldedTokens,
    expandedTokens: expandTokenVariants(familyScopedTokens, prepared.locale),
    expandedFoldedTokens: expandTokenVariants(familyScopedFoldedTokens, prepared.locale)
  };

  function isFamilyScopedUsefulToken(token: string, query: PreparedQuery): boolean {
    const foldedToken = foldSearchText(token);

    return (
      (token.length >= 3 || acronymTokenSet.has(foldedToken)) &&
      !noiseTokenSet.has(foldedToken) &&
      !isStopQueryToken(token, query.locale) &&
      !isSafeJobLevelModifierToken(token, query.locale)
    );
  }
}

async function loadRequiredIntentVocabulary(sourceName: string): Promise<OccupationIntentVocabulary> {
  const { loadOccupationIntentVocabularyArtifactRequired } = await import('../runtime/occupation-intent-vocabulary-artifact.js');
  const entry = await loadOccupationIntentVocabularyArtifactRequired(sourceName);
  return entry.artifact;
}

function anchorIntentWithCommonRolePhrase(intent: OccupationQueryIntent, match: CommonRolePhraseMatch): OccupationQueryIntent {
  const canonicalRoleTokens = tokenizeNormalizedText(match.canonicalEnglish);

  if (canonicalRoleTokens.length < 2) {
    return intent;
  }

  const roleHeadAuthority = resolveRoleHeadAuthority({
    locale: match.locale,
    roleTokens: canonicalRoleTokens,
    roleHeadTokens: canonicalRoleTokens.slice(-1),
    venueTokens: intent.venueTokens,
    domainTokens: intent.domainTokens,
    ambiguousTokens: intent.ambiguousTokens
  });

  return {
    ...intent,
    roleTokens: canonicalRoleTokens,
    roleHeadTokens: canonicalRoleTokens.slice(-1),
    ...roleHeadAuthority,
    occupationClassPreference: inferOccupationClassPreference({
      locale: match.locale,
      roleHeadTokens: canonicalRoleTokens.slice(-1),
      authoritativeRoleHeadTokens: roleHeadAuthority.authoritativeRoleHeadTokens,
      roleExpansionTokens: []
    }),
    confidence: Math.max(intent.confidence, Math.min(1, 0.9 + Math.min(match.priority, 10) / 100)),
    diagnostics: [
      {
        token: match.surface,
        normalizedToken: foldSearchText(match.surface),
        index: match.startToken,
        kind: 'role_head',
        reason: `matched curated role phrase "${match.surface}" -> "${match.canonicalEnglish}"`
      },
      ...intent.diagnostics
    ]
  };
}

function anchorIntentWithFamilyAlias(intent: OccupationQueryIntent, match: FamilyAliasMatch): OccupationQueryIntent {
  const canonicalRoleTokens = tokenizeNormalizedText(match.canonicalEnglish);

  if (canonicalRoleTokens.length < 2) {
    return intent;
  }

  const roleHeadAuthority = resolveRoleHeadAuthority({
    locale: match.locale,
    roleTokens: canonicalRoleTokens,
    roleHeadTokens: canonicalRoleTokens.slice(-1),
    venueTokens: intent.venueTokens,
    domainTokens: intent.domainTokens,
    ambiguousTokens: intent.ambiguousTokens
  });

  return {
    ...intent,
    roleTokens: canonicalRoleTokens,
    roleHeadTokens: canonicalRoleTokens.slice(-1),
    ...roleHeadAuthority,
    occupationClassPreference: inferOccupationClassPreference({
      locale: match.locale,
      roleHeadTokens: canonicalRoleTokens.slice(-1),
      authoritativeRoleHeadTokens: roleHeadAuthority.authoritativeRoleHeadTokens,
      roleExpansionTokens: []
    }),
    confidence: Math.max(intent.confidence, Math.min(1, 0.86 + Math.min(match.priority, 10) / 100)),
    diagnostics: [
      {
        token: match.surface,
        normalizedToken: foldSearchText(match.surface),
        index: match.startToken,
        kind: 'role_head',
        reason: `matched curated family alias "${match.surface}" -> "${match.canonicalEnglish}"`
      },
      ...intent.diagnostics
    ]
  };
}

export function normalizeSearchSurfaceText(value: string): string {
  return normalizeUtilitySurfaceText(value);
}

export function normalizeSearchText(value: string): string {
  return normalizeUtilityText(value);
}

export function foldSearchText(value: string): string {
  return foldUtilityText(value);
}

export function foldSearchLookupText(value: string): string {
  return foldUtilityLookupText(value);
}

export function tokenizeNormalizedText(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function tokenizeSurfaceText(value: string): string[] {
  return tokenizeNormalizedText(value);
}

export function isUsefulQueryToken(token: string, locale: string | undefined): boolean {
  const normalizedLocale = normalizeQueryLocale(locale);
  return token.length >= 3 && !isLowSignalQueryToken(token, normalizedLocale);
}

export function isGenericQueryToken(token: string, locale: string | undefined): boolean {
  const normalizedLocale = normalizeQueryLocale(locale);
  const foldedToken = foldSearchText(token);

  return localeSetHasEnglishBackbone(GENERIC_ROLE_TERMS_BY_LOCALE, normalizedLocale, foldedToken);
}

export function isStopQueryToken(token: string, locale: string | undefined): boolean {
  const normalizedLocale = normalizeQueryLocale(locale);
  const foldedToken = foldSearchText(token);

  return localeSetHasEnglishBackbone(FUNCTION_WORDS_BY_LOCALE, normalizedLocale, foldedToken);
}

export function isSafeJobLevelModifierToken(token: string, locale: string | undefined): boolean {
  const normalizedLocale = normalizeQueryLocale(locale);
  const foldedToken = foldSearchText(token);

  return localeSetHasEnglishBackbone(SAFE_JOB_LEVEL_MODIFIERS_BY_LOCALE, normalizedLocale, foldedToken);
}

export function isAcronymToken(token: string): boolean {
  return isUtilityAcronymToken(token);
}

export function expandTokenVariants(tokens: string[], locale: string | undefined): string[] {
  const normalizedLocale = normalizeQueryLocale(locale);
  return expandLocaleTokenVariantArray(tokens, normalizedLocale);
}

export function expandAcronymToken(token: string, locale: string | undefined): string[] {
  const normalizedLocale = normalizeQueryLocale(locale);
  const normalizedToken = token.toLocaleUpperCase('en-US');
  return ACRONYM_EXPANSIONS_BY_LOCALE[normalizedLocale].get(normalizedToken) ?? ACRONYM_EXPANSIONS_BY_LOCALE.en.get(normalizedToken) ?? [];
}

export function containsTokenPhrase(haystackTokens: string[], needleTokens: string[], locale?: string): boolean {
  return longestContiguousTokenMatch(haystackTokens, needleTokens, locale).length === needleTokens.length && needleTokens.length > 0;
}

export function longestContiguousTokenMatch(leftTokens: string[], rightTokens: string[], locale?: string): string[] {
  let best: string[] = [];

  for (let leftIndex = 0; leftIndex < leftTokens.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightTokens.length; rightIndex += 1) {
      const current: string[] = [];
      let offset = 0;

      while (
        leftIndex + offset < leftTokens.length &&
        rightIndex + offset < rightTokens.length &&
        tokensEquivalent(leftTokens[leftIndex + offset], rightTokens[rightIndex + offset], locale)
      ) {
        current.push(leftTokens[leftIndex + offset]);
        offset += 1;
      }

      if (current.length > best.length) {
        best = current;
      }
    }
  }

  return best;
}

export function normalizeQueryLocale(locale: string | undefined): SupportedQueryLocale {
  const normalized = locale?.trim().toLowerCase();

  if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et') {
    return normalized;
  }

  return 'unknown';
}

function isGenericQueryShape(tokens: string[], locale: SupportedQueryLocale): boolean {
  if (tokens.length <= 1) {
    return true;
  }

  return tokens.every((token) => isLowSignalQueryToken(token, locale));
}

function isLowSignalQueryToken(token: string, locale: SupportedQueryLocale): boolean {
  return (
    isGenericQueryToken(token, locale) ||
    isStopQueryToken(token, locale) ||
    isSafeJobLevelModifierToken(token, locale) ||
    isCommonTitleNoiseToken(token, locale)
  );
}

function isCommonTitleNoiseToken(token: string, locale: SupportedQueryLocale): boolean {
  return findCommonTitleNoiseTokens([token], locale).length > 0;
}

function findCommonTitleNoiseTokens(tokens: string[], locale: SupportedQueryLocale): string[] {
  const noiseTokens = new Set<string>();

  for (const phrase of localePhrasesWithEnglishBackbone(COMMON_TITLE_NOISE_PHRASES_BY_LOCALE, locale)) {
    if (phrase.length === 0 || phrase.length > tokens.length) {
      continue;
    }

    for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
      const candidate = tokens.slice(index, index + phrase.length);

      if (candidate.every((token, offset) => token === foldSearchText(phrase[offset]))) {
        for (const token of candidate) {
          noiseTokens.add(token);
        }
      }
    }
  }

  return Array.from(noiseTokens);
}

function localeSetHasEnglishBackbone(
  valuesByLocale: Record<SupportedQueryLocale, Set<string>>,
  locale: SupportedQueryLocale,
  value: string
): boolean {
  return valuesByLocale[locale].has(value) || (locale !== 'en' && valuesByLocale.en.has(value));
}

function localePhrasesWithEnglishBackbone(
  valuesByLocale: Record<SupportedQueryLocale, string[][]>,
  locale: SupportedQueryLocale
): string[][] {
  if (locale === 'en') {
    return valuesByLocale.en;
  }

  return [...valuesByLocale[locale], ...valuesByLocale.en];
}

function splitCompoundTokens(tokens: string[], locale: SupportedQueryLocale): string[] {
  const knownParts = COMPOUND_SPLIT_PARTS_BY_LOCALE[locale];

  if (knownParts.size === 0) {
    return [];
  }

  return tokens.flatMap((token) => splitCompoundToken(token, knownParts));
}

function splitCompoundToken(token: string, knownParts: Set<string>): string[] {
  if (knownParts.has(token) || token.length < 8) {
    return [];
  }

  for (const left of knownParts) {
    if (!token.startsWith(left) || left.length < 4) {
      continue;
    }

    const right = token.slice(left.length);

    if (knownParts.has(right) && right.length >= 4) {
      return [left, right];
    }
  }

  for (const right of knownParts) {
    if (!token.endsWith(right) || right.length < 4) {
      continue;
    }

    const left = token.slice(0, -right.length);

    if (knownParts.has(left) && left.length >= 4) {
      return [left, right];
    }
  }

  return [];
}

function expandAcronyms(surfaceTokens: string[], locale: SupportedQueryLocale): string[] {
  const expanded: string[] = [];

  for (const surfaceToken of surfaceTokens) {
    const expansion = expandAcronymToken(surfaceToken, locale);

    if (expansion.length === 0) {
      continue;
    }

    expanded.push(...expansion);
  }

  return Array.from(new Set(expanded));
}

function expandAcronymsInlineForIntent(surfaceTokens: string[], foldedTokens: string[], locale: SupportedQueryLocale): string[] {
  const expanded: string[] = [];

  for (let index = 0; index < foldedTokens.length; index += 1) {
    const foldedToken = foldedTokens[index];

    if (foldedToken) {
      expanded.push(foldedToken);
    }

    const surfaceToken = surfaceTokens[index];

    if (!surfaceToken) {
      continue;
    }

    for (const expansionToken of expandAcronymToken(surfaceToken, locale)) {
      expanded.push(foldSearchText(expansionToken));
    }
  }

  return expanded;
}
function appendUnique(tokens: string[], extraTokens: string[]): string[] {
  const merged = [...tokens];
  const seen = new Set(tokens);

  for (const token of extraTokens) {
    if (!seen.has(token)) {
      merged.push(token);
      seen.add(token);
    }
  }

  return merged;
}

function tokensEquivalent(left: string, right: string, locale: string | undefined): boolean {
  if (left === right) {
    return true;
  }

  if (foldSearchLookupText(left) === foldSearchLookupText(right)) {
    return true;
  }

  const normalizedLocale = normalizeQueryLocale(locale);
  return expandTokenVariants([left], normalizedLocale).includes(right) || expandTokenVariants([right], normalizedLocale).includes(left);
}

function splitOccupationSignalClauses(value: string): string[] {
  return stripBracketedText(normalizeSearchSurfaceText(value))
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function stripBracketedText(value: string): string {
  return value.replace(BRACKETED_TEXT, ' ').trim();
}

function prepareOccupationSignalClause(value: string, locale: SupportedQueryLocale): string {
  const raw = normalizeSearchSurfaceText(locale === 'ro' || locale === 'hu' ? peelOccupationTitleNoise(value, locale) : value);
  const surfaceTokens = tokenizeSurfaceText(raw);
  const comparisonTokens = surfaceTokens.map((token) => foldSearchText(token));
  const noiseTokens = new Set(findCommonTitleNoiseTokens(comparisonTokens, locale));
  const tokenPairs = surfaceTokens.map((token, index) => ({
    surfaceToken: token,
    comparisonToken: comparisonTokens[index] ?? foldSearchText(token)
  }));
  const signalTokenPairs = tokenPairs.filter(({ comparisonToken, surfaceToken }) =>
    isOccupationSignalToken(comparisonToken, surfaceToken, locale, noiseTokens)
  );
  const signalTokens = signalTokenPairs.map(({ surfaceToken }) => surfaceToken);

  return signalTokens.join(' ').trim();
}

function isOccupationSignalToken(
  foldedToken: string,
  surfaceToken: string,
  locale: SupportedQueryLocale,
  noiseTokens: Set<string>
): boolean {
  if (isAcronymToken(surfaceToken)) {
    return !noiseTokens.has(foldedToken) && !isSafeJobLevelModifierToken(foldedToken, locale);
  }

  return foldedToken.length >= 2 && !noiseTokens.has(foldedToken) && !isSafeJobLevelModifierToken(foldedToken, locale);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/gu, ' ');

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    uniqueValues.push(normalized);
  }

  return uniqueValues;
}
