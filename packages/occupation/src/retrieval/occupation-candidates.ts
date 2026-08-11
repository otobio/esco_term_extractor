import type { Connection, RowDataPacket } from 'mysql2/promise';
import { readOptionalEnv } from '../config/env.js';
import {
  containsTokenPhrase,
  expandTokenVariants,
  foldSearchLookupText,
  foldSearchText,
  isUsefulQueryToken,
  longestContiguousTokenMatch,
  normalizeSearchText,
  normalizeQueryLocale,
  prepareQuery,
  tokenizeNormalizedText,
  type PreparedQuery
} from '../query/query-preparation.js';
import { isHighConfidenceEnglishSurfaceQueryFromProfiles } from '../query/english-surface-detection.js';
import { ALIAS_MATCH_POLICY, CAPABILITY_TASK_POLICY, RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT } from '../scoring/scoring-policy.js';
import {
  prepareOccupationRetrievalQuery,
  type OccupationRoleSpanSelection,
  type PreparedOccupationRetrievalQuery
} from '../query/occupation-retrieval-query.js';
import { createRetrievalEngine } from './retrieval-engine-factory.js';
import { retrieveBinaryAliasNgramHits, type AliasNgramHit } from './alias-ngram-retriever.js';
import {
  loadOccupationAliasNgramBinaryIfAvailable,
  type BinaryAliasNgramIndex
} from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import type {
  AliasEvidenceRow,
  AliasRetrievalEngine,
  CanonicalLabelHit,
  OccupationRetrievalEngine,
  OccupationTextHit,
  OccupationTextRetrievalEngine
} from './retrieval-engine.js';
import { timed, type TimingMap } from '../utils/timing.js';
import { requirePositiveIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';

export const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
export const DEFAULT_RETRIEVAL_LOCALE = 'en';
export const DEFAULT_MODEL_KEY = 'none';
export const DEFAULT_CANDIDATE_LIMIT = 10;
export const DEFAULT_RETRIEVAL_PROFILE = 'occupation_hybrid_v1' as const;
export const LEGACY_LEXICAL_BACKEND_LABEL = 'hybrid' as const;

export function retrievalSurfaceLocales(locale: string): string[] {
  const primaryLocale = normalizeLocale(locale);
  const locales = [primaryLocale];

  if (primaryLocale !== DEFAULT_RETRIEVAL_LOCALE) {
    locales.push(DEFAULT_RETRIEVAL_LOCALE);
  }

  return Array.from(new Set(locales));
}

export type RetrievalChannel = 'exact_canonical' | 'exact_alias' | 'folded_alias' | 'ngram_alias' | 'lexical' | 'capability_task';
export type RetrievalProfile = typeof DEFAULT_RETRIEVAL_PROFILE;

export type RetrieveOccupationCandidatesOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  modelKey?: string;
  limit?: number;
  evaluationQueryId?: number;
  retrievalQuery?: PreparedOccupationRetrievalQuery;
  preparedQuery?: PreparedQuery;
};

export type CandidateEvidenceRecord = {
  channel: RetrievalChannel;
  score: number;
  alias?: string;
  normalizedAlias?: string;
  foldedAlias?: string;
  aliasRole?: string;
  aliasWeight?: number | null;
  cosine?: number;
  dot?: number;
  textRole?: string;
  details?: Record<string, unknown>;
};

export type RetrievedOccupationCandidate = {
  graphNodeId: number;
  canonicalLabel: string;
  totalScore: number;
  channelScores: Partial<Record<RetrievalChannel, number>>;
  evidence: CandidateEvidenceRecord[];
};

export type RetrieveOccupationCandidatesResult = {
  originalQuery: string;
  query: string;
  querySpans: string[];
  locale: string;
  retrievalLocales: string[];
  normalizedQuery: string;
  foldedQuery: string;
  preparedQuery: PreparedQuery;
  querySignals: string[];
  keptQuerySignals: string[];
  querySignalCleaningMs: number;
  roleSpanSelection: OccupationRoleSpanSelection | null;
  sourceName: string;
  retrievalProfile: RetrievalProfile;
  modelKey: string;
  modelDimensions: number | null;
  limit: number;
  evaluationQueryId: number | null;
  scannedAliasHitCount: number;
  scannedOpenSearchHitCount: number;
  timings: TimingMap;
  candidates: RetrievedOccupationCandidate[];
};

type EvaluationQueryRow = RowDataPacket & {
  id: number;
  locale_code: string;
  query_text: string;
};

type AliasNgramScoredRow = AliasNgramHit;

type RetrievalSurface = {
  locale: string;
  preparedQuery: PreparedQuery;
  exactAliasQueries: string[];
  foldedAliasQueries: Set<string>;
};

