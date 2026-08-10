import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { commonRolePhraseEntries } from '../query/common-role-phrase-atlas.js';
import { familyAliasEntries } from '../query/family-alias-atlas.js';
import { cleanOccupationSignals } from '../query/occupation-signal-oov-cleaner.js';
import { peelOccupationTitleNoise } from '../query/occupation-noise-peeling.js';
import {
  foldSearchText,
  isGenericQueryToken,
  normalizeQueryLocale,
  prepareOccupationQueryInput,
  normalizeSearchSurfaceText,
  tokenizeNormalizedText,
  type SupportedQueryLocale
} from '../query/query-preparation.js';
import { reviewedNoiseRules } from '../query/reviewed-query-prep-seeds.js';

export type RawTitleChunkFact = {
  locale: SupportedQueryLocale;
  row_index: number;
  original_title: string;
  normalized_title: string;
  chunk_surface: string;
  chunk_normalized_surface: string;
  token_count: number;
  char_count: number;
  chunk_index: number;
  chunk_start_token: number;
  chunk_end_token: number;
  position_bucket: 'start' | 'middle' | 'end' | 'full';
  is_parenthetical: boolean;
  is_prefix_like: boolean;
  is_suffix_like: boolean;
  has_slash_boundary: boolean;
  has_dash_boundary: boolean;
  has_pipe_boundary: boolean;
  has_comma_boundary: boolean;
  preceding_token: string;
  following_token: string;
};

export type ChunkCandidateStat = {
  locale: SupportedQueryLocale;
  chunk_surface: string;
  chunk_normalized_surface: string;
  token_count: number;
  occurrence_count: number;
  unique_title_count: number;
  title_df: number;
  position_start_count: number;
  position_middle_count: number;
  position_end_count: number;
  position_full_count: number;
  parenthetical_count: number;
  prefix_like_count: number;
  suffix_like_count: number;
  slash_boundary_count: number;
  dash_boundary_count: number;
  pipe_boundary_count: number;
  comma_boundary_count: number;
  example_titles: string;
};

export type ChunkCandidateAnnotation = ChunkCandidateStat & {
  known_noise_match: boolean;
  known_common_role_match: boolean;
  known_family_alias_match: boolean;
  known_dictionary_exact_match: boolean;
  already_covered_flag: boolean;
  coverage_skip_reason: string;
  review_bucket: string;
};

export type TitleChunkDiscoveryRow = {
  rowIndex: number;
  title: string;
};

export type DiscoverRawTitleChunkFactsOptions = {
  locale: string;
  maxChunkTokens?: number;
  sourceName?: string;
};

type TitleToken = {
  surface: string;
  start: number;
  end: number;
  isParenthetical: boolean;
};

type AggregateBucket = {
  locale: SupportedQueryLocale;
  tokenCount: number;
  occurrenceCount: number;
  originalTitles: Set<string>;
  positionCounts: Record<'start' | 'middle' | 'end' | 'full', number>;
  parentheticalCount: number;
  prefixLikeCount: number;
  suffixLikeCount: number;
  slashBoundaryCount: number;
  dashBoundaryCount: number;
  pipeBoundaryCount: number;
  commaBoundaryCount: number;
  exampleTitles: string[];
  seenExampleTitles: Set<string>;
  surfaceCounts: Map<string, number>;
};

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const HARD_INTERNAL_BOUNDARY_PATTERN = /[\/|,]/u;
const DASH_PATTERN = /[\p{Pd}-]/u;

