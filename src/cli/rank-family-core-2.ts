// Family ranking answers one question:
// "Of these candidate ESCO families, which one best explains the prepared query?"
//
// The model is deliberately small:
//   retrieval proposes candidates;
//   semantic fit decides whether a family means the query;
//   contradictions demote strong-but-wrong retrieval;
//   priors support a plausible family;
//   recovery contributes more evidence and uses the same scorer.
//
// There is one score and one comparator. Do not add a recovered-family cascade,
// a confidence-floor pass, or a tier-first ordering path here.

import type { PreparedQuery } from '../query/query-preparation.js';
import { expandTokenVariants } from '../query/query-preparation.js';
import { getOccupationFamilyContext } from '../api/occupation-family-taxonomy.js';
import {
  familyCapabilityRelevanceMultiplier,
  tryLoadOccupationFamilyCapabilityRelevanceLookup
} from '../query/occupation-family-capability-relevance.js';
import { familyTokenRelevanceMultiplier, tryLoadOccupationFamilyTokenRelevanceLookup } from '../query/occupation-family-token-relevance.js';
import {
  getGenericHeadFamilyPriors,
  getGenericHeadFamilyContradiction,
  hasGenericHeadVenueContext,
  type GenericHeadFamilyPrior
} from '../search-pipeline/generic-head-family-priors.js';
import { getFamilySpecializationPriors } from '../search-pipeline/family-specialization-priors.js';
import { getJobFunctionFamilyPriors } from '../search-pipeline/job-function-family-priors.js';
import {
  compareFamilyStructureToQuery,
  getFamilyStructureRule,
  familyStructureSupportScore,
  type FamilyStructureComparison
} from '../runtime/occupation-family-structure-rules.js';
import {
  BRANCH_MARGIN_POLICY,
  EVIDENCE_NORMALIZATION_POLICY,
  FAMILY_SCORING_POLICY,
  GENERIC_RISK_PENALTY,
  PIPELINE_DECISION_GATE
} from '../scoring/scoring-policy.js';
import { clampScore, roundScore } from '../utils/operators.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import type {
  FamilyEvidenceTier,
  PipelineEvidenceChannel,
  PipelineEvidenceRecord,
  PipelineFamilyCandidate,
  PipelineLeafCandidate,
  RankedPipelineFamily,
  RecoveredFamilySelectionAuthority
} from './rank-family-core.js';

export type FamilyRankingScore = {
  retrieval: number;
  semantic: number;
  recovery: number;
  prior: number;
  corroboration: number;
  contradiction: number;
  structuralSupport: number;
  structuralContradiction: number;
  structuralRejected: boolean;
  // 1 unless post-recovery authority found zero role-token grounding for this family. Pre-recovery
  // scoring has no such notion and always passes 1, so the gate in `compareFamilyScores` is a no-op
  // until recovery authority is attached.
  roleGrounded: number;
  total: number;
  // A safety-net minimum for the *displayed* confidence only. Never folded into `total`, so it can
  // never change which family sorts first in `compareFamilyScores` -- only how confident the winner looks.
  floor: number;
};

type ComparableFamily = {
  rankingScore?: FamilyRankingScore;
  confidence: number;
  evidence: readonly PipelineEvidenceRecord[];
  evidenceTierRank: number;
  branchShare: number;
  familyLabel: string;
  selectionAuthority?: RecoveredFamilySelectionAuthority;
};

type ScoreInput = {
  family: PipelineFamilyCandidate | RankedPipelineFamily;
  supportingLeaves?: readonly PipelineLeafCandidate[];
  preparedQuery?: PreparedQuery;
  sourceName?: string;
  jobFunction?: string | null;
  authority?: RecoveredFamilySelectionAuthority;
  tier?: FamilyEvidenceTier;
};

export function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return 0;
  }

  return preparedQuery.intent.roleTokens.length >= 2 ? 2 : 1;
}