type SubphraseAliasMatch = AliasEvidenceRow & {
  foldedAlias: string;
  matchType: 'alias_alternative_exact' | 'alias_in_query' | 'query_in_alias';
  matchedTokens: string[];
  aliasTokenCount: number;
  queryTokenCount: number;
  subphraseScore: number;
};

type CandidateAccumulator = {
  graphNodeId: number;
  canonicalLabel: string;
  evidence: CandidateEvidenceRecord[];
};

export class OccupationCandidateRetriever {
  public constructor(
    private readonly connection: Connection | null = null,
    private readonly occupationRetriever: OccupationTextRetrievalEngine = createRetrievalEngine().occupations,
    private readonly aliasRetriever: AliasRetrievalEngine = createRetrievalEngine().aliases
  ) {}

  public static withEngine(connection: Connection | null, engine: OccupationRetrievalEngine): OccupationCandidateRetriever {
    return new OccupationCandidateRetriever(connection, engine.occupations, engine.aliases);
  }

  public async run(options: RetrieveOccupationCandidatesOptions): Promise<RetrieveOccupationCandidatesResult> {
    if (!options.retrievalQuery) {
      throw new Error('Missing required query input. Provide --retrieval-query');
    }

    const sourceName = normalizeSourceName(options.sourceName);
    const limit = normalizeLimit(options.limit);
    const timings: TimingMap = {};
    const evaluationQuery = await this.resolveEvaluationQuery(options.evaluationQueryId);
    const locale = normalizeLocale(evaluationQuery?.locale_code ?? options.locale);
    const modelKey = normalizeModelKey(options.modelKey);
    const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
    const retrievalQuery = options.retrievalQuery;
    const preparedQuery = options.preparedQuery || retrievalQuery.preparedQuery;
    const retrievalSurfaces = await prepareRetrievalSurfaces(sourceName, retrievalQuery.query, locale, preparedQuery, timings);
    const retrievalLocales = retrievalSurfaces.map((surface) => surface.locale);
    const exactRows: AliasEvidenceRow[] = [];
    const foldedRows: AliasEvidenceRow[] = [];
    const subphraseMatches: SubphraseAliasMatch[] = [];
    const ngramMatches: AliasNgramScoredRow[] = [];
    const openSearchRows: OccupationTextHit[] = [];
    let scannedAliasHitCount = 0;
    let hasWholeAlias = false;

    for (const surface of retrievalSurfaces) {
      const rawSurfacePreparedQuery =
        retrievalQuery.originalQuery === retrievalQuery.query
          ? surface.preparedQuery
          : await timed(
              () => prepareQuery(retrievalQuery.originalQuery, surface.locale, { sourceName }),
              'candidate.raw_canonical_prepare',
              timings
            );
      const aliasRetrieval = await timed(
        () =>
          this.aliasRetriever.retrieve({
            sourceName,
            locale: surface.locale,
            preparedQuery: surface.preparedQuery,
            exactAliasQueries: surface.exactAliasQueries,
            foldedAliasQueries: Array.from(surface.foldedAliasQueries),
            limit
          }),
        'candidate.alias_retrieval',
        timings
      );
      const canonicalLabelRows = await timed(
        () =>
          this.occupationRetriever.retrieveCanonicalLabels({
            query: retrievalQuery.query,
            locale: surface.locale,
            sourceName,
            preparedQuery: surface.preparedQuery,
            foldedQueries: Array.from(surface.foldedAliasQueries),
            limit
          }),
        'candidate.canonical_label_retrieval',
        timings
      );
      const rawCanonicalLabelRows =
        retrievalQuery.originalQuery === retrievalQuery.query
          ? []
          : await timed(
              () =>
                this.occupationRetriever.retrieveCanonicalLabels({
                  query: retrievalQuery.originalQuery,
                  locale: surface.locale,
                  sourceName,
                  preparedQuery: rawSurfacePreparedQuery,
                  foldedQueries: [foldSearchLookupText(rawSurfacePreparedQuery.normalized)],
                  limit: Math.min(limit, 5)
                }),
              'candidate.raw_canonical_label_retrieval',
              timings
            );
      const lexicalRows = await timed(
        () =>
          this.occupationRetriever.retrieve({
            query: retrievalQuery.query,
            locale: surface.locale,
            sourceName,
            preparedQuery: surface.preparedQuery,
            limit
          }),
        'candidate.lexical_retrieval',
        timings
      );
      const canonicalEvidence = partitionCanonicalLabelEvidence(canonicalLabelRows, surface.exactAliasQueries, surface.foldedAliasQueries);
      const rawCanonicalEvidence = partitionCanonicalLabelEvidence(
        rawCanonicalLabelRows,
        [rawSurfacePreparedQuery.normalized],
        new Set([foldSearchLookupText(rawSurfacePreparedQuery.normalized)])
      );
      const foldedMatches = aliasRetrieval.foldedRows.filter(
        (row) =>
          row.normalized_alias !== retrievalQuery.normalizedQuery &&
          surface.foldedAliasQueries.has(foldSearchLookupText(row.normalized_alias))
      );

      exactRows.push(...canonicalEvidence.exactRows, ...rawCanonicalEvidence.exactRows, ...aliasRetrieval.exactRows);
      foldedRows.push(...canonicalEvidence.foldedRows, ...rawCanonicalEvidence.foldedRows, ...foldedMatches);
      subphraseMatches.push(...findSubphraseAliasMatches(aliasRetrieval.subphraseRows, surface.preparedQuery));
      openSearchRows.push(...lexicalRows);
      scannedAliasHitCount += aliasRetrieval.scannedAliasHitCount + canonicalLabelRows.length + rawCanonicalLabelRows.length;
      hasWholeAlias =
        hasWholeAlias ||
        hasWholeAliasEvidence(canonicalEvidence, aliasRetrieval.exactRows, foldedMatches) ||
        hasWholeAliasEvidence(rawCanonicalEvidence, [], []);
    }

    if (!hasWholeAlias) {
      for (const surface of retrievalSurfaces) {
        ngramMatches.push(...(await this.retrieveAliasNgramMatches(sourceName, surface.preparedQuery, limit, timings)));
      }
    }

    const candidates = await timed(
      () => this.buildCandidates(exactRows, foldedRows, subphraseMatches, ngramMatches, openSearchRows),
      'candidate.build_candidates',
      timings
    );

    return {
      originalQuery: retrievalQuery.originalQuery,
      query: retrievalQuery.query,
      querySpans: retrievalQuery.querySpans,
      locale: retrievalQuery.locale,
      retrievalLocales,
      normalizedQuery: retrievalQuery.normalizedQuery,
      foldedQuery: retrievalQuery.foldedQuery,
      preparedQuery,
      querySignals: retrievalQuery.querySignals,
      keptQuerySignals: retrievalQuery.keptQuerySignals,
      querySignalCleaningMs: retrievalQuery.querySignalCleaningMs,
      roleSpanSelection: retrievalQuery.roleSpanSelection,
      sourceName,
      retrievalProfile,
      modelKey,
      modelDimensions: null,
      limit,
      evaluationQueryId: evaluationQuery?.id ?? null,
      scannedAliasHitCount,
      scannedOpenSearchHitCount: openSearchRows.length,
      timings,
      candidates
    };
  }

