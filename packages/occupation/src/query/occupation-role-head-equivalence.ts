import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { DEFAULT_RUNTIME_DIR } from '../runtime/runtime-dir.js';
import { isRecord, isStringArray } from '../utils/validation.js';
import { foldSearchText, type SupportedQueryLocale } from './query-preparation.js';

type RoleHeadEquivalenceClass = {
  id: string;
  terms?: string[];
  termsByLocale: Partial<Record<SupportedQueryLocale, string[]>>;
};

export type RoleHeadEquivalenceArtifact = {
  description?: string;
  classes: RoleHeadEquivalenceClass[];
};

export type RoleHeadEquivalenceArtifactEntry = {
  artifactPath: string;
  artifact: RoleHeadEquivalenceArtifact;
};

const SUPPORTED_EQUIVALENCE_LOCALES: SupportedQueryLocale[] = ['en', 'ro', 'hu', 'et', 'unknown'];
const DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH = path.join(DEFAULT_RUNTIME_DIR, 'occupation-role-head-equivalents.json');
const ROLE_HEAD_EQUIVALENTS_ENV = 'OCCUPATION_ROLE_HEAD_EQUIVALENTS_ARTIFACT_PATH';

let cachedEquivalents: RoleHeadEquivalenceLookup | null = null;

type RoleHeadEquivalenceLookup = {
  classIdsByLocaleAndTerm: ReadonlyMap<SupportedQueryLocale, ReadonlyMap<string, readonly string[]>>;
};

export function defaultOccupationRoleHeadEquivalentsArtifactPath(): string {
  return DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH;
}

export function loadOccupationRoleHeadEquivalenceArtifactRequired(): RoleHeadEquivalenceArtifactEntry {
  const artifactPath = readOptionalEnv(ROLE_HEAD_EQUIVALENTS_ENV) ?? DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH;

  return {
    artifactPath,
    artifact: parseRoleHeadEquivalenceArtifact(readFileSync(artifactPath, 'utf8'), artifactPath)
  };
}

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
  const { artifactPath, artifact } = loadOccupationRoleHeadEquivalenceArtifactRequired();
  const mutableClassIds = new Map<SupportedQueryLocale, Map<string, Set<string>>>();

  for (const equivalenceClass of artifact.classes) {
    const globalTerms = uniqueFoldedTerms(equivalenceClass.terms ?? []);
    const termsByLocale = new Map<SupportedQueryLocale, string[]>();

    for (const locale of SUPPORTED_EQUIVALENCE_LOCALES) {
      const localeTerms = uniqueFoldedTerms(equivalenceClass.termsByLocale[locale] ?? []);
      const terms = uniqueSortedStrings([...globalTerms, ...localeTerms]);

      if (terms.length > 0) {
        termsByLocale.set(locale, terms);
      }
    }

    const conceptTerms = uniqueSortedStrings([...globalTerms, ...[...termsByLocale.values()].flat()]);

    if (conceptTerms.length < 2) {
      throw new Error(`Invalid role-head equivalence class "${equivalenceClass.id}" in ${artifactPath}; expected at least two folded terms.`);
    }

    for (const [locale, terms] of termsByLocale) {
      const localeClassIdLookup = mutableLookupForLocale(mutableClassIds, locale);

      for (const term of terms) {
        let classIds = localeClassIdLookup.get(term);

        if (!classIds) {
          classIds = new Set<string>();
          localeClassIdLookup.set(term, classIds);
        }

        classIds.add(equivalenceClass.id);
      }
    }
  }

  return {
    classIdsByLocaleAndTerm: freezeLookup(mutableClassIds)
  };
}

export function parseRoleHeadEquivalenceArtifact(contents: string, artifactPath: string): RoleHeadEquivalenceArtifact {
  const parsed: unknown = JSON.parse(contents);

  if (!isRoleHeadEquivalenceArtifact(parsed)) {
    throw new Error(`Invalid role-head equivalence artifact: ${artifactPath}`);
  }

  return parsed;
}

function isRoleHeadEquivalenceArtifact(value: unknown): value is RoleHeadEquivalenceArtifact {
  return isRecord(value) &&
    Array.isArray(value.classes) &&
    value.classes.every(isRoleHeadEquivalenceClass);
}

function isRoleHeadEquivalenceClass(value: unknown): value is RoleHeadEquivalenceClass {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    (value.terms === undefined || isStringArray(value.terms)) &&
    isLocaleTermMap(value.termsByLocale);
}

function isLocaleTermMap(value: unknown): value is Partial<Record<SupportedQueryLocale, string[]>> {
  return isRecord(value) &&
    Object.entries(value).every(([locale, terms]) =>
      isSupportedEquivalenceLocale(locale) && isStringArray(terms)
    );
}

function isSupportedEquivalenceLocale(locale: string): locale is SupportedQueryLocale {
  return SUPPORTED_EQUIVALENCE_LOCALES.includes(locale as SupportedQueryLocale);
}

function mutableLookupForLocale(
  mutable: Map<SupportedQueryLocale, Map<string, Set<string>>>,
  locale: SupportedQueryLocale
): Map<string, Set<string>> {
  let lookup = mutable.get(locale);

  if (!lookup) {
    lookup = new Map<string, Set<string>>();
    mutable.set(locale, lookup);
  }

  return lookup;
}

function classIdsForTerm(
  lookup: RoleHeadEquivalenceLookup,
  locale: SupportedQueryLocale,
  term: string
): ReadonlySet<string> {
  const localeClassIds = lookup.classIdsByLocaleAndTerm.get(locale)?.get(term) ?? [];
  const globalClassIds = locale === 'unknown'
    ? []
    : lookup.classIdsByLocaleAndTerm.get('unknown')?.get(term) ?? [];

  if (globalClassIds.length === 0) {
    return new Set(localeClassIds);
  }

  return new Set([...localeClassIds, ...globalClassIds]);
}

function freezeLookup<T>(
  mutable: Map<SupportedQueryLocale, Map<string, Set<T>>>
): ReadonlyMap<SupportedQueryLocale, ReadonlyMap<string, readonly T[]>> {
  return new Map(
    [...mutable.entries()].map(([locale, terms]) => [
      locale,
      new Map([...terms.entries()].map(([term, values]) => [term, [...values].sort()]))
    ])
  );
}

function uniqueFoldedTerms(terms: string[]): string[] {
  return uniqueSortedStrings(
    terms
      .map((term) => foldSearchText(term))
      .filter((term) => term.length > 0)
  );
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