export async function discoverRawTitleChunkFacts(
  rows: readonly TitleChunkDiscoveryRow[],
  options: DiscoverRawTitleChunkFactsOptions
): Promise<RawTitleChunkFact[]> {
  const locale = normalizeQueryLocale(options.locale);
  if (locale === 'unknown') {
    throw new Error(`Unsupported locale: ${options.locale}`);
  }

  const maxChunkTokens = Math.max(1, Math.min(options.maxChunkTokens ?? 5, 8));
  const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
  const facts: RawTitleChunkFact[] = [];

  for (const row of rows) {
    const originalTitle = String(row.title ?? '').trim();
    if (!originalTitle) {
      continue;
    }

    const discoverySignals = await buildDiscoverySignals(originalTitle, locale, sourceName);
    let chunkIndex = 0;

    for (const signal of discoverySignals) {
      const normalizedTitle = normalizeSearchSurfaceText(signal);
      const tokens = extractTitleTokens(normalizedTitle);
      if (tokens.length === 0) {
        continue;
      }

      const parentheticalRuns = extractDelimitedParentheticalRuns(tokens, normalizedTitle);

      for (let start = 0; start < tokens.length; start += 1) {
        let blockedByHardBoundary = false;
        for (let end = start; end < tokens.length && end < start + maxChunkTokens; end += 1) {
          if (isInsideGroupedParentheticalRun(start, end, parentheticalRuns)) {
            continue;
          }

          if (end > start) {
            const gap = normalizedTitle.slice(tokens[end - 1].end, tokens[end].start);
            if (HARD_INTERNAL_BOUNDARY_PATTERN.test(gap) || tokens[end - 1].isParenthetical !== tokens[end].isParenthetical) {
              blockedByHardBoundary = true;
            }
          }

          if (blockedByHardBoundary) {
            break;
          }

          const chunkStart = tokens[start].start;
          const chunkEnd = tokens[end].end;
          const chunkSurface = normalizeSearchSurfaceText(normalizedTitle.slice(chunkStart, chunkEnd));
          const chunkNormalizedSurface = foldSearchText(chunkSurface);
          const tokenCount = end - start + 1;
          if (!chunkSurface || !chunkNormalizedSurface || (tokenCount === 1 && isGenericQueryToken(chunkNormalizedSurface, locale))) {
            continue;
          }

          chunkIndex += 1;
          const leftBoundary = start > 0 ? normalizedTitle.slice(tokens[start - 1].end, chunkStart) : '';
          const rightBoundary = end < tokens.length - 1 ? normalizedTitle.slice(chunkEnd, tokens[end + 1].start) : '';
          const internalBoundary = start === end ? '' : normalizedTitle.slice(chunkStart, chunkEnd);
          const boundarySample = `${leftBoundary} ${internalBoundary} ${rightBoundary}`;
          const positionBucket =
            start === 0 && end === tokens.length - 1 ? 'full' : start === 0 ? 'start' : end === tokens.length - 1 ? 'end' : 'middle';

          facts.push({
            locale,
            row_index: row.rowIndex,
            original_title: originalTitle,
            normalized_title: normalizedTitle,
            chunk_surface: chunkSurface,
            chunk_normalized_surface: chunkNormalizedSurface,
            token_count: tokenCount,
            char_count: chunkSurface.length,
            chunk_index: chunkIndex,
            chunk_start_token: start,
            chunk_end_token: end,
            position_bucket: positionBucket,
            is_parenthetical: tokens[start].isParenthetical && tokens[end].isParenthetical,
            is_prefix_like: start === 0 && end < tokens.length - 1,
            is_suffix_like: start > 0 && end === tokens.length - 1,
            has_slash_boundary: boundarySample.includes('/'),
            has_dash_boundary: DASH_PATTERN.test(boundarySample),
            has_pipe_boundary: boundarySample.includes('|'),
            has_comma_boundary: boundarySample.includes(','),
            preceding_token: start > 0 ? tokens[start - 1].surface : '',
            following_token: end < tokens.length - 1 ? tokens[end + 1].surface : ''
          });
        }
      }

      for (const run of parentheticalRuns) {
        chunkIndex += 1;
        facts.push({
          locale,
          row_index: row.rowIndex,
          original_title: originalTitle,
          normalized_title: normalizedTitle,
          chunk_surface: run.surface,
          chunk_normalized_surface: foldSearchText(run.surface),
          token_count: run.endToken - run.startToken + 1,
          char_count: run.surface.length,
          chunk_index: chunkIndex,
          chunk_start_token: run.startToken,
          chunk_end_token: run.endToken,
          position_bucket:
            run.startToken === 0 && run.endToken === tokens.length - 1 ? 'full' : run.endToken === tokens.length - 1 ? 'end' : 'middle',
          is_parenthetical: true,
          is_prefix_like: false,
          is_suffix_like: run.endToken === tokens.length - 1,
          has_slash_boundary: run.surface.includes('/'),
          has_dash_boundary: DASH_PATTERN.test(run.surface),
          has_pipe_boundary: run.surface.includes('|'),
          has_comma_boundary: run.surface.includes(','),
          preceding_token: run.startToken > 0 ? tokens[run.startToken - 1].surface : '',
          following_token: run.endToken < tokens.length - 1 ? tokens[run.endToken + 1].surface : ''
        });
      }
    }
  }

  return facts;
}

