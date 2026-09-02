import { isGenericQueryToken, isStopQueryToken } from '../query/query-preparation.js';
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
import { isKnownRoleHeadWord, isRankRoleHead } from './role-head-groups.js';

type TranslationArtifacts = {
  roleHeads: RoleHeadEquivalenceLookup;
  schema: SpecializationSchemaLookup;
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
    // Modifier tokens are everything but the role head and stopwords.
    const roleHeadTokens = new Set(queryRoleHeadTokens);
    const modifierTokens = inputTokens.filter((token) => !roleHeadTokens.has(token) && !isStopQueryToken(token, locale));

    return buildCanonicalComparisonQuery({
      matchedTokens: [...inputTokens],
      modifierTokens,
      unresolvedTokens: [],
      foldedFullText: foldedTitle,
      localRoleHeadTokens: [...roleHeadTokens],
      translationUnits: []
    });
  }

  let artifactsPromise = cachedArtifactsByLocale.get(locale);

  if (!artifactsPromise) {
    artifactsPromise = loadTranslationArtifacts(locale);
    cachedArtifactsByLocale.set(locale, artifactsPromise);
  }

  const artifacts = await artifactsPromise;
  const matchedByLocalToken = new Map<string, Set<string>>();
  const resolvedRoleHeadTokenSet = new Set<string>();
  const translationUnits: TranslationUnit[] = [];
  // Concept-alias matches (level 1) resolve a local token to a specialization *concept* (e.g. "vanzari"
  // -> knowledge_domain concept "business", task concept "sales"), not to a literal role-head noun --
  // the specialization dimension mapper already scores that concept against the candidate's own
  // structural profile elsewhere. Recording those tokens here too, and requiring them to appear
  // verbatim in a candidate's canonical label, double-penalizes generic-role-head queries (e.g. an
  // "agent" query) against equally generic candidates that only carry the concept structurally
  // (e.g. "technical sales representative"). modifierTokenSet tracks which matched tokens came from
  // this level so callers can treat them as supporting context rather than a strict requirement.
  const modifierTokenSet = new Set<string>();
  const resolvedTokenIndices = new Set<number>();

  const safeTokenOriginalIndices: number[] = [];
  // Quality tokens
  const safeInputTokens = inputTokens.filter((token, index) => {
    const keep = !isStopQueryToken(token, locale) && !isRankRoleHead(token, 'authority') && !isRankRoleHead(token, 'non-authority');
    if (keep) {
      safeTokenOriginalIndices.push(index);
    }
    return keep;
  });

  // Rank/level tokens (e.g. "ajutor", "sef") are excluded from safeInputTokens above so the three
  // less-accurate translation levels below never touch them -- but that used to mean they were
  // silently dropped from the translation entirely. LEVEL_SPECIALIZATION_SYNONYMS already gives an
  // exact, curated English word for each rank (the kind name itself, e.g. "ajutor" -> "assistant"),
  // so translate them from that table directly instead of leaving them untranslated.
  for (const token of inputTokens) {
    if (isStopQueryToken(token, locale)) {
      continue;
    }

    const levelKind = detectLeafLevelKind(new Set([token]));
    if (levelKind !== 'none') {
      translationUnits.push({ localText: token, alternatives: [{ kind: 'modifier', token: levelKind }] });
      addMatches(matchedByLocalToken, token, [levelKind]);
      modifierTokenSet.add(levelKind);
    }
  }

  // Curated multi-token concept aliases and curated role-head aliases (which can themselves be
  // multi-token phrases, e.g. "conducator auto" -> driver) are matched together in one greedy-longest
  // pass, ranked ahead of the broad cross-locale role-head equivalence lookup below. Matching them as
  // two separate passes (concept aliases first, in full, then role-head aliases) let a short
  // single-token concept alias grab a token before a longer overlapping role-head phrase got a
  // chance -- e.g. "auto" matching the single-token "automotive/vehicle" concept alias before
  // "conducator auto" could be tried as a 2-token role-head phrase for "driver". Running both sources
  // through the same longest-window-first search fixes that: whichever source has the longer match for
  // a given start position wins, regardless of which curated list it came from. Each match marks the
  // input token positions it translated in resolvedTokenIndices, and the less-accurate level below
  // skips those positions -- once a more accurate level has already translated a token, a less
  // accurate level must not be given the chance to override it with a different (or wrong) translation.
  // TODO: You will want to try different morph forms
  for (const match of phraseAliasMatches(safeInputTokens, artifacts.schema)) {
    translationUnits.push({ localText: match.localToken, alternatives: match.alternatives });
    addMatches(
      matchedByLocalToken,
      match.localToken,
      match.alternatives.map((alternative) => alternative.token)
    );
    for (const alternative of match.alternatives) {
      if (alternative.kind !== 'role_head') {
        modifierTokenSet.add(alternative.token);
        continue;
      }

      const roleHead = alternative.token;
      if (!isGenericQueryToken(roleHead, 'en')) {
        resolvedRoleHeadTokenSet.add(roleHead);
      }
    }

    for (const index of match.tokenIndices) {
      resolvedTokenIndices.add(index);
    }
  }

  safeInputTokens.forEach((token, index) => {
    if (resolvedTokenIndices.has(index)) {
      return;
    }

    for (const term of expandLocaleTokenVariants(token, locale)) {
      const matches = englishRoleHeadMatches(term, locale, artifacts.roleHeads);

      if (matches.length === 0) {
        continue;
      }

      translationUnits.push({
        localText: token,
        alternatives: matches.map((match) => ({ kind: 'role_head', token: match }))
      });
      addMatches(matchedByLocalToken, token, matches);
      matches
        .filter((match) => !isGenericQueryToken(match, 'en'))
        .forEach((match) => {
          resolvedRoleHeadTokenSet.add(match);
        });
      return;
    }
  });

  const matchedTokens = uniquePreservingOrder([...matchedByLocalToken.values()].flatMap((tokens) => [...tokens]));

  // Reverses the local->English translation to find the local surface's own role head: the local
  // token(s) whose English translation set contains a word from a known role-head group. This lets
  // retrieval build local-language modifier+roleHead combo keys (for the local exact-alias fast
  // path) without needing a separate local-language role-head list.
  const localRoleHeadTokens = [...matchedByLocalToken.entries()]
    .filter(([, englishTokens]) => [...englishTokens].some((token) => isKnownRoleHeadWord(token)))
    .map(([localToken]) => localToken);

  // A multi-token concept-alias match (e.g. "resurse umane" -> human_resources) is keyed in
  // matchedByLocalToken by the joined phrase, not by each individual input token -- so checking
  // matchedByLocalToken.has(token) per original token would wrongly report "resurse" and "umane" as
  // unresolved even though the phrase as a whole matched. Map resolvedTokenIndices (positions within
  // safeInputTokens) back to their original inputTokens positions to check resolution by position too.
  const resolvedOriginalIndices = new Set([...resolvedTokenIndices].map((safeIndex) => safeTokenOriginalIndices[safeIndex]));

  return buildCanonicalComparisonQuery({
    matchedTokens,
    modifierTokens: matchedTokens.filter((token) => modifierTokenSet.has(token)),
    unresolvedTokens: inputTokens.filter((token, index) => !matchedByLocalToken.has(token) && !resolvedOriginalIndices.has(index)),
    resolvedRoleHeadTokens: [...resolvedRoleHeadTokenSet],
    localRoleHeadTokens,
    translationUnits
  });
}

