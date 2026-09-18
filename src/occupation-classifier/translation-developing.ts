import { isGenericQueryToken, isStopQueryToken } from '../query/query-preparation.js';
import conceptLeafFrequencyJson from './specialization/specialization-schema/concept-leaf-frequency.json' with { type: 'json' };
import { detectLeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from '../runtime/occupation-role-head-equivalence-artifact.js';
import type { RoleHeadEquivalenceLookup } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { expandLocaleTokenVariants } from '../query/token-variants.js';
import {
  loadSpecializationSchemaLookup,
  type SpecializationConceptAliasRule,
  type SpecializationSchemaLookup
} from './specialization-schema.js';
import type {
  CanonicalComparisonQuery,
  SupportedQueryLocale,
  TranslatedTitle,
  TranslationAlternative,
  TranslationConceptDimension,
  TranslationUnit
} from './types.js';
import { isAuthorityTier, isKnownRoleHeadWord, isRankRoleHead } from './role-head-groups.js';
import { uniquePreservingOrder, uniqueSorted } from './utils.js';

type TranslationArtifacts = {
  roleHeads: RoleHeadEquivalenceLookup;
  schema: SpecializationSchemaLookup;
};

type TranslationResolutionState = {
  matchedByLocalToken: Map<string, Set<string>>;
  resolvedRoleHeadTokens: Set<string>;
  modifierTokens: Set<string>;
  resolvedTokenIndices: Set<number>;
  translationUnits: TranslationUnit[];
};

type PhraseAliasMatch = {
  localToken: string;
  alternatives: TranslationAlternative[];
  tokenIndices: number[];
};

const cachedArtifactsByLocale = new Map<string, Promise<TranslationArtifacts>>();

// Translates each non-English input token to English role-head vocabulary, without ever attempting
// to translate a stopword/function word (e.g. "of", "de", "si") -- a stopword occasionally collides
// with a curated alias or equivalence-class term for an unrelated concept, which would otherwise
// "translate" it into a spurious English token and pollute the comparison query.
export async function translateTitleForClassifier(
  title: string,
  locale: SupportedQueryLocale,
  queryRoleHeadTokens: readonly string[] = []
): Promise<CanonicalComparisonQuery> {
  const foldedTitle = foldSearchText(title);
  const inputTokens = tokenizeNormalizedText(foldedTitle);

  if (locale === 'en') {
    return translateEnglishTitle(
      foldedTitle,
      inputTokens,
      locale,
      queryRoleHeadTokens
    );
  }

  const artifacts = await getTranslationArtifacts(locale);
  const state = createTranslationResolutionState();

  resolvePhraseAliases(state, inputTokens, artifacts.schema);
  resolveLevelTokens(state, inputTokens, locale);
  resolveRoleHeadTokens(state, inputTokens, locale, artifacts.roleHeads);

  return finalizeTranslation(
    state,
    inputTokens,
    foldedTitle
  );
}

function translateEnglishTitle(
  foldedTitle: string,
  inputTokens: readonly string[],
  locale: SupportedQueryLocale,
  queryRoleHeadTokens: readonly string[]
): CanonicalComparisonQuery {
  const roleHeadTokens = new Set(queryRoleHeadTokens);
  const modifierTokens = inputTokens.filter(
    token => !roleHeadTokens.has(token) && !isStopQueryToken(token, locale)
  );

  return buildCanonicalComparisonQuery({
    matchedTokens: [...inputTokens],
    modifierTokens,
    unresolvedTokens: [],
    foldedFullText: foldedTitle,
    localRoleHeadTokens: [...roleHeadTokens],
    translationUnits: []
  });
}

async function getTranslationArtifacts(
  locale: SupportedQueryLocale
): Promise<TranslationArtifacts> {
  let artifactsPromise = cachedArtifactsByLocale.get(locale);

  if (!artifactsPromise) {
    artifactsPromise = loadTranslationArtifacts(locale);
    cachedArtifactsByLocale.set(locale, artifactsPromise);
  }

  return artifactsPromise;
}

function createTranslationResolutionState(): TranslationResolutionState {
  return {
    matchedByLocalToken: new Map(),
    resolvedRoleHeadTokens: new Set(),
    modifierTokens: new Set(),
    resolvedTokenIndices: new Set(),
    translationUnits: []
  };
}

function resolvePhraseAliases(
  state: TranslationResolutionState,
  inputTokens: readonly string[],
  schema: SpecializationSchemaLookup
): void {
  const phraseTokenOriginalIndices: number[] = [];
  const phraseInputTokens = inputTokens.filter((token, index) => {
    const keep = !isStopQueryToken(token, 'unknown');

    if (keep) {
      phraseTokenOriginalIndices.push(index);
    }

    return keep;
  });

  const phraseMatches = phraseAliasMatches(
    phraseInputTokens,
    schema
  ).filter(match => {
    // A lone rank/level word (e.g. "ajutor") matching a single-token concept alias must not steal
    // the token from the more accurate rank/level translation below. Only a genuine multi-token
    // phrase, or a role-head match, is specific enough to override the rank reading.
    return !isSoleRankConceptMatch(match);
  });

  for (const match of phraseMatches) {
    for (const index of match.tokenIndices) {
      state.resolvedTokenIndices.add(
        phraseTokenOriginalIndices[index]
      );
    }

    addTranslationUnit(
      state,
      match.localToken,
      match.alternatives
    );
  }
}

function resolveLevelTokens(
  state: TranslationResolutionState,
  inputTokens: readonly string[],
  locale: SupportedQueryLocale
): void {
  inputTokens.forEach((token, index) => {
    if (
      isStopQueryToken(token, locale) ||
      state.resolvedTokenIndices.has(index)
    ) {
      return;
    }

    const levelKind = detectLeafLevelKind(new Set([token]));

    if (levelKind === 'none') {
      return;
    }

    const alternatives: TranslationAlternative[] = [
      {
        kind: 'modifier',
        token: levelKind
      }
    ];

    // Authority words such as "manager", "director", "chief", and "supervisor" can also be
    // standalone occupations, so offer the role-head interpretation as well.
    if (
      isAuthorityTier(levelKind) &&
      isKnownRoleHeadWord(levelKind)
    ) {
      alternatives.push({
        kind: 'role_head',
        token: levelKind
      });
    }

    addTranslationUnit(
      state,
      token,
      alternatives
    );

    state.modifierTokens.add(levelKind);

    if (
      isAuthorityTier(levelKind) &&
      isKnownRoleHeadWord(levelKind) &&
      !isGenericQueryToken(levelKind, 'en')
    ) {
      state.resolvedRoleHeadTokens.add(levelKind);
    }
  });
}

function resolveRoleHeadTokens(
  state: TranslationResolutionState,
  inputTokens: readonly string[],
  locale: SupportedQueryLocale,
  lookup: RoleHeadEquivalenceLookup
): void {
  const safeTokenOriginalIndices: number[] = [];

  const safeInputTokens = inputTokens.filter((token, index) => {
    const keep =
      !isStopQueryToken(token, locale) &&
      !isRankRoleHead(token, 'authority') &&
      !isRankRoleHead(token, 'non-authority');

    if (keep) {
      safeTokenOriginalIndices.push(index);
    }

    return keep;
  });

  safeInputTokens.forEach((token, safeIndex) => {
    const originalIndex = safeTokenOriginalIndices[safeIndex];

    if (state.resolvedTokenIndices.has(originalIndex)) {
      return;
    }

    for (const term of expandLocaleTokenVariants(token, locale)) {
      const matches = englishRoleHeadMatches(
        term,
        locale,
        lookup
      );

      if (matches.length === 0) {
        continue;
      }

      const alternatives = matches.map(
        match => ({
          kind: 'role_head' as const,
          token: match
        })
      );

      addTranslationUnit(
        state,
        token,
        alternatives
      );

      for (const match of matches) {
        if (!isGenericQueryToken(match, 'en')) {
          state.resolvedRoleHeadTokens.add(match);
        }
      }

      return;
    }
  });
}

function finalizeTranslation(
  state: TranslationResolutionState,
  inputTokens: readonly string[],
  foldedTitle: string
): CanonicalComparisonQuery {
  const matchedTokens = uniquePreservingOrder(
    [...state.matchedByLocalToken.values()]
      .flatMap(tokens => [...tokens])
  );

  const unresolvedTokens = inputTokens.filter(
    (token, index) =>
      !state.matchedByLocalToken.has(token) &&
      !state.resolvedTokenIndices.has(index)
  );

  const localRoleHeadTokens = [
    ...state.matchedByLocalToken.entries()
  ]
    .filter(([, englishTokens]) =>
      [...englishTokens].some(isKnownRoleHeadWord)
    )
    .map(([localToken]) => localToken);

  return buildCanonicalComparisonQuery({
    matchedTokens,
    modifierTokens: matchedTokens.filter(
      token => state.modifierTokens.has(token)
    ),
    unresolvedTokens,
    resolvedRoleHeadTokens: [...state.resolvedRoleHeadTokens],
    localRoleHeadTokens,
    translationUnits: state.translationUnits,
    foldedFullText: foldedTitle
  });
}

function addTranslationUnit(
  state: TranslationResolutionState,
  localToken: string,
  alternatives: readonly TranslationAlternative[]
): void {
  if (alternatives.length === 0) {
    return;
  }

  addMatches(
    state.matchedByLocalToken,
    localToken,
    alternatives.map(alternative => alternative.token)
  );

  for (const alternative of alternatives) {
    if (alternative.kind === 'concept') {
      state.modifierTokens.add(alternative.token);
    }
  }

  state.translationUnits.push({
    localText: localToken,
    alternatives: [...alternatives]
  });
}

function isSoleRankConceptMatch(match: PhraseAliasMatch): boolean {
  return (
    match.tokenIndices.length === 1 &&
    match.alternatives.every(
      alternative => alternative.kind !== 'role_head'
    ) &&
    detectLeafLevelKind(new Set([match.localToken])) !== 'none'
  );
}

export function buildCanonicalComparisonQuery(
  translated: TranslatedTitle
): CanonicalComparisonQuery {
  const hasFullMatch =
    translated.unresolvedTokens.length === 0 &&
    translated.matchedTokens.length > 0;

  const translationUnits = translated.translationUnits ?? [];

  return {
    englishTokens: translated.matchedTokens,
    modifierTokens: translated.modifierTokens,
    unresolvedTokens: translated.unresolvedTokens,
    canonicalExactKeys: hasFullMatch
      ? canonicalExactKeysForTranslation(
          translated,
          translationUnits
        )
      : [],
    resolvedRoleHeadTokens:
      translated.resolvedRoleHeadTokens ?? [],
    localRoleHeadTokens:
      translated.localRoleHeadTokens ?? [],
    translationUnits
  };
}

export function modifierTokenUnitsForComparisonQuery(
  comparisonQuery: CanonicalComparisonQuery
): readonly (readonly string[])[] {
  const units: string[][] = [];

  for (const unit of comparisonQuery.translationUnits) {
    const tokens: string[] = [];

    for (const alternative of unit.alternatives) {
      if (
        alternative.kind !== 'role_head' &&
        !tokens.includes(alternative.token)
      ) {
        tokens.push(alternative.token);
      }
    }

    if (tokens.length > 0) {
      units.push(tokens);
    }
  }

  return units;
}

// How many leaves in the whole taxonomy carry a given concept id -- a rare concept (e.g.
// "construction") is stronger coverage evidence than a common one. Weighting units by this instead of
// counting them 1-for-1 keeps a candidate matching only a common concept from tying one matching a
// rare concept.
const CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES =
  conceptLeafFrequencyJson.totalLeaves;

const CONCEPT_LEAF_FREQUENCY_BY_ID: Record<string, number> =
  conceptLeafFrequencyJson.leafCountByConceptId;

const CONCEPT_UNIT_WEIGHT_FLOOR = 0.6;

function conceptUnitWeight(conceptId: string): number {
  const leafCount = CONCEPT_LEAF_FREQUENCY_BY_ID[conceptId];

  if (!leafCount || leafCount <= 0) {
    return 1;
  }

  const specificity =
    Math.log(
      CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES / leafCount
    ) /
    Math.log(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES);

  return (
    CONCEPT_UNIT_WEIGHT_FLOOR +
    (1 - CONCEPT_UNIT_WEIGHT_FLOOR) *
      Math.max(0, Math.min(1, specificity))
  );
}

export function conceptUnitCoverageForComparisonQuery(
  comparisonQuery: CanonicalComparisonQuery,
  conceptsByDimension: ReadonlyMap<
    TranslationConceptDimension,
    readonly string[]
  >
): number | null {
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const unit of comparisonQuery.translationUnits) {
    let unitWeight = 0;
    let matched = false;

    for (const alternative of unit.alternatives) {
      if (alternative.kind !== 'concept') {
        continue;
      }

      unitWeight = Math.max(
        unitWeight,
        conceptUnitWeight(alternative.conceptId)
      );

      if (
        (
          conceptsByDimension.get(alternative.dimension) ?? []
        ).includes(alternative.conceptId)
      ) {
        matched = true;
      }
    }

    if (unitWeight === 0) {
      continue;
    }

    totalWeight += unitWeight;

    if (matched) {
      matchedWeight += unitWeight;
    }
  }

  return totalWeight === 0
    ? null
    : matchedWeight / totalWeight;
}

