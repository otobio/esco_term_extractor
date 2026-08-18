import { isGenericQueryToken, isSafeJobLevelModifierToken, isStopQueryToken, type PreparedQuery } from '../query/query-preparation.js';
import { aliasRoleScoreFactor, CANONICAL_ALIAS_ROLE, FAMILY_SUPPORTING_ALIAS_ROLE, isSearchAliasRole } from '../query/alias-role-policy.js';
import { familyTokenRelevanceMultiplier, tryLoadOccupationFamilyTokenRelevanceLookup } from '../query/occupation-family-token-relevance.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import {
  loadOccupationSearchMetaArtifactRequired,
  type RuntimeAliasRecord,
  type RuntimeSearchMetaRecord
} from '../runtime/occupation-search-meta-artifact.js';
import {
  ALIAS_NGRAM_NULL_U32,
  ALIAS_NGRAM_WEIGHT_SCALE,
  binaryFeaturePostings,
  binaryStringAt,
  binaryStringId,
  type BinaryAliasNgramIndex
} from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { rowValue } from '../runtime/occupation-retrieval-index-artifact.js';
import { clampScore, roundScore } from '../utils/operators.js';
import { preloadVocabularyCompoundSplitArtifact, usesVocabularyCompoundSplit, type CompoundSplitLocale } from '../utils/lang.js';
import { splitCompoundTokensWithArtifact } from '../query/token-variants.js';
import type { OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';

export type RuntimeAliasNgramRecord = {
  index: number;
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  alias: string;
  normalizedAlias: string;
  aliasRole: string;
  aliasRoleScoreFactor: number;
  aliasWeight: number | null;
  foldedTokens: string[];
  usefulFoldedTokens: string[];
  weightedFeatures: Array<[string, number]>;
  norm: number;
};

export type AliasNgramIndexOptions = {
  sourceName: string;
  locale: string;
  includeFamilySupportingAliases?: boolean;
};

export type AliasNgramSourceRow = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  alias: string;
  normalizedAlias: string;
  aliasRole: string;
  aliasWeight: number | null;
};

export type AliasNgramHit = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  alias: string;
  normalizedAlias: string;
  aliasRole: string;
  aliasWeight: number | null;
  score: number;
  cosine: number;
  tokenCoverage: number;
  usefulTokenCoverage: number;
  // Debug-only: the two directions usefulTokenCoverage takes the min of, surfaced separately so a low
  // blended coverage can be diagnosed as "query has extra tokens" vs "alias has extra tokens".
  queryUsefulTokenCoverage: number;
  aliasUsefulTokenCoverage: number;
  phraseDirection: 'exact' | 'contains' | 'none';
  matchedTokens: string[];
  matchedFeatures: string[];
};

type AliasNgramEntry = {
  index: number;
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  alias: string;
  normalizedAlias: string;
  aliasRole: string;
  aliasRoleScoreFactor: number;
  aliasWeight: number | null;
  foldedTokens: string[];
  usefulFoldedTokens: string[];
  featureCounts: Map<string, number>;
  weightedFeatures: Map<string, number>;
  norm: number;
};

type RawAliasNgramEntry = Omit<AliasNgramEntry, 'index' | 'weightedFeatures' | 'norm'>;

export type AliasNgramIndex = {
  sourceName: string;
  locale: string;
  includeFamilySupportingAliases: boolean;
  aliasCount: number;
  entries: AliasNgramEntry[];
  postingsByFeature: Map<string, number[]>;
};

const MAX_FEATURE_POSTING_SCAN = 2500;

async function loadVocabularyCompoundSplitArtifactForLocale(
  locale: string,
  sourceName: string
): Promise<OccupationSignalVocabularyArtifact | undefined> {
  return usesVocabularyCompoundSplit(locale as CompoundSplitLocale) ? preloadVocabularyCompoundSplitArtifact(sourceName) : undefined;
}

export async function buildAliasNgramIndex(options: AliasNgramIndexOptions): Promise<AliasNgramIndex> {
  const artifactEntry = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
  const records = artifactEntry.getAllRecordsWithDetails();
  const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
  const vocabularyArtifact = await loadVocabularyCompoundSplitArtifactForLocale(options.locale, options.sourceName);
  const rawEntries = buildRawEntries(records, options.locale, includeFamilySupportingAliases, vocabularyArtifact);
  return buildAliasNgramIndexFromRawEntries({
    sourceName: options.sourceName,
    locale: options.locale,
    includeFamilySupportingAliases,
    rawEntries
  });
}