  private async resolveEvaluationQuery(evaluationQueryId: number | undefined): Promise<EvaluationQueryRow | null> {
    if (evaluationQueryId === undefined) {
      return null;
    }

    if (!this.connection) {
      throw new Error('--evaluation-query-id requires a MySQL connection. Runtime query mode should pass --query instead.');
    }

    const [rows] = await this.connection.query<EvaluationQueryRow[]>(
      `
        SELECT
          id,
          locale_code,
          query_text
        FROM ose_evaluation_queries
        WHERE id = ?
        LIMIT 1
      `,
      [evaluationQueryId]
    );

    const row = rows[0] ?? null;

    if (!row) {
      throw new Error(`No evaluation query found for --evaluation-query-id=${evaluationQueryId}.`);
    }

    return row;
  }

  private async retrieveAliasNgramMatches(
    sourceName: string,
    preparedQuery: PreparedQuery,
    limit: number,
    timings: TimingMap
  ): Promise<AliasNgramScoredRow[]> {
    if (!isAliasNgramRetrievalEnabled()) {
      return [];
    }

    const scoringQuery =
      preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedTokens.join(' ').trim() || preparedQuery.normalized;
    const scoringPreparedQuery =
      scoringQuery === preparedQuery.raw
        ? preparedQuery
        : await timed(() => prepareQuery(scoringQuery, preparedQuery.locale, { sourceName }), 'candidate.alias_ngram_prepare', timings);
    const index = await timed(() => loadAliasNgramIndex(sourceName, preparedQuery.locale), 'candidate.alias_ngram_index_load', timings);

    return timed(
      () => retrieveAliasNgramRuntimeHits(index, scoringPreparedQuery, { limit: Math.max(limit * 3, 25) }),
      'candidate.alias_ngram_retrieval',
      timings
    );
  }

