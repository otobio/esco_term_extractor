import {
  hashTokenSequence,
  hashVocabularyText,
  loadOccupationSignalVocabularyArtifactRequired,
  type OccupationSignalVocabularyArtifact
} from '../runtime/occupation-signal-vocabulary-artifact.js';
import { findCommonRolePhraseMatch } from './common-role-phrase-atlas.js';
import {
  isGenericQueryToken,
  isSafeJobLevelModifierToken,
  isStopQueryToken,
  normalizeQueryLocale,
  type SupportedQueryLocale
} from './query-preparation.js';
import { foldSearchText, normalizeSearchSurfaceText, tokenizeNormalizedText } from '../utils/texts.js';
import { perTokenVocabularyCompoundSplits, reconstructCompoundExpandedSurface } from './token-variants.js';

export type OccupationRoleSpanCandidate = {
  text: string;
  foldedText: string;
  startToken: number;
  endToken: number;
  tokenCount: number;
  knownTokenCount: number;
  tokenCoverage: number;
  longestPhraseLength: number;
  exactPhraseKnown: boolean;
  maxAnchorCount: number;
  codeTokenCount: number;
  genericTokenCount: number;
  score: number;
  evidence: string[];
};

export type OccupationRoleSpanSelection = {
  originalQuery: string;
  cleanedQuery: string;
  roleQuery: string;
  contextQuery: string;
  selectedSpan: OccupationRoleSpanCandidate | null;
  candidates: OccupationRoleSpanCandidate[];
};

export type SelectOccupationRoleSpanOptions = {
  sourceName: string;
  locale: string;
  originalQuery: string;
  querySpans: string[];
  disabledCommonRolePhraseRoleKeys?: readonly string[];
};

type SignalVocabulary = {
  artifact: OccupationSignalVocabularyArtifact;
  maxPhraseTokenCount: number;
};

type CompoundExpandedCandidateSurface = {
  displayTokens: string[];
  foldedTokens: string[];
};

const VOCABULARY_CACHE = new Map<string, Promise<SignalVocabulary>>();
const MAX_ROLE_SPAN_TOKENS = 6;
const MIN_ROLE_SPAN_SCORE = 1.25;

