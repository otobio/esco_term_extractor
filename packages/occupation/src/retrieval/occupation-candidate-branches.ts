import {
  OccupationCandidateRetriever,
  type CandidateEvidenceRecord,
  type RetrieveOccupationCandidatesOptions,
  type RetrieveOccupationCandidatesResult
} from './occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired, type RuntimeSearchMetaCoreRecord } from '../runtime/occupation-search-meta-artifact.js';
import { mergeTimings, timed, type TimingMap } from '../utils/timing.js';
import { requireNonNegativeIntegerAtMost } from '../utils/validation.js';

export const DEFAULT_SIBLING_LIMIT = 5;

export type ExpandOccupationCandidateBranchesOptions = RetrieveOccupationCandidatesOptions & {
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

export type ExpandOccupationCandidateBranchesResult = {
  originalQuery: string;
  query: string;
  querySpans: string[];
  locale: string;
  normalizedQuery: string;
  foldedQuery: string;
  querySignals: string[];
  keptQuerySignals: string[];
  querySignalCleaningMs: number;
  roleSpanSelection: RetrieveOccupationCandidatesResult['roleSpanSelection'];
  sourceName: string;
  retrievalProfile: RetrieveOccupationCandidatesResult['retrievalProfile'];
  modelKey: string;
  modelDimensions: number | null;
  limit: number;
  siblingLimit: number;
  evaluationQueryId: number | null;
  scannedAliasHitCount: number;
  scannedOpenSearchHitCount: number;
  timings: TimingMap;
  candidates: ExpandedOccupationCandidate[];
  branches: OccupationCandidateBranch[];
};

type SearchMetaFields = {
  search_meta_id: number;
  graph_node_id: number;
  canonical_label: string;
  generic_risk: 'low' | 'medium' | 'high';
  has_hierarchy: number;
  has_capability_support: number;
  family_node_id: number | null;
  family_label: string | null;
  group_node_id: number | null;
  group_label: string | null;
  parent_node_id: number | null;
  parent_label: string | null;
};

export class OccupationCandidateBranchExpander {
  public constructor(private readonly retriever: OccupationCandidateRetriever = new OccupationCandidateRetriever()) {}

  public async run(options: ExpandOccupationCandidateBranchesOptions): Promise<ExpandOccupationCandidateBranchesResult> {
    const timings: TimingMap = {};
    const siblingLimit = normalizeSiblingLimit(options.siblingLimit);
    const retrieval = await timed(() => this.retriever.run(options), 'branch.candidate_retrieval_total', timings);
    const graphNodeIds = retrieval.candidates.map((candidate) => candidate.graphNodeId);

    if (graphNodeIds.length === 0) {
      return {
        ...copyRetrievalHeader(retrieval, siblingLimit),
        timings: mergeTimings(retrieval.timings, timings),
        candidates: [],
        branches: []
      };
    }

    const runtimeMeta = await timed(
      () => loadOccupationSearchMetaArtifactRequired(retrieval.sourceName),
      'branch.search_meta_artifact_load',
      timings
    );
    const searchMetaByNodeId = new Map<number, SearchMetaFields>();
    const ancestorsBySearchMetaId = new Map<number, ExpandedCandidateAncestor[]>();
    const siblingsBySearchMetaId = new Map<number, ExpandedCandidateSibling[]>();

    for (const graphNodeId of graphNodeIds) {
      const record = runtimeMeta.getCoreRecord(graphNodeId);

      if (!record) {
        continue;
      }

      searchMetaByNodeId.set(graphNodeId, runtimeRecordToSearchMetaFields(record));
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
            canonicalLabel: searchMeta?.canonical_label ?? candidate.canonicalLabel,
            totalScore: candidate.totalScore,
            channelScores: candidate.channelScores,
            evidence: candidate.evidence,
            genericRisk: searchMeta?.generic_risk ?? null,
            hasHierarchy: searchMeta?.has_hierarchy === 1,
            hasCapabilitySupport: searchMeta?.has_capability_support === 1,
            familyNodeId: searchMeta?.family_node_id ?? evidenceFamily?.familyNodeId ?? null,
            familyLabel: searchMeta?.family_label ?? evidenceFamily?.familyLabel ?? null,
            groupNodeId: searchMeta?.group_node_id ?? null,
            groupLabel: searchMeta?.group_label ?? null,
            parentNodeId: searchMeta?.parent_node_id ?? null,
            parentLabel: searchMeta?.parent_label ?? null,
            ancestors: searchMeta ? (ancestorsBySearchMetaId.get(searchMeta.search_meta_id) ?? []) : [],
            siblings: searchMeta ? (siblingsBySearchMetaId.get(searchMeta.search_meta_id) ?? []) : [],
            ...branch
          };
        }),
      'branch.expand_candidates',
      timings
    );

    const branches = await timed(() => buildBranches(candidates), 'branch.build_branches', timings);

    return {
      ...copyRetrievalHeader(retrieval, siblingLimit),
      timings: mergeTimings(retrieval.timings, timings),
      candidates,
      branches
    };
  }
}