export function rankFamilyCandidatesForRecovery(
  preparedQuery: PreparedQuery,
  sourceName: string,
  topFamilyLimit: number,
  candidateFamilies: readonly PipelineFamilyCandidate[],
  candidateLeavesByFamilyKey: ReadonlyMap<string, readonly PipelineLeafCandidate[]>,
  jobFunction: string | null = null
): RankedPipelineFamily[] {
  const families = candidateFamilies.slice();

  if (hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens)) {
    const existingFamilyKeys = new Set(families.map((family) => family.familyKey));
    const priors =
      getGenericHeadFamilyPriors(
        authoritativeRoleHeadTokens(preparedQuery),
        preparedQuery.intent.roleTokens,
        preparedQuery.intent.venueTokens,
        Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch)
      ) ?? [];

    for (const prior of priors) {
      const familyKey = `family:${prior.familyNodeId}`;
      if (existingFamilyKeys.has(familyKey)) {
        continue;
      }

      families.push({
        familyKey,
        familyKind: 'family',
        familyNodeId: prior.familyNodeId,
        familyLabel: prior.familyLabel,
        evidence: [],
        supportingLeafIds: new Set(),
        branchShare: 0,
        branchMarginRatio: null,
        evidenceTier: null,
        evidenceTierRank: Number.POSITIVE_INFINITY,
        score: 0,
        confidence: 0
      });
      existingFamilyKeys.add(familyKey);
    }
  }

  const scoredFamilies = families
    .map((family) => {
      const leaves = candidateLeavesByFamilyKey.get(family.familyKey) ?? [];
      const supportingLeaves = leaves.filter((leaf) => family.supportingLeafIds.has(leaf.graphNodeId));
      const tier = familyEvidenceTier(family.evidence);
      const rankingScore = scoreFamily({ family, supportingLeaves, preparedQuery, sourceName, jobFunction, tier });

      return {
        ...family,
        evidenceTier: tier,
        evidenceTierRank: familyEvidenceTierRank(tier),
        rankingScore,
        score: Math.max(rankingScore.total, rankingScore.floor),
        confidence: Math.max(rankingScore.total, rankingScore.floor)
      };
    })
    .sort(compareFamilyScores);
  const selectedFamilies = scoredFamilies.slice(0, topFamilyLimit);
  const selectedFamilyKeys = new Set(selectedFamilies.map((family) => family.familyKey));

  for (const family of scoredFamilies) {
    if (selectedFamilies.length >= topFamilyLimit || selectedFamilyKeys.has(family.familyKey)) {
      continue;
    }

    const hasProtectedCoverage = family.evidence.some((record) => {
      if (record.channel !== 'family_profile' && record.channel !== 'exact_family_canonical' && record.channel !== 'useful_exact') {
        return false;
      }

      const coverage = numericDetail(record.details.coverage) ?? 0;
      const roleCoverage = numericDetail(record.details.role_coverage) ?? 0;
      const domainCoverage = numericDetail(record.details.domain_coverage) ?? 0;
      return coverage >= 1 && roleCoverage >= 1 && (preparedQuery.intent.domainTokens.length === 0 || domainCoverage >= 1);
    });

    if (hasProtectedCoverage) {
      selectedFamilies.push(family);
      selectedFamilyKeys.add(family.familyKey);
    }
  }

  if (preparedQuery.intent.roleHeadRequiresContext && preparedQuery.intent.roleHeadHasContext) {
    for (const family of scoredFamilies.filter(hasPrimaryGenericHeadFamilyPrior)) {
      if (selectedFamilyKeys.has(family.familyKey)) {
        continue;
      }

      const replaceIndex = selectedFamilies.findIndex((entry) => !hasPrimaryGenericHeadFamilyPrior(entry));
      if (replaceIndex < 0) {
        continue;
      }

      selectedFamilies.splice(replaceIndex, 1, family);
      selectedFamilyKeys.add(family.familyKey);
    }
  }

  return selectedFamilies
    .sort(compareFamilyScores)
    .slice(0, topFamilyLimit)
    .map((family, index) => ({
      ...family,
      rank: index + 1,
      supportingLeafCount: family.supportingLeafIds.size,
      leaves: []
    }));
}

export function rankFamilyCandidatesForSelection(
  preparedQuery: PreparedQuery,
  families: readonly RankedPipelineFamily[],
  recoverAuthority: (family: RankedPipelineFamily, preparedQuery: PreparedQuery) => RecoveredFamilySelectionAuthority
): RankedPipelineFamily[] {
  return families
    .map((family) => {
      const authority = recoverAuthority(family, preparedQuery);
      const rankingScore = scoreFamily({ family, authority, preparedQuery });
      return {
        ...family,
        selectionAuthority: authority,
        rankingScore,
        score: Math.max(rankingScore.total, rankingScore.floor),
        confidence: Math.max(rankingScore.total, rankingScore.floor)
      };
    })
    .sort(compareFamilyScores)
    .map((family, index) => ({ ...family, rank: index + 1 }));
}