export async function selectOccupationRoleSpan(options: SelectOccupationRoleSpanOptions): Promise<OccupationRoleSpanSelection> {
  const locale = normalizeQueryLocale(options.locale);
  const vocabulary = await loadSignalVocabulary(options.sourceName);
  const cleanedQuery = options.querySpans.join(' ').trim() || options.originalQuery.trim();
  const surfaceTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(cleanedQuery));
  const foldedTokens = surfaceTokens.map((token) => foldSearchText(token));

  if (foldedTokens.length === 0) {
    return emptySelection(options.originalQuery, cleanedQuery);
  }

  const tokenCompoundSplits = await perTokenVocabularyCompoundSplits(foldedTokens, locale, options.sourceName);
  const compoundExpandedDisplaySurface = reconstructCompoundExpandedSurface(surfaceTokens, tokenCompoundSplits);
  const compoundExpandedSurface = reconstructCompoundExpandedSurface(foldedTokens, tokenCompoundSplits);
  const directPhraseMatch =
    options.querySpans.length === 1
      ? findCommonRolePhraseMatch(cleanedQuery, locale, {
          disabledRoleKeys: options.disabledCommonRolePhraseRoleKeys
        })
      : null;
  const compoundExpandedPhraseMatch =
    !directPhraseMatch && compoundExpandedDisplaySurface
      ? findCommonRolePhraseMatch(compoundExpandedDisplaySurface, locale, {
          disabledRoleKeys: options.disabledCommonRolePhraseRoleKeys
        })
      : null;
  const phraseMatch = directPhraseMatch ?? compoundExpandedPhraseMatch;
  const phraseMatchSurfaceTokens =
    phraseMatch && compoundExpandedPhraseMatch && compoundExpandedDisplaySurface
      ? tokenizeNormalizedText(normalizeSearchSurfaceText(compoundExpandedDisplaySurface))
      : surfaceTokens;
  const phraseMatchFoldedTokens =
    phraseMatch && compoundExpandedPhraseMatch && compoundExpandedSurface
      ? phraseMatchSurfaceTokens.map((token) => foldSearchText(token))
      : foldedTokens;
  if (phraseMatch) {
    return {
      originalQuery: options.originalQuery,
      cleanedQuery,
      roleQuery: phraseMatch.canonicalEnglish,
      contextQuery: contextForPhraseSelection(phraseMatchSurfaceTokens, phraseMatch.startToken, phraseMatch.endToken),
      selectedSpan: compoundExpandedPhraseMatch
        ? withCompoundExpandedEvidence({
            text: phraseMatch.surfaceTokens.join(' '),
            foldedText: foldSearchText(phraseMatch.surfaceTokens.join(' ')),
            startToken: phraseMatch.startToken,
            endToken: phraseMatch.endToken,
            tokenCount: phraseMatch.endToken - phraseMatch.startToken,
            knownTokenCount: phraseMatch.canonicalTokens.length,
            tokenCoverage: 1,
            longestPhraseLength: phraseMatch.canonicalTokens.length,
            exactPhraseKnown: !phraseMatch.approximate,
            maxAnchorCount: 0,
            codeTokenCount: 0,
            genericTokenCount: 0,
            score: 10,
            evidence: [
              phraseMatch.approximate ? 'curated_role_phrase_approximate' : 'curated_role_phrase_exact',
              `canonical_${phraseMatch.canonicalEnglish}`
            ]
          })
        : {
        text: phraseMatch.surfaceTokens.join(' '),
        foldedText: foldSearchText(phraseMatch.surfaceTokens.join(' ')),
        startToken: phraseMatch.startToken,
        endToken: phraseMatch.endToken,
        tokenCount: phraseMatch.endToken - phraseMatch.startToken,
        knownTokenCount: phraseMatch.canonicalTokens.length,
        tokenCoverage: 1,
        longestPhraseLength: phraseMatch.canonicalTokens.length,
        exactPhraseKnown: !phraseMatch.approximate,
        maxAnchorCount: 0,
        codeTokenCount: 0,
        genericTokenCount: 0,
        score: 10,
        evidence: [
          phraseMatch.approximate ? 'curated_role_phrase_approximate' : 'curated_role_phrase_exact',
          `canonical_${phraseMatch.canonicalEnglish}`
        ]
      },
      candidates: candidatesForPhraseMatch(phraseMatch, phraseMatchSurfaceTokens, phraseMatchFoldedTokens).map((candidate) =>
        compoundExpandedPhraseMatch ? withCompoundExpandedEvidence(candidate) : candidate
      )
    };
  }

  const originalCandidates = buildSpanCandidates(surfaceTokens, foldedTokens, locale, vocabulary);
  const compoundExpandedCandidateSurface = buildCompoundExpandedCandidateSurface(
    cleanedQuery,
    compoundExpandedDisplaySurface,
    compoundExpandedSurface
  );
  const compoundExpandedCandidates =
    compoundExpandedCandidateSurface && compoundExpandedCandidateSurface.foldedTokens.length > 0
      ? buildSpanCandidates(
          compoundExpandedCandidateSurface.displayTokens,
          compoundExpandedCandidateSurface.foldedTokens,
          locale,
          vocabulary
        )
      : [];
  const candidates = originalCandidates;
  const selectedOriginalSpan = selectBestCandidate(originalCandidates, foldedTokens.length);
  const selectedCompoundExpandedSpan =
    compoundExpandedCandidateSurface && compoundExpandedCandidateSurface.foldedTokens.length > 0
      ? selectBestCandidate(compoundExpandedCandidates, compoundExpandedCandidateSurface.foldedTokens.length)
      : null;
  const useCompoundExpandedSpan =
    selectedCompoundExpandedSpan !== null &&
    (selectedOriginalSpan === null ||
      selectedCompoundExpandedSpan.score > selectedOriginalSpan.score ||
      (selectedCompoundExpandedSpan.score === selectedOriginalSpan.score &&
        selectedCompoundExpandedSpan.longestPhraseLength > selectedOriginalSpan.longestPhraseLength));
  const selectedSpan = useCompoundExpandedSpan ? withCompoundExpandedEvidence(selectedCompoundExpandedSpan) : selectedOriginalSpan;
  const selectedSurfaceTokens =
    useCompoundExpandedSpan && compoundExpandedCandidateSurface ? compoundExpandedCandidateSurface.displayTokens : surfaceTokens;
  const selectedCandidates = useCompoundExpandedSpan ? compoundExpandedCandidates : candidates;
  const displaySelectedSpan =
    selectedSpan && useCompoundExpandedSpan ? candidateWithDisplaySurface(selectedSpan, selectedSurfaceTokens) : selectedSpan;
  const roleQuery = displaySelectedSpan?.text ?? cleanedQuery;
  const contextQuery = displaySelectedSpan ? contextForSelection(selectedSurfaceTokens, displaySelectedSpan) : '';

  return {
    originalQuery: options.originalQuery,
    cleanedQuery,
    roleQuery,
    contextQuery,
    selectedSpan: displaySelectedSpan,
    candidates: selectedCandidates.slice(0, 20).map((candidate) => (useCompoundExpandedSpan ? withCompoundExpandedEvidence(candidate) : candidate))
  };
}

