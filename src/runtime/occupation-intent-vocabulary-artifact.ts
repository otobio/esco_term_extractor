import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { foldSearchLookupText, isStopQueryToken, tokenizeNormalizedText, type SupportedQueryLocale } from '../query/query-preparation.js';
import { commonRolePhraseEntries } from '../query/common-role-phrase-atlas.js';
import type { OccupationIntentVocabulary, OccupationIntentVocabularyLocale } from '../query/query-intent.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
import { isNonNegativeInteger, isRecord, isStringArray, safeFileSegment } from '../utils/validation.js';
import {
  configuredRuntimeArtifactCacheSize,
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../utils/runtime-artifact-cache.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';

export type OccupationIntentVocabularyArtifactManifest = {
  schemaVersion: 2;
  sourceName: string;
  generatedAt: string;
  localeCount: number;
  recordsPath: string;
};

export type OccupationIntentVocabularyArtifact = OccupationIntentVocabularyArtifactManifest & OccupationIntentVocabulary;

type IntentVocabularyArtifactCacheEntry = {
  manifestPath: string;
  recordsPath: string;
  artifact: OccupationIntentVocabularyArtifact;
};

type TermStats = {
  totalCount: number;
  headCount: number;
  prefixCount: number;
  familyCount: number;
  capabilityCount: number;
};

type RolePhraseSource = {
  value: string;
  sourceKind: 'trusted_label' | 'supporting_alias';
};

const ARTIFACT_CACHE = new Map<string, RuntimeArtifactCacheEntry<IntentVocabularyArtifactCacheEntry>>();
const DEFAULT_INTENT_VOCABULARY_CACHE_SIZE = 2;
const MIN_ROLE_HEAD_COUNT = 2;
const MIN_MODIFIER_COUNT = 2;
const DOMAIN_HEAD_RATIO_MAX = 0.18;
const ROLE_MODIFIER_HEAD_RATIO_MAX = 0.45;
const MAX_TERMS_PER_BUCKET = 2500;
const MAX_PHRASES_PER_BUCKET = 100000;
const MAX_INTENT_PHRASE_TOKENS = 5;
const MIN_INTENT_PHRASE_TOKENS = 2;
const SUPPORTING_ALIAS_TERM_STATS_LOCALES = new Set<SupportedQueryLocale>(['hu', 'et']);
const NON_DOMAIN_PREFIX_TERMS = new Set([
  'aircraft',
  'automotive',
  'civil',
  'compliance',
  'data',
  'electrical',
  'financial',
  'industrial',
  'maintenance',
  'mechanical',
  'medical',
  'quality',
  'security',
  'software',
  'tax',
  'web'
]);
const KNOWN_DOMAIN_TERMS = new Set([
  'airline',
  'airport',
  'bank',
  'banking',
  'clinic',
  'education',
  'factory',
  'hotel',
  'hospital',
  'logistics',
  'manufacturing',
  'marine',
  'retail',
  'school',
  'telecom',
  'transport',
  'vocational',
  'warehouse'
]);
const KNOWN_CREDENTIAL_TERMS = new Set(['certified', 'chartered', 'licensed', 'registered']);

export function defaultOccupationIntentVocabularyManifestPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-intent-vocabulary.${safeFileSegment(sourceName)}.manifest.json`);
}

export function defaultOccupationIntentVocabularyRecordsPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-intent-vocabulary.${safeFileSegment(sourceName)}.records.jsonl`);
}

export async function loadOccupationIntentVocabularyArtifactIfAvailable(
  sourceName: string
): Promise<IntentVocabularyArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationIntentVocabularyManifestPath(sourceName);
  const cacheKey = path.resolve(manifestPath);
  return getCachedRuntimeArtifact(ARTIFACT_CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_INTENT_VOCABULARY_CACHE_SIZE', DEFAULT_INTENT_VOCABULARY_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName)
  });
}

