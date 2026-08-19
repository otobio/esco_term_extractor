import {
  foldSearchLookupText,
  foldSearchText,
  isAcronymToken,
  normalizeSearchSurfaceText,
  normalizeSearchText,
  tokenizeNormalizedText,
  tokenizeSurfaceText
} from '../utils/texts.js';
import { findCommonRolePhraseMatch, type CommonRolePhraseMatch } from './common-role-phrase-atlas.js';
import { findFamilyAliasMatch, type FamilyAliasMatch } from './family-alias-atlas.js';
import {
  classifyOccupationQueryIntent,
  inferOccupationClassPreference,
  resolveRoleHeadAuthority,
  type OccupationIntentVocabulary,
  type OccupationQueryIntent
} from './query-intent.js';
import {
  expandLocaleTokenVariantArray,
  perTokenVocabularyCompoundSplits,
  reconstructCompoundExpandedSurface
} from './token-variants.js';
import { FUNCTION_WORDS_BY_LOCALE } from '../utils/lang.js';

export type SupportedQueryLocale = 'en' | 'ro' | 'hu' | 'et' | 'unknown';

// Naming:
// - folded: match-safe text form used for retrieval and token matching
// - useful: role-bearing query token that survives generic/stop/modifier filtering
// - variant: alternate form of the same useful token (plural/singular, gender, spelling, inflection)
// - recall: additive retrieval set that keeps the original useful tokens and adds matchable extras
// - expanded: a compound-aware reconstruction of the same query surface, not a new query intent
export type PreparedQuery = {
  // Raw input
  raw: string;
  locale: SupportedQueryLocale;

  // Human-readable normalized surface
  normalized: string;
  surfaceTokens: string[];
  tokens: string[];

  // Normalized retrieval material:
  // usefulRecallTokens keeps only useful role-bearing tokens plus additive recall extras such as acronyms.
  // usefulVariantTokens expands those useful recall tokens into same-token lexical variants.
  usefulRecallTokens: string[];
  usefulVariantTokens: string[];
  compoundExpandedTokens: string[];

  // Match-safe folded surface
  folded: string;
  foldedTokens: string[];

  // Folded retrieval / matching material:
  // usefulFoldedRecallTokens is the folded matching form of usefulRecallTokens.
  // usefulFoldedVariantTokens is the folded matching form of usefulVariantTokens.
  usefulFoldedRecallTokens: string[];
  usefulFoldedVariantTokens: string[];
  compoundExpandedFoldedTokens: string[];
  genericTokens: string[];
  stopTokens: string[];
  noiseTokens: string[];
  modifierTokens: string[];
  acronymTokens: string[];

  // Additive matching expansions
  capabilityVerbFoldedAdditionTokens: string[];

  // Intent / structured interpretation
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
  disabledCommonRolePhraseRoleKeys?: readonly string[];
};

const DEFAULT_INTENT_VOCABULARY_SOURCE_NAME = 'esco_1_2_1';

const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦|/&]+|\s+[\p{Pd}]\s+|(?<=\p{L})-(?=\p{Lu})|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;
const BRACKETED_TEXT = /\s*[\p{Ps}[{<][^)\]}>]*[\p{Pe}\]}>]\s*/gu;

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