async function buildDiscoverySignals(title: string, locale: SupportedQueryLocale, sourceName: string): Promise<string[]> {
  const peeledTitle = peelOccupationTitleNoise(title, locale).peeledTitle;
  const preparedSignals = prepareOccupationQueryInput(peeledTitle, locale).signals;
  const cleanedSignals = await cleanOccupationSignals({
    sourceName,
    locale,
    signals: preparedSignals
  });
  const candidateSignals = cleanedSignals.keptSignals.length > 0 ? cleanedSignals.keptSignals : preparedSignals;

  return candidateSignals.filter((signal) => !isBareGenericSignal(signal, locale));
}

function isBareGenericSignal(signal: string, locale: SupportedQueryLocale): boolean {
  const tokens = tokenizeNormalizedText(normalizeSearchSurfaceText(signal));
  return tokens.length === 1 && isGenericQueryToken(foldSearchText(tokens[0] ?? ''), locale);
}

export function aggregateChunkFacts(facts: readonly RawTitleChunkFact[]): ChunkCandidateStat[] {
  const buckets = new Map<string, AggregateBucket>();
  const totalUniqueTitles = new Set(facts.map((fact) => fact.original_title)).size;

  for (const fact of facts) {
    const key = `${fact.locale}\u0000${fact.chunk_normalized_surface}`;
    const bucket = buckets.get(key) ?? {
      locale: fact.locale,
      tokenCount: fact.token_count,
      occurrenceCount: 0,
      originalTitles: new Set<string>(),
      positionCounts: { start: 0, middle: 0, end: 0, full: 0 },
      parentheticalCount: 0,
      prefixLikeCount: 0,
      suffixLikeCount: 0,
      slashBoundaryCount: 0,
      dashBoundaryCount: 0,
      pipeBoundaryCount: 0,
      commaBoundaryCount: 0,
      exampleTitles: [],
      seenExampleTitles: new Set<string>(),
      surfaceCounts: new Map<string, number>()
    };

    bucket.occurrenceCount += 1;
    bucket.originalTitles.add(fact.original_title);
    bucket.positionCounts[fact.position_bucket] += 1;
    bucket.parentheticalCount += Number(fact.is_parenthetical);
    bucket.prefixLikeCount += Number(fact.is_prefix_like);
    bucket.suffixLikeCount += Number(fact.is_suffix_like);
    bucket.slashBoundaryCount += Number(fact.has_slash_boundary);
    bucket.dashBoundaryCount += Number(fact.has_dash_boundary);
    bucket.pipeBoundaryCount += Number(fact.has_pipe_boundary);
    bucket.commaBoundaryCount += Number(fact.has_comma_boundary);
    bucket.surfaceCounts.set(fact.chunk_surface, (bucket.surfaceCounts.get(fact.chunk_surface) ?? 0) + 1);
    if (!bucket.seenExampleTitles.has(fact.original_title) && bucket.exampleTitles.length < 5) {
      bucket.seenExampleTitles.add(fact.original_title);
      bucket.exampleTitles.push(fact.original_title);
    }

    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const [, chunkNormalizedSurface] = key.split('\u0000');
      return {
        locale: bucket.locale,
        chunk_surface: pickRepresentativeSurface(bucket.surfaceCounts),
        chunk_normalized_surface: chunkNormalizedSurface,
        token_count: bucket.tokenCount,
        occurrence_count: bucket.occurrenceCount,
        unique_title_count: bucket.originalTitles.size,
        title_df: totalUniqueTitles > 0 ? roundRatio(bucket.originalTitles.size / totalUniqueTitles) : 0,
        position_start_count: bucket.positionCounts.start,
        position_middle_count: bucket.positionCounts.middle,
        position_end_count: bucket.positionCounts.end,
        position_full_count: bucket.positionCounts.full,
        parenthetical_count: bucket.parentheticalCount,
        prefix_like_count: bucket.prefixLikeCount,
        suffix_like_count: bucket.suffixLikeCount,
        slash_boundary_count: bucket.slashBoundaryCount,
        dash_boundary_count: bucket.dashBoundaryCount,
        pipe_boundary_count: bucket.pipeBoundaryCount,
        comma_boundary_count: bucket.commaBoundaryCount,
        example_titles: bucket.exampleTitles.join(' | ')
      } satisfies ChunkCandidateStat;
    })
    .sort(compareChunkStats);
}