export async function loadOccupationIntentVocabularyArtifactRequired(sourceName: string): Promise<IntentVocabularyArtifactCacheEntry> {
  const manifestPath =
    readOptionalEnv('OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH') ?? defaultOccupationIntentVocabularyManifestPath(sourceName);
  const artifactEntry = await loadOccupationIntentVocabularyArtifactIfAvailable(sourceName);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation intent-vocabulary artifact for source="${sourceName}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run query:intent:export-vocab` after exporting search-meta, or set OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

export function buildOccupationIntentVocabularyRecords(records: RuntimeSearchMetaRecord[]): OccupationIntentVocabularyLocale[] {
  const statsByLocale = new Map<string, Map<string, TermStats>>();
  const phraseSourcesByLocale = new Map<string, Map<string, RolePhraseSource>>();

  for (const record of records) {
    addLabel(statsByLocale, 'en', record.canonicalLabel);
    addRolePhraseSource(phraseSourcesByLocale, 'en', record.canonicalLabel, 'trusted_label');

    if (record.familyLabel) {
      addFamilyLabel(statsByLocale, 'en', record.familyLabel);
    }

    if (record.groupLabel) {
      addFamilyLabel(statsByLocale, 'en', record.groupLabel);
    }

    for (const alias of record.aliases) {
      if (isIntentTermStatsAlias(alias)) {
        addLabel(statsByLocale, alias.localeCode, alias.normalizedAlias);
      }

      if (isIntentPhraseAlias(alias)) {
        addRolePhraseSource(phraseSourcesByLocale, alias.localeCode, alias.normalizedAlias, 'trusted_label');
      } else if (isSupportingIntentPhraseAlias(alias)) {
        addRolePhraseSource(phraseSourcesByLocale, alias.localeCode, alias.normalizedAlias, 'supporting_alias');
      }
    }

    for (const capability of record.capabilityLabels) {
      addCapability(statsByLocale, 'unknown', capability.normalizedLabel);
    }
  }

  for (const locale of ['en', 'ro', 'hu', 'et'] as const) {
    for (const phrase of commonRolePhraseEntries(locale)) {
      addRolePhraseSource(phraseSourcesByLocale, locale, phrase.surface, 'trusted_label');
    }
  }

  if (!statsByLocale.has('unknown')) {
    statsByLocale.set('unknown', new Map());
  }

  return Array.from(statsByLocale.entries())
    .map(([localeCode, stats]) => buildLocaleRecord(localeCode, stats, phraseSourcesByLocale.get(localeCode) ?? new Map()))
    .sort((left, right) => left.localeCode.localeCompare(right.localeCode));
}

async function loadArtifact(manifestPath: string, sourceName: string): Promise<IntentVocabularyArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = validateManifest(JSON.parse(rawManifest) as unknown, manifestPath);

  if (manifest.sourceName !== sourceName) {
    return null;
  }

  const recordsPath = path.resolve(path.dirname(manifestPath), manifest.recordsPath);
  const localeProfiles = await loadRecords(recordsPath);

  if (localeProfiles.length !== manifest.localeCount) {
    throw new Error(
      `Occupation intent-vocabulary artifact count mismatch: manifest=${manifest.localeCount}, records=${localeProfiles.length}.`
    );
  }

  return {
    manifestPath,
    recordsPath,
    artifact: {
      ...manifest,
      localeProfiles
    }
  };
}

async function loadRecords(recordsPath: string): Promise<OccupationIntentVocabularyLocale[]> {
  const raw = await readFile(recordsPath, 'utf8');
  const records: OccupationIntentVocabularyLocale[] = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    records.push(validateRecord(JSON.parse(line) as unknown, recordsPath, index + 1));
  }

  return records;
}

function addLabel(statsByLocale: Map<string, Map<string, TermStats>>, localeCode: string, value: string): void {
  const tokens = intentTokens(value, normalizeArtifactLocale(localeCode));

  if (tokens.length === 0) {
    return;
  }

  tokens.forEach((token, index) => {
    const stats = getTermStats(getLocaleStats(statsByLocale, localeCode), token);
    stats.totalCount += 1;

    if (index === tokens.length - 1) {
      stats.headCount += 1;
    } else {
      stats.prefixCount += 1;
    }
  });
}

function addFamilyLabel(statsByLocale: Map<string, Map<string, TermStats>>, localeCode: string, value: string): void {
  for (const token of intentTokens(value, normalizeArtifactLocale(localeCode))) {
    const stats = getTermStats(getLocaleStats(statsByLocale, localeCode), token);
    stats.familyCount += 1;
  }
}

function addCapability(statsByLocale: Map<string, Map<string, TermStats>>, localeCode: string, value: string): void {
  for (const token of intentTokens(value, normalizeArtifactLocale(localeCode))) {
    const stats = getTermStats(getLocaleStats(statsByLocale, localeCode), token);
    stats.capabilityCount += 1;
  }
}

function addRolePhraseSource(
  phraseSourcesByLocale: Map<string, Map<string, RolePhraseSource>>,
  localeCode: string,
  value: string,
  sourceKind: RolePhraseSource['sourceKind']
): void {
  const normalizedLocale = normalizeArtifactLocale(localeCode);
  let phrases = phraseSourcesByLocale.get(normalizedLocale);

  if (!phrases) {
    phrases = new Map();
    phraseSourcesByLocale.set(normalizedLocale, phrases);
  }

  const key = foldSearchLookupText(value);
  const existing = phrases.get(key);

  if (!existing || (existing.sourceKind === 'supporting_alias' && sourceKind === 'trusted_label')) {
    phrases.set(key, { value, sourceKind });
  }
}