function scoreFamily(input: ScoreInput): FamilyRankingScore {
  const { family, authority } = input;
  const preparedQuery = input.preparedQuery;
  const sourceName = input.sourceName ?? '';
  const supportingLeaves = input.supportingLeaves ?? [];
  const existingScore = 'rankingScore' in family ? (family.rankingScore as FamilyRankingScore | undefined) : undefined;
  const base = existingScore ?? {
    retrieval: family.confidence,
    semantic: 0,
    recovery: 0,
    prior: 0,
    corroboration: 0,
    contradiction: 0,
    structuralSupport: 0,
    structuralContradiction: 0,
    structuralRejected: false,
    roleGrounded: 1,
    total: family.confidence,
    floor: 0
  };

  let retrieval = base.retrieval;
  let semantic = base.semantic;
  let recovery = base.recovery;
  let prior = base.prior;
  let corroboration = base.corroboration;
  let contradiction = base.contradiction;
  let structuralSupport = base.structuralSupport;
  let structuralContradiction = base.structuralContradiction;
  let structuralRejected = base.structuralRejected;
  let roleGrounded = base.roleGrounded;
  let floor = 0;

  if (preparedQuery) {
    applyGenericHeadPriorEvidence(family, preparedQuery);
    const tier = input.tier ?? familyEvidenceTier(family.evidence);
    const leafFit = maxLeafFit(supportingLeaves);
    const branch = Math.max(
      family.branchShare,
      ratioToScore(family.branchMarginRatio, BRANCH_MARGIN_POLICY.WEAK_RATIO, BRANCH_MARGIN_POLICY.STRONG_RATIO)
    );
    const exactOccupation = Math.max(
      maxEvidenceScore(family.evidence, ['exact_canonical']),
      maxEvidenceScore(family.evidence, ['exact_alias'])
    );
    const exactFamily = maxEvidenceScore(family.evidence, ['exact_family_canonical']);
    const lexical = maxEvidenceScore(family.evidence, [
      'folded_alias',
      'ngram_alias',
      'lexical',
      'capability_task',
      'useful_exact',
      'family_profile',
      'reviewed_family_signal'
    ]);

    retrieval = clampScore(
      exactOccupation *
        (FAMILY_SCORING_POLICY.EXACT_ALIAS_BASE_CONTRIBUTION + leafFit * FAMILY_SCORING_POLICY.EXACT_ALIAS_LEAF_FIT_WEIGHT) +
        exactFamily * FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_WEIGHT +
        lexical * FAMILY_SCORING_POLICY.LEXICAL_EVIDENCE_WEIGHT +
        branch * FAMILY_SCORING_POLICY.HYBRID_BRANCH_STRENGTH_WEIGHT
    );
    semantic = clampScore(
      familyRoleCoverage(family.evidence, preparedQuery) * FAMILY_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
        familyDomainCoverage(family.evidence, preparedQuery) * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        leafCapabilityShare(supportingLeaves) * FAMILY_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT +
        leafFit * FAMILY_SCORING_POLICY.LEAF_FIT_WEIGHT +
        familyTokenRelevance(family.familyNodeId, preparedQuery, sourceName) * FAMILY_SCORING_POLICY.TOKEN_RELEVANCE_TIEBREAK_WEIGHT
    );
    prior = clampScore(
      maxEvidenceScore(family.evidence, ['reviewed_family_signal']) * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_WEIGHT +
        jobFunctionPrior(family, supportingLeaves, preparedQuery, input.jobFunction ?? null) * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        genericHeadPrior(family.familyNodeId, preparedQuery) * FAMILY_SCORING_POLICY.GENERIC_HEAD_PRIOR_WEIGHT +
        familyGroupAgreement(family.familyNodeId, preparedQuery) * FAMILY_SCORING_POLICY.GROUP_ALIGNMENT_WEIGHT +
        familySpecializationPrior(family.familyNodeId, preparedQuery)
    );
    corroboration = clampScore(
      (Math.min(supportingLeaves.length, FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES) / FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES) *
        FAMILY_SCORING_POLICY.HYBRID_SUPPORT_BREADTH_WEIGHT
    );
    contradiction = clampScore(
      familyGroupMismatch(family.familyNodeId, preparedQuery) * FAMILY_SCORING_POLICY.GROUP_MISMATCH_PENALTY_WEIGHT +
        maxEvidenceScore(family.evidence, ['reviewed_family_penalty']) * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_PENALTY_WEIGHT +
        averageGenericPenalty(supportingLeaves) * FAMILY_SCORING_POLICY.GENERIC_PENALTY_WEIGHT +
        familyCapabilityContradiction(family.familyNodeId, preparedQuery, sourceName) *
          FAMILY_SCORING_POLICY.CAPABILITY_RELEVANCE_CONTRADICTION_PENALTY_WEIGHT +
        genericHeadContradiction(family.familyNodeId, preparedQuery) * FAMILY_SCORING_POLICY.GENERIC_HEAD_VENUE_CONTRADICTION_PENALTY_WEIGHT
    );
    const structure = familyStructureComparison(family.familyNodeId, preparedQuery);
    structuralSupport = structure.support;
    structuralContradiction = structure.contradiction;
    structuralRejected = structure.comparison?.hardRejected ?? false;
    semantic = clampScore(semantic + structuralSupport);
    contradiction = clampScore(Math.max(contradiction, structuralContradiction));
    floor = tier === 'local_exact' || hasEvidence(family.evidence, 'useful_exact') ? FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR : 0;
  }

  if (authority) {
    retrieval = clampScore(
      Math.max(retrieval, authority.exactFamilyCanonical, authority.usefulExact) +
        Math.min(authority.exactAliasCount, 5) * 0.03 +
        Math.min(authority.foldedAliasCount, 5) * 0.02 +
        authority.branchShare * 0.06
    );
    semantic = clampScore(
      Math.max(
        semantic,
        authority.roleCoverage * FAMILY_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
          authority.roleHeadCoverage * 0.12 +
          authority.bestLeafRoleCoverage * 0.16 +
          authority.capabilityRoleCoverage * FAMILY_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT +
          authority.structuralAlignment * 0.12 +
          authority.familyStructureAuthority * 0.18 +
          authority.profileRoleCoverage * 0.08 +
          authority.profileFamilyLabelCoverage * 0.06
      )
    );
    recovery = clampScore(
      Math.min(authority.exactRoleLeafCount, 5) * 0.05 +
        Math.min(authority.partialRoleLeafCount, 5) * 0.025 +
        Math.min(authority.capabilityLeafCount, 5) * 0.025 +
        Math.min(authority.primaryExactAliasLeafCount, 5) * 0.04 +
        Math.min(authority.supportedSpecializationLeafCount, 5) * 0.025
    );
    // groupAgreement/groupMismatch are deliberately NOT folded in here -- `compareFamilyScores`
    // applies them as a tier-gated tiebreak instead, since they're a soft steer that should only
    // decide between families whose evidence tier is otherwise equal, not shift the additive total.
    prior = clampScore(Math.max(prior, authority.reviewedSignal, authority.jobFunctionPrior, authority.genericHeadPrior));
    corroboration = clampScore(
      corroboration + Math.min(authority.exactEvidenceCount, 5) * 0.015 + Math.min(authority.bestRoleTokenMatchCount, 5) * 0.015
    );
    contradiction = clampScore(Math.max(contradiction, authority.familySpecializationMismatch * 0.22));
    roleGrounded = Math.max(authority.roleGrounded, authority.familyStructureAuthority >= 0.7 ? 1 : 0);

    let authorityFloor = authority.exactFamilyCanonical > 0 ? FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR : 0;
    if (authority.familyStructureAuthority >= 0.7) {
      authorityFloor = Math.max(authorityFloor, PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE);
    }
    const usesRoleAgreementOrdering =
      preparedQuery !== undefined &&
      preparedQuery.locale === 'en' &&
      preparedQuery.acronymTokens.length === 0 &&
      exactRoleMatchThreshold(preparedQuery) >= 2;

    if (usesRoleAgreementOrdering) {
      if (authority.exactRoleLeafCount >= 3 && authority.capabilityLeafCount >= 2) {
        authorityFloor = Math.max(authorityFloor, FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_CAPABILITY_FLOOR);
      } else if (authority.exactRoleLeafCount >= 3) {
        authorityFloor = Math.max(authorityFloor, FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_FLOOR);
      } else if (authority.profileFamilyLabelCoverage >= 1 && authority.profileRoleCoverage >= 1) {
        authorityFloor = Math.max(authorityFloor, PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE);
      }
    }

    floor = Math.max(floor, authorityFloor);
  }

  const total = structuralRejected ? 0 : clampScore(semantic + retrieval + recovery + prior + corroboration - contradiction);
  const effectiveFloor = structuralRejected ? 0 : floor;
  return {
    retrieval: roundScore(retrieval),
    semantic: roundScore(semantic),
    recovery: roundScore(recovery),
    prior: roundScore(prior),
    corroboration: roundScore(corroboration),
    contradiction: roundScore(contradiction),
    structuralSupport: roundScore(structuralSupport),
    structuralContradiction: roundScore(structuralContradiction),
    structuralRejected,
    roleGrounded,
    total: roundScore(total),
    floor: roundScore(effectiveFloor)
  };
}