function candidatesForPhraseMatch(
  phraseMatch: ReturnType<typeof findCommonRolePhraseMatch>,
  surfaceTokens: string[],
  foldedTokens: string[]
): OccupationRoleSpanCandidate[] {
  if (!phraseMatch) {
    return [];
  }

  const matchedSurfaceTokens = surfaceTokens.slice(phraseMatch.startToken, phraseMatch.endToken);
  const matchedFoldedTokens = foldedTokens.slice(phraseMatch.startToken, phraseMatch.endToken);

  return [
    {
      text: matchedSurfaceTokens.join(' '),
      foldedText: matchedFoldedTokens.join(' '),
      startToken: phraseMatch.startToken,
      endToken: phraseMatch.endToken,
      tokenCount: matchedFoldedTokens.length,
      knownTokenCount: phraseMatch.canonicalTokens.length,
      tokenCoverage: 1,
      longestPhraseLength: phraseMatch.canonicalTokens.length,
      exactPhraseKnown: !phraseMatch.approximate,
      maxAnchorCount: 0,
      codeTokenCount: 0,
      genericTokenCount: 0,
      score: 10,
      evidence: [phraseMatch.approximate ? 'curated_role_phrase_approximate' : 'curated_role_phrase_exact']
    }
  ];
}

function contextForPhraseSelection(surfaceTokens: string[], startToken: number, endToken: number): string {
  return [...surfaceTokens.slice(0, startToken), ...surfaceTokens.slice(endToken)].join(' ').trim();
}

function withCompoundExpandedEvidence(candidate: OccupationRoleSpanCandidate): OccupationRoleSpanCandidate {
  return candidate.evidence.includes('compound_expanded_surface')
    ? candidate
    : { ...candidate, evidence: [...candidate.evidence, 'compound_expanded_surface'] };
}

function candidateWithDisplaySurface(candidate: OccupationRoleSpanCandidate, surfaceTokens: string[]): OccupationRoleSpanCandidate {
  const displayTokens = surfaceTokens.slice(candidate.startToken, candidate.endToken);
  return {
    ...candidate,
    text: displayTokens.join(' '),
    foldedText: foldSearchText(displayTokens.join(' '))
  };
}

function buildCompoundExpandedCandidateSurface(
  cleanedQuery: string,
  compoundExpandedDisplaySurface: string | null,
  compoundExpandedFoldedSurface: string | null
): CompoundExpandedCandidateSurface | null {
  if (!compoundExpandedDisplaySurface || compoundExpandedDisplaySurface === cleanedQuery) {
    return null;
  }

  const displayTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(compoundExpandedDisplaySurface));
  const foldedTokens =
    compoundExpandedFoldedSurface && compoundExpandedFoldedSurface !== cleanedQuery
      ? tokenizeNormalizedText(normalizeSearchSurfaceText(compoundExpandedFoldedSurface))
      : displayTokens.map((token) => foldSearchText(token));

  return displayTokens.length > 0 && foldedTokens.length > 0 ? { displayTokens, foldedTokens } : null;
}