function buildLocaleRecord(
  localeCode: string,
  stats: Map<string, TermStats>,
  phraseSources: Map<string, RolePhraseSource>
): OccupationIntentVocabularyLocale {
  const roleHeadTerms: string[] = [];
  const roleModifierTerms: string[] = [];
  const domainModifierTerms: string[] = [];
  const credentialModifierTerms = Array.from(KNOWN_CREDENTIAL_TERMS).sort();
  const ambiguousModifierTerms: string[] = [];

  for (const [term, termStats] of stats.entries()) {
    if (term.length < 3) {
      continue;
    }

    const total = Math.max(1, termStats.totalCount);
    const headRatio = termStats.headCount / total;
    const prefixRatio = termStats.prefixCount / total;
    const familyRatio = termStats.familyCount / Math.max(1, termStats.familyCount + termStats.totalCount);

    if (KNOWN_CREDENTIAL_TERMS.has(term)) {
      continue;
    }

    if (
      KNOWN_DOMAIN_TERMS.has(term) ||
      (termStats.prefixCount >= MIN_MODIFIER_COUNT &&
        headRatio <= DOMAIN_HEAD_RATIO_MAX &&
        familyRatio > 0.1 &&
        !NON_DOMAIN_PREFIX_TERMS.has(term))
    ) {
      domainModifierTerms.push(term);
      continue;
    }

    if (termStats.headCount >= MIN_ROLE_HEAD_COUNT && headRatio >= 0.42) {
      roleHeadTerms.push(term);
      continue;
    }

    if (termStats.prefixCount >= MIN_MODIFIER_COUNT && prefixRatio >= 0.35 && headRatio <= ROLE_MODIFIER_HEAD_RATIO_MAX) {
      roleModifierTerms.push(term);
      continue;
    }

    if (termStats.prefixCount > 0 && termStats.headCount > 0) {
      ambiguousModifierTerms.push(term);
    }
  }

  const boundedRoleHeadTerms = boundedSorted(roleHeadTerms);
  const roleHeadSet = new Set([...boundedRoleHeadTerms, ...KNOWN_ROLE_PHRASE_HEADS]);

  return {
    localeCode,
    roleHeadTerms: boundedRoleHeadTerms,
    roleModifierTerms: boundedSorted(roleModifierTerms),
    domainModifierTerms: boundedSorted(domainModifierTerms),
    credentialModifierTerms,
    ambiguousModifierTerms: boundedSorted(ambiguousModifierTerms),
    rolePhrases: buildRolePhrases(phraseSources, normalizeArtifactLocale(localeCode), roleHeadSet),
    domainPhrases: []
  };
}

const KNOWN_ROLE_PHRASE_HEADS = new Set([
  'analyst',
  'architect',
  'auditor',
  'consultant',
  'creator',
  'designer',
  'developer',
  'engineer',
  'manager',
  'officer',
  'specialist',
  'writer'
]);
const BLOCKED_ROLE_PHRASE_HEADS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set(),
  ro: new Set(['media']),
  hu: new Set(),
  et: new Set(),
  unknown: new Set()
};

function isIntentPhraseAlias(alias: RuntimeSearchMetaRecord['aliases'][number]): boolean {
  if (alias.confidence !== null && alias.confidence < 0.7) {
    return false;
  }

  return (
    alias.aliasRole === 'locale_primary' ||
    alias.aliasRole === 'locale_supporting' ||
    alias.aliasRole === 'reviewed_crosswalk' ||
    alias.aliasRole === 'english_backbone'
  );
}

function isSupportingIntentPhraseAlias(alias: RuntimeSearchMetaRecord['aliases'][number]): boolean {
  if (alias.confidence !== null && alias.confidence < 0.7) {
    return false;
  }

  return alias.aliasRole === 'family_supporting';
}

function isIntentTermStatsAlias(alias: RuntimeSearchMetaRecord['aliases'][number]): boolean {
  return alias.aliasRole !== 'family_supporting' || SUPPORTING_ALIAS_TERM_STATS_LOCALES.has(normalizeArtifactLocale(alias.localeCode));
}