export function annotateChunkCandidateStats(
  stats: readonly ChunkCandidateStat[],
  options: Pick<DiscoverRawTitleChunkFactsOptions, 'locale'>
): ChunkCandidateAnnotation[] {
  const locale = normalizeQueryLocale(options.locale);
  if (locale === 'unknown') {
    throw new Error(`Unsupported locale: ${options.locale}`);
  }

  const commonRoleLookup = new Set(
    commonRolePhraseEntries(locale).map((entry) => foldSearchText(normalizeSearchSurfaceText(entry.surface)))
  );
  const familyAliasLookup = new Set(familyAliasEntries(locale).map((entry) => foldSearchText(normalizeSearchSurfaceText(entry.surface))));
  const reviewedNoise = locale === 'ro' || locale === 'hu' ? reviewedNoiseRules(locale) : [];
  const noisePhraseLookup = new Set<string>();
  const noiseTokenLookup = new Set<string>();
  for (const rule of reviewedNoise) {
    for (const term of rule.terms ?? []) {
      const normalized = foldSearchText(normalizeSearchSurfaceText(term));
      if (!normalized) {
        continue;
      }
      if (rule.matchType === 'token') {
        noiseTokenLookup.add(normalized);
        continue;
      }
      noisePhraseLookup.add(normalized);
    }
  }

  return stats.map((candidate) => {
    const knownNoiseMatch =
      noisePhraseLookup.has(candidate.chunk_normalized_surface) ||
      (candidate.token_count === 1 && noiseTokenLookup.has(candidate.chunk_normalized_surface));
    const knownCommonRoleMatch = commonRoleLookup.has(candidate.chunk_normalized_surface);
    const knownFamilyAliasMatch = familyAliasLookup.has(candidate.chunk_normalized_surface);
    const knownDictionaryExactMatch = false;
    const alreadyCoveredFlag = knownNoiseMatch || knownCommonRoleMatch || knownFamilyAliasMatch || knownDictionaryExactMatch;
    const coverageSkipReason = knownNoiseMatch
      ? 'known_noise_exact'
      : knownCommonRoleMatch
        ? 'known_common_role_exact'
        : knownFamilyAliasMatch
          ? 'known_family_alias_exact'
          : knownDictionaryExactMatch
            ? 'known_dictionary_exact'
            : '';

    return {
      ...candidate,
      known_noise_match: knownNoiseMatch,
      known_common_role_match: knownCommonRoleMatch,
      known_family_alias_match: knownFamilyAliasMatch,
      known_dictionary_exact_match: knownDictionaryExactMatch,
      already_covered_flag: alreadyCoveredFlag,
      coverage_skip_reason: coverageSkipReason,
      review_bucket: classifyReviewBucket(candidate, alreadyCoveredFlag)
    } satisfies ChunkCandidateAnnotation;
  });
}