async function loadSignalVocabulary(sourceName: string): Promise<SignalVocabulary> {
  let cached = VOCABULARY_CACHE.get(sourceName);

  if (!cached) {
    cached = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => ({
      artifact: entry.artifact,
      maxPhraseTokenCount: entry.artifact.maxPhraseTokenCount
    }));
    VOCABULARY_CACHE.set(sourceName, cached);
  }

  return cached;
}

function buildSpanCandidates(
  surfaceTokens: string[],
  foldedTokens: string[],
  locale: SupportedQueryLocale,
  vocabulary: SignalVocabulary
): OccupationRoleSpanCandidate[] {
  const candidates: OccupationRoleSpanCandidate[] = [];
  const maxWindow = Math.min(MAX_ROLE_SPAN_TOKENS, foldedTokens.length);

  for (let start = 0; start < foldedTokens.length; start += 1) {
    for (let windowSize = 1; windowSize <= maxWindow && start + windowSize <= foldedTokens.length; windowSize += 1) {
      candidates.push(scoreSpan(surfaceTokens, foldedTokens, start, start + windowSize, locale, vocabulary));
    }
  }

  return candidates.sort(compareSpanCandidates);
}

function scoreSpan(
  surfaceTokens: string[],
  foldedTokens: string[],
  startToken: number,
  endToken: number,
  locale: SupportedQueryLocale,
  vocabulary: SignalVocabulary
): OccupationRoleSpanCandidate {
  const spanSurfaceTokens = surfaceTokens.slice(startToken, endToken);
  const spanFoldedTokens = foldedTokens.slice(startToken, endToken);
  const tokenCount = spanFoldedTokens.length;
  const knownTokenCount = spanFoldedTokens.filter((token) => vocabulary.artifact.tokenHashes.has(hashVocabularyText(token))).length;
  const tokenCoverage = tokenCount === 0 ? 0 : knownTokenCount / tokenCount;
  const longestPhraseLength = longestKnownPhraseLength(spanFoldedTokens, vocabulary);
  const exactPhraseKnown = hasKnownPhrase(spanFoldedTokens, vocabulary);
  const anchorCounts = spanFoldedTokens.map((token) => occupationAnchorCount(token, vocabulary.artifact));
  const maxAnchorCount = Math.max(0, ...anchorCounts);
  const codeTokenCount = spanFoldedTokens.filter(isCodeLikeToken).length;
  const genericTokenCount = spanFoldedTokens.filter((token) => isLowRoleSignalToken(token, locale)).length;
  const evidence: string[] = [];

  if (exactPhraseKnown) {
    evidence.push('exact_signal_phrase');
  }

  if (longestPhraseLength >= 2) {
    evidence.push(`known_signal_phrase_${longestPhraseLength}`);
  }

  if (knownTokenCount > 0) {
    evidence.push(`known_tokens_${knownTokenCount}`);
  }

  if (maxAnchorCount > 0) {
    evidence.push(`anchor_count_${maxAnchorCount}`);
  }

  if (codeTokenCount > 0) {
    evidence.push(`code_tokens_${codeTokenCount}`);
  }

  if (genericTokenCount === tokenCount && tokenCount > 0) {
    evidence.push('generic_only');
  }

  const phraseScore = exactPhraseKnown ? 3.2 : longestPhraseLength * 0.55;
  const coverageScore = tokenCoverage * 1.4;
  const anchorScore = Math.min(maxAnchorCount / 25, 1.1);
  const lengthScore = Math.min(tokenCount, 4) * 0.12;
  const codePenalty = codeTokenCount * 1.2;
  const genericPenalty = genericTokenCount === tokenCount ? 0.75 : Math.max(0, genericTokenCount - 1) * 0.15;
  const score = roundScore(phraseScore + coverageScore + anchorScore + lengthScore - codePenalty - genericPenalty);

  return {
    text: spanSurfaceTokens.join(' '),
    foldedText: spanFoldedTokens.join(' '),
    startToken,
    endToken,
    tokenCount,
    knownTokenCount,
    tokenCoverage: roundScore(tokenCoverage),
    longestPhraseLength,
    exactPhraseKnown,
    maxAnchorCount,
    codeTokenCount,
    genericTokenCount,
    score,
    evidence
  };
}