async function loadTranslationArtifacts(
  locale: SupportedQueryLocale
): Promise<TranslationArtifacts> {
  const [roleHeads, schema] = await Promise.all([
    Promise.resolve(
      loadOccupationRoleHeadEquivalenceArtifactRequired().lookup
    ),
    loadSpecializationSchemaLookup(locale)
  ]);

  return { roleHeads, schema };
}

function addMatches(
  matchedByLocalToken: Map<string, Set<string>>,
  localToken: string,
  englishTokens: readonly string[]
): void {
  if (englishTokens.length === 0) {
    return;
  }

  const tokens =
    matchedByLocalToken.get(localToken) ??
    new Set<string>();

  for (const token of englishTokens) {
    if (token) {
      tokens.add(token);
    }
  }

  matchedByLocalToken.set(localToken, tokens);
}

function phraseAliasMatches(
  inputTokens: readonly string[],
  schema: SpecializationSchemaLookup
): PhraseAliasMatch[] {
  const matches: PhraseAliasMatch[] = [];
  const consumed = new Set<number>();

  const maxTokenCount = Math.max(
    schema.maxConceptAliasTokenCount,
    schema.maxRoleHeadAliasTokenCount
  );

  for (
    let index = 0;
    index < inputTokens.length;
    index += 1
  ) {
    if (consumed.has(index)) {
      continue;
    }

    const firstTokenConceptRules =
      schema.conceptAliasesByFirstToken.get(
        inputTokens[index]
      ) ?? [];

    const upperBound = Math.min(
      inputTokens.length,
      index + maxTokenCount
    );

    for (
      let end = upperBound;
      end > index;
      end -= 1
    ) {
      const localToken = inputTokens
        .slice(index, end)
        .join(' ');

      const conceptRules =
        firstTokenConceptRules.filter(
          rule =>
            rule.weakFoldedAlias === localToken
        );

      const roleHeads =
        schema.roleHeadAliasesByLocalToken.get(
          localToken
        ) ?? [];

      if (
        conceptRules.length === 0 &&
        roleHeads.length === 0
      ) {
        continue;
      }

      const tokenIndices = Array.from(
        { length: end - index },
        (_, offset) => index + offset
      );

      matches.push({
        localToken,
        alternatives: [
          ...roleHeadAlternatives(roleHeads),
          ...conceptAlternatives(conceptRules)
        ],
        tokenIndices
      });

      for (const tokenIndex of tokenIndices) {
        consumed.add(tokenIndex);
      }

      break;
    }
  }

  return matches;
}