export async function buildOccupationAliasNgramRecords(
  records: RuntimeSearchMetaRecord[],
  options: AliasNgramIndexOptions
): Promise<RuntimeAliasNgramRecord[]> {
  const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
  const vocabularyArtifact = await loadVocabularyCompoundSplitArtifactForLocale(options.locale, options.sourceName);
  const rawEntries = buildRawEntries(records, options.locale, includeFamilySupportingAliases, vocabularyArtifact);
  const documentFrequency = countDocumentFrequency(rawEntries.map((entry) => entry.featureCounts));

  return rawEntries.map((entry, index) => {
    const weightedFeatures = weightFeatures(entry.featureCounts, documentFrequency, rawEntries.length);

    return {
      index,
      graphNodeId: entry.graphNodeId,
      canonicalLabel: entry.canonicalLabel,
      familyNodeId: entry.familyNodeId,
      familyLabel: entry.familyLabel,
      alias: entry.alias,
      normalizedAlias: entry.normalizedAlias,
      aliasRole: entry.aliasRole,
      aliasRoleScoreFactor: entry.aliasRoleScoreFactor,
      aliasWeight: entry.aliasWeight,
      foldedTokens: entry.foldedTokens,
      usefulFoldedTokens: entry.usefulFoldedTokens,
      weightedFeatures: Array.from(weightedFeatures.entries()).sort(([left], [right]) => left.localeCompare(right)),
      norm: vectorNorm(weightedFeatures)
    };
  });
}

export function buildAliasNgramIndexFromArtifactRecords(
  options: AliasNgramIndexOptions & { records: RuntimeAliasNgramRecord[] }
): AliasNgramIndex {
  const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
  const entries = options.records.map((record, fallbackIndex) => ({
    index: record.index ?? fallbackIndex,
    graphNodeId: record.graphNodeId,
    canonicalLabel: record.canonicalLabel,
    familyNodeId: record.familyNodeId,
    familyLabel: record.familyLabel,
    alias: record.alias,
    normalizedAlias: record.normalizedAlias,
    aliasRole: record.aliasRole,
    aliasRoleScoreFactor: record.aliasRoleScoreFactor,
    aliasWeight: record.aliasWeight,
    foldedTokens: record.foldedTokens,
    usefulFoldedTokens: record.usefulFoldedTokens,
    featureCounts: new Map<string, number>(),
    weightedFeatures: new Map(record.weightedFeatures),
    norm: record.norm
  }));

  return {
    sourceName: options.sourceName,
    locale: options.locale,
    includeFamilySupportingAliases,
    aliasCount: entries.length,
    entries,
    postingsByFeature: buildPostings(entries)
  };
}

export function buildAliasNgramIndexFromRows(options: AliasNgramIndexOptions & { rows: AliasNgramSourceRow[] }): AliasNgramIndex {
  const includeFamilySupportingAliases = options.includeFamilySupportingAliases === true;
  const rawEntries = buildRawEntriesFromRows(options.rows, options.locale, includeFamilySupportingAliases);
  return buildAliasNgramIndexFromRawEntries({
    sourceName: options.sourceName,
    locale: options.locale,
    includeFamilySupportingAliases,
    rawEntries
  });
}

function buildAliasNgramIndexFromRawEntries(options: {
  sourceName: string;
  locale: string;
  includeFamilySupportingAliases: boolean;
  rawEntries: RawAliasNgramEntry[];
}): AliasNgramIndex {
  const rawEntries = options.rawEntries;
  const documentFrequency = countDocumentFrequency(rawEntries.map((entry) => entry.featureCounts));
  const entries = rawEntries.map((entry, index) => {
    const weightedFeatures = weightFeatures(entry.featureCounts, documentFrequency, rawEntries.length);
    return {
      ...entry,
      index,
      weightedFeatures,
      norm: vectorNorm(weightedFeatures)
    };
  });
  const postingsByFeature = buildPostings(entries);

  return {
    sourceName: options.sourceName,
    locale: options.locale,
    includeFamilySupportingAliases: options.includeFamilySupportingAliases,
    aliasCount: entries.length,
    entries,
    postingsByFeature
  };
}