  private buildCandidates(
    exactRows: AliasEvidenceRow[],
    foldedRows: AliasEvidenceRow[],
    subphraseRows: SubphraseAliasMatch[],
    ngramRows: AliasNgramScoredRow[],
    openSearchRows: OccupationTextHit[]
  ): RetrievedOccupationCandidate[] {
    const candidatesByNodeId = new Map<number, CandidateAccumulator>();

    for (const row of exactRows) {
      const channel: RetrievalChannel = row.alias_role === 'canonical_label' ? 'exact_canonical' : 'exact_alias';
      addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
        channel,
        ...aliasEvidenceDetails(row),
        score: roundScore(toNullableNumber(row.weight) ?? 1)
      });
    }

    for (const row of foldedRows) {
      const aliasWeight = toNullableNumber(row.weight);

      addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
        channel: 'folded_alias',
        ...aliasEvidenceDetails(row),
        score: roundScore((aliasWeight ?? 1) * ALIAS_MATCH_POLICY.FOLDED_EXACT_DISCOUNT),
        foldedAlias: foldSearchText(row.normalized_alias)
      });
    }

    for (const row of subphraseRows) {
      const aliasWeight = toNullableNumber(row.weight);
      const downgradeWeakAliasInQuery = shouldDowngradeWeakAliasInQuery(row);
      const channel: RetrievalChannel = row.matchType === 'query_in_alias' || downgradeWeakAliasInQuery ? 'lexical' : 'folded_alias';

      addEvidence(candidatesByNodeId, row.graph_node_id, row.canonical_label, {
        channel,
        ...aliasEvidenceDetails(row),
        score: roundScore((aliasWeight ?? 1) * row.subphraseScore),
        foldedAlias: row.foldedAlias,
        details: {
          ...aliasAuthorityDetails(row),
          match_type: row.matchType,
          downgraded_weak_alias_in_query: downgradeWeakAliasInQuery,
          matched_tokens: row.matchedTokens,
          alias_token_count: row.aliasTokenCount,
          query_token_count: row.queryTokenCount
        }
      });
    }

    for (const row of ngramRows) {
      addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, {
        channel: 'ngram_alias',
        score: row.score,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
        aliasRole: row.aliasRole,
        aliasWeight: row.aliasWeight,
        cosine: row.cosine,
        details: {
          family_node_id: row.familyNodeId,
          family_label: row.familyLabel,
          token_coverage: row.tokenCoverage,
          useful_token_coverage: row.usefulTokenCoverage,
          matched_tokens: row.matchedTokens,
          matched_features: row.matchedFeatures
        }
      });
    }

    for (const row of openSearchRows) {
      addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, {
        channel: 'lexical',
        score: row.score,
        details: {
          raw_score: row.rawScore,
          normalized_raw_score: row.normalizedRawScore,
          lexical_signal_score: row.lexicalSignalScore,
          matched_queries: row.matchedQueries,
          matched_fields: row.matchedFields,
          matched_tokens: row.matchedTokens,
          phrase_match: row.phraseMatch,
          field_signals: row.fieldSignals,
          max_useful_token_coverage: row.maxUsefulTokenCoverage,
          query_token_count: row.queryTokenCount,
          useful_query_token_count: row.usefulQueryTokenCount
        }
      });

      const capabilityEvidence = buildCapabilityTaskEvidence(row);

      if (capabilityEvidence) {
        addEvidence(candidatesByNodeId, row.graphNodeId, row.canonicalLabel, capabilityEvidence);
      }
    }

    // Each channel above already bounded its own retrieval to the caller's `limit` (or `limit * 3`
    // for ngram_alias) at the source, so this merged/deduped set is a per-channel top-K union, not
    // an unbounded scan. Re-slicing it here by blended totalScore would throw away exactly the
    // channel-diverse candidates that union was built to preserve, so the full merged set is returned.
    return Array.from(candidatesByNodeId.values())
      .map((candidate) => finalizeCandidate(candidate))
      .sort(
        (left, right) =>
          right.totalScore - left.totalScore ||
          (right.channelScores.exact_canonical ?? 0) - (left.channelScores.exact_canonical ?? 0) ||
          (right.channelScores.exact_alias ?? 0) - (left.channelScores.exact_alias ?? 0) ||
          (right.channelScores.folded_alias ?? 0) - (left.channelScores.folded_alias ?? 0) ||
          (right.channelScores.ngram_alias ?? 0) - (left.channelScores.ngram_alias ?? 0) ||
          (right.channelScores.lexical ?? 0) - (left.channelScores.lexical ?? 0) ||
          (right.channelScores.capability_task ?? 0) - (left.channelScores.capability_task ?? 0) ||
          left.canonicalLabel.localeCompare(right.canonicalLabel)
      );
  }
}

async function prepareRetrievalSurfaces(
  sourceName: string,
  query: string,
  locale: string,
  preparedQuery: PreparedQuery,
  timings: TimingMap
): Promise<RetrievalSurface[]> {
  const surfaceLocales = (await shouldUseEnglishOnlyRetrievalSurface(sourceName, locale, preparedQuery))
    ? [DEFAULT_RETRIEVAL_LOCALE]
    : retrievalSurfaceLocales(locale);
  const surfaces: RetrievalSurface[] = [];

  for (const surfaceLocale of surfaceLocales) {
    const surfacePreparedQuery =
      surfaceLocale === preparedQuery.locale
        ? preparedQuery
        : await timed(() => prepareQuery(query, surfaceLocale, { sourceName }), 'candidate.secondary_surface_prepare', timings);

    surfaces.push({
      locale: surfaceLocale,
      preparedQuery: surfacePreparedQuery,
      exactAliasQueries: exactAliasQueriesForPreparedQuery(surfacePreparedQuery),
      foldedAliasQueries: foldedAliasQueriesForPreparedQuery(surfacePreparedQuery)
    });
  }

  return surfaces;
}

