import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { DEFAULT_RUNTIME_DIR } from '../runtime/runtime-dir.js';
import { isRecord, isStringArray } from '../utils/validation.js';
import { foldSearchText } from './query-preparation.js';
const SUPPORTED_EQUIVALENCE_LOCALES = ['en', 'ro', 'hu', 'et', 'unknown'];
const DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH = path.join(DEFAULT_RUNTIME_DIR, 'occupation-role-head-equivalents.json');
const ROLE_HEAD_EQUIVALENTS_ENV = 'OCCUPATION_ROLE_HEAD_EQUIVALENTS_ARTIFACT_PATH';
let cachedEquivalents = null;
export function defaultOccupationRoleHeadEquivalentsArtifactPath() {
    return DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH;
}
export function loadOccupationRoleHeadEquivalenceArtifactRequired() {
    const artifactPath = readOptionalEnv(ROLE_HEAD_EQUIVALENTS_ENV) ?? DEFAULT_ROLE_HEAD_EQUIVALENTS_PATH;
    return {
        artifactPath,
        artifact: parseRoleHeadEquivalenceArtifact(readFileSync(artifactPath, 'utf8'), artifactPath)
    };
}
export function occupationRoleHeadSharesEquivalentClass(token, locale, labelTokens) {
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
function roleHeadEquivalents() {
    if (!cachedEquivalents) {
        cachedEquivalents = loadRoleHeadEquivalents();
    }
    return cachedEquivalents;
}
function loadRoleHeadEquivalents() {
    const { artifactPath, artifact } = loadOccupationRoleHeadEquivalenceArtifactRequired();
    const mutableClassIds = new Map();
    for (const equivalenceClass of artifact.classes) {
        const globalTerms = uniqueFoldedTerms(equivalenceClass.terms ?? []);
        const termsByLocale = new Map();
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
                    classIds = new Set();
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
export function parseRoleHeadEquivalenceArtifact(contents, artifactPath) {
    const parsed = JSON.parse(contents);
    if (!isRoleHeadEquivalenceArtifact(parsed)) {
        throw new Error(`Invalid role-head equivalence artifact: ${artifactPath}`);
    }
    return parsed;
}
function isRoleHeadEquivalenceArtifact(value) {
    return isRecord(value) &&
        Array.isArray(value.classes) &&
        value.classes.every(isRoleHeadEquivalenceClass);
}
function isRoleHeadEquivalenceClass(value) {
    return isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        (value.terms === undefined || isStringArray(value.terms)) &&
        isLocaleTermMap(value.termsByLocale);
}
function isLocaleTermMap(value) {
    return isRecord(value) &&
        Object.entries(value).every(([locale, terms]) => isSupportedEquivalenceLocale(locale) && isStringArray(terms));
}
function isSupportedEquivalenceLocale(locale) {
    return SUPPORTED_EQUIVALENCE_LOCALES.includes(locale);
}
function mutableLookupForLocale(mutable, locale) {
    let lookup = mutable.get(locale);
    if (!lookup) {
        lookup = new Map();
        mutable.set(locale, lookup);
    }
    return lookup;
}
function classIdsForTerm(lookup, locale, term) {
    const localeClassIds = lookup.classIdsByLocaleAndTerm.get(locale)?.get(term) ?? [];
    const globalClassIds = locale === 'unknown'
        ? []
        : lookup.classIdsByLocaleAndTerm.get('unknown')?.get(term) ?? [];
    if (globalClassIds.length === 0) {
        return new Set(localeClassIds);
    }
    return new Set([...localeClassIds, ...globalClassIds]);
}
function freezeLookup(mutable) {
    return new Map([...mutable.entries()].map(([locale, terms]) => [
        locale,
        new Map([...terms.entries()].map(([term, values]) => [term, [...values].sort()]))
    ]));
}
function uniqueFoldedTerms(terms) {
    return uniqueSortedStrings(terms
        .map((term) => foldSearchText(term))
        .filter((term) => term.length > 0));
}
function uniqueSortedStrings(values) {
    return [...new Set(values)].sort();
}