function buildRolePhrases(
  phraseSources: Map<string, RolePhraseSource>,
  locale: SupportedQueryLocale,
  roleHeadTerms: Set<string>
): string[] {
  const phrases = new Set<string>();

  for (const source of phraseSources.values()) {
    const value = source.value;
    const tokens = intentTokens(value, locale);

    if (tokens.length < MIN_INTENT_PHRASE_TOKENS) {
      continue;
    }

    const headToken = tokens[tokens.length - 1];
    const headTerms = source.sourceKind === 'supporting_alias' ? KNOWN_ROLE_PHRASE_HEADS : roleHeadTerms;

    if (!headToken || !tokenHasRoleHeadAuthority(headToken, headTerms, locale)) {
      continue;
    }

    const earliestStart = Math.max(0, tokens.length - MAX_INTENT_PHRASE_TOKENS);

    for (let start = earliestStart; start <= tokens.length - MIN_INTENT_PHRASE_TOKENS; start += 1) {
      phrases.add(tokens.slice(start).join(' '));
    }
  }

  return boundedSortedPhrases(Array.from(phrases));
}

function tokenHasRoleHeadAuthority(token: string, roleHeadTerms: Set<string>, locale: SupportedQueryLocale): boolean {
  if (BLOCKED_ROLE_PHRASE_HEADS_BY_LOCALE[locale].has(token)) {
    return false;
  }

  if (roleHeadTerms.has(token)) {
    return true;
  }

  if (token.endsWith('s') && token.length > 3 && roleHeadTerms.has(token.slice(0, -1))) {
    return true;
  }

  return false;
}

function intentTokens(value: string, locale: SupportedQueryLocale): string[] {
  return tokenizeNormalizedText(foldSearchLookupText(value)).filter((token) => token.length >= 3 && !isStopQueryToken(token, locale));
}

function getLocaleStats(statsByLocale: Map<string, Map<string, TermStats>>, localeCode: string): Map<string, TermStats> {
  const normalizedLocale = normalizeArtifactLocale(localeCode);
  let stats = statsByLocale.get(normalizedLocale);

  if (!stats) {
    stats = new Map();
    statsByLocale.set(normalizedLocale, stats);
  }

  return stats;
}

function getTermStats(stats: Map<string, TermStats>, term: string): TermStats {
  let existing = stats.get(term);

  if (!existing) {
    existing = {
      totalCount: 0,
      headCount: 0,
      prefixCount: 0,
      familyCount: 0,
      capabilityCount: 0
    };
    stats.set(term, existing);
  }

  return existing;
}

function boundedSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort().slice(0, MAX_TERMS_PER_BUCKET);
}

function boundedSortedPhrases(values: string[]): string[] {
  return Array.from(new Set(values)).sort().slice(0, MAX_PHRASES_PER_BUCKET);
}

function normalizeArtifactLocale(localeCode: string): SupportedQueryLocale {
  const normalized = localeCode.trim().toLowerCase();

  if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et') {
    return normalized;
  }

  return 'unknown';
}

function validateManifest(value: unknown, manifestPath: string): OccupationIntentVocabularyArtifactManifest {
  if (!isRecord(value)) {
    throw new Error(`Occupation intent-vocabulary manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = value as Partial<OccupationIntentVocabularyArtifactManifest>;

  if (
    manifest.schemaVersion !== 2 ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.localeCount) ||
    typeof manifest.recordsPath !== 'string'
  ) {
    throw new Error(`Invalid occupation intent-vocabulary manifest metadata at ${manifestPath}.`);
  }

  return manifest as OccupationIntentVocabularyArtifactManifest;
}

function validateRecord(value: unknown, recordsPath: string, lineNumber: number): OccupationIntentVocabularyLocale {
  if (!isRecord(value)) {
    throw new Error(`Invalid intent-vocabulary record at ${recordsPath}:${lineNumber}.`);
  }

  const record = value as Partial<OccupationIntentVocabularyLocale>;

  if (
    typeof record.localeCode !== 'string' ||
    !isStringArray(record.roleHeadTerms) ||
    !isStringArray(record.roleModifierTerms) ||
    !isStringArray(record.domainModifierTerms) ||
    !isStringArray(record.credentialModifierTerms) ||
    !isStringArray(record.ambiguousModifierTerms) ||
    !isStringArray(record.rolePhrases) ||
    !isStringArray(record.domainPhrases)
  ) {
    throw new Error(`Invalid intent-vocabulary record metadata at ${recordsPath}:${lineNumber}.`);
  }

  return {
    localeCode: record.localeCode,
    roleHeadTerms: record.roleHeadTerms,
    roleModifierTerms: record.roleModifierTerms,
    domainModifierTerms: record.domainModifierTerms,
    credentialModifierTerms: record.credentialModifierTerms,
    ambiguousModifierTerms: record.ambiguousModifierTerms,
    rolePhrases: record.rolePhrases,
    domainPhrases: record.domainPhrases
  };
}