async function shouldUseEnglishOnlyRetrievalSurface(sourceName: string, locale: string, preparedQuery: PreparedQuery): Promise<boolean> {
  const normalizedLocale = normalizeQueryLocale(locale);

  if (normalizedLocale === DEFAULT_RETRIEVAL_LOCALE) {
    return false;
  }

  const foldedTokens = preparedQuery.foldedTokens;

  if (foldedTokens.length < 2 || foldedTokens.length > 5) {
    return false;
  }

  if (!foldedTokens.every((token) => /^[a-z0-9]+$/u.test(token))) {
    return false;
  }

  const artifact = await loadOccupationIntentVocabularyArtifactRequired(sourceName);
  const englishProfile =
    artifact.artifact.resolveLocaleProfile?.(DEFAULT_RETRIEVAL_LOCALE) ??
    artifact.artifact.localeProfiles.find((profile) => profile.localeCode === DEFAULT_RETRIEVAL_LOCALE) ??
    null;
  const activeLocaleProfile =
    artifact.artifact.resolveLocaleProfile?.(normalizedLocale) ??
    artifact.artifact.localeProfiles.find((profile) => profile.localeCode === normalizedLocale) ??
    null;

  if (!englishProfile || !activeLocaleProfile) {
    return false;
  }

  return isHighConfidenceEnglishSurfaceQueryFromProfiles(
    foldedTokens,
    englishProfile,
    activeLocaleProfile,
    preparedQuery.intent.confidence
  );
}

export function isAliasNgramRetrievalEnabled(): boolean {
  const disableValue = readOptionalEnv('OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL')?.toLowerCase();

  if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
    return false;
  }

  const enableValue = readOptionalEnv('OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL')?.toLowerCase();
  return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}

/**
 * The binary artifact module already caches and version-checks the loaded
 * index by manifest path and disposes it (closing its file descriptors) on
 * eviction. A second cache here previously wrapped the same resource with
 * its own, uncoordinated eviction policy; once the lower cache disposed an
 * entry this one kept handing out the now-closed object, causing EBADF /
 * stale-fd reads under concurrent multi-locale traffic. Delegate straight
 * through so there is a single owner of the resource's lifetime.
 */
function loadAliasNgramIndex(sourceName: string, locale: string): Promise<BinaryAliasNgramIndex> {
  return loadAliasNgramRuntimeIndex(sourceName, locale, isAliasNgramFamilySupportEnabled());
}

async function loadAliasNgramRuntimeIndex(
  sourceName: string,
  locale: string,
  includeFamilySupportingAliases: boolean
): Promise<BinaryAliasNgramIndex> {
  const binaryIndex = await loadOccupationAliasNgramBinaryIfAvailable(sourceName, locale, includeFamilySupportingAliases);

  if (binaryIndex) {
    return binaryIndex;
  }

  throw new Error(
    [
      `Missing required binary alias-ngram artifact for source="${sourceName}" locale="${locale}".`,
      `family_support=${includeFamilySupportingAliases ? 'yes' : 'no'}`,
      'Run `npm run runtime:artifacts-build` before runtime resolution.'
    ].join(' ')
  );
}

function retrieveAliasNgramRuntimeHits(
  runtimeIndex: BinaryAliasNgramIndex,
  preparedQuery: PreparedQuery,
  options: { limit: number }
): AliasNgramHit[] {
  return retrieveBinaryAliasNgramHits(runtimeIndex, preparedQuery, options);
}

export function isAliasNgramFamilySupportEnabled(): boolean {
  const disableValue = readOptionalEnv('OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT')?.toLowerCase();

  if (disableValue === '1' || disableValue === 'true' || disableValue === 'yes') {
    return false;
  }

  const enableValue = readOptionalEnv('OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT')?.toLowerCase();
  return enableValue !== '0' && enableValue !== 'false' && enableValue !== 'no';
}