function englishRoleHeadMatches(
  token: string,
  locale: SupportedQueryLocale,
  lookup: RoleHeadEquivalenceLookup
): string[] {
  const folded = foldSearchText(token);

  if (!folded) {
    return [];
  }

  // If the local-language token is spelled identically to an English role-head term (a cognate,
  // e.g. RO/EN "agent"), treat it as already-English rather than expanding it through its equivalence
  // classes. A generic cognate like "agent" is shared across dozens of unrelated ESCO leaf classes
  // (guard, firefighter, detective, trader, officer...), each using it as their own locale term for a
  // completely different English role head -- unioning all of those classes' English terms would flood
  // the translation with unrelated tokens instead of preserving the one token that was already correct.
  if (
    lookup.classIdsByLocaleAndTerm
      .get('en')
      ?.has(folded) ||
    isKnownRoleHeadWord(folded)
  ) {
    return [folded];
  }

  const tokenClassIds = new Set([
    ...(lookup.classIdsByLocaleAndTerm
      .get(locale)
      ?.get(folded) ?? []),
    ...(locale === 'unknown'
      ? []
      : lookup.classIdsByLocaleAndTerm
          .get('unknown')
          ?.get(folded) ?? [])
  ]);

  if (tokenClassIds.size === 0) {
    return [];
  }

  const matches = new Set<string>();

  for (
    const [englishToken, classIds]
    of lookup.classIdsByLocaleAndTerm.get('en') ?? []
  ) {
    if (
      classIds.some(classId =>
        tokenClassIds.has(classId)
      ) &&
      !isGenericQueryToken(englishToken, 'en')
    ) {
      matches.add(englishToken);
    }
  }

  return uniqueSorted([...matches]);
}