function classifyReviewBucket(candidate: ChunkCandidateStat, alreadyCoveredFlag: boolean): string {
  if (alreadyCoveredFlag) {
    return 'covered_skip';
  }

  if (candidate.token_count === 1 && candidate.occurrence_count < 3) {
    return 'defer_singleton';
  }

  if (candidate.occurrence_count >= 5 || candidate.unique_title_count >= 4) {
    return 'priority_review';
  }

  if (candidate.occurrence_count >= 2 && candidate.token_count >= 2) {
    return 'review';
  }

  return 'monitor';
}

function extractTitleTokens(title: string): TitleToken[] {
  const parentheticalDepthByIndex = buildParentheticalDepthIndex(title);
  const matches = title.matchAll(TOKEN_PATTERN);
  const tokens: TitleToken[] = [];

  for (const match of matches) {
    const surface = match[0];
    const start = match.index ?? 0;
    const end = start + surface.length;
    tokens.push({
      surface,
      start,
      end,
      isParenthetical: parentheticalDepthByIndex[start] > 0
    });
  }

  return tokens;
}

function extractDelimitedParentheticalRuns(
  tokens: readonly TitleToken[],
  title: string
): Array<{ surface: string; startToken: number; endToken: number }> {
  const runs: Array<{ surface: string; startToken: number; endToken: number }> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokens[index]?.isParenthetical) {
      continue;
    }

    const startToken = index;
    let endToken = index;
    while (endToken + 1 < tokens.length && tokens[endToken + 1]?.isParenthetical) {
      endToken += 1;
    }

    const surface = normalizeSearchSurfaceText(title.slice(tokens[startToken].start, tokens[endToken].end));
    if (surface && /[/|,-]/u.test(surface)) {
      runs.push({ surface, startToken, endToken });
    }

    index = endToken;
  }

  return runs;
}

function isInsideGroupedParentheticalRun(
  startToken: number,
  endToken: number,
  runs: ReadonlyArray<{ startToken: number; endToken: number }>
): boolean {
  return runs.some((run) => startToken >= run.startToken && endToken <= run.endToken);
}

function buildParentheticalDepthIndex(title: string): number[] {
  const depths = new Array<number>(title.length + 1).fill(0);
  let depth = 0;

  for (let index = 0; index < title.length; index += 1) {
    depths[index] = depth;
    const char = title[index];
    if (char === '(' || char === '[' || char === '{' || char === '<') {
      depth += 1;
      continue;
    }
    if ((char === ')' || char === ']' || char === '}' || char === '>') && depth > 0) {
      depth -= 1;
    }
  }

  depths[title.length] = depth;
  return depths;
}

function pickRepresentativeSurface(surfaceCounts: ReadonlyMap<string, number>): string {
  return (
    Array.from(surfaceCounts.entries()).sort(
      (left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0])
    )[0]?.[0] ?? ''
  );
}

function compareChunkStats(left: ChunkCandidateStat, right: ChunkCandidateStat): number {
  return (
    right.occurrence_count - left.occurrence_count ||
    right.unique_title_count - left.unique_title_count ||
    right.token_count - left.token_count ||
    left.chunk_surface.localeCompare(right.chunk_surface)
  );
}

function roundRatio(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : 0;
}

export function chunkFactsToCsvRows(facts: readonly RawTitleChunkFact[]): Array<Record<string, string | number | boolean>> {
  return facts.map((fact) => ({ ...fact }));
}

export function chunkStatsToCsvRows(stats: readonly ChunkCandidateStat[]): Array<Record<string, string | number | boolean>> {
  return stats.map((stat) => ({ ...stat }));
}

export function chunkAnnotationsToCsvRows(
  annotations: readonly ChunkCandidateAnnotation[]
): Array<Record<string, string | number | boolean>> {
  return annotations.map((annotation) => ({ ...annotation }));
}

export function selectMonitorChunkAnnotations(annotations: readonly ChunkCandidateAnnotation[]): ChunkCandidateAnnotation[] {
  return annotations.filter((annotation) => annotation.review_bucket === 'monitor');
}

export function normalizeDiscoveryTitle(value: string): string {
  return normalizeSearchSurfaceText(value);
}

export function tokenizeDiscoveryTitle(value: string): string[] {
  return tokenizeNormalizedText(normalizeSearchSurfaceText(value));
}