export function buildCanonicalComparisonQuery(translated: TranslatedTitle): CanonicalComparisonQuery {
  const hasFullMatch = translated.unresolvedTokens.length === 0 && translated.matchedTokens.length > 0;
  const translationUnits = translated.translationUnits ?? [];

  return {
    englishTokens: translated.matchedTokens,
    modifierTokens: translated.modifierTokens,
    unresolvedTokens: translated.unresolvedTokens,
    canonicalExactKeys: hasFullMatch ? canonicalExactKeysForTranslation(translated, translationUnits) : [],
    resolvedRoleHeadTokens: translated.resolvedRoleHeadTokens ?? [],
    localRoleHeadTokens: translated.localRoleHeadTokens ?? [],
    translationUnits
  };
}

export function modifierTokenUnitsForComparisonQuery(comparisonQuery: CanonicalComparisonQuery): readonly (readonly string[])[] {
  const units: string[][] = [];

  for (const unit of comparisonQuery.translationUnits) {
    const tokens: string[] = [];
    for (const alternative of unit.alternatives) {
      if (alternative.kind !== 'role_head' && !tokens.includes(alternative.token)) {
        tokens.push(alternative.token);
      }
    }
    if (tokens.length > 0) {
      units.push(tokens);
    }
  }

  return units;
}

export function conceptUnitCoverageForComparisonQuery(
  comparisonQuery: CanonicalComparisonQuery,
  conceptsByDimension: ReadonlyMap<TranslationConceptDimension, readonly string[]>
): number | null {
  let matchedUnitCount = 0;
  let conceptUnitCount = 0;

  for (const unit of comparisonQuery.translationUnits) {
    let matched = false;
    let hasConceptAlternative = false;
    for (const alternative of unit.alternatives) {
      if (alternative.kind !== 'concept') {
        continue;
      }

      hasConceptAlternative = true;
      if ((conceptsByDimension.get(alternative.dimension) ?? []).includes(alternative.conceptId)) {
        matched = true;
        break;
      }
    }

    if (!hasConceptAlternative) {
      continue;
    }

    conceptUnitCount++;
    if (matched) {
      matchedUnitCount++;
    }
  }

  return conceptUnitCount === 0 ? null : matchedUnitCount / conceptUnitCount;
}

async function loadTranslationArtifacts(locale: SupportedQueryLocale): Promise<TranslationArtifacts> {
  const [roleHeads, schema] = await Promise.all([
    Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired().lookup),
    loadSpecializationSchemaLookup(locale)
  ]);

  return { roleHeads, schema };
}