function copyRetrievalHeader(
  retrieval: RetrieveOccupationCandidatesResult,
  siblingLimit: number
): Omit<ExpandOccupationCandidateBranchesResult, 'candidates' | 'branches'> {
  return {
    originalQuery: retrieval.originalQuery,
    query: retrieval.query,
    querySpans: retrieval.querySpans,
    locale: retrieval.locale,
    normalizedQuery: retrieval.normalizedQuery,
    foldedQuery: retrieval.foldedQuery,
    querySignals: retrieval.querySignals,
    keptQuerySignals: retrieval.keptQuerySignals,
    querySignalCleaningMs: retrieval.querySignalCleaningMs,
    roleSpanSelection: retrieval.roleSpanSelection,
    sourceName: retrieval.sourceName,
    retrievalProfile: retrieval.retrievalProfile,
    modelKey: retrieval.modelKey,
    modelDimensions: retrieval.modelDimensions,
    limit: retrieval.limit,
    siblingLimit,
    evaluationQueryId: retrieval.evaluationQueryId,
    scannedAliasHitCount: retrieval.scannedAliasHitCount,
    scannedOpenSearchHitCount: retrieval.scannedOpenSearchHitCount,
    timings: retrieval.timings
  };
}

function runtimeRecordToSearchMetaFields(record: RuntimeSearchMetaCoreRecord): SearchMetaFields {
  return {
    search_meta_id: record.searchMetaId,
    graph_node_id: record.graphNodeId,
    canonical_label: record.canonicalLabel,
    generic_risk: record.genericRisk,
    has_hierarchy: record.hasHierarchy ? 1 : 0,
    has_capability_support: record.hasCapabilitySupport ? 1 : 0,
    family_node_id: record.familyNodeId,
    family_label: record.familyLabel,
    group_node_id: record.groupNodeId,
    group_label: record.groupLabel,
    parent_node_id: record.parentNodeId,
    parent_label: record.parentLabel
  };
}

function buildBranchIdentity(
  graphNodeId: number,
  canonicalLabel: string,
  searchMeta: SearchMetaFields | null,
  evidence: CandidateEvidenceRecord[]
): Pick<ExpandedOccupationCandidate, 'branchKey' | 'branchKind' | 'branchNodeId' | 'branchLabel'> {
  if (searchMeta?.family_node_id && searchMeta.family_label) {
    return {
      branchKey: `family:${searchMeta.family_node_id}`,
      branchKind: 'family',
      branchNodeId: searchMeta.family_node_id,
      branchLabel: searchMeta.family_label
    };
  }

  if (searchMeta?.group_node_id && searchMeta.group_label) {
    return {
      branchKey: `group:${searchMeta.group_node_id}`,
      branchKind: 'group',
      branchNodeId: searchMeta.group_node_id,
      branchLabel: searchMeta.group_label
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
    branchLabel: searchMeta?.canonical_label ?? canonicalLabel
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
    maxCandidateScore: roundScore(Math.max(...candidates.map((candidate) => candidate.totalScore))),
    totalCandidateScore: roundScore(candidates.reduce((sum, candidate) => sum + candidate.totalScore, 0)),
    channelScores: {
      exactAlias: roundScore(Math.max(...candidates.map((candidate) => candidate.channelScores.exact_alias ?? 0))),
      foldedAlias: roundScore(Math.max(...candidates.map((candidate) => candidate.channelScores.folded_alias ?? 0))),
      ngramAlias: roundScore(Math.max(...candidates.map((candidate) => candidate.channelScores.ngram_alias ?? 0))),
      openSearchLexical: roundScore(Math.max(...candidates.map((candidate) => candidate.channelScores.lexical ?? 0))),
      capabilityTask: roundScore(Math.max(...candidates.map((candidate) => candidate.channelScores.capability_task ?? 0)))
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