export async function prepareOccupationQueryInput(
  value: string,
  locale: string | undefined,
  options: PrepareQueryOptions = {}
): Promise<PreparedOccupationQueryInput> {
  const resolvedLocale = normalizeQueryLocale(locale);
  const clauses = splitOccupationSignalClauses(value);
  const preparedClauses = (
    await Promise.all(
      clauses.map(async (clause) => ({
        raw: clause,
        signal: normalizeSearchSurfaceText(clause)
      }))
    )
  ).filter((clause) => clause.signal);
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
  const preparedSurface = normalizeSearchSurfaceText(value);
  const surface = normalizeSearchSurfaceText(preparedSurface);
  const normalized = normalizeSearchText(preparedSurface);
  const folded = foldSearchText(preparedSurface);
  const surfaceTokens = tokenizeSurfaceText(surface);
  const tokens = tokenizeNormalizedText(normalized);
  const foldedTokens = tokenizeNormalizedText(folded);
  const compoundSplitSourceName = options.sourceName ?? DEFAULT_INTENT_VOCABULARY_SOURCE_NAME;
  const tokenCompoundSplits = await perTokenVocabularyCompoundSplits(foldedTokens, resolvedLocale, compoundSplitSourceName);
  const compoundExpandedSurface = reconstructCompoundExpandedSurface(tokens, tokenCompoundSplits);
  const compoundExpandedTokens = compoundExpandedSurface ? tokenizeNormalizedText(normalizeSearchText(compoundExpandedSurface)) : [];
  const compoundExpandedFoldedTokens = compoundExpandedTokens.length > 0 ? compoundExpandedTokens.map((token) => foldSearchText(token)) : [];
  const compoundExpandedFoldedAdditions = compoundExpandedFoldedTokens.filter((token) => !foldedTokens.includes(token));
  const acronymExpansionTokens = expandAcronyms(surfaceTokens, resolvedLocale);
  const acronymExpansionFoldedTokens = acronymExpansionTokens.map((token) => foldSearchText(token));
  const intentFoldedTokens = expandAcronymsInlineForIntent(surfaceTokens, foldedTokens, resolvedLocale);
  const lexicalTokens = appendUnique(tokens, tokenCompoundSplits?.flat() ?? []);
  const lexicalFoldedTokens = appendUnique(foldedTokens, compoundExpandedFoldedAdditions);
  const noiseTokens: string[] = [];
  const noiseTokenSet = new Set(noiseTokens);
  const usefulBaseTokens = lexicalTokens.filter((token, index) => {
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
  const usefulFoldedBaseTokens = lexicalFoldedTokens.filter((token, index) => {
    const surfaceToken = surfaceTokens[index];

    if (surfaceToken && isAcronymToken(surfaceToken)) {
      return !isGenericQueryToken(token, resolvedLocale) && !isSafeJobLevelModifierToken(token, resolvedLocale);
    }

    return !noiseTokenSet.has(token) && !isSafeJobLevelModifierToken(token, resolvedLocale) && isUsefulQueryToken(token, resolvedLocale);
  });
  const usefulRecallTokens = appendUnique(usefulBaseTokens, acronymExpansionTokens);
  const usefulFoldedRecallTokens = appendUnique(usefulFoldedBaseTokens, acronymExpansionFoldedTokens);
  const usefulFoldedVariantTokensForIntent = expandTokenVariants(usefulFoldedRecallTokens, resolvedLocale);
  const usefulVariantTokens = expandTokenVariants(usefulRecallTokens, resolvedLocale);
  // Compound-split tokens (e.g. "projektvezeto" -> "projekt" + "vezeto") must be classified the same way
  // whole tokens are -- otherwise a split-out generic head like "vezeto" never gets recognized as one,
  // and the query is scored as an opaque single OOV token instead of "domain modifier + generic head".
  const foldedTokensWithSplits = appendUnique(foldedTokens, compoundExpandedFoldedAdditions);
  const genericTokens = Array.from(new Set(foldedTokensWithSplits.filter((token) => isGenericQueryToken(token, resolvedLocale)))).sort();
  const stopTokens = Array.from(
    new Set(
      foldedTokensWithSplits.filter(
        (token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isStopQueryToken(token, resolvedLocale)
      )
    )
  ).sort();
  const modifierTokens = Array.from(
    new Set(
      foldedTokensWithSplits.filter(
        (token, index) => !isAcronymToken(surfaceTokens[index] ?? '') && isSafeJobLevelModifierToken(token, resolvedLocale)
      )
    )
  ).sort();
  const acronymTokens = Array.from(new Set(surfaceTokens.filter((token) => isAcronymToken(token)))).sort();
  const intentVocabulary =
    options.intentVocabulary ?? (await loadRequiredIntentVocabulary(options.sourceName ?? DEFAULT_INTENT_VOCABULARY_SOURCE_NAME));
  const intent = classifyOccupationQueryIntent({
    locale: resolvedLocale,
    foldedTokens: appendUnique(intentFoldedTokens, compoundExpandedFoldedAdditions),
    usefulFoldedRecallTokens: usefulFoldedVariantTokensForIntent,
    roleExpansionFoldedTokens: appendUnique(compoundExpandedFoldedAdditions, acronymExpansionFoldedTokens),
    stopTokens,
    noiseTokens,
    modifierTokens,
    vocabulary: intentVocabulary
  });
  // A single-token HU compound (e.g. "projektvezeto") never reaches the curated role-phrase/family-alias
  // atlases below -- both require >=2 raw surface tokens. Retrying with the compound-split reconstruction
  // ("projekt vezeto") lets a query like "projektvezeto" resolve exactly as its already-two-word form does,
  // instead of falling back to weaker lexical/ngram scoring alone.
  const commonRolePhraseMatch =
    findCommonRolePhraseMatch(value, resolvedLocale, {
      disabledRoleKeys: options.disabledCommonRolePhraseRoleKeys
    }) ??
    (compoundExpandedSurface
      ? findCommonRolePhraseMatch(compoundExpandedSurface, resolvedLocale, {
          disabledRoleKeys: options.disabledCommonRolePhraseRoleKeys
        })
      : null);
  const familyAliasMatch = commonRolePhraseMatch
    ? null
    : (findFamilyAliasMatch(value, resolvedLocale) ??
      (compoundExpandedSurface ? findFamilyAliasMatch(compoundExpandedSurface, resolvedLocale) : null));
  const anchoredIntent = commonRolePhraseMatch
    ? anchorIntentWithCommonRolePhrase(intent, commonRolePhraseMatch)
    : familyAliasMatch
      ? anchorIntentWithFamilyAlias(intent, familyAliasMatch)
      : intent;
  const usefulFoldedVariantTokens = expandTokenVariants(usefulFoldedRecallTokens, resolvedLocale);
  const capabilityVerbFoldedAdditionTokens = await buildCapabilityVerbFoldedAdditionTokens({
    sourceName: options.sourceName ?? DEFAULT_INTENT_VOCABULARY_SOURCE_NAME,
    locale: resolvedLocale,
    intent: anchoredIntent
  });

  return {
    // Raw input
    raw: value,
    locale: resolvedLocale,

    // Human-readable normalized surface
    normalized,
    surfaceTokens,
    tokens,
    usefulRecallTokens,
    usefulVariantTokens,

    // Match-safe folded surface
    folded,
    foldedTokens,

    // Retrieval / matching tokens
    usefulFoldedRecallTokens,
    genericTokens,
    stopTokens,
    noiseTokens,
    modifierTokens,
    acronymTokens,

    // Additive recall expansions
    usefulFoldedVariantTokens,
    compoundExpandedTokens,
    compoundExpandedFoldedTokens,
    capabilityVerbFoldedAdditionTokens,

    // Intent / structured interpretation
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
  const lexicalTokens = appendUnique(
    prepared.tokens,
    prepared.compoundExpandedTokens.filter((token) => !prepared.tokens.includes(token))
  );
  const lexicalFoldedTokens = appendUnique(prepared.foldedTokens, preparedQueryCompoundExpandedFoldedAdditions(prepared));
  const usefulExpansionTokens = prepared.usefulRecallTokens.filter((token) => !lexicalTokens.includes(token));
  const usefulExpansionFoldedTokens = prepared.usefulFoldedRecallTokens.filter((token) => !lexicalFoldedTokens.includes(token));
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
    usefulRecallTokens: familyScopedTokens,
    usefulFoldedRecallTokens: familyScopedFoldedTokens,
    usefulVariantTokens: expandTokenVariants(familyScopedTokens, prepared.locale),
    usefulFoldedVariantTokens: expandTokenVariants(familyScopedFoldedTokens, prepared.locale)
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

export function preparedQueryNormalizedRecallSurfaces(preparedQuery: PreparedQuery): string[] {
  return uniqueNonEmpty([preparedQuery.normalized, preparedQuery.compoundExpandedTokens.join(' ')]);
}

export function preparedQueryNormalizedRecallTokenSequences(preparedQuery: PreparedQuery): string[][] {
  return uniqueTokenSequences([preparedQuery.tokens, preparedQuery.compoundExpandedTokens]);
}

export function preparedQueryFoldedRecallSurfaces(preparedQuery: PreparedQuery): string[] {
  return uniqueNonEmpty([preparedQuery.folded, preparedQueryCompoundExpandedFoldedTokens(preparedQuery).join(' ')]);
}

export function preparedQueryUsefulNormalizedRecallTokenSequences(preparedQuery: PreparedQuery): string[][] {
  const compoundExpandedUsefulTokens = preparedQuery.compoundExpandedTokens.filter((token) =>
    isPreparedQueryUsefulToken(token, preparedQuery)
  );

  return uniqueTokenSequences([
    preparedQuery.usefulRecallTokens,
    compoundExpandedUsefulTokens
  ]);
}

export function preparedQueryUsefulFoldedRecallTokenSequences(preparedQuery: PreparedQuery): string[][] {
  const compoundExpandedUsefulFoldedTokens = preparedQueryCompoundExpandedFoldedTokens(preparedQuery).filter((token) =>
    preparedQuery.usefulFoldedRecallTokens.includes(token)
  );

  return uniqueTokenSequences([
    preparedQuery.usefulFoldedRecallTokens,
    compoundExpandedUsefulFoldedTokens
  ]);
}

export function preparedQueryFoldedRecallTokenSequences(preparedQuery: PreparedQuery): string[][] {
  return uniqueTokenSequences([preparedQuery.foldedTokens, preparedQueryCompoundExpandedFoldedTokens(preparedQuery)]);
}

// Canonical compound-expanded folded recall sequence. Non-empty only when a real compound reconstruction exists.
export function preparedQueryCompoundExpandedFoldedTokens(preparedQuery: PreparedQuery): string[] {
  return preparedQuery.compoundExpandedFoldedTokens;
}

export function preparedQueryCompoundExpandedFoldedAdditions(preparedQuery: PreparedQuery): string[] {
  return preparedQuery.compoundExpandedFoldedTokens.filter((token) => !preparedQuery.foldedTokens.includes(token));
}

const CAPABILITY_VERB_SOURCE_LIMIT = 3;
const _CAPABILITY_VERB_RESULT_LIMIT = 3;

async function buildCapabilityVerbFoldedAdditionTokens(input: {
  sourceName: string;
  locale: SupportedQueryLocale;
  intent: OccupationQueryIntent;
}): Promise<string[]> {
  const seeds = uniqueNonEmpty(
    input.intent.roleHeadTokens
      .flatMap((token) => deriveCapabilityVerbSeedCandidates(token, input.locale))
      .slice(0, CAPABILITY_VERB_SOURCE_LIMIT)
  );

  if (seeds.length === 0) {
    return [];
  }

  // The ESCO verb-synonym artifact is English-only today, so other locales stop at the
  // locale-specific agent-noun-to-verb-stem seeds derived above instead of expanding further.
  //
  // Verb-synonym expansion (English) is disabled for now -- not yet stabilized, and was found to
  // inject noisy/unrequested related terms (e.g. "security" -> "architecture"/"safety") into
  // capability_fit coverage, which can swing family selection on vocabulary the query never asked
  // for. Commented out rather than removed so it can be re-enabled once stabilized.
  return seeds;

  /*
  // eslint-disable-next-line no-unreachable
  const relatedTerms = new Set<string>();

  for (const seed of seeds) {
    relatedTerms.add(seed);

    let rows: Awaited<ReturnType<typeof giveVerbSynonym>>;

    try {
      rows = await giveVerbSynonym(seed, {
        sourceName: input.sourceName,
        locale: input.locale,
        limit: CAPABILITY_VERB_RESULT_LIMIT
      });
    } catch (error) {
      if (isMissingRelatedTermsArtifactError(error)) {
        continue;
      }

      throw error;
    }

    for (const row of rows) {
      const relatedVerb = foldSearchText(row.relatedVerb).trim();

      if (!relatedVerb) {
        continue;
      }

      relatedTerms.add(relatedVerb);

      if (relatedTerms.size >= CAPABILITY_VERB_RESULT_LIMIT) {
        return Array.from(relatedTerms);
      }
    }
    
  }

  return Array.from(relatedTerms);
    */
}

function isPreparedQueryUsefulToken(token: string, preparedQuery: PreparedQuery): boolean {
  const foldedToken = foldSearchText(token);

  return (
    !preparedQuery.noiseTokens.includes(foldedToken) &&
    !isSafeJobLevelModifierToken(token, preparedQuery.locale) &&
    isUsefulQueryToken(token, preparedQuery.locale)
  );
}

// function isMissingRelatedTermsArtifactError(error: unknown): boolean {
//   if (!(error instanceof Error)) {
//     return false;
//   }

//   return error.message.includes('Missing required ESCO related-terms binary artifact') || error.message.includes('ENOENT');
// }

function deriveCapabilityVerbSeedCandidates(token: string, locale: SupportedQueryLocale): string[] {
  const folded = foldSearchText(token).trim();

  if (!folded || folded.length < 4) {
    return [];
  }

  switch (locale) {
    case 'en':
      return deriveEnglishCapabilityVerbSeedCandidates(folded);
    case 'hu':
      return deriveHungarianCapabilityVerbSeedCandidates(folded);
    case 'ro':
      return deriveRomanianCapabilityVerbSeedCandidates(folded);
    case 'et':
      return deriveEstonianCapabilityVerbSeedCandidates(folded);
    default:
      return [folded];
  }
}

function uniqueTokenSequences(sequences: string[][]): string[][] {
  const seen = new Set<string>();
  const unique: string[][] = [];

  for (const sequence of sequences) {
    const normalized = sequence.map((token) => token.trim()).filter(Boolean);

    if (normalized.length === 0) {
      continue;
    }

    const key = normalized.join('\u0000');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

// English agent nouns: "waiter" -> "wait"/"waiting", "operator" -> "operat"/"operating".
function deriveEnglishCapabilityVerbSeedCandidates(folded: string): string[] {
  const candidates = new Set<string>();

  if ((folded.endsWith('er') || folded.endsWith('or')) && folded.length > 4) {
    const base = folded.slice(0, -2);

    if (base.length >= 3) {
      candidates.add(`${base}ing`);
      candidates.add(base);
    }
  }

  if (candidates.size === 0) {
    candidates.add(folded);
  }

  return Array.from(candidates);
}

// Hungarian agent nouns formed with the -ó/-ő suffix (folded to a trailing "o") derive directly
// from a verb stem: "vezeto" (leader) <- "vezet" (to lead), "elado" (seller) <- "elad" (to sell).
function deriveHungarianCapabilityVerbSeedCandidates(folded: string): string[] {
  const candidates = new Set<string>([folded]);

  if (folded.endsWith('o') && folded.length >= 5) {
    const stem = folded.slice(0, -1);

    if (stem.length >= 4) {
      candidates.add(stem);
    }
  }

  return Array.from(candidates);
}

// Romanian agent nouns formed with the -tor suffix derive from an -a infinitive stem:
// "lucrator" (worker) <- "lucra" (to work), "coordonator" (coordinator) <- "coordona" (to coordinate).
function deriveRomanianCapabilityVerbSeedCandidates(folded: string): string[] {
  const candidates = new Set<string>([folded]);

  if (folded.endsWith('tor') && folded.length > 6) {
    const stem = folded.slice(0, -3);

    if (stem.length >= 4) {
      candidates.add(stem);
    }
  }

  return Array.from(candidates);
}

// Estonian agent nouns formed with the -ja suffix derive from an -ma infinitive stem:
// "opetaja" (teacher) <- "opetama" (to teach), "muuja" (seller) <- "muuma" (to sell).
function deriveEstonianCapabilityVerbSeedCandidates(folded: string): string[] {
  const candidates = new Set<string>([folded]);

  if (folded.endsWith('ja') && folded.length >= 5) {
    const stem = folded.slice(0, -2);

    if (stem.length >= 3) {
      candidates.add(stem);
      candidates.add(`${stem}ma`);
    }
  }

  return Array.from(candidates);
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
  return isGenericQueryToken(token, locale) || isStopQueryToken(token, locale) || isSafeJobLevelModifierToken(token, locale);
}

function localeSetHasEnglishBackbone(
  valuesByLocale: Record<SupportedQueryLocale, Set<string>>,
  locale: SupportedQueryLocale,
  value: string
): boolean {
  return valuesByLocale[locale].has(value) || (locale !== 'en' && valuesByLocale.en.has(value));
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