function addMatches(matchedByLocalToken: Map<string, Set<string>>, localToken: string, englishTokens: readonly string[]): void {
  if (englishTokens.length === 0) {
    return;
  }

  const tokens = matchedByLocalToken.get(localToken) ?? new Set<string>();

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
): Array<{ localToken: string; alternatives: TranslationAlternative[]; tokenIndices: number[] }> {
  const matches: Array<{ localToken: string; alternatives: TranslationAlternative[]; tokenIndices: number[] }> = [];
  const consumed = new Set<number>();
  const maxTokenCount = Math.max(schema.maxConceptAliasTokenCount, schema.maxRoleHeadAliasTokenCount);

  for (let index = 0; index < inputTokens.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }

    const firstTokenConceptRules = schema.conceptAliasesByFirstToken.get(inputTokens[index]) ?? [];
    const upperBound = Math.min(inputTokens.length, index + maxTokenCount);

    for (let end = upperBound; end > index; end -= 1) {
      const localToken = inputTokens.slice(index, end).join(' ');
      const conceptRules = firstTokenConceptRules.filter((rule) => rule.weakFoldedAlias === localToken);
      const roleHeads = schema.roleHeadAliasesByLocalToken.get(localToken) ?? [];

      if (conceptRules.length > 0 || roleHeads.length > 0) {
        const tokenIndices = Array.from({ length: end - index }, (_, offset) => index + offset);
        matches.push({
          localToken,
          alternatives: roleHeads.length > 0 ? roleHeadAlternatives(roleHeads) : conceptAlternatives(conceptRules),
          tokenIndices
        });
        for (const tokenIndex of tokenIndices) {
          consumed.add(tokenIndex);
        }
        break;
      }
    }
  }

  return matches;
}

function englishRoleHeadMatches(token: string, locale: SupportedQueryLocale, lookup: RoleHeadEquivalenceLookup): string[] {
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
  // Checked against both the equivalence artifact's English vocabulary and the broader
  // DEFAULT_ROLE_HEAD_GROUPS word list (role-head-groups.ts) -- a local token spelled the same as any
  // known English role head is already a valid translation, alias table or not.
  if (lookup.classIdsByLocaleAndTerm.get('en')?.has(folded) || isKnownRoleHeadWord(folded)) {
    return [folded];
  }

  const tokenClassIds = new Set([
    ...(lookup.classIdsByLocaleAndTerm.get(locale)?.get(folded) ?? []),
    ...(locale === 'unknown' ? [] : (lookup.classIdsByLocaleAndTerm.get('unknown')?.get(folded) ?? []))
  ]);

  if (tokenClassIds.size === 0) {
    return [];
  }

  const matches = new Set<string>();

  for (const [englishToken, classIds] of lookup.classIdsByLocaleAndTerm.get('en') ?? []) {
    if (classIds.some((classId) => tokenClassIds.has(classId)) && !isGenericQueryToken(englishToken, 'en')) {
      matches.add(englishToken);
    }
  }

  return uniqueSorted([...matches]);
}

function uniqueSorted(tokens: readonly string[]): string[] {
  return [...new Set(tokens.filter(Boolean))].sort();
}

function roleHeadAlternatives(roleHeads: readonly string[]): TranslationAlternative[] {
  return uniqueSorted(roleHeads).map((token) => ({ kind: 'role_head', token }));
}

function conceptAlternatives(rules: readonly SpecializationConceptAliasRule[]): TranslationAlternative[] {
  const seen = new Set<string>();
  const alternatives: TranslationAlternative[] = [];

  for (const rule of rules) {
    const token = rule.concept.canonical;
    const key = `${rule.concept.dimension}:${rule.conceptId}:${token}`;
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

  return alternatives.sort((left, right) => left.token.localeCompare(right.token));
}

function canonicalExactKeysForTranslation(translated: TranslatedTitle, translationUnits: readonly TranslationUnit[]): string[] {
  if (translationUnits.length === 0) {
    return [foldWeakPunctuationLookupText(translated.foldedFullText ?? translated.matchedTokens.join(' '))];
  }

  let phrases = [''];
  for (const unit of translationUnits) {
    const tokens = uniquePreservingOrder(unit.alternatives.map((alternative) => alternative.token));
    if (tokens.length === 0) {
      continue;
    }

    const next: string[] = [];
    for (const phrase of phrases) {
      for (const token of tokens) {
        next.push(`${phrase} ${token}`.trim());
      }
    }
    phrases = next;
  }

  return uniquePreservingOrder(phrases.map(foldWeakPunctuationLookupText).filter(Boolean));
}

// canonicalExactKeys (buildCanonicalComparisonQuery) joins matchedTokens back into a string for an
// exact-string comparison against a candidate's canonical label -- uniqueSorted's alphabetical order
// silently scrambled multi-word queries there (e.g. "shop assistant" -> "assistant shop"), breaking
// the exact match. This keeps first-seen order instead, for that one call site.
function uniquePreservingOrder(tokens: readonly string[]): string[] {
  return [...new Set(tokens.filter(Boolean))];
}
