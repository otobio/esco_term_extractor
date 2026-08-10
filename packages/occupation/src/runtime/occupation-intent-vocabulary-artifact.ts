import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { foldSearchLookupText, isStopQueryToken, tokenizeNormalizedText, type SupportedQueryLocale } from '../query/query-preparation.js';
import { commonRolePhraseEntries } from '../query/common-role-phrase-atlas.js';
import type { OccupationIntentVocabulary, OccupationIntentVocabularyLocale } from '../query/query-intent.js';
import type { RuntimeSearchMetaRecord } from './occupation-search-meta-artifact.js';
import {
  readFixedTable,
  readStringTable,
  readUint32Rows,
  rowValue,
  stringAt,
  uint32RowsSlice,
  writeFixedTable,
  writeStringTable,
  writeUint32Rows,
  type BinaryStringTable,
  type FixedTable
} from '../utils/binary-table.js';
import { isNonNegativeInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import {
  configuredRuntimeArtifactCacheSize,
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../utils/runtime-artifact-cache.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';

export const INTENT_VOCABULARY_BINARY_SCHEMA_VERSION = 3;
const INTENT_VOCABULARY_LOCALE_ROW_WIDTH = 15;
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
const HEAD_POSITION_BY_LOCALE: Record<SupportedQueryLocale, 'first' | 'last'> = {
  en: 'last',
  ro: 'first',
  hu: 'last',
  et: 'last',
  unknown: 'last'
};
const NON_DOMAIN_PREFIX_TERMS = new Set([
  'aircraft',
  'automotive',
  'civil',
  'client',
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
  'automobile',
  'airport',
  'bank',
  'banking',
  'clinic',
  'education',
  'factory',
  'hotel',
  'hospital',
  'laundromat',
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
const BLOCKED_DOMAIN_MODIFIER_TERMS = new Set<string>();
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

export type OccupationIntentVocabularyArtifactManifest = {
  schemaVersion: typeof INTENT_VOCABULARY_BINARY_SCHEMA_VERSION;
  sourceName: string;
  generatedAt: string;
  localeCount: number;
  stringCount: number;
  termIdCount: number;
  phraseIdCount: number;
  files: {
    strings: string;
    localeRows: string;
    termIds: string;
    phraseIds: string;
  };
};

export type OccupationIntentVocabularyArtifact = OccupationIntentVocabularyArtifactManifest & OccupationIntentVocabulary;

type IntentVocabularyArtifactCacheEntry = {
  manifestPath: string;
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

type LoadedBinaryIntentVocabulary = {
  strings: BinaryStringTable;
  localeRows: FixedTable;
  termIds: Uint32Array;
  phraseIds: Uint32Array;
};

type LocaleBucketRef = {
  offset: number;
  count: number;
};

const ARTIFACT_CACHE = new Map<string, RuntimeArtifactCacheEntry<IntentVocabularyArtifactCacheEntry>>();

export function defaultOccupationIntentVocabularyManifestPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-intent-vocabulary.${safeFileSegment(sourceName)}.binary.manifest.json`);
}

export function defaultOccupationIntentVocabularyReviewJsonlPath(sourceName: string): string {
  return path.join(process.cwd(), 'data', 'runtime-review', `occupation-intent-vocabulary.${safeFileSegment(sourceName)}.jsonl`);
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

export function buildOccupationIntentVocabularyBinaryFiles(
  records: OccupationIntentVocabularyLocale[],
  prefix: string
): {
  manifestFiles: OccupationIntentVocabularyArtifactManifest['files'];
  buffers: Map<string, Buffer>;
  stringCount: number;
  termIdCount: number;
  phraseIdCount: number;
} {
  const normalizedRecords = records.map((record) => normalizeIntentVocabularyLocaleRecord(record));
  const strings = collectIntentVocabularyStrings(normalizedRecords);
  const stringIdByValue = new Map(strings.map((value, index) => [value, index]));
  const termIds: number[] = [];
  const phraseIds: number[] = [];
  const localeRows: number[][] = [];

  for (const record of normalizedRecords) {
    localeRows.push([
      requiredStringId(stringIdByValue, foldSearchLookupText(record.localeCode).trim()),
      ...appendStringIds(termIds, stringIdByValue, record.roleHeadTerms),
      ...appendStringIds(termIds, stringIdByValue, record.roleModifierTerms),
      ...appendStringIds(termIds, stringIdByValue, record.domainModifierTerms),
      ...appendStringIds(termIds, stringIdByValue, record.credentialModifierTerms),
      ...appendStringIds(termIds, stringIdByValue, record.ambiguousModifierTerms),
      ...appendStringIds(phraseIds, stringIdByValue, record.rolePhrases),
      ...appendStringIds(phraseIds, stringIdByValue, record.domainPhrases)
    ]);
  }

  const files = {
    strings: `${prefix}.strings.bin`,
    localeRows: `${prefix}.locale-rows.bin`,
    termIds: `${prefix}.term-ids.bin`,
    phraseIds: `${prefix}.phrase-ids.bin`
  } satisfies OccupationIntentVocabularyArtifactManifest['files'];

  return {
    manifestFiles: files,
    buffers: new Map([
      [files.strings, writeStringTable(strings)],
      [files.localeRows, writeFixedTable(localeRows, INTENT_VOCABULARY_LOCALE_ROW_WIDTH)],
      [files.termIds, writeUint32Rows(termIds)],
      [files.phraseIds, writeUint32Rows(phraseIds)]
    ]),
    stringCount: strings.length,
    termIdCount: termIds.length,
    phraseIdCount: phraseIds.length
  };
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

  const directory = path.dirname(manifestPath);
  const [strings, localeRows, termIds, phraseIds] = await Promise.all([
    readStringTable(path.resolve(directory, manifest.files.strings), manifest.stringCount),
    readFixedTable(path.resolve(directory, manifest.files.localeRows), INTENT_VOCABULARY_LOCALE_ROW_WIDTH, manifest.localeCount),
    readUint32Rows(path.resolve(directory, manifest.files.termIds)),
    readUint32Rows(path.resolve(directory, manifest.files.phraseIds))
  ]);
  const binary = { strings, localeRows, termIds, phraseIds };

  if (termIds.length !== manifest.termIdCount) {
    throw new Error(`Occupation intent-vocabulary term-id count mismatch: manifest=${manifest.termIdCount}, file=${termIds.length}.`);
  }

  if (phraseIds.length !== manifest.phraseIdCount) {
    throw new Error(`Occupation intent-vocabulary phrase-id count mismatch: manifest=${manifest.phraseIdCount}, file=${phraseIds.length}.`);
  }

  const decodedProfiles = new Map<string, OccupationIntentVocabularyLocale | null>();
  const localeRowByCode = buildLocaleRowIdByCode(binary);

  return {
    manifestPath,
    artifact: {
      ...manifest,
      localeProfiles: [],
      resolveLocaleProfile: (localeCode: string) => {
        const normalizedLocale = foldSearchLookupText(localeCode).trim();
        const cached = decodedProfiles.get(normalizedLocale);

        if (cached !== undefined) {
          return cached;
        }

        const rowId = localeRowByCode.get(normalizedLocale);
        const profile = rowId === undefined ? null : decodeLocaleProfile(binary, rowId);
        decodedProfiles.set(normalizedLocale, profile);
        return profile;
      }
    }
  };
}

function decodeLocaleProfile(binary: LoadedBinaryIntentVocabulary, rowId: number): OccupationIntentVocabularyLocale {
  return normalizeIntentVocabularyLocaleRecord({
    localeCode: stringAt(binary.strings, rowValue(binary.localeRows, rowId, 0)),
    roleHeadTerms: decodeStringIds(binary.strings, binary.termIds, bucketRef(binary.localeRows, rowId, 1)),
    roleModifierTerms: decodeStringIds(binary.strings, binary.termIds, bucketRef(binary.localeRows, rowId, 3)),
    domainModifierTerms: decodeStringIds(binary.strings, binary.termIds, bucketRef(binary.localeRows, rowId, 5)),
    credentialModifierTerms: decodeStringIds(binary.strings, binary.termIds, bucketRef(binary.localeRows, rowId, 7)),
    ambiguousModifierTerms: decodeStringIds(binary.strings, binary.termIds, bucketRef(binary.localeRows, rowId, 9)),
    rolePhrases: decodeStringIds(binary.strings, binary.phraseIds, bucketRef(binary.localeRows, rowId, 11)),
    domainPhrases: decodeStringIds(binary.strings, binary.phraseIds, bucketRef(binary.localeRows, rowId, 13))
  });
}

function bucketRef(rows: FixedTable, rowId: number, offsetColumn: number): LocaleBucketRef {
  return {
    offset: rowValue(rows, rowId, offsetColumn),
    count: rowValue(rows, rowId, offsetColumn + 1)
  };
}

function decodeStringIds(strings: BinaryStringTable, ids: Uint32Array, bucket: LocaleBucketRef): string[] {
  if (bucket.count === 0) {
    return [];
  }

  return uint32RowsSlice(ids, bucket.offset, bucket.count).map((stringId) => stringAt(strings, stringId));
}

function buildLocaleRowIdByCode(binary: LoadedBinaryIntentVocabulary): Map<string, number> {
  const byCode = new Map<string, number>();

  for (let rowId = 0; rowId < binary.localeRows.count; rowId += 1) {
    byCode.set(stringAt(binary.strings, rowValue(binary.localeRows, rowId, 0)), rowId);
  }

  return byCode;
}

function addLabel(statsByLocale: Map<string, Map<string, TermStats>>, localeCode: string, value: string): void {
  const locale = normalizeArtifactLocale(localeCode);
  const tokens = intentTokens(value, locale);

  if (tokens.length === 0) {
    return;
  }

  const headIndex = localeHeadTokenIndex(tokens, locale);

  tokens.forEach((token, index) => {
    const stats = getTermStats(getLocaleStats(statsByLocale, localeCode), token);
    stats.totalCount += 1;

    if (index === headIndex) {
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
    switch (classifyIntentVocabularyTerm(term, termStats)) {
      case 'domain_modifier':
        domainModifierTerms.push(term);
        break;
      case 'role_head':
        roleHeadTerms.push(term);
        break;
      case 'role_modifier':
        roleModifierTerms.push(term);
        break;
      case 'ambiguous_modifier':
        ambiguousModifierTerms.push(term);
        break;
      case 'ignore':
        break;
    }
  }

  const normalizedRecord = normalizeIntentVocabularyLocaleRecord({
    localeCode,
    roleHeadTerms,
    roleModifierTerms,
    domainModifierTerms,
    credentialModifierTerms,
    ambiguousModifierTerms,
    rolePhrases: [],
    domainPhrases: []
  });
  const roleHeadSet = new Set([...normalizedRecord.roleHeadTerms, ...KNOWN_ROLE_PHRASE_HEADS]);

  return {
    ...normalizedRecord,
    rolePhrases: buildRolePhrases(phraseSources, normalizeArtifactLocale(localeCode), roleHeadSet),
    domainPhrases: normalizedRecord.domainPhrases
  };
}

type IntentVocabularyTermClass = 'domain_modifier' | 'role_head' | 'role_modifier' | 'ambiguous_modifier' | 'ignore';

function classifyIntentVocabularyTerm(term: string, termStats: TermStats): IntentVocabularyTermClass {
  if (term.length < 3 || KNOWN_CREDENTIAL_TERMS.has(term)) {
    return 'ignore';
  }

  const total = Math.max(1, termStats.totalCount);
  const headRatio = termStats.headCount / total;
  const prefixRatio = termStats.prefixCount / total;
  const familyRatio = termStats.familyCount / Math.max(1, termStats.familyCount + termStats.totalCount);
  const knownDomain = KNOWN_DOMAIN_TERMS.has(term);
  const blockedDomain = NON_DOMAIN_PREFIX_TERMS.has(term) || BLOCKED_DOMAIN_MODIFIER_TERMS.has(term);
  const domainCandidate =
    knownDomain ||
    (!blockedDomain &&
      termStats.prefixCount >= MIN_MODIFIER_COUNT &&
      termStats.familyCount >= 2 &&
      headRatio <= DOMAIN_HEAD_RATIO_MAX &&
      familyRatio >= 0.2);
  const roleHeadCandidate = termStats.headCount >= MIN_ROLE_HEAD_COUNT && headRatio >= 0.42;
  const roleModifierCandidate =
    termStats.prefixCount >= MIN_MODIFIER_COUNT &&
    prefixRatio >= 0.35 &&
    headRatio <= ROLE_MODIFIER_HEAD_RATIO_MAX &&
    !knownDomain &&
    !BLOCKED_DOMAIN_MODIFIER_TERMS.has(term);

  if (domainCandidate && roleHeadCandidate) {
    return 'ambiguous_modifier';
  }

  if (domainCandidate && roleModifierCandidate) {
    return knownDomain || familyRatio >= 0.35 ? 'domain_modifier' : 'ambiguous_modifier';
  }

  if (roleHeadCandidate && roleModifierCandidate) {
    return headRatio >= 0.58 || termStats.headCount > termStats.prefixCount ? 'role_head' : 'ambiguous_modifier';
  }

  if (domainCandidate) {
    return 'domain_modifier';
  }

  if (roleHeadCandidate) {
    return 'role_head';
  }

  if (roleModifierCandidate) {
    return 'role_modifier';
  }

  if (termStats.prefixCount > 0 && termStats.headCount > 0) {
    return 'ambiguous_modifier';
  }

  if (BLOCKED_DOMAIN_MODIFIER_TERMS.has(term) && termStats.prefixCount >= MIN_MODIFIER_COUNT) {
    return 'ambiguous_modifier';
  }

  return 'ignore';
}

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
    const tokens = intentTokens(source.value, locale);

    if (tokens.length < MIN_INTENT_PHRASE_TOKENS) {
      continue;
    }

    const headToken = tokens[localeHeadTokenIndex(tokens, locale)];
    const headTerms = source.sourceKind === 'supporting_alias' ? KNOWN_ROLE_PHRASE_HEADS : roleHeadTerms;

    if (!headToken || !tokenHasRoleHeadAuthority(headToken, headTerms, locale)) {
      continue;
    }

    if (HEAD_POSITION_BY_LOCALE[locale] === 'first') {
      const maxEnd = Math.min(tokens.length, MAX_INTENT_PHRASE_TOKENS);

      for (let end = MIN_INTENT_PHRASE_TOKENS; end <= maxEnd; end += 1) {
        phrases.add(tokens.slice(0, end).join(' '));
      }

      continue;
    }

    const earliestStart = Math.max(0, tokens.length - MAX_INTENT_PHRASE_TOKENS);

    for (let start = earliestStart; start <= tokens.length - MIN_INTENT_PHRASE_TOKENS; start += 1) {
      phrases.add(tokens.slice(start).join(' '));
    }
  }

  return boundedSortedPhrases(Array.from(phrases));
}

function localeHeadTokenIndex(tokens: string[], locale: SupportedQueryLocale): number {
  if (tokens.length === 0) {
    return -1;
  }

  return HEAD_POSITION_BY_LOCALE[locale] === 'first' ? 0 : tokens.length - 1;
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
    manifest.schemaVersion !== INTENT_VOCABULARY_BINARY_SCHEMA_VERSION ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !isNonNegativeInteger(manifest.localeCount) ||
    !isNonNegativeInteger(manifest.stringCount) ||
    !isNonNegativeInteger(manifest.termIdCount) ||
    !isNonNegativeInteger(manifest.phraseIdCount) ||
    !isRecord(manifest.files) ||
    typeof manifest.files.strings !== 'string' ||
    typeof manifest.files.localeRows !== 'string' ||
    typeof manifest.files.termIds !== 'string' ||
    typeof manifest.files.phraseIds !== 'string'
  ) {
    throw new Error(`Invalid occupation intent-vocabulary manifest metadata at ${manifestPath}.`);
  }

  return manifest as OccupationIntentVocabularyArtifactManifest;
}

function normalizeIntentVocabularyLocaleRecord(record: OccupationIntentVocabularyLocale): OccupationIntentVocabularyLocale {
  const locale = normalizeArtifactLocale(record.localeCode);
  const roleHeadTerms = new Set(normalizeBucketTerms(record.roleHeadTerms));
  const roleModifierTerms = new Set(normalizeBucketTerms(record.roleModifierTerms));
  const domainModifierTerms = new Set(normalizeBucketTerms(record.domainModifierTerms));
  const credentialModifierTerms = new Set(normalizeBucketTerms(record.credentialModifierTerms));
  const ambiguousModifierTerms = new Set(normalizeBucketTerms(record.ambiguousModifierTerms));

  for (const term of credentialModifierTerms) {
    roleHeadTerms.delete(term);
    roleModifierTerms.delete(term);
    domainModifierTerms.delete(term);
    ambiguousModifierTerms.delete(term);
  }

  for (const term of BLOCKED_DOMAIN_MODIFIER_TERMS) {
    if (domainModifierTerms.delete(term)) {
      ambiguousModifierTerms.add(term);
    }
  }

  for (const term of KNOWN_DOMAIN_TERMS) {
    if (roleModifierTerms.delete(term) || ambiguousModifierTerms.delete(term)) {
      domainModifierTerms.add(term);
    }
  }

  for (const term of BLOCKED_DOMAIN_MODIFIER_TERMS) {
    if (roleModifierTerms.delete(term)) {
      ambiguousModifierTerms.add(term);
    }
  }

  for (const term of roleHeadTerms) {
    if (roleModifierTerms.delete(term) || domainModifierTerms.delete(term)) {
      ambiguousModifierTerms.add(term);
    }
  }

  if (HEAD_POSITION_BY_LOCALE[locale] === 'first') {
    for (const term of Array.from(roleHeadTerms)) {
      if (!NON_DOMAIN_PREFIX_TERMS.has(term)) {
        continue;
      }

      roleHeadTerms.delete(term);
      roleModifierTerms.add(term);
      ambiguousModifierTerms.delete(term);
    }
  }

  for (const term of domainModifierTerms) {
    if (NON_DOMAIN_PREFIX_TERMS.has(term) && domainModifierTerms.delete(term)) {
      ambiguousModifierTerms.add(term);
      continue;
    }

    if (roleModifierTerms.delete(term)) {
      ambiguousModifierTerms.add(term);
    }
  }

  const finalRoleHeadTerms = boundedSorted(Array.from(roleHeadTerms));
  const roleHeadAuthority = new Set([...finalRoleHeadTerms, ...KNOWN_ROLE_PHRASE_HEADS]);

  return {
    localeCode: foldSearchLookupText(record.localeCode).trim(),
    roleHeadTerms: finalRoleHeadTerms,
    roleModifierTerms: boundedSorted(Array.from(roleModifierTerms)),
    domainModifierTerms: boundedSorted(Array.from(domainModifierTerms)),
    credentialModifierTerms: boundedSorted(Array.from(credentialModifierTerms)),
    ambiguousModifierTerms: boundedSorted(Array.from(ambiguousModifierTerms)),
    rolePhrases: boundedSortedPhrases(
      normalizePhraseTerms(record.rolePhrases).filter((phrase) => {
        const tokens = intentTokens(phrase, locale);
        const headToken = tokens[localeHeadTokenIndex(tokens, locale)];
        return Boolean(headToken && tokenHasRoleHeadAuthority(headToken, roleHeadAuthority, locale));
      })
    ),
    domainPhrases: boundedSortedPhrases(normalizePhraseTerms(record.domainPhrases))
  };
}

function normalizeBucketTerms(values: string[]): string[] {
  return values.map((value) => foldSearchLookupText(value).trim()).filter((value) => value.length >= 3);
}

function normalizePhraseTerms(values: string[]): string[] {
  return values.map((value) => foldSearchLookupText(value).trim()).filter((value) => value.length > 0);
}

function collectIntentVocabularyStrings(records: OccupationIntentVocabularyLocale[]): string[] {
  const strings = new Set<string>();

  for (const record of records) {
    strings.add(foldSearchLookupText(record.localeCode).trim());
    for (const value of [
      ...record.roleHeadTerms,
      ...record.roleModifierTerms,
      ...record.domainModifierTerms,
      ...record.credentialModifierTerms,
      ...record.ambiguousModifierTerms,
      ...record.rolePhrases,
      ...record.domainPhrases
    ]) {
      strings.add(value);
    }
  }

  return Array.from(strings).sort();
}

function appendStringIds(target: number[], stringIdByValue: Map<string, number>, values: string[]): [number, number] {
  const offset = target.length;

  for (const value of values) {
    target.push(requiredStringId(stringIdByValue, value));
  }

  return [offset, values.length];
}

function requiredStringId(stringIdByValue: Map<string, number>, value: string): number {
  const stringId = stringIdByValue.get(value);

  if (stringId === undefined) {
    throw new Error(`Missing binary intent-vocabulary string: ${value}`);
  }

  return stringId;
}