function compareFamilyScores(left: ComparableFamily, right: ComparableFamily): number {
  const leftScore = left.rankingScore ?? {
    retrieval: left.confidence,
    semantic: 0,
    recovery: 0,
    prior: 0,
    corroboration: 0,
    contradiction: 0,
    structuralSupport: 0,
    structuralContradiction: 0,
    structuralRejected: false,
    roleGrounded: 1,
    total: left.confidence,
    floor: 0
  };
  const rightScore = right.rankingScore ?? {
    retrieval: right.confidence,
    semantic: 0,
    recovery: 0,
    prior: 0,
    corroboration: 0,
    contradiction: 0,
    structuralSupport: 0,
    structuralContradiction: 0,
    structuralRejected: false,
    roleGrounded: 1,
    total: right.confidence,
    floor: 0
  };

  if (leftScore.structuralRejected !== rightScore.structuralRejected) {
    return leftScore.structuralRejected ? 1 : -1;
  }

  // Exact family canonical evidence is an unambiguous shortcut: a family the query names outright
  // always wins the first pass, before any additive scoring runs.
  const leftExactCanonical = hasEvidence(left.evidence, 'exact_family_canonical');
  const rightExactCanonical = hasEvidence(right.evidence, 'exact_family_canonical');
  if (leftExactCanonical !== rightExactCanonical) {
    return leftExactCanonical ? -1 : 1;
  }

  const leftContradicted = leftScore.contradiction >= 0.35 && leftScore.semantic < 0.25 ? 1 : 0;
  const rightContradicted = rightScore.contradiction >= 0.35 && rightScore.semantic < 0.25 ? 1 : 0;
  const leftStrongSemantic = leftScore.semantic >= 0.35 && leftScore.contradiction < 0.25 ? 1 : 0;
  const rightStrongSemantic = rightScore.semantic >= 0.35 && rightScore.contradiction < 0.25 ? 1 : 0;
  const leftStructuralNet = structuralNetScore(leftScore);
  const rightStructuralNet = structuralNetScore(rightScore);
  const structuralNetDelta = rightStructuralNet - leftStructuralNet;
  const reviewedSignalDelta =
    maxEvidenceScore(right.evidence, ['reviewed_family_signal']) - maxEvidenceScore(left.evidence, ['reviewed_family_signal']);
  const genericHeadPriorDelta =
    maxEvidenceScore(right.evidence, ['generic_head_family_prior']) - maxEvidenceScore(left.evidence, ['generic_head_family_prior']);

  // Selection-authority tiebreaks below are undefined pre-recovery, so every term is optional-chained
  // to a neutral 0/false and contributes nothing until `rankFamilyCandidatesForSelection` attaches authority.
  const leftAuthority = left.selectionAuthority;
  const rightAuthority = right.selectionAuthority;
  const bothHaveExactAlias = (leftAuthority?.exactAliasCount ?? 0) > 0 && (rightAuthority?.exactAliasCount ?? 0) > 0;
  if (bothHaveExactAlias && leftAuthority && rightAuthority && Math.abs(leftAuthority.branchShare - rightAuthority.branchShare) > 0.2) {
    return rightAuthority.branchShare - leftAuthority.branchShare;
  }

  const groupHintEligible = left.evidenceTierRank === right.evidenceTierRank;
  const foldedAliasAuthority = bothHaveExactAlias
    ? 0
    : Number((rightAuthority?.foldedAliasCount ?? 0) > 0) - Number((leftAuthority?.foldedAliasCount ?? 0) > 0) ||
      (rightAuthority?.foldedAliasCount ?? 0) - (leftAuthority?.foldedAliasCount ?? 0) ||
      (rightAuthority?.exactEvidenceCount ?? 0) - (leftAuthority?.exactEvidenceCount ?? 0);

  return (
    leftContradicted - rightContradicted ||
    (Math.abs(genericHeadPriorDelta) >= 0.2 ? genericHeadPriorDelta : 0) ||
    (Math.abs(reviewedSignalDelta) >= 0.2 ? reviewedSignalDelta : 0) ||
    rightStrongSemantic - leftStrongSemantic ||
    (Math.abs(structuralNetDelta) >= FAMILY_STRUCTURE_ORDERING_MARGIN ? structuralNetDelta : 0) ||
    rightScore.roleGrounded - leftScore.roleGrounded ||
    rightScore.total - leftScore.total ||
    rightScore.semantic - leftScore.semantic ||
    rightScore.retrieval - leftScore.retrieval ||
    rightScore.recovery - leftScore.recovery ||
    rightScore.prior - leftScore.prior ||
    (groupHintEligible ? (rightAuthority?.groupAgreement ?? 0) - (leftAuthority?.groupAgreement ?? 0) : 0) ||
    (groupHintEligible ? (leftAuthority?.groupMismatch ?? 0) - (rightAuthority?.groupMismatch ?? 0) : 0) ||
    (leftAuthority?.familySpecializationMismatch ?? 0) - (rightAuthority?.familySpecializationMismatch ?? 0) ||
    left.evidenceTierRank - right.evidenceTierRank ||
    Number((rightAuthority?.exactAliasCount ?? 0) > 0) - Number((leftAuthority?.exactAliasCount ?? 0) > 0) ||
    foldedAliasAuthority ||
    (rightAuthority?.exactAliasCount ?? 0) - (leftAuthority?.exactAliasCount ?? 0) ||
    right.branchShare - left.branchShare ||
    (rightAuthority?.bestLeafStructuralPreference ?? 0) - (leftAuthority?.bestLeafStructuralPreference ?? 0) ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

function structuralNetScore(score: FamilyRankingScore): number {
  return score.structuralRejected ? -1 : score.structuralSupport - score.structuralContradiction;
}

function applyGenericHeadPriorEvidence(family: PipelineFamilyCandidate | RankedPipelineFamily, preparedQuery: PreparedQuery): void {
  if (family.familyKind !== 'family' || hasEvidence(family.evidence, 'generic_head_family_prior')) {
    return;
  }

  const priors = getGenericHeadFamilyPriors(
    authoritativeRoleHeadTokens(preparedQuery),
    preparedQuery.intent.roleTokens,
    preparedQuery.intent.venueTokens,
    Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch)
  );
  const prior = priors.find((entry) => entry.familyNodeId === family.familyNodeId);
  if (!prior) {
    return;
  }

  if (hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens)) {
    family.evidence.push(genericHeadFamilyPriorEvidence(prior, preparedQuery));
  }
}

