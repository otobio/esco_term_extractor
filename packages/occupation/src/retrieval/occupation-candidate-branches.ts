import {
  OccupationCandidateRetriever,
  type CandidateEvidenceRecord,
  type RetrieveOccupationCandidatesOptions,
  type RetrieveOccupationCandidatesResult
} from './occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired, type RuntimeSearchMetaCoreRecord } from '../runtime/occupation-search-meta-artifact.js';
import { mergeTimings, timed, type TimingMap } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost, requirePositiveIntegerAtMost } from '../utils/validation.js';
import { maxOf } from '../utils/operators.js';
import type { PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';

export const DEFAULT_SIBLING_LIMIT = 5;

export type OccupationCandidateBranchRetrievalOptions = RetrieveOccupationCandidatesOptions & {
  retrievalQuery: NonNullable<RetrieveOccupationCandidatesOptions['retrievalQuery']>;
  siblingLimit?: number;
};

export type CandidateBranchKind = 'family' | 'group' | 'node';

export type ExpandedCandidateAncestor = {
  graphNodeId: number;
  canonicalLabel: string;
  nodeLevel: string;
  distanceFromLeaf: number;
  ancestorRole: string;
};

export type ExpandedCandidateSibling = {
  graphNodeId: number;
  canonicalLabel: string;
  nodeLevel: string;
  siblingKind: string;
  weight: number | null;
};

export type ExpandedOccupationCandidate = {
  graphNodeId: number;
  canonicalLabel: string;
  totalScore: number;
  channelScores: RetrieveOccupationCandidatesResult['candidates'][number]['channelScores'];
  evidence: CandidateEvidenceRecord[];
  genericRisk: 'low' | 'medium' | 'high' | null;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  familyNodeId: number | null;
  familyLabel: string | null;
  groupNodeId: number | null;
  groupLabel: string | null;
  parentNodeId: number | null;
  parentLabel: string | null;
  ancestors: ExpandedCandidateAncestor[];
  siblings: ExpandedCandidateSibling[];
  branchKey: string;
  branchKind: CandidateBranchKind;
  branchNodeId: number;
  branchLabel: string;
};

export type CandidateBranchScoreSummary = {
  candidateCount: number;
  maxCandidateScore: number;
  totalCandidateScore: number;
  channelScores: {
    exactAlias: number;
    foldedAlias: number;
    ngramAlias: number;
    openSearchLexical: number;
    capabilityTask: number;
  };
};

export type OccupationCandidateBranch = {
  branchKey: string;
  branchKind: CandidateBranchKind;
  branchNodeId: number;
  branchLabel: string;
  scoreSummary: CandidateBranchScoreSummary;
  candidates: ExpandedOccupationCandidate[];
};

export type OccupationCandidateBranchRetrievalResult = {
  originalQuery: string;
  query: string;
  querySpans: string[];
  locale: string;
  retrievalLocales: string[];
  keptQuerySignals: string[];
  roleSpanSelection: PreparedOccupationRetrievalQuery['roleSpanSelection'];
  sourceName: string;
  retrievalProfile: RetrieveOccupationCandidatesResult['retrievalProfile'];
  limit: number;
  siblingLimit: number;
  evaluationQueryId: number | null;
  scannedAliasHitCount: number;
  scannedOpenSearchHitCount: number;
  timings: TimingMap;
  candidates: ExpandedOccupationCandidate[];
  branches: OccupationCandidateBranch[];
};

export class OccupationCandidateBranchRetriever {
  public constructor(private readonly retriever: OccupationCandidateRetriever = new OccupationCandidateRetriever()) {}

  public async run(options: OccupationCandidateBranchRetrievalOptions): Promise<OccupationCandidateBranchRetrievalResult> {
    return this.retrieveCandidatesWithGraphBranches(options);
  }

  public async retrieveCandidatesWithGraphBranches(
    options: OccupationCandidateBranchRetrievalOptions
  ): Promise<OccupationCandidateBranchRetrievalResult> {
    const timings: TimingMap = {};
    const siblingLimit = options.siblingLimit!;
    const sourceName = options.sourceName!;
    const limit = options.limit!;

    const retrieval = await timed(() => this.retriever.run(options), 'branch.candidate_retrieval_total', timings);
    const graphNodeIds = retrieval.candidates.map((candidate) => candidate.graphNodeId);

    if (graphNodeIds.length === 0) {
      return {
        ...copyRetrievalHeader(options, retrieval, sourceName, limit, siblingLimit),
        timings: mergeTimings(retrieval.timings, timings),
        candidates: [],
        branches: []
      };
    }

    const runtimeMeta = await timed(
      () => loadOccupationSearchMetaArtifactRequired(sourceName),
      'branch.search_meta_artifact_load',
      timings
    );
    const searchMetaByNodeId = new Map<number, RuntimeSearchMetaCoreRecord>();
    const ancestorsBySearchMetaId = new Map<number, ExpandedCandidateAncestor[]>();
    const siblingsBySearchMetaId = new Map<number, ExpandedCandidateSibling[]>();

    for (const graphNodeId of graphNodeIds) {
      const record = runtimeMeta.getCoreRecord(graphNodeId);

      if (!record) {
        continue;
      }

      searchMetaByNodeId.set(graphNodeId, record);
      ancestorsBySearchMetaId.set(record.searchMetaId, record.ancestors);
      siblingsBySearchMetaId.set(record.searchMetaId, record.siblings.slice(0, siblingLimit));
    }

    const candidates = await timed(
      () =>
        retrieval.candidates.map((candidate) => {
          const searchMeta = searchMetaByNodeId.get(candidate.graphNodeId) ?? null;
          const branch = buildBranchIdentity(candidate.graphNodeId, candidate.canonicalLabel, searchMeta, candidate.evidence);
          const evidenceFamily = evidenceFamilyIdentity(candidate.evidence);

          return {
            graphNodeId: candidate.graphNodeId,
            canonicalLabel: searchMeta?.canonicalLabel ?? candidate.canonicalLabel,
            totalScore: candidate.totalScore,
            channelScores: candidate.channelScores,
            evidence: candidate.evidence,
            genericRisk: searchMeta?.genericRisk ?? null,
            hasHierarchy: searchMeta?.hasHierarchy ?? false,
            hasCapabilitySupport: searchMeta?.hasCapabilitySupport ?? false,
            familyNodeId: searchMeta?.familyNodeId ?? evidenceFamily?.familyNodeId ?? null,
            familyLabel: searchMeta?.familyLabel ?? evidenceFamily?.familyLabel ?? null,
            groupNodeId: searchMeta?.groupNodeId ?? null,
            groupLabel: searchMeta?.groupLabel ?? null,
            parentNodeId: searchMeta?.parentNodeId ?? null,
            parentLabel: searchMeta?.parentLabel ?? null,
            ancestors: searchMeta ? (ancestorsBySearchMetaId.get(searchMeta.searchMetaId) ?? []) : [],
            siblings: searchMeta ? (siblingsBySearchMetaId.get(searchMeta.searchMetaId) ?? []) : [],
            ...branch
          };
        }),
      'branch.expand_candidates',
      timings
    );

    const branches = await timed(() => buildBranches(candidates), 'branch.build_branches', timings);

    return {
      ...copyRetrievalHeader(options, retrieval, sourceName, limit, siblingLimit),
      timings: mergeTimings(retrieval.timings, timings),
      candidates,
      branches
    };
  }
}

function copyRetrievalHeader(
  options: OccupationCandidateBranchRetrievalOptions,
  retrieval: RetrieveOccupationCandidatesResult,
  sourceName: string,
  limit: number,
  siblingLimit: number
): Omit<OccupationCandidateBranchRetrievalResult, 'candidates' | 'branches'> {
  const retrievalQuery = options.retrievalQuery;

  return {
    originalQuery: retrievalQuery.originalQuery,
    query: retrievalQuery.query,
    querySpans: retrievalQuery.querySpans,
    locale: retrievalQuery.locale,
    retrievalLocales: retrieval.retrievalLocales,
    keptQuerySignals: retrievalQuery.keptQuerySignals,
    roleSpanSelection: retrievalQuery.roleSpanSelection,
    sourceName,
    retrievalProfile: retrieval.retrievalProfile,
    limit,
    siblingLimit,
    evaluationQueryId: options.evaluationQueryId ?? null,
    scannedAliasHitCount: retrieval.scannedAliasHitCount,
    scannedOpenSearchHitCount: retrieval.scannedOpenSearchHitCount,
    timings: retrieval.timings
  };
}

function buildBranchIdentity(
  graphNodeId: number,
  canonicalLabel: string,
  searchMeta: RuntimeSearchMetaCoreRecord | null,
  evidence: CandidateEvidenceRecord[]
): Pick<ExpandedOccupationCandidate, 'branchKey' | 'branchKind' | 'branchNodeId' | 'branchLabel'> {
  if (searchMeta?.familyNodeId && searchMeta.familyLabel) {
    return {
      branchKey: `family:${searchMeta.familyNodeId}`,
      branchKind: 'family',
      branchNodeId: searchMeta.familyNodeId,
      branchLabel: searchMeta.familyLabel
    };
  }

  if (searchMeta?.groupNodeId && searchMeta.groupLabel) {
    return {
      branchKey: `group:${searchMeta.groupNodeId}`,
      branchKind: 'group',
      branchNodeId: searchMeta.groupNodeId,
      branchLabel: searchMeta.groupLabel
    };
  }

  const evidenceFamily = evidenceFamilyIdentity(evidence);

  if (evidenceFamily && evidenceFamily.familyNodeId === graphNodeId) {
    return {
      branchKey: `family:${evidenceFamily.familyNodeId}`,
      branchKind: 'family',
      branchNodeId: evidenceFamily.familyNodeId,
      branchLabel: evidenceFamily.familyLabel
    };
  }

  return {
    branchKey: `node:${graphNodeId}`,
    branchKind: 'node',
    branchNodeId: graphNodeId,
    branchLabel: searchMeta?.canonicalLabel ?? canonicalLabel
  };
}

function evidenceFamilyIdentity(evidence: CandidateEvidenceRecord[]): { familyNodeId: number; familyLabel: string } | null {
  for (const record of evidence) {
    const familyNodeId = typeof record.details?.family_node_id === 'number' ? record.details.family_node_id : null;
    const familyLabel = typeof record.details?.family_label === 'string' ? record.details.family_label.trim() : '';

    if (familyNodeId && familyLabel) {
      return {
        familyNodeId,
        familyLabel
      };
    }
  }

  return null;
}

function buildBranches(candidates: ExpandedOccupationCandidate[]): OccupationCandidateBranch[] {
  const candidatesByBranch = new Map<string, ExpandedOccupationCandidate[]>();

  for (const candidate of candidates) {
    const branchCandidates = candidatesByBranch.get(candidate.branchKey) ?? [];
    branchCandidates.push(candidate);
    candidatesByBranch.set(candidate.branchKey, branchCandidates);
  }

  return Array.from(candidatesByBranch.values())
    .map((branchCandidates) => {
      const sortedCandidates = [...branchCandidates].sort(compareCandidates);
      const firstCandidate = sortedCandidates[0];

      return {
        branchKey: firstCandidate.branchKey,
        branchKind: firstCandidate.branchKind,
        branchNodeId: firstCandidate.branchNodeId,
        branchLabel: firstCandidate.branchLabel,
        scoreSummary: buildBranchScoreSummary(sortedCandidates),
        candidates: sortedCandidates
      };
    })
    .sort(compareBranches);
}

function buildBranchScoreSummary(candidates: ExpandedOccupationCandidate[]): CandidateBranchScoreSummary {
  return {
    candidateCount: candidates.length,
    maxCandidateScore: roundScore(maxOf(candidates, (candidate) => candidate.totalScore, -Infinity)),
    totalCandidateScore: roundScore(candidates.reduce((sum, candidate) => sum + candidate.totalScore, 0)),
    channelScores: {
      exactAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.exact_alias ?? 0, -Infinity)),
      foldedAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.folded_alias ?? 0, -Infinity)),
      ngramAlias: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.ngram_alias ?? 0, -Infinity)),
      openSearchLexical: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.lexical ?? 0, -Infinity)),
      capabilityTask: roundScore(maxOf(candidates, (candidate) => candidate.channelScores.capability_task ?? 0, -Infinity))
    }
  };
}