function roleHeadAlternatives(
  roleHeads: readonly string[]
): TranslationAlternative[] {
  return uniqueSorted(roleHeads).map(
    token => ({
      kind: 'role_head',
      token
    })
  );
}

function conceptAlternatives(
  rules: readonly SpecializationConceptAliasRule[]
): TranslationAlternative[] {
  const seen = new Set<string>();
  const alternatives: TranslationAlternative[] = [];

  for (const rule of rules) {
    const token = rule.concept.canonical;
    const key =
      `${rule.concept.dimension}:${rule.conceptId}:${token}`;

    if (!token || seen.has(key)) {
      continue;
    }

    seen.add(key);

    alternatives.push({
      kind: 'concept',
      token,
      dimension: rule.concept.dimension,
      conceptId: rule.conceptId
    });
  }

  return alternatives.sort(
    (left, right) =>
      left.token.localeCompare(right.token)
  );
}

function canonicalExactKeysForTranslation(
  translated: TranslatedTitle,
  translationUnits: readonly TranslationUnit[]
): string[] {
  if (translationUnits.length === 0) {
    return [
      foldWeakPunctuationLookupText(
        translated.foldedFullText ??
          translated.matchedTokens.join(' ')
      )
    ];
  }

  let phrases = [''];

  for (const unit of translationUnits) {
    const tokens = uniquePreservingOrder(
      unit.alternatives.map(
        alternative => alternative.token
      )
    );

    if (tokens.length === 0) {
      continue;
    }

    phrases = phrases.flatMap(phrase =>
      tokens.map(
        token =>
          `${phrase} ${token}`.trim()
      )
    );
  }

  return uniquePreservingOrder(
    phrases
      .map(foldWeakPunctuationLookupText)
      .filter(Boolean)
  );
}