function hasPrimaryGenericHeadFamilyPrior(family: ComparableFamily): boolean {
  return family.evidence.some(
    (record) =>
      record.channel === 'generic_head_family_prior' &&
      typeof record.details.prior_strength === 'string' &&
      record.details.prior_strength === 'primary'
  );
}

function genericHeadFamilyPriorEvidence(prior: GenericHeadFamilyPrior, preparedQuery: PreparedQuery): PipelineEvidenceRecord {
  const roleHead = preparedQuery.intent.roleHeadTokens[preparedQuery.intent.roleHeadTokens.length - 1] ?? null;

  return {
    channel: 'generic_head_family_prior',
    score: prior.strength === 'primary' ? 0.82 : 0.58,
    sourceStage: 'generic_head_context',
    details: {
      role_head: roleHead,
      matched_role_terms: roleHead ? [roleHead] : [],
      matched_tokens: roleHead ? [roleHead] : [],
      prior_strength: prior.strength,
      family_node_id: prior.familyNodeId,
      family_label: prior.familyLabel
    }
  };
}

type FamilyStructureRankSignal = {
  readonly comparison: FamilyStructureComparison | null;
  readonly support: number;
  readonly contradiction: number;
};

const FAMILY_STRUCTURE_MAX_EXPECTED_SCORE = 25;
const FAMILY_STRUCTURE_SUPPORT_WEIGHT = 0.14;
const FAMILY_STRUCTURE_SOFT_CONTRADICTION_WEIGHT = 0.12;
const FAMILY_STRUCTURE_HARD_REJECTION_PENALTY = 0.75;
const FAMILY_STRUCTURE_ORDERING_MARGIN = 0.05;