function compareBranches(left: OccupationCandidateBranch, right: OccupationCandidateBranch): number {
  return (
    right.scoreSummary.maxCandidateScore - left.scoreSummary.maxCandidateScore ||
    right.scoreSummary.totalCandidateScore - left.scoreSummary.totalCandidateScore ||
    right.scoreSummary.candidateCount - left.scoreSummary.candidateCount ||
    left.branchLabel.localeCompare(right.branchLabel)
  );
}

function compareCandidates(left: ExpandedOccupationCandidate, right: ExpandedOccupationCandidate): number {
  return (
    right.totalScore - left.totalScore ||
    (right.channelScores.exact_alias ?? 0) - (left.channelScores.exact_alias ?? 0) ||
    (right.channelScores.folded_alias ?? 0) - (left.channelScores.folded_alias ?? 0) ||
    (right.channelScores.lexical ?? 0) - (left.channelScores.lexical ?? 0) ||
    (right.channelScores.capability_task ?? 0) - (left.channelScores.capability_task ?? 0) ||
    left.canonicalLabel.localeCompare(right.canonicalLabel)
  );
}

function normalizeSiblingLimit(limit: number | undefined): number {
  return requireNonNegativeIntegerAtMost(limit ?? DEFAULT_SIBLING_LIMIT, 100, 'Sibling limit');
}

function roundScore(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
