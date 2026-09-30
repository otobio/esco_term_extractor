import { CONFIDENCE, MAX_ALT_FAMILIES, MAX_ALT_LEAVES } from './config.js';
import { LABEL_SOURCE_RANK, compareLabelMatches } from './evidence.js';
import type {
  EscoCoverage,
  EscoDecision,
  EscoDecisionReason,
  EscoLabelSource,
  FamilyShare,
  LabelMatch,
  OccupationCandidate,
  SpanDecision,
  SpanEvidence
} from './types.js';

type MatchedCandidate = OccupationCandidate & { match: LabelMatch };

type FamilyVote = { familyUri: string; score: number; hasQueryExtraTerms: boolean };

const EXACT_LEAF_REASON: Record<EscoLabelSource, EscoDecisionReason> = {
  preferred: 'exact_preferred_label_leaf',
  alternative: 'exact_alternative_label_leaf',
  hidden: 'exact_hidden_label_leaf'
};

const EXACT_LEAF_CONFIDENCE: Record<EscoLabelSource, number> = {
  preferred: CONFIDENCE.exactPreferredLabelLeaf,
  alternative: CONFIDENCE.exactAlternativeLabelLeaf,
  hidden: CONFIDENCE.exactHiddenLabelLeaf
};

export function selectSpanDecision(evidence: SpanEvidence): SpanDecision {
  const ranked = evidence.candidates
    .filter((candidate): candidate is MatchedCandidate => candidate.match !== null)
    .sort((left, right) => compareLabelMatches(left.match, right.match) || left.searchRank - right.searchRank);
  const contained = ranked.filter((candidate) => candidate.match.relation !== 'partial');

  if (ranked.length === 0 && evidence.familyLabelCandidates.length === 0) {
    return unresolved('unresolved_no_candidates', []);
  }

  const familyVotes = voteFamilies(evidence, ranked);

  const exactFamily = evidence.familyLabelCandidates.find(
    (candidate) => candidate.match.relation === 'equal' && candidate.match.literalEqual
  );

  if (exactFamily) {
    return {
      decision: decision('family', 'exact_family_label', CONFIDENCE.exactFamilyLabel),
      leaf: null,
      familyUri: exactFamily.familyUri,
      altLeaves: altLeaves(contained, null),
      altFamilies: altFamilies(familyVotes, exactFamily.familyUri),
      coverage: coverageOf(exactFamily.match)
    };
  }

  const equalLeaves = ranked.filter((candidate) => candidate.match.relation === 'equal');
  const bestSourceRank = Math.max(0, ...equalLeaves.map((candidate) => LABEL_SOURCE_RANK[candidate.match.source]));
  const bestSourceLeaves = equalLeaves.filter((candidate) => LABEL_SOURCE_RANK[candidate.match.source] === bestSourceRank);
  const [uniqueLeaf] = bestSourceLeaves;

  if (bestSourceLeaves.length === 1 && uniqueLeaf) {
    return {
      decision: decision('leaf', EXACT_LEAF_REASON[uniqueLeaf.match.source], EXACT_LEAF_CONFIDENCE[uniqueLeaf.match.source]),
      leaf: uniqueLeaf,
      familyUri: uniqueLeaf.familyUri,
      altLeaves: altLeaves(contained, uniqueLeaf),
      altFamilies: altFamilies(familyVotes, uniqueLeaf.familyUri),
      coverage: coverageOf(uniqueLeaf.match)
    };
  }

  const [winner] = familyVotes;

  if (!winner) {
    return unresolved('unresolved_weak_evidence', altLeaves(ranked, null));
  }

  const familyLeaves = contained.filter((candidate) => candidate.familyUri === winner.familyUri);
  const reason = bestSourceLeaves.length > 1 || !winner.hasQueryExtraTerms ? 'family_leaf_ambiguity' : 'family_dictionary_gap';

  return {
    decision: decision('family', reason, voteConfidence(winner, familyVotes)),
    leaf: null,
    familyUri: winner.familyUri,
    altLeaves: altLeaves([...familyLeaves, ...contained], null),
    altFamilies: altFamilies(familyVotes, winner.familyUri),
    coverage: coverageOf(familyLeaves[0]?.match ?? null)
  };
}

function voteFamilies(evidence: SpanEvidence, ranked: MatchedCandidate[]): FamilyVote[] {
  const votes = new Map<string, FamilyVote>();
  const voters = [
    ...ranked.flatMap((candidate) => (candidate.familyUri ? [{ familyUri: candidate.familyUri, match: candidate.match }] : [])),
    ...evidence.familyLabelCandidates.map((candidate) => ({ familyUri: candidate.familyUri, match: candidate.match }))
  ];

  for (const { familyUri, match } of voters) {
    if (match.relation === 'partial') {
      continue;
    }

    const vote = votes.get(familyUri) ?? { familyUri, score: 0, hasQueryExtraTerms: false };
    vote.score += match.overlap;
    vote.hasQueryExtraTerms ||= match.relation === 'query_contains_label';
    votes.set(familyUri, vote);
  }

  return [...votes.values()].sort((left, right) => right.score - left.score);
}

function altLeaves(ranked: MatchedCandidate[], selected: MatchedCandidate | null): OccupationCandidate[] {
  const seen = new Set<string>(selected ? [selected.uri] : []);
  const alternatives: OccupationCandidate[] = [];

  for (const candidate of ranked) {
    if (seen.has(candidate.uri)) {
      continue;
    }

    seen.add(candidate.uri);
    alternatives.push(candidate);

    if (alternatives.length === MAX_ALT_LEAVES) {
      break;
    }
  }

  return alternatives;
}

function altFamilies(votes: FamilyVote[], selectedFamilyUri: string | null): FamilyShare[] {
  return votes
    .filter((vote) => vote.familyUri !== selectedFamilyUri)
    .slice(0, MAX_ALT_FAMILIES)
    .map((vote) => ({ familyUri: vote.familyUri, confidence: voteConfidence(vote, votes) }));
}

function voteConfidence(vote: FamilyVote, votes: FamilyVote[]): number {
  const totalScore = votes.reduce((sum, item) => sum + item.score, 0);

  return round2((vote.score / totalScore) * CONFIDENCE.familyVoteCeiling);
}

export function altLeafConfidence(match: LabelMatch | null): number {
  return round2((match?.overlap ?? 0) * CONFIDENCE.familyVoteCeiling);
}

function unresolved(reason: EscoDecisionReason, alternatives: OccupationCandidate[]): SpanDecision {
  return {
    decision: decision('unresolved', reason, 0),
    leaf: null,
    familyUri: null,
    altLeaves: alternatives,
    altFamilies: [],
    coverage: coverageOf(alternatives[0]?.match ?? null)
  };
}

function decision(type: EscoDecision['type'], reason: EscoDecisionReason, confidence: number): EscoDecision {
  return { type, reason, confidence };
}

function coverageOf(match: LabelMatch | null): EscoCoverage {
  return { matchedTokens: match?.matchedTokens ?? [], missingTokens: match?.missingTokens ?? [] };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