function familyStructureComparison(familyNodeId: number, preparedQuery: PreparedQuery): FamilyStructureRankSignal {
  if (!getFamilyStructureRule(familyNodeId)) {
    return {
      comparison: null,
      support: 0,
      contradiction: 0
    };
  }

  const comparison = compareFamilyStructureToQuery(familyNodeId, familyStructureQueryTokens(preparedQuery), preparedQuery.locale);
  const rawSupport = Math.max(familyStructureSupportScore(comparison), 0);
  const support = clampScore(
    (Math.min(rawSupport, FAMILY_STRUCTURE_MAX_EXPECTED_SCORE) / FAMILY_STRUCTURE_MAX_EXPECTED_SCORE) * FAMILY_STRUCTURE_SUPPORT_WEIGHT
  );
  const softContradictionCount = comparison.dimensions.filter(
    (dimension) =>
      dimension.contradicted && !comparison.reasons.some((reason) => reason.startsWith(`${dimension.dimension} contradiction:`))
  ).length;
  const contradiction = comparison.hardRejected
    ? FAMILY_STRUCTURE_HARD_REJECTION_PENALTY
    : clampScore(Math.min(softContradictionCount, 3) * FAMILY_STRUCTURE_SOFT_CONTRADICTION_WEIGHT);

  return {
    comparison,
    support,
    contradiction
  };
}

function familyStructureQueryTokens(preparedQuery: PreparedQuery): string[] {
  const genericRoleHeads = new Set(preparedQuery.intent.genericRoleHeadTokens.map((token) => foldSearchText(token)));
  const authoritativeRoleHeads = new Set(preparedQuery.intent.authoritativeRoleHeadTokens.map((token) => foldSearchText(token)));
  const tokens = [
    ...preparedQuery.intent.roleTokens,
    ...preparedQuery.intent.domainTokens,
    ...preparedQuery.intent.venueTokens,
    ...preparedQuery.intent.authoritativeRoleHeadTokens,
    ...preparedQuery.usefulFoldedRecallTokens
  ];

  for (let index = 0; index < preparedQuery.foldedTokens.length; index += 1) {
    for (const size of [2, 3]) {
      const phrase = preparedQuery.foldedTokens.slice(index, index + size).join(' ');
      if (phrase.length > 0 && phrase.includes(' ')) {
        tokens.push(phrase);
      }
    }
  }

  return Array.from(new Set(tokens)).filter((token) => {
    const foldedToken = foldSearchText(token);
    return token.length > 0 && (!genericRoleHeads.has(foldedToken) || authoritativeRoleHeads.has(foldedToken));
  });
}

function familyEvidenceTier(evidence: readonly PipelineEvidenceRecord[]): FamilyEvidenceTier {
  if (hasEvidence(evidence, 'exact_family_canonical') || hasEvidence(evidence, 'exact_canonical') || hasEvidence(evidence, 'exact_alias')) {
    return 'local_exact';
  }

  if (hasEvidence(evidence, 'useful_exact')) {
    return 'useful_exact';
  }

  if (hasEvidence(evidence, 'cross_locale_english_backbone')) {
    return 'cross_locale_backbone';
  }

  if (hasEvidence(evidence, 'folded_alias')) {
    return 'folded_alias';
  }

  if (
    hasEvidence(evidence, 'reviewed_family_signal') ||
    hasEvidence(evidence, 'family_structure') ||
    hasEvidence(evidence, 'generic_head_family_prior') ||
    hasCoveredNgramAlias(evidence) ||
    hasPreparedPhraseWindow(evidence)
  ) {
    return 'strong_phrase';
  }

  return hasEvidence(evidence, 'family_profile') ? 'family_profile' : 'graph_only';
}

function familyEvidenceTierRank(tier: FamilyEvidenceTier): number {
  const rank: Record<FamilyEvidenceTier, number> = {
    local_exact: 1,
    useful_exact: 2,
    cross_locale_backbone: 3,
    folded_alias: 4,
    strong_phrase: 5,
    family_profile: 6,
    graph_only: 7
  };
  return rank[tier];
}

function familyAuthorityFloor(evidence: readonly PipelineEvidenceRecord[], tier: FamilyEvidenceTier): number {
  if (tier === 'local_exact' || hasEvidence(evidence, 'useful_exact')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  return 0;
}

function maxEvidenceScore(evidence: readonly PipelineEvidenceRecord[], channels: readonly PipelineEvidenceChannel[]): number {
  const wanted = new Set<PipelineEvidenceChannel>(channels);
  return Math.max(...evidence.filter((record) => wanted.has(record.channel)).map(normalizeEvidenceScore), 0);
}

function normalizeEvidenceScore(record: PipelineEvidenceRecord): number {
  if (record.channel === 'graph_family_recovery') {
    return 0;
  }

  if (record.channel === 'folded_alias') {
    return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.FOLDED_ALIAS_DISCOUNT);
  }

  if (record.channel === 'lexical') {
    return clampScore(record.score * EVIDENCE_NORMALIZATION_POLICY.OPENSEARCH_LEXICAL_BOOST);
  }

  return clampScore(record.score);
}

function familyRoleCoverage(evidence: readonly PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const roleTokens =
    preparedQuery.intent.roleTokens.length >= 2 &&
    preparedQuery.intent.domainTokens.length === 0 &&
    preparedQuery.intent.venueTokens.length === 0 &&
    !preparedQuery.commonRolePhraseMatch
      ? [...new Set([...preparedQuery.intent.roleTokens, ...preparedQuery.usefulFoldedRecallTokens])]
      : groundingRoleTokens(preparedQuery);

  return evidenceTokenCoverage(evidence, roleTokens, 'role_coverage', 'matched_role_terms');
}