export function retrieveAliasNgramHits(index: AliasNgramIndex, preparedQuery: PreparedQuery, options: { limit: number }): AliasNgramHit[] {
  const queryFeatures = buildFeatureCounts(preparedQuery.folded, index.locale);
  const weightedQueryFeatures = weightFeatures(queryFeatures, countQueryDocumentFrequency(index, queryFeatures), index.aliasCount);
  const queryNorm = vectorNorm(weightedQueryFeatures);

  if (queryNorm === 0) {
    return [];
  }

  const candidateIds = candidateEntryIds(index, weightedQueryFeatures);
  // compoundSplitFoldedTokens credits a compound query word (e.g. hu "targoncavezeto") against an
  // alias only ever stored as its separate constituent tokens ("targonca", "vezeto").
  const queryTokenSet = new Set([...preparedQuery.foldedTokens, ...preparedQuery.compoundSplitFoldedTokens]);
  // expandedFoldedTokens carries locale-variant forms (e.g. ro plural "electricieni" -> singular
  // "electrician") that usefulFoldedTokens never gets -- without this, coverage never credits a
  // query's inflected form against an alias only ever stored in its base form.
  const usefulQueryTokenSet = new Set([...preparedQuery.expandedFoldedTokens, ...preparedQuery.compoundSplitFoldedTokens]);
  const relevanceLookup = tryLoadOccupationFamilyTokenRelevanceLookup(index.sourceName);
  const hits: AliasNgramHit[] = [];

  for (const entryId of candidateIds) {
    const entry = index.entries[entryId];

    if (!entry || entry.norm === 0) {
      continue;
    }

    const cosine = dotProduct(weightedQueryFeatures, entry.weightedFeatures) / (queryNorm * entry.norm);

    if (cosine <= 0) {
      continue;
    }

    const matchedTokens = entry.foldedTokens.filter((token) => queryTokenSet.has(token));
    const matchedUsefulTokens = entry.usefulFoldedTokens.filter((token) => usefulQueryTokenSet.has(token));
    const tokenCoverage = queryTokenSet.size > 0 ? matchedTokens.length / queryTokenSet.size : 0;
    const queryUsefulTokenCoverage = usefulQueryTokenSet.size > 0 ? matchedUsefulTokens.length / usefulQueryTokenSet.size : tokenCoverage;
    const aliasUsefulTokenCoverage =
      entry.usefulFoldedTokens.length > 0 ? matchedUsefulTokens.length / entry.usefulFoldedTokens.length : queryUsefulTokenCoverage;
    // An alias with extra tokens the query never mentioned (e.g. "jurist" fully covering the query but
    // only half of the compound alias "jurist lingvist") is a different, more specific occupation than
    // the bare query -- credit only the weaker of the two directions so it can't outscore a full match.
    const usefulTokenCoverage = Math.min(queryUsefulTokenCoverage, aliasUsefulTokenCoverage);
    const phraseBonus =
      entry.normalizedAlias === preparedQuery.normalized || foldSearchText(entry.normalizedAlias) === preparedQuery.folded
        ? 0.12
        : entry.foldedTokens.join(' ').includes(preparedQuery.folded) || preparedQuery.folded.includes(entry.foldedTokens.join(' '))
          ? 0.05
          : 0;
    const authorityBoost = entry.aliasRole === CANONICAL_ALIAS_ROLE ? 0.04 : Math.min(0.04, Math.max(0, entry.aliasWeight ?? 0) * 0.04);
    const relevanceMultiplier = familyTokenRelevanceMultiplier(relevanceLookup, index.locale, entry.familyNodeId, matchedTokens);
    const score = clampScore(
      (cosine * 0.72 + usefulTokenCoverage * 0.18 + phraseBonus + authorityBoost) * entry.aliasRoleScoreFactor * relevanceMultiplier
    );

    hits.push({
      graphNodeId: entry.graphNodeId,
      canonicalLabel: entry.canonicalLabel,
      familyNodeId: entry.familyNodeId,
      familyLabel: entry.familyLabel,
      alias: entry.alias,
      normalizedAlias: entry.normalizedAlias,
      aliasRole: entry.aliasRole,
      aliasWeight: entry.aliasWeight,
      score,
      cosine: roundScore(cosine),
      tokenCoverage: roundScore(tokenCoverage),
      usefulTokenCoverage: roundScore(usefulTokenCoverage),
      queryUsefulTokenCoverage: roundScore(queryUsefulTokenCoverage),
      aliasUsefulTokenCoverage: roundScore(aliasUsefulTokenCoverage),
      phraseDirection: phraseBonus === 0.12 ? 'exact' : phraseBonus === 0.05 ? 'contains' : 'none',
      matchedTokens: Array.from(new Set(matchedTokens)).sort(),
      matchedFeatures: topMatchedFeatures(weightedQueryFeatures, entry.weightedFeatures, 8)
    });
  }

  return hits
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.usefulTokenCoverage - left.usefulTokenCoverage ||
        right.cosine - left.cosine ||
        left.canonicalLabel.localeCompare(right.canonicalLabel) ||
        left.alias.localeCompare(right.alias)
    )
    .slice(0, options.limit);
}