function partitionCanonicalLabelEvidence(
  rows: CanonicalLabelHit[],
  exactQueries: string[],
  foldedQueries: Set<string>
): { exactRows: AliasEvidenceRow[]; foldedRows: AliasEvidenceRow[] } {
  const exactQuerySet = new Set(exactQueries);
  const exactRows: AliasEvidenceRow[] = [];
  const foldedRows: AliasEvidenceRow[] = [];

  for (const row of rows) {
    const evidenceRow: AliasEvidenceRow = {
      graph_node_id: row.graphNodeId,
      canonical_label: row.canonicalLabel,
      alias: row.canonicalLabel,
      normalized_alias: row.normalizedLabel,
      alias_role: 'canonical_label',
      alias_role_rank: null,
      weight: 1,
      alias_authority_score: null,
      alias_token_count: null
    };

    if (exactQuerySet.has(row.normalizedLabel)) {
      exactRows.push(evidenceRow);
      continue;
    }

    if (foldedQueries.has(foldSearchLookupText(row.normalizedLabel))) {
      foldedRows.push(evidenceRow);
    }
  }

  return { exactRows, foldedRows };
}

function hasWholeAliasEvidence(
  canonicalEvidence: { exactRows: AliasEvidenceRow[]; foldedRows: AliasEvidenceRow[] },
  exactAliasRows: AliasEvidenceRow[],
  foldedAliasRows: AliasEvidenceRow[]
): boolean {
  return (
    canonicalEvidence.exactRows.length > 0 ||
    exactAliasRows.length > 0 ||
    canonicalEvidence.foldedRows.length > 0 ||
    foldedAliasRows.length > 0
  );
}

function aliasAuthorityDetails(row: AliasEvidenceRow): Record<string, unknown> {
  return {
    alias_role_rank: row.alias_role_rank,
    alias_authority_score: row.alias_authority_score,
    indexed_alias_token_count: row.alias_token_count
  };
}

function aliasEvidenceDetails(row: AliasEvidenceRow): Omit<CandidateEvidenceRecord, 'channel' | 'score'> {
  return {
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    aliasRole: row.alias_role,
    aliasWeight: toNullableNumber(row.weight),
    details: aliasAuthorityDetails(row)
  };
}

function findSubphraseAliasMatches(rows: AliasEvidenceRow[], preparedQuery: PreparedQuery): SubphraseAliasMatch[] {
  const queryTokens = preparedQuery.foldedTokens;
  const usefulQueryTokens = preparedQuery.usefulFoldedTokens;
  const queryTokenCount = queryTokens.length;
  const matches: SubphraseAliasMatch[] = findExactAliasAlternativeMatches(rows, preparedQuery);
  const seen = new Set<string>();

  if (queryTokenCount < 2 || usefulQueryTokens.length === 0) {
    return matches;
  }

  for (const row of rows) {
    if (row.normalized_alias === preparedQuery.normalized) {
      continue;
    }

    const foldedAlias = foldSearchText(row.normalized_alias);

    if (foldedAlias === preparedQuery.folded) {
      continue;
    }

    const aliasTokens = tokenizeNormalizedText(foldedAlias);
    const usefulAliasTokens = aliasTokens.filter((token) => isUsefulQueryToken(token, preparedQuery.locale));

    if (!isSafeSubphraseAlias(usefulAliasTokens)) {
      continue;
    }

    const aliasInQuery = containsTokenPhrase(usefulQueryTokens, usefulAliasTokens, preparedQuery.locale);
    const queryInAlias = containsTokenPhrase(usefulAliasTokens, usefulQueryTokens, preparedQuery.locale);
    const longestMatch = longestContiguousTokenMatch(usefulQueryTokens, usefulAliasTokens, preparedQuery.locale);

    if (!aliasInQuery && !queryInAlias) {
      continue;
    }

    const key = `${row.graph_node_id}|${foldedAlias}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matches.push({
      ...row,
      foldedAlias,
      matchType: aliasInQuery ? 'alias_in_query' : 'query_in_alias',
      matchedTokens: longestMatch,
      aliasTokenCount: usefulAliasTokens.length,
      queryTokenCount: usefulQueryTokens.length,
      subphraseScore: scoreSubphraseAlias(usefulAliasTokens.length, usefulQueryTokens.length, aliasInQuery, longestMatch.length)
    });
  }

  return matches.sort(
    (left, right) =>
      right.subphraseScore - left.subphraseScore ||
      (toNullableNumber(right.weight) ?? 0) - (toNullableNumber(left.weight) ?? 0) ||
      left.canonical_label.localeCompare(right.canonical_label)
  );
}

function findExactAliasAlternativeMatches(rows: AliasEvidenceRow[], preparedQuery: PreparedQuery): SubphraseAliasMatch[] {
  const usefulQueryTokens = preparedQuery.usefulFoldedTokens;
  const matches: SubphraseAliasMatch[] = [];
  const seen = new Set<string>();

  if (usefulQueryTokens.length === 0) {
    return matches;
  }

  for (const row of rows) {
    for (const aliasAlternative of foldedAliasAlternatives(row.normalized_alias)) {
      const alternativeTokens = tokenizeNormalizedText(aliasAlternative).filter((token) => isUsefulQueryToken(token, preparedQuery.locale));

      if (alternativeTokens.length === 0 || !sameTokenPhrase(alternativeTokens, usefulQueryTokens, preparedQuery.locale)) {
        continue;
      }

      const key = `${row.graph_node_id}|${aliasAlternative}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      matches.push({
        ...row,
        foldedAlias: aliasAlternative,
        matchType: 'alias_alternative_exact',
        matchedTokens: alternativeTokens,
        aliasTokenCount: alternativeTokens.length,
        queryTokenCount: usefulQueryTokens.length,
        subphraseScore: ALIAS_MATCH_POLICY.ALTERNATIVE_EXACT_SUBPHRASE_SCORE
      });
    }
  }

  return matches;
}