function familyDomainCoverage(evidence: readonly PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  return evidenceTokenCoverage(evidence, preparedQuery.intent.domainTokens, 'domain_coverage', 'matched_domain_terms');
}

function evidenceTokenCoverage(
  evidence: readonly PipelineEvidenceRecord[],
  tokens: readonly string[],
  explicitCoverageKey: string,
  matchedTermsKey: string
): number {
  if (tokens.length === 0) {
    return 0;
  }

  const supported = new Set<string>();
  let explicitCoverage = 0;

  for (const record of evidence) {
    const explicit = numericDetail(record.details[explicitCoverageKey]);
    if (explicit !== null) {
      explicitCoverage = Math.max(explicitCoverage, explicit);
      if (explicit >= 1) {
        addTokens(supported, tokens);
      }
    }

    const matchedTerms = stringArrayDetail(record.details[matchedTermsKey]);
    const matchedTokens = stringArrayDetail(record.details.matched_tokens);
    addTokens(
      supported,
      tokens.filter((token) => tokenListHasEquivalent(matchedTerms, token) || tokenListHasEquivalent(matchedTokens, token))
    );
  }

  return clampScore(Math.max(supported.size / tokens.length, explicitCoverage));
}

function groundingRoleTokens(preparedQuery: PreparedQuery): string[] {
  if (minimumRequiredRoleMatches(preparedQuery) > 1) {
    return preparedQuery.intent.roleTokens;
  }

  const heads = authoritativeRoleHeadTokens(preparedQuery);
  return heads.length > 0 ? heads : preparedQuery.intent.roleTokens;
}

function minimumRequiredRoleMatches(preparedQuery: PreparedQuery): number {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return 0;
  }

  if (
    preparedQuery.intent.roleHeadRequiresContext &&
    preparedQuery.intent.roleHeadHasContext &&
    preparedQuery.intent.roleTokens.length > authoritativeRoleHeadTokens(preparedQuery).length
  ) {
    return Math.min(2, preparedQuery.intent.roleTokens.length);
  }

  return 1;
}

function authoritativeRoleHeadTokens(preparedQuery: PreparedQuery): string[] {
  if (preparedQuery.intent.authoritativeRoleHeadTokens.length > 0) {
    return preparedQuery.intent.authoritativeRoleHeadTokens;
  }

  if (preparedQuery.intent.roleHeadRequiresContext && !preparedQuery.intent.roleHeadHasContext) {
    return [];
  }

  return preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens;
}

function tokenListHasEquivalent(values: readonly string[], token: string): boolean {
  const foldedValues = new Set(values.map((value) => foldSearchText(value)));
  const foldedToken = foldSearchText(token);
  return (
    foldedValues.has(foldedToken) || expandTokenVariants([foldedToken], 'en').some((variant) => foldedValues.has(foldSearchText(variant)))
  );
}

function addTokens(target: Set<string>, tokens: readonly string[]): void {
  for (const token of tokens) {
    target.add(foldSearchText(token));
  }
}

function maxLeafFit(leaves: readonly PipelineLeafCandidate[]): number {
  return Math.max(...leaves.map((leaf) => leaf.leafFitScore ?? 0), 0);
}

function leafCapabilityShare(leaves: readonly PipelineLeafCandidate[]): number {
  if (leaves.length === 0) {
    return 0;
  }

  return leaves.filter((leaf) => leaf.hasCapabilitySupport).length / leaves.length;
}

function averageGenericPenalty(leaves: readonly PipelineLeafCandidate[]): number {
  if (leaves.length === 0) {
    return 0;
  }

  return leaves.reduce((sum, leaf) => sum + genericPenalty(leaf.genericRisk), 0) / leaves.length;
}

function genericPenalty(risk: PipelineLeafCandidate['genericRisk']): number {
  if (risk === 'high') {
    return GENERIC_RISK_PENALTY.HIGH;
  }

  if (risk === 'medium') {
    return GENERIC_RISK_PENALTY.MEDIUM;
  }

  return GENERIC_RISK_PENALTY.LOW;
}

function familyGroupAgreement(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const preferred = preparedQuery.intent.occupationClassPreference.preferredFamilyGroups;
  return family && preferred.includes(family.group) ? 1 : 0;
}

function familyGroupMismatch(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const disfavored = preparedQuery.intent.occupationClassPreference.disfavoredFamilyGroups;
  return family && disfavored.includes(family.group) ? 1 : 0;
}

function jobFunctionPrior(
  family: PipelineFamilyCandidate | RankedPipelineFamily,
  supportingLeaves: readonly PipelineLeafCandidate[],
  preparedQuery: PreparedQuery,
  jobFunction: string | null
): number {
  const prior = getJobFunctionFamilyPriors(jobFunction ?? undefined)?.find((entry) => entry.familyNodeId === family.familyNodeId);
  if (!prior || preparedQuery.intent.roleTokens.length === 0) {
    return 0;
  }

  const hasAliasEvidence = family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias');
  const hasRoleEvidenceCoverage =
    evidenceTokenCoverage(family.evidence, groundingRoleTokens(preparedQuery), 'role_coverage', 'matched_role_terms') > 0;

  if (!hasAliasEvidence && !hasRoleEvidenceCoverage && !familyHasRoleGroundedLeaf(supportingLeaves, preparedQuery)) {
    return 0;
  }

  return prior.strength === 'primary' ? 0.88 : 0.62;
}