export function retrieveBinaryAliasNgramHits(
  index: BinaryAliasNgramIndex,
  preparedQuery: PreparedQuery,
  options: { limit: number }
): AliasNgramHit[] {
  const queryFeatures = buildFeatureCounts(preparedQuery.folded, index.manifest.locale);
  const weightedQueryFeatures = weightFeatures(
    queryFeatures,
    countBinaryQueryDocumentFrequency(index, queryFeatures),
    index.manifest.count
  );
  const queryNorm = vectorNorm(weightedQueryFeatures);

  if (queryNorm === 0) {
    return [];
  }

  const candidateIds = binaryCandidateEntryIds(index, weightedQueryFeatures);
  const binaryQueryFeatures = binaryQueryFeatureMap(index, weightedQueryFeatures);
  // See retrieveAliasNgramHits above for why this also folds in compoundSplitFoldedTokens.
  const queryTokenSet = new Set([...preparedQuery.foldedTokens, ...preparedQuery.compoundSplitFoldedTokens]);
  // See retrieveAliasNgramHits above for why this uses expandedFoldedTokens, not usefulFoldedTokens.
  const usefulQueryTokenSet = new Set([...preparedQuery.expandedFoldedTokens, ...preparedQuery.compoundSplitFoldedTokens]);
  const preselectedHits: Array<{ entryId: number; cosine: number }> = [];

  for (const entryId of candidateIds) {
    const norm = rowValue(index.rows, entryId, 11) / ALIAS_NGRAM_WEIGHT_SCALE;

    if (norm === 0) {
      continue;
    }

    const cosine = binaryDotProduct(index, entryId, binaryQueryFeatures.weightsByFeatureId) / (queryNorm * norm);

    if (cosine <= 0) {
      continue;
    }

    preselectedHits.push({ entryId, cosine });
  }

  const shortlist = preselectedHits
    .sort((left, right) => right.cosine - left.cosine || left.entryId - right.entryId)
    .slice(0, Math.max(options.limit * 8, 120));
  const relevanceLookup = tryLoadOccupationFamilyTokenRelevanceLookup(index.manifest.sourceName);
  const hits: Array<Omit<AliasNgramHit, 'matchedFeatures'> & { entryId: number }> = [];

  for (const { entryId, cosine } of shortlist) {
    const foldedTokens = tokenTextToTokens(binaryStringAt(index, rowValue(index.rows, entryId, 9)));
    const usefulFoldedTokens = tokenTextToTokens(binaryStringAt(index, rowValue(index.rows, entryId, 10)));
    const normalizedAlias = binaryStringAt(index, rowValue(index.rows, entryId, 5));
    const aliasRole = binaryStringAt(index, rowValue(index.rows, entryId, 6));
    const aliasWeight = nullableScaled(rowValue(index.rows, entryId, 7));
    const familyNodeId = nullableU32(rowValue(index.rows, entryId, 2));
    const matchedTokens = foldedTokens.filter((token) => queryTokenSet.has(token));
    const matchedUsefulTokens = usefulFoldedTokens.filter((token) => usefulQueryTokenSet.has(token));
    const tokenCoverage = queryTokenSet.size > 0 ? matchedTokens.length / queryTokenSet.size : 0;
    const queryUsefulTokenCoverage = usefulQueryTokenSet.size > 0 ? matchedUsefulTokens.length / usefulQueryTokenSet.size : tokenCoverage;
    const aliasUsefulTokenCoverage =
      usefulFoldedTokens.length > 0 ? matchedUsefulTokens.length / usefulFoldedTokens.length : queryUsefulTokenCoverage;
    const usefulTokenCoverage = Math.min(queryUsefulTokenCoverage, aliasUsefulTokenCoverage);
    const phraseBonus =
      normalizedAlias === preparedQuery.normalized || foldSearchText(normalizedAlias) === preparedQuery.folded
        ? 0.12
        : foldedTokens.join(' ').includes(preparedQuery.folded) || preparedQuery.folded.includes(foldedTokens.join(' '))
          ? 0.05
          : 0;
    const authorityBoost = aliasRole === CANONICAL_ALIAS_ROLE ? 0.04 : Math.min(0.04, Math.max(0, aliasWeight ?? 0) * 0.04);
    const aliasRoleScoreFactor = rowValue(index.rows, entryId, 8) / ALIAS_NGRAM_WEIGHT_SCALE;
    const relevanceMultiplier = familyTokenRelevanceMultiplier(relevanceLookup, index.manifest.locale, familyNodeId, matchedTokens);
    const score = clampScore(
      (cosine * 0.72 + usefulTokenCoverage * 0.18 + phraseBonus + authorityBoost) * aliasRoleScoreFactor * relevanceMultiplier
    );

    hits.push({
      entryId,
      graphNodeId: rowValue(index.rows, entryId, 0),
      canonicalLabel: binaryStringAt(index, rowValue(index.rows, entryId, 1)),
      familyNodeId,
      familyLabel: nullableString(index, rowValue(index.rows, entryId, 3)),
      alias: binaryStringAt(index, rowValue(index.rows, entryId, 4)),
      normalizedAlias,
      aliasRole,
      aliasWeight,
      score,
      cosine: roundScore(cosine),
      tokenCoverage: roundScore(tokenCoverage),
      usefulTokenCoverage: roundScore(usefulTokenCoverage),
      queryUsefulTokenCoverage: roundScore(queryUsefulTokenCoverage),
      aliasUsefulTokenCoverage: roundScore(aliasUsefulTokenCoverage),
      phraseDirection: phraseBonus === 0.12 ? 'exact' : phraseBonus === 0.05 ? 'contains' : 'none',
      matchedTokens: Array.from(new Set(matchedTokens)).sort()
    });
  }

  return hits
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.usefulTokenCoverage - left.usefulTokenCoverage ||
        right.cosine - left.cosine ||
        left.canonicalLabel.localeCompare(right.canonicalLabel) ||
        left.alias.localeCompare(right.alias)
    )
    .slice(0, options.limit)
    .map(({ entryId, ...hit }) => ({
      ...hit,
      matchedFeatures: binaryTopMatchedFeatures(index, entryId, binaryQueryFeatures, 8)
    }));
}