function foldedAliasAlternatives(normalizedAlias: string): string[] {
  if (!/[\u002f,;|]/u.test(normalizedAlias)) {
    return [];
  }

  return Array.from(
    new Set(
      normalizedAlias
        .split(/[\u002f,;|]/u)
        .map((part) => foldSearchText(normalizeSearchText(part)))
        .filter(Boolean)
    )
  );
}

function sameTokenPhrase(leftTokens: string[], rightTokens: string[], locale: string): boolean {
  return leftTokens.length === rightTokens.length && containsTokenPhrase(leftTokens, rightTokens, locale);
}

function exactAliasQueriesForPreparedQuery(preparedQuery: PreparedQuery): string[] {
  return Array.from(
    new Set([
      ...expandQueryTokenSequence(preparedQuery.tokens, preparedQuery.locale),
      ...expandQueryTokenSequence(preparedQuery.usefulTokens, preparedQuery.locale)
    ])
  );
}

function foldedAliasQueriesForPreparedQuery(preparedQuery: PreparedQuery): Set<string> {
  return new Set(
    [
      ...expandQueryTokenSequence(preparedQuery.foldedTokens, preparedQuery.locale),
      ...expandQueryTokenSequence(preparedQuery.usefulFoldedTokens, preparedQuery.locale)
    ].map((query) => foldSearchLookupText(query))
  );
}

function expandQueryTokenSequence(tokens: string[], locale: string): string[] {
  const maxVariantQueries = 24;

  if (tokens.length === 0 || tokens.length > 5) {
    return [tokens.join(' ')].filter(Boolean);
  }

  let phrases = [''];

  for (const token of tokens) {
    const tokenVariants = expandTokenVariants([token], locale);
    const nextPhrases: string[] = [];

    for (const phrase of phrases) {
      for (const variant of tokenVariants) {
        nextPhrases.push(`${phrase} ${variant}`.trim());
      }
    }

    phrases = Array.from(new Set(nextPhrases)).slice(0, maxVariantQueries);

    if (phrases.length >= maxVariantQueries) {
      break;
    }
  }

  return Array.from(new Set(phrases));
}

function isSafeSubphraseAlias(aliasTokens: string[]): boolean {
  if (aliasTokens.length >= 2) {
    return aliasTokens.some((token) => token.length >= 4);
  }

  const token = aliasTokens[0] ?? '';
  return token.length >= 6;
}

function scoreSubphraseAlias(
  aliasTokenCount: number,
  queryTokenCount: number,
  aliasInQuery: boolean,
  longestMatchTokenCount: number
): number {
  const coverage = aliasInQuery ? aliasTokenCount / Math.max(queryTokenCount, 1) : queryTokenCount / Math.max(aliasTokenCount, 1);
  const longestMatchBoost =
    Math.min(longestMatchTokenCount, ALIAS_MATCH_POLICY.MAX_LONGEST_MATCH_TOKENS) * ALIAS_MATCH_POLICY.LONGEST_MATCH_TOKEN_BONUS;
  const phraseStrength =
    aliasTokenCount >= 2 && queryTokenCount >= 2 ? ALIAS_MATCH_POLICY.MULTI_TOKEN_PHRASE_BASE : ALIAS_MATCH_POLICY.SINGLE_TOKEN_PHRASE_BASE;

  return roundScore(
    Math.min(
      ALIAS_MATCH_POLICY.MAX_SUBPHRASE_SCORE,
      phraseStrength + Math.min(coverage, 1) * ALIAS_MATCH_POLICY.COVERAGE_CONTRIBUTION + longestMatchBoost
    )
  );
}

function shouldDowngradeWeakAliasInQuery(row: SubphraseAliasMatch): boolean {
  return row.matchType === 'alias_in_query' && row.queryTokenCount >= 3 && row.matchedTokens.length < 2;
}

function getOrCreateCandidate(
  candidatesByNodeId: Map<number, CandidateAccumulator>,
  graphNodeId: number,
  canonicalLabel: string
): CandidateAccumulator {
  const existing = candidatesByNodeId.get(graphNodeId);

  if (existing) {
    return existing;
  }

  const candidate: CandidateAccumulator = {
    graphNodeId,
    canonicalLabel,
    evidence: []
  };

  candidatesByNodeId.set(graphNodeId, candidate);
  return candidate;
}