function familyHasRoleGroundedLeaf(leaves: readonly PipelineLeafCandidate[], preparedQuery: PreparedQuery): boolean {
  const roleHeadTokens = authoritativeRoleHeadTokens(preparedQuery);
  const altRoleHeadTokens = preparedQuery.intent.altRoleHeadTokens;
  if (roleHeadTokens.length === 0) {
    return false;
  }

  return leaves.some((leaf) => {
    const labelTokens = Array.from(new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel))));
    // canonicalLabel is always English -- altRoleHeadTokens (the safe English equivalent of
    // roleHeadTokens, resolved once at intent-build time in query-intent.ts) is checked here too, so a
    // curated cross-locale synonym isn't treated as "no role-grounded leaf" just because
    // tokenListHasEquivalent only knows English morphology, not curated equivalence classes.
    return (
      roleHeadTokens.some((token) => tokenListHasEquivalent(labelTokens, token)) ||
      altRoleHeadTokens.some((term) => labelTokens.includes(term))
    );
  });
}

// NOTE: dropping this gate so a recognized head carrier alone (no venue) could reach each profile's
// `default` fallback was tried and reverted -- on the 50-title fixture it regressed a real case
// ("Operator Frezare CNC" defaulted to "Process control technicians" instead of the correct trades
// family) without fixing anything measured, because several profiles' `default` lists are only safe
// guesses when paired with a matched venue, not as a blanket head-only prior. Loosening this needs
// per-profile review of which `default` lists are safe head-only guesses, not a global gate removal.
function genericHeadPrior(familyNodeId: number, preparedQuery: PreparedQuery): number {
  if (!hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens)) {
    return 0;
  }

  const prior = getGenericHeadFamilyPriors(
    authoritativeRoleHeadTokens(preparedQuery),
    preparedQuery.intent.roleTokens,
    preparedQuery.intent.venueTokens,
    Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch)
  )?.find((entry) => entry.familyNodeId === familyNodeId);

  return prior?.strength === 'primary' ? 0.82 : prior ? 0.58 : 0;
}

// A definite (matched) venue that maps to a *different* family under this head carrier is a real
// conflict, not silence -- see getGenericHeadFamilyContradiction. An unmapped/absent venue is not
// penalized: that's exactly the case the `default` fallback above is meant to cover.
function genericHeadContradiction(familyNodeId: number, preparedQuery: PreparedQuery): number {
  return getGenericHeadFamilyContradiction(
    authoritativeRoleHeadTokens(preparedQuery),
    preparedQuery.intent.roleTokens,
    preparedQuery.intent.venueTokens,
    Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch),
    familyNodeId
  )
    ? 1
    : 0;
}

// A tiny, tag-keyed nudge (see family-specialization-priors.ts): each tag already bundles every
// locale's synonyms for that concept, so this stays a handful of entries no matter how many wordings
// exist. Deliberately small -- real token-relevance evidence should always win when it's present;
// this only tips the close calls where that data is thin or absent.
function familySpecializationPrior(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const prior = getFamilySpecializationPriors(preparedQuery.usefulFoldedRecallTokens).find((entry) => entry.familyNodeId === familyNodeId);
  return prior?.strength === 'primary' ? 0.04 : prior ? 0.02 : 0;
}

function familyTokenRelevance(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  const lookup = tryLoadOccupationFamilyTokenRelevanceLookup(sourceName);
  return lookup ? familyTokenRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, preparedQuery.usefulFoldedRecallTokens) : 0;
}

function familyCapabilityContradiction(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  if (preparedQuery.usefulFoldedRecallTokens.length === 0) {
    return 0;
  }

  const lookup = tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName);
  if (!lookup) {
    return 0;
  }

  return clampScore(
    1 - familyCapabilityRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, preparedQuery.usefulFoldedRecallTokens)
  );
}

function ratioToScore(ratio: number | null, weak: number, strong: number): number {
  if (ratio === null) {
    return BRANCH_MARGIN_POLICY.MIN_SCORE;
  }

  if (ratio <= weak) {
    return BRANCH_MARGIN_POLICY.MIN_SCORE;
  }

  if (ratio >= strong) {
    return 1;
  }

  return roundScore(BRANCH_MARGIN_POLICY.MIN_SCORE + ((ratio - weak) / (strong - weak)) * BRANCH_MARGIN_POLICY.SCORE_RANGE);
}

function hasEvidence(evidence: readonly PipelineEvidenceRecord[], channel: PipelineEvidenceChannel): boolean {
  return evidence.some((record) => record.channel === channel);
}

function hasCoveredNgramAlias(evidence: readonly PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'ngram_alias') {
      return false;
    }

    const coverage = numericDetail(record.details.query_useful_token_coverage);
    return coverage !== null && coverage > 0;
  });
}

function hasPreparedPhraseWindow(evidence: readonly PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'lexical') {
      return false;
    }

    return stringArrayDetail(record.details.matched_queries).some((query) =>
      /^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(?:[2-9]|\d{2,})_idx_\d+$/u.test(query)
    );
  });
}

function numericDetail(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayDetail(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