function selectBestCandidate(candidates: OccupationRoleSpanCandidate[], totalTokenCount: number): OccupationRoleSpanCandidate | null {
  const fullSpan = candidates.find((candidate) => candidate.startToken === 0 && candidate.endToken === totalTokenCount) ?? null;
  const best = candidates[0] ?? null;

  if (!best) {
    return null;
  }

  if (!fullSpan) {
    return best.score >= MIN_ROLE_SPAN_SCORE ? best : null;
  }

  if (fullSpan.codeTokenCount === 0 && fullSpan.score > 0) {
    return fullSpan;
  }

  if (best.score < MIN_ROLE_SPAN_SCORE) {
    return fullSpan.score > 0 ? fullSpan : null;
  }

  return best;
}

function compareSpanCandidates(left: OccupationRoleSpanCandidate, right: OccupationRoleSpanCandidate): number {
  return (
    right.score - left.score ||
    Number(right.exactPhraseKnown) - Number(left.exactPhraseKnown) ||
    right.longestPhraseLength - left.longestPhraseLength ||
    right.knownTokenCount - left.knownTokenCount ||
    right.tokenCount - left.tokenCount ||
    left.startToken - right.startToken
  );
}

function contextForSelection(surfaceTokens: string[], selectedSpan: OccupationRoleSpanCandidate): string {
  return [...surfaceTokens.slice(0, selectedSpan.startToken), ...surfaceTokens.slice(selectedSpan.endToken)].join(' ').trim();
}

function hasKnownPhrase(tokens: string[], vocabulary: SignalVocabulary): boolean {
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.length === 1) {
    return vocabulary.artifact.tokenHashes.has(hashVocabularyText(tokens[0] ?? ''));
  }

  return vocabulary.artifact.phraseHashesByTokenCount.get(tokens.length)?.has(hashTokenSequence(tokens)) ?? false;
}

function longestKnownPhraseLength(tokens: string[], vocabulary: SignalVocabulary): number {
  const maxWindow = Math.min(tokens.length, vocabulary.maxPhraseTokenCount);

  for (let windowSize = maxWindow; windowSize >= 2; windowSize -= 1) {
    const phraseHashes = vocabulary.artifact.phraseHashesByTokenCount.get(windowSize);

    if (!phraseHashes) {
      continue;
    }

    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      if (phraseHashes.has(hashTokenSequence(tokens.slice(start, start + windowSize)))) {
        return windowSize;
      }
    }
  }

  return tokens.length === 1 && vocabulary.artifact.tokenHashes.has(hashVocabularyText(tokens[0] ?? '')) ? 1 : 0;
}

function occupationAnchorCount(token: string, artifact: OccupationSignalVocabularyArtifact): number {
  const index = artifact.anchorHashes.indexOf(hashVocabularyText(token));
  return index < 0 ? 0 : artifact.anchorCounts.get(index);
}

function isLowRoleSignalToken(token: string, locale: SupportedQueryLocale): boolean {
  return isGenericQueryToken(token, locale) || isStopQueryToken(token, locale) || isSafeJobLevelModifierToken(token, locale);
}

function isCodeLikeToken(token: string): boolean {
  return /^(?:id|cod|cor)?\d{2,}$/iu.test(token) || /^[a-z]{1,4}\d{2,}$/iu.test(token);
}

function emptySelection(originalQuery: string, cleanedQuery: string): OccupationRoleSpanSelection {
  return {
    originalQuery,
    cleanedQuery,
    roleQuery: cleanedQuery,
    contextQuery: '',
    selectedSpan: null,
    candidates: []
  };
}

function roundScore(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
