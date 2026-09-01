import {
  defaultOccupationRoleHeadEquivalentsArtifactPath,
  loadOccupationRoleHeadEquivalenceArtifactRequired,
  parseRoleHeadEquivalenceArtifact,
  type RoleHeadEquivalenceArtifact,
  type RoleHeadEquivalenceArtifactEntry,
  type RoleHeadEquivalenceClass,
  type RoleHeadEquivalenceLookup
} from '../runtime/occupation-role-head-equivalence-artifact.js';
import { isGenericQueryToken, type SupportedQueryLocale } from './query-preparation.js';
import { foldSearchText } from '../utils/texts.js';

let cachedEquivalents: RoleHeadEquivalenceLookup | null = null;
export type { RoleHeadEquivalenceArtifact, RoleHeadEquivalenceArtifactEntry, RoleHeadEquivalenceClass };
export {
  defaultOccupationRoleHeadEquivalentsArtifactPath,
  loadOccupationRoleHeadEquivalenceArtifactRequired,
  parseRoleHeadEquivalenceArtifact
};

export function occupationRoleHeadSharesEquivalentClass(
  token: string,
  locale: SupportedQueryLocale,
  labelTokens: ReadonlySet<string>
): boolean {
  const folded = foldSearchText(token);

  if (!folded) {
    return false;
  }

  const lookup = roleHeadEquivalents();
  const tokenClassIds = classIdsForTerm(lookup, locale, folded);

  if (tokenClassIds.size === 0) {
    return false;
  }

  for (const labelToken of labelTokens) {
    const labelClassIds = classIdsForTerm(lookup, locale, labelToken);

    for (const classId of tokenClassIds) {
      if (labelClassIds.has(classId)) {
        return true;
      }
    }
  }

  return false;
}

// Leaf canonical labels are always English, so unlike occupationRoleHeadSharesEquivalentClass
// (which compares both sides in the same locale), this looks the label tokens up under 'en'
// while the query token stays in its own locale.
export function occupationRoleHeadSharesEquivalentClassWithEnglishLabel(
  token: string,
  locale: SupportedQueryLocale,
  englishLabelTokens: ReadonlySet<string>
): boolean {
  const folded = foldSearchText(token);

  if (!folded) {
    return false;
  }

  const lookup = roleHeadEquivalents();
  const tokenClassIds = classIdsForTerm(lookup, locale, folded);

  if (tokenClassIds.size === 0) {
    return false;
  }

  for (const labelToken of englishLabelTokens) {
    const labelClassIds = classIdsForTerm(lookup, 'en', labelToken);

    for (const classId of tokenClassIds) {
      if (labelClassIds.has(classId)) {
        return true;
      }
    }
  }

  return false;
}

// Returns every English term that shares an equivalence class with `token` (read in `locale`).
// This is the "safe English version" of a non-English role-head token -- computed once per query
// (see altRoleHeadTokens on OccupationQueryIntent) so every downstream comparison site can check a
// plain token set instead of each independently calling the equivalence artifact.
export function englishRoleHeadEquivalents(token: string, locale: SupportedQueryLocale): string[] {
  const folded = foldSearchText(token);

  if (!folded) {
    return [];
  }

  const lookup = roleHeadEquivalents();
  const tokenClassIds = classIdsForTerm(lookup, locale, folded);

  if (tokenClassIds.size === 0) {
    return [];
  }

  const englishTerms = lookup.classIdsByLocaleAndTerm.get('en');

  if (!englishTerms) {
    return [];
  }

  const matches = new Set<string>();

  for (const [term, classIds] of englishTerms) {
    if (classIds.some((classId) => tokenClassIds.has(classId)) && !isGenericQueryToken(term, 'en')) {
      matches.add(term);
    }
  }

  return [...matches].sort();
}

function roleHeadEquivalents(): RoleHeadEquivalenceLookup {
  if (!cachedEquivalents) {
    cachedEquivalents = loadRoleHeadEquivalents();
  }

  return cachedEquivalents;
}

function loadRoleHeadEquivalents(): RoleHeadEquivalenceLookup {
  return loadOccupationRoleHeadEquivalenceArtifactRequired().lookup;
}

function classIdsForTerm(lookup: RoleHeadEquivalenceLookup, locale: SupportedQueryLocale, term: string): ReadonlySet<string> {
  const localeClassIds = lookup.classIdsByLocaleAndTerm.get(locale)?.get(term) ?? [];
  const globalClassIds = locale === 'unknown' ? [] : (lookup.classIdsByLocaleAndTerm.get('unknown')?.get(term) ?? []);

  if (globalClassIds.length === 0) {
    return new Set(localeClassIds);
  }

  return new Set([...localeClassIds, ...globalClassIds]);
}