function buildRawEntries(
  records: RuntimeSearchMetaRecord[],
  locale: string,
  includeFamilySupportingAliases: boolean,
  vocabularyArtifact?: OccupationSignalVocabularyArtifact
): RawAliasNgramEntry[] {
  const entries: RawAliasNgramEntry[] = [];
  const seen = new Set<string>();
  const familySupportingRowsByKey = new Map<string, AliasNgramSourceRow>();

  for (const record of records) {
    if (locale === 'en') {
      addEntry(record, {
        alias: record.canonicalLabel,
        normalizedAlias: record.canonicalLabel,
        aliasRole: CANONICAL_ALIAS_ROLE,
        weight: 1
      });
    }

    for (const alias of record.aliases) {
      if (alias.localeCode !== locale || !isSearchAliasRole(alias.aliasRole, includeFamilySupportingAliases)) {
        continue;
      }

      if (alias.aliasRole === FAMILY_SUPPORTING_ALIAS_ROLE) {
        if (record.familyNodeId === null || !record.familyLabel) {
          continue;
        }

        const normalizedAlias = alias.normalizedAlias.trim() || alias.alias.trim();
        const foldedAlias = foldSearchText(normalizedAlias);
        const key = `${record.familyNodeId}\0${foldedAlias}`;
        const existing = familySupportingRowsByKey.get(key);

        if (!existing || (alias.weight ?? 0) > (existing.aliasWeight ?? 0)) {
          familySupportingRowsByKey.set(key, {
            graphNodeId: record.familyNodeId,
            canonicalLabel: record.familyLabel,
            familyNodeId: record.familyNodeId,
            familyLabel: record.familyLabel,
            alias: alias.alias,
            normalizedAlias,
            aliasRole: alias.aliasRole,
            aliasWeight: alias.weight
          });
        }

        continue;
      }

      addEntry(record, alias);
    }
  }

  entries.push(
    ...buildRawEntriesFromRows(Array.from(familySupportingRowsByKey.values()), locale, includeFamilySupportingAliases, vocabularyArtifact)
  );

  return entries;

  function addEntry(
    record: RuntimeSearchMetaRecord,
    alias: RuntimeAliasRecord | { alias: string; normalizedAlias: string; aliasRole: string; weight: number | null }
  ): void {
    const normalizedAlias = alias.normalizedAlias.trim() || alias.alias.trim();
    const foldedAlias = foldSearchText(normalizedAlias);
    const foldedTokens = tokenizeNormalizedText(foldedAlias);

    if (foldedTokens.length === 0) {
      return;
    }

    const key = `${record.graphNodeId}\0${alias.aliasRole}\0${foldedAlias}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    // A compound alias (e.g. hu "kamionsofőr") is a single opaque token at tokenize time -- expand it
    // with its vocabulary-driven split parts ("kamion", "sofor") so a query for the bare part can match
    // it via exact token coverage, not just character-ngram cosine similarity.
    const compoundSplitTokens = vocabularyArtifact
      ? splitCompoundTokensWithArtifact(foldedTokens, locale as CompoundSplitLocale, vocabularyArtifact)
      : [];
    const expandedFoldedTokens = compoundSplitTokens.length > 0 ? appendUniqueTokens(foldedTokens, compoundSplitTokens) : foldedTokens;
    entries.push({
      graphNodeId: record.graphNodeId,
      canonicalLabel: record.canonicalLabel,
      familyNodeId: record.familyNodeId,
      familyLabel: record.familyLabel,
      alias: alias.alias,
      normalizedAlias,
      aliasRole: alias.aliasRole,
      aliasRoleScoreFactor: aliasRoleScoreFactor(alias.aliasRole),
      aliasWeight: alias.weight,
      foldedTokens: expandedFoldedTokens,
      usefulFoldedTokens: usefulAliasTokens(expandedFoldedTokens, locale),
      featureCounts: buildFeatureCounts(foldedAlias, locale, compoundSplitTokens)
    });
  }
}

function buildRawEntriesFromRows(
  rows: AliasNgramSourceRow[],
  locale: string,
  includeFamilySupportingAliases: boolean,
  vocabularyArtifact?: OccupationSignalVocabularyArtifact
): RawAliasNgramEntry[] {
  const entries: RawAliasNgramEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isSearchAliasRole(row.aliasRole, includeFamilySupportingAliases)) {
      continue;
    }

    const normalizedAlias = row.normalizedAlias.trim() || row.alias.trim();
    const foldedAlias = foldSearchText(normalizedAlias);
    const foldedTokens = tokenizeNormalizedText(foldedAlias);

    if (foldedTokens.length === 0) {
      continue;
    }

    const key = `${row.graphNodeId}\0${row.aliasRole}\0${foldedAlias}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const compoundSplitTokens = vocabularyArtifact
      ? splitCompoundTokensWithArtifact(foldedTokens, locale as CompoundSplitLocale, vocabularyArtifact)
      : [];
    const expandedFoldedTokens = compoundSplitTokens.length > 0 ? appendUniqueTokens(foldedTokens, compoundSplitTokens) : foldedTokens;
    entries.push({
      graphNodeId: row.graphNodeId,
      canonicalLabel: row.canonicalLabel,
      familyNodeId: row.familyNodeId,
      familyLabel: row.familyLabel,
      alias: row.alias,
      normalizedAlias,
      aliasRole: row.aliasRole,
      aliasRoleScoreFactor: aliasRoleScoreFactor(row.aliasRole),
      aliasWeight: row.aliasWeight,
      foldedTokens: expandedFoldedTokens,
      usefulFoldedTokens: usefulAliasTokens(expandedFoldedTokens, locale),
      featureCounts: buildFeatureCounts(foldedAlias, locale, compoundSplitTokens)
    });
  }

  return entries;
}

