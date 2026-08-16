import {
  defaultOccupationRoleHeadEquivalentsArtifactPath,
  loadOccupationRoleHeadEquivalenceArtifactRequired,
  parseRoleHeadEquivalenceArtifact,
  type RoleHeadEquivalenceArtifact,
  type RoleHeadEquivalenceArtifactEntry,
  type RoleHeadEquivalenceClass,
  type RoleHeadEquivalenceLookup
} from '../runtime/occupation-role-head-equivalence-artifact.js';
import type { SupportedQueryLocale } from './query-preparation.js';
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