function addEvidence(
  candidatesByNodeId: Map<number, CandidateAccumulator>,
  graphNodeId: number,
  canonicalLabel: string,
  evidence: CandidateEvidenceRecord
): void {
  getOrCreateCandidate(candidatesByNodeId, graphNodeId, canonicalLabel).evidence.push(evidence);
}

function buildCapabilityTaskEvidence(row: OccupationTextHit): CandidateEvidenceRecord | null {
  if (row.usefulQueryTokenCount < 2) {
    return null;
  }

  const capabilitySignals = row.fieldSignals.filter((signal) => signal.fieldClass === 'capability' && signal.usefulMatchedTokenCount > 0);

  if (capabilitySignals.length === 0) {
    return null;
  }

  const maxUsefulTokenCoverage = roundScore(maxOf(capabilitySignals, (signal) => signal.usefulTokenCoverage));

  if (maxUsefulTokenCoverage <= 0) {
    return null;
  }

  const usefulMatchedTokens = Array.from(new Set(capabilitySignals.flatMap((signal) => signal.usefulMatchedTokens))).sort();
  const capabilityAlignment =
    CAPABILITY_TASK_POLICY.BASE_ALIGNMENT + maxUsefulTokenCoverage * CAPABILITY_TASK_POLICY.COVERAGE_ALIGNMENT_WEIGHT;
  const score = roundScore(row.score * Math.min(1, capabilityAlignment));

  if (score <= 0) {
    return null;
  }

  return {
    channel: 'capability_task',
    score,
    details: {
      source_channel: 'lexical',
      opensearch_score: row.score,
      lexical_signal_score: row.lexicalSignalScore,
      matched_tokens: usefulMatchedTokens,
      field_signals: capabilitySignals,
      max_useful_token_coverage: maxUsefulTokenCoverage,
      useful_query_token_count: row.usefulQueryTokenCount
    }
  };
}

function finalizeCandidate(candidate: CandidateAccumulator): RetrievedOccupationCandidate {
  const channelScores: Partial<Record<RetrievalChannel, number>> = {};

  for (const evidence of candidate.evidence) {
    channelScores[evidence.channel] = Math.max(channelScores[evidence.channel] ?? 0, evidence.score);
  }

  // `capability_task` is not an independent retrieval channel: buildCapabilityTaskEvidence()
  // derives it from the same lexical row (score = row.score * min(1, 0.35 + coverage
  // * 0.65)), so it can never exceed that row's own lexical score. Summing both with
  // separate weights below would double-count one opensearch hit as if it were two corroborating
  // signals, inflating loosely-matched candidates relative to ones whose only evidence is a
  // genuinely independent channel (e.g. ngram_alias). Only the max of the two is counted.
  const totalScore = roundScore(
    (channelScores.exact_canonical ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.EXACT_CANONICAL +
      (channelScores.exact_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.EXACT_ALIAS +
      (channelScores.folded_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.FOLDED_ALIAS +
      (channelScores.ngram_alias ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.NGRAM_ALIAS +
      Math.max(channelScores.lexical ?? 0, channelScores.capability_task ?? 0) * RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT.OPENSEARCH_LEXICAL
  );

  return {
    graphNodeId: candidate.graphNodeId,
    canonicalLabel: candidate.canonicalLabel,
    totalScore,
    channelScores,
    evidence: candidate.evidence.sort((left, right) => channelOrder(left.channel) - channelOrder(right.channel) || right.score - left.score)
  };
}

function channelOrder(channel: RetrievalChannel): number {
  if (channel === 'exact_canonical') {
    return 0;
  }

  if (channel === 'exact_alias') {
    return 1;
  }

  if (channel === 'folded_alias') {
    return 2;
  }

  if (channel === 'ngram_alias') {
    return 3;
  }

  if (channel === 'lexical') {
    return 4;
  }

  if (channel === 'capability_task') {
    return 5;
  }

  return 6;
}

function normalizeRequiredQuery(query: string | undefined): string {
  const normalized = query?.trim();

  if (!normalized) {
    throw new Error('Provide --query="..." or --evaluation-query-id=N.');
  }

  return normalized;
}

function normalizeLocale(locale: string | undefined): string {
  const normalized = locale?.trim().toLowerCase();
  return normalized || DEFAULT_RETRIEVAL_LOCALE;
}

function normalizeSourceName(sourceName: string | undefined): string {
  const normalized = sourceName?.trim();
  return normalized || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeModelKey(modelKey: string | undefined): string {
  const normalized = modelKey?.trim();
  return normalized || DEFAULT_MODEL_KEY;
}

function normalizeLimit(limit: number | undefined): number {
  return requirePositiveIntegerAtMost(limit ?? DEFAULT_CANDIDATE_LIMIT, 1000, 'Candidate limit');
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundScore(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