function buildFeatureCounts(text: string, locale: string, extraTokens: string[] = []): Map<string, number> {
  const tokens = tokenizeNormalizedText(foldSearchText(text));
  const counts = new Map<string, number>();

  // extraTokens carries vocabulary-driven compound-split parts (e.g. hu "kamionsofőr" -> "kamion",
  // "sofor") so a query for just the split part can find this alias via feature overlap, not only
  // via character-ngram cosine similarity.
  for (const token of extraTokens) {
    for (const variant of tokenVariants(token)) {
      addFeature(counts, `tok:${variant}`, tokenWeight(token, locale) * 0.82);
    }
  }

  tokens.forEach((token, index) => {
    for (const variant of tokenVariants(token)) {
      addFeature(counts, `tok:${variant}`, tokenWeight(token, locale) * (variant === token ? 1 : 0.82));
    }

    addFeature(counts, `pre:${token.slice(0, Math.min(4, token.length))}`, 0.35);

    if (index + 1 < tokens.length) {
      const next = tokens[index + 1] ?? '';
      const adjacentSpecificity = tokenSpecificityFactor(token, locale) * tokenSpecificityFactor(next, locale);
      addFeature(counts, `bi:${token}_${next}`, BASE_BIGRAM_WEIGHT * adjacentSpecificity);

      for (const compound of compoundTokenVariants(token, next)) {
        addFeature(counts, `tok:${compound}`, BASE_COMPOUND_WEIGHT * adjacentSpecificity);
      }
    }

    for (const ngram of characterNgrams(token, 3)) {
      addFeature(counts, `c3:${ngram}`, 0.25);
    }

    for (const ngram of characterNgrams(token, 4)) {
      addFeature(counts, `c4:${ngram}`, 0.35);
    }
  });

  return counts;
}

function appendUniqueTokens(tokens: string[], extraTokens: string[]): string[] {
  const merged = new Set(tokens);

  for (const token of extraTokens) {
    merged.add(token);
  }

  return Array.from(merged);
}

function tokenVariants(token: string): string[] {
  const variants = new Set<string>([token]);

  if (token.endsWith('ies') && token.length > 5) {
    variants.add(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  if (token === 'backend') {
    variants.add('back_end');
  }

  if (token === 'frontend') {
    variants.add('front_end');
  }

  if (token === 'fullstack') {
    variants.add('full_stack');
  }

  return Array.from(variants);
}

function compoundTokenVariants(left: string, right: string): string[] {
  const compound = `${left}_${right}`;
  const variants = new Set<string>([compound]);

  if (compound === 'back_end') {
    variants.add('backend');
  }

  if (compound === 'front_end') {
    variants.add('frontend');
  }

  if (compound === 'full_stack') {
    variants.add('fullstack');
  }

  return Array.from(variants);
}

// Single source of truth for how much a token's discriminating power should count in ANY
// feature derived from it (unigram, bigram, compound, ...). A stop/generic word is deliberately
// down-weighted here so that every feature built from it -- not just `tok:` -- inherits the
// same discount. Multi-token features scale their base weight by the specificity of each
// constituent token (see tokenSpecificityFactor) instead of using their own flat constant, so a
// bigram containing a generic word can never outscore a specific single-token match the way a
// hardcoded flat bigram weight could.
const UNIGRAM_SPECIFIC_WEIGHT = 1.4;
const UNIGRAM_GENERIC_WEIGHT = 0.65;
const UNIGRAM_STOP_WEIGHT = 0.15;
const BASE_BIGRAM_WEIGHT = 1.55;
const BASE_COMPOUND_WEIGHT = 1.25;

function tokenWeight(token: string, locale: string): number {
  if (isStopQueryToken(token, locale) || isSafeJobLevelModifierToken(token, locale)) {
    return UNIGRAM_STOP_WEIGHT;
  }

  if (isGenericQueryToken(token, locale)) {
    return UNIGRAM_GENERIC_WEIGHT;
  }

  return UNIGRAM_SPECIFIC_WEIGHT;
}

function tokenSpecificityFactor(token: string, locale: string): number {
  return tokenWeight(token, locale) / UNIGRAM_SPECIFIC_WEIGHT;
}

function usefulAliasTokens(tokens: string[], locale: string): string[] {
  return tokens.filter((token) => !isStopQueryToken(token, locale) && !isSafeJobLevelModifierToken(token, locale));
}

function characterNgrams(token: string, size: number): string[] {
  if (token.length < size) {
    return [];
  }

  const grams: string[] = [];

  for (let index = 0; index <= token.length - size; index += 1) {
    grams.push(token.slice(index, index + size));
  }

  return grams;
}

function addFeature(counts: Map<string, number>, feature: string, weight: number): void {
  counts.set(feature, (counts.get(feature) ?? 0) + weight);
}

function countDocumentFrequency(featureCounts: Array<Map<string, number>>): Map<string, number> {
  const df = new Map<string, number>();

  for (const counts of featureCounts) {
    for (const feature of counts.keys()) {
      df.set(feature, (df.get(feature) ?? 0) + 1);
    }
  }

  return df;
}

function countQueryDocumentFrequency(index: AliasNgramIndex, queryFeatures: Map<string, number>): Map<string, number> {
  const df = new Map<string, number>();

  for (const feature of queryFeatures.keys()) {
    df.set(feature, index.postingsByFeature.get(feature)?.length ?? 0);
  }

  return df;
}

function weightFeatures(counts: Map<string, number>, documentFrequency: Map<string, number>, documentCount: number): Map<string, number> {
  const weighted = new Map<string, number>();

  for (const [feature, count] of counts) {
    const df = documentFrequency.get(feature) ?? 0;
    const idf = Math.log(1 + (documentCount + 1) / (df + 1));
    weighted.set(feature, count * idf);
  }

  return weighted;
}

function buildPostings(entries: AliasNgramEntry[]): Map<string, number[]> {
  const postings = new Map<string, number[]>();

  for (const entry of entries) {
    for (const feature of entry.weightedFeatures.keys()) {
      const ids = postings.get(feature) ?? [];
      ids.push(entry.index);
      postings.set(feature, ids);
    }
  }

  return postings;
}

function candidateEntryIds(index: AliasNgramIndex, queryFeatures: Map<string, number>): Set<number> {
  const ids = new Set<number>();
  const orderedFeatures = Array.from(queryFeatures.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([feature]) => feature);

  for (const feature of orderedFeatures) {
    const postings = index.postingsByFeature.get(feature) ?? [];

    if (postings.length > MAX_FEATURE_POSTING_SCAN) {
      continue;
    }

    for (const id of postings) {
      ids.add(id);
    }
  }

  return ids;
}

function vectorNorm(features: Map<string, number>): number {
  let sum = 0;

  for (const value of features.values()) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

function dotProduct(left: Map<string, number>, right: Map<string, number>): number {
  let sum = 0;
  const [smaller, larger] = left.size < right.size ? [left, right] : [right, left];

  for (const [feature, value] of smaller) {
    sum += value * (larger.get(feature) ?? 0);
  }

  return sum;
}

function topMatchedFeatures(left: Map<string, number>, right: Map<string, number>, limit: number): string[] {
  const matches: Array<{ feature: string; score: number }> = [];

  for (const [feature, leftWeight] of left) {
    const rightWeight = right.get(feature);

    if (rightWeight === undefined) {
      continue;
    }

    matches.push({ feature, score: leftWeight * rightWeight });
  }

  return matches
    .sort((leftMatch, rightMatch) => rightMatch.score - leftMatch.score || leftMatch.feature.localeCompare(rightMatch.feature))
    .slice(0, limit)
    .map((match) => match.feature);
}

function countBinaryQueryDocumentFrequency(index: BinaryAliasNgramIndex, queryFeatures: Map<string, number>): Map<string, number> {
  const df = new Map<string, number>();

  for (const feature of queryFeatures.keys()) {
    const featureId = binaryStringId(index, feature);
    df.set(feature, featureId >= 0 ? binaryFeaturePostings(index, featureId).length : 0);
  }

  return df;
}

function binaryCandidateEntryIds(index: BinaryAliasNgramIndex, queryFeatures: Map<string, number>): Set<number> {
  const ids = new Set<number>();
  const orderedFeatures = Array.from(queryFeatures.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([feature]) => feature);

  for (const feature of orderedFeatures) {
    const featureId = binaryStringId(index, feature);
    const postings = featureId >= 0 ? binaryFeaturePostings(index, featureId) : [];

    if (postings.length > MAX_FEATURE_POSTING_SCAN) {
      continue;
    }

    for (const id of postings) {
      ids.add(id);
    }
  }

  return ids;
}

function binaryDotProduct(index: BinaryAliasNgramIndex, entryId: number, queryFeatures: Map<number, number>): number {
  let sum = 0;
  const offset = rowValue(index.rows, entryId, 12);
  const length = rowValue(index.rows, entryId, 13);

  for (let cursor = offset; cursor < offset + length; cursor += 1) {
    const featureId = rowValue(index.featureValues, cursor, 0);
    const queryWeight = queryFeatures.get(featureId);

    if (queryWeight === undefined) {
      continue;
    }

    sum += queryWeight * (rowValue(index.featureValues, cursor, 1) / ALIAS_NGRAM_WEIGHT_SCALE);
  }

  return sum;
}

type BinaryQueryFeatureMap = {
  featureById: Map<number, string>;
  weightsByFeatureId: Map<number, number>;
};

function binaryQueryFeatureMap(index: BinaryAliasNgramIndex, queryFeatures: Map<string, number>): BinaryQueryFeatureMap {
  const featureById = new Map<number, string>();
  const weightsByFeatureId = new Map<number, number>();

  for (const [feature, weight] of queryFeatures) {
    const featureId = binaryStringId(index, feature);

    if (featureId < 0) {
      continue;
    }

    featureById.set(featureId, feature);
    weightsByFeatureId.set(featureId, weight);
  }

  return { featureById, weightsByFeatureId };
}

function binaryTopMatchedFeatures(
  index: BinaryAliasNgramIndex,
  entryId: number,
  queryFeatures: BinaryQueryFeatureMap,
  limit: number
): string[] {
  const matches: Array<{ feature: string; score: number }> = [];
  const offset = rowValue(index.rows, entryId, 12);
  const length = rowValue(index.rows, entryId, 13);

  for (let cursor = offset; cursor < offset + length; cursor += 1) {
    const featureId = rowValue(index.featureValues, cursor, 0);
    const queryWeight = queryFeatures.weightsByFeatureId.get(featureId);

    if (queryWeight === undefined) {
      continue;
    }

    matches.push({
      feature: queryFeatures.featureById.get(featureId) ?? '',
      score: queryWeight * (rowValue(index.featureValues, cursor, 1) / ALIAS_NGRAM_WEIGHT_SCALE)
    });
  }

  return matches
    .sort((left, right) => right.score - left.score || left.feature.localeCompare(right.feature))
    .slice(0, limit)
    .map((match) => match.feature);
}

function tokenTextToTokens(value: string): string[] {
  return value ? value.split('\n').filter(Boolean) : [];
}

function nullableU32(value: number): number | null {
  return value === ALIAS_NGRAM_NULL_U32 ? null : value;
}

function nullableScaled(value: number): number | null {
  return value === ALIAS_NGRAM_NULL_U32 ? null : value / ALIAS_NGRAM_WEIGHT_SCALE;
}

function nullableString(index: BinaryAliasNgramIndex, value: number): string | null {
  return value === ALIAS_NGRAM_NULL_U32 ? null : binaryStringAt(index, value);
}
