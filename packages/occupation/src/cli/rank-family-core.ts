// Family-ranking ownership lives here so the pipeline can orchestrate retrieval/recovery while swapping
// the recovery-family ranker. Post-recovery authority still receives already-computed leaf/family facts
// from the pipeline, but the ordering cascade remains centralized here.
import type { RetrievalChannel } from '../retrieval/occupation-candidates.js';
import { expandTokenVariants, type PreparedQuery } from '../query/query-preparation.js';
import {
  BRANCH_MARGIN_POLICY,
  EVIDENCE_NORMALIZATION_POLICY,
  FAMILY_SCORING_POLICY,
  GENERIC_RISK_PENALTY,
  PIPELINE_DECISION_GATE
} from '../scoring/scoring-policy.js';
import { familyTokenRelevanceMultiplier, tryLoadOccupationFamilyTokenRelevanceLookup } from '../query/occupation-family-token-relevance.js';
import {
  familyCapabilityRelevanceMultiplier,
  tryLoadOccupationFamilyCapabilityRelevanceLookup
} from '../query/occupation-family-capability-relevance.js';
import { getOccupationFamilyContext } from '../api/occupation-family-taxonomy.js';
import type { OccupationLeafStructureRecord } from '../runtime/occupation-leaf-structure-contract.js';
import type { CapabilityFit } from '../search-pipeline/ranking/capability-fit-ranker.js';
import type { FamilyScopedLeafFit } from '../search-pipeline/ranking/family-scoped-leaf-ranker.js';
import type { LeafClosenessRank } from '../search-pipeline/ranking/leaf-closeness-ranker.js';
import type { LeafSelectionEvidence } from '../search-pipeline/ranking/leaf-selection-evidence-ranker.js';
import {
  getGenericHeadFamilyPriors,
  hasGenericHeadVenueContext,
  type GenericHeadFamilyPrior
} from '../search-pipeline/generic-head-family-priors.js';
import { getJobFunctionFamilyPriors, type JobFunctionFamilyPrior } from '../search-pipeline/job-function-family-priors.js';
import { clampScore, roundScore } from '../utils/operators.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';

export type PipelineEvidenceChannel =
  | RetrievalChannel
  | 'exact_family_canonical'
  | 'useful_exact'
  | 'cross_locale_english_backbone'
  | 'job_function_family_prior'
  | 'generic_head_family_prior'
  | 'reviewed_family_signal'
  | 'reviewed_family_penalty'
  | 'family_structure'
  | 'family_profile'
  | 'graph_support'
  | 'graph_family_recovery';

export type PipelineEvidenceRecord = {
  channel: PipelineEvidenceChannel;
  score: number;
  sourceStage: string;
  details: Record<string, unknown>;
};

export type PipelineLeafCandidate = {
  graphNodeId: number;
  canonicalLabel: string;
  familyKey: string;
  familyKind: 'family' | 'group' | 'node';
  familyNodeId: number;
  familyLabel: string;
  genericRisk: 'low' | 'medium' | 'high' | null;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  leafFitScore: number | null;
  leafStructure: OccupationLeafStructureRecord | null;
  evidence: PipelineEvidenceRecord[];
  closeness: LeafClosenessRank | null;
  familyScopedFit: FamilyScopedLeafFit | null;
  capabilityFit: CapabilityFit | null;
  selectionEvidence: LeafSelectionEvidence | null;
  score: number;
  confidence: number;
};

export type PipelineFamilyCandidate = {
  familyKey: string;
  familyKind: 'family' | 'group' | 'node';
  familyNodeId: number;
  familyLabel: string;
  evidence: PipelineEvidenceRecord[];
  supportingLeafIds: Set<number>;
  branchShare: number;
  branchMarginRatio: number | null;
  evidenceTier: FamilyEvidenceTier | null;
  evidenceTierRank: number;
  score: number;
  confidence: number;
};

export type FamilyEvidenceTier =
  | 'local_exact'
  | 'useful_exact'
  | 'cross_locale_backbone'
  | 'folded_alias'
  | 'family_profile'
  | 'strong_phrase'
  | 'graph_only';

export type RankedPipelineFamily = Omit<PipelineFamilyCandidate, 'supportingLeafIds'> & {
  rank: number;
  supportingLeafCount: number;
  leaves: RankedPipelineLeaf[];
  selectionAuthority?: RecoveredFamilySelectionAuthority;
};

export type RankedPipelineLeaf = PipelineLeafCandidate & {
  rank: number;
};

export function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number {
  const roleTokenCount = preparedQuery.intent.roleTokens.length;

  if (roleTokenCount === 0) {
    return 0;
  }

  return roleTokenCount >= 2 ? 2 : 1;
}

export function selectFamiliesForRecovery(
  scoredFamilies: PipelineFamilyCandidate[],
  preparedQuery: PreparedQuery,
  topFamilyLimit: number
): PipelineFamilyCandidate[] {
  const confidentFamilies = scoredFamilies.filter((family) => family.confidence >= PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE);
  const selectedFamilies = (confidentFamilies.length > 0 ? confidentFamilies : scoredFamilies).slice(0, topFamilyLimit);
  const selectedFamilyKeys = new Set(selectedFamilies.map((family) => family.familyKey));
  const protectedCoverageFamilies = scoredFamilies.filter((family) => hasProtectedRecoveryCoverage(family, preparedQuery));

  if (protectedCoverageFamilies.length > 0) {
    const mergedFamilies = [...selectedFamilies];

    for (const family of protectedCoverageFamilies) {
      if (selectedFamilyKeys.has(family.familyKey)) {
        continue;
      }

      mergedFamilies.push(family);
      selectedFamilyKeys.add(family.familyKey);
    }

    return mergedFamilies.sort(compareFamilies).slice(0, topFamilyLimit);
  }

  if (!preparedQuery.intent.roleHeadRequiresContext || !preparedQuery.intent.roleHeadHasContext) {
    return selectedFamilies;
  }

  const mustKeepFamilyKeys = scoredFamilies.filter(hasPrimaryGenericHeadFamilyPrior).map((family) => family.familyKey);

  if (mustKeepFamilyKeys.length === 0) {
    return selectedFamilies;
  }

  const mergedFamilies = [...selectedFamilies];

  for (const familyKey of mustKeepFamilyKeys) {
    if (selectedFamilyKeys.has(familyKey)) {
      continue;
    }

    const family = scoredFamilies.find((entry) => entry.familyKey === familyKey);

    if (!family) {
      continue;
    }

    const replaceIndex = mergedFamilies.findIndex((entry) => !hasPrimaryGenericHeadFamilyPrior(entry));

    if (replaceIndex < 0) {
      continue;
    }

    mergedFamilies.splice(replaceIndex, 1, family);
    selectedFamilyKeys.add(familyKey);
  }

  return mergedFamilies.sort(compareFamilies).slice(0, topFamilyLimit);
}

function hasProtectedRecoveryCoverage(family: PipelineFamilyCandidate, preparedQuery: PreparedQuery): boolean {
  const familyProfileEvidence = family.evidence.filter(
    (record) => record.channel === 'family_profile' || record.channel === 'exact_family_canonical' || record.channel === 'useful_exact'
  );

  if (familyProfileEvidence.length === 0) {
    return false;
  }

  const requiresDomain = preparedQuery.intent.domainTokens.length > 0;

  return familyProfileEvidence.some((record) => {
    const coverage = numericDetail(record.details.coverage) ?? 0;
    const roleCoverage = numericDetail(record.details.role_coverage) ?? 0;
    const domainCoverage = numericDetail(record.details.domain_coverage) ?? 0;

    if (coverage < 1 || roleCoverage < 1) {
      return false;
    }

    if (requiresDomain && domainCoverage < 1) {
      return false;
    }

    return true;
  });
}

function hasPrimaryGenericHeadFamilyPrior(family: PipelineFamilyCandidate): boolean {
  return family.evidence.some(
    (record) =>
      record.channel === 'generic_head_family_prior' &&
      typeof record.details.prior_strength === 'string' &&
      record.details.prior_strength === 'primary'
  );
}

function numericDetail(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

export function scoreFamilyCandidate(
  family: PipelineFamilyCandidate,
  candidateLeafsByFamilyKey: ReadonlyMap<string, readonly PipelineLeafCandidate[]>,
  preparedQuery: PreparedQuery,
  sourceName: string,
  jobFunction: string | null = null
): PipelineFamilyCandidate {
  const familyLeafs = candidateLeafsByFamilyKey.get(family.familyKey) ?? [];
  const supportingLeafs = familyLeafs.filter((leaf) => family.supportingLeafIds.has(leaf.graphNodeId));
  applyFamilyPriorEvidence(family, supportingLeafs, preparedQuery, jobFunction);
  const evidenceTier = familyEvidenceTier(family.evidence);
  const leafFitScore = maxLeafFitScore(supportingLeafs);
  const roleCoverage = familyRoleCoverageScore(family.evidence, preparedQuery);
  const domainCoverage = maxIntentDomainEvidenceCoverage(family.evidence, preparedQuery);
  const exactCanonicalScore = maxEvidenceScore(family.evidence, ['exact_canonical']);
  const exactAliasScore = maxEvidenceScore(family.evidence, ['exact_alias']);
  const exactFamilyCanonicalScore = maxEvidenceScore(family.evidence, ['exact_family_canonical']);
  const reviewedSignalScore = maxEvidenceScore(family.evidence, ['reviewed_family_signal']);
  const reviewedPenaltyScore = maxEvidenceScore(family.evidence, ['reviewed_family_penalty']);
  const lexicalEvidenceScore = maxEvidenceScore(family.evidence, [
    'reviewed_family_signal',
    'folded_alias',
    'ngram_alias',
    'lexical',
    'capability_task',
    'useful_exact',
    'family_profile'
  ]);
  const jobFunctionPriorScore = maxEvidenceScore(family.evidence, ['job_function_family_prior']);
  const genericHeadPriorScore = maxEvidenceScore(family.evidence, ['generic_head_family_prior']);
  const branchStrength = Math.max(
    family.branchShare,
    ratioToScore(family.branchMarginRatio, BRANCH_MARGIN_POLICY.WEAK_RATIO, BRANCH_MARGIN_POLICY.STRONG_RATIO)
  );
  const supportBreadth =
    Math.min(supportingLeafs.length, FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES) / FAMILY_SCORING_POLICY.MAX_BREADTH_LEAVES;
  const capabilitySupport =
    supportingLeafs.length === 0 ? 0 : supportingLeafs.filter((leaf) => leaf.hasCapabilitySupport).length / supportingLeafs.length;
  const genericPenalty = averageGenericPenalty(supportingLeafs);
  const familyGroupAgreement = familyGroupAgreementScore(family.familyNodeId, preparedQuery);
  const familyGroupMismatch = familyGroupMismatchPenalty(family.familyNodeId, preparedQuery);
  const capabilityRelevanceContradiction = familyCapabilityRelevanceContradictionPenalty(family.familyNodeId, preparedQuery, sourceName);
  const tokenRelevanceTiebreak = familyTokenRelevanceTiebreakScore(family.familyNodeId, preparedQuery, sourceName);
  const exactOccupationScore = Math.max(exactCanonicalScore, exactAliasScore);
  const exactOccupationContribution =
    exactOccupationScore *
    (FAMILY_SCORING_POLICY.EXACT_ALIAS_BASE_CONTRIBUTION + leafFitScore * FAMILY_SCORING_POLICY.EXACT_ALIAS_LEAF_FIT_WEIGHT);
  const authorityFloor = familyEvidenceAuthorityFloor(family.evidence, preparedQuery);
  const confidence = clampScore(
    Math.max(
      authorityFloor,
      branchStrength * FAMILY_SCORING_POLICY.HYBRID_BRANCH_STRENGTH_WEIGHT +
        supportBreadth * FAMILY_SCORING_POLICY.HYBRID_SUPPORT_BREADTH_WEIGHT +
        exactOccupationContribution +
        exactFamilyCanonicalScore * FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_WEIGHT +
        reviewedSignalScore * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_WEIGHT +
        lexicalEvidenceScore * FAMILY_SCORING_POLICY.LEXICAL_EVIDENCE_WEIGHT +
        jobFunctionPriorScore * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        genericHeadPriorScore * FAMILY_SCORING_POLICY.GENERIC_HEAD_PRIOR_WEIGHT +
        roleCoverage * FAMILY_SCORING_POLICY.ROLE_COVERAGE_WEIGHT +
        domainCoverage * FAMILY_SCORING_POLICY.DOMAIN_SUPPORT_WEIGHT +
        familyGroupAgreement * FAMILY_SCORING_POLICY.GROUP_ALIGNMENT_WEIGHT +
        capabilitySupport * FAMILY_SCORING_POLICY.CAPABILITY_SUPPORT_WEIGHT +
        leafFitScore * FAMILY_SCORING_POLICY.LEAF_FIT_WEIGHT -
        familyGroupMismatch * FAMILY_SCORING_POLICY.GROUP_MISMATCH_PENALTY_WEIGHT -
        reviewedPenaltyScore * FAMILY_SCORING_POLICY.REVIEWED_SIGNAL_PENALTY_WEIGHT -
        genericPenalty * FAMILY_SCORING_POLICY.GENERIC_PENALTY_WEIGHT -
        capabilityRelevanceContradiction * FAMILY_SCORING_POLICY.CAPABILITY_RELEVANCE_CONTRADICTION_PENALTY_WEIGHT +
        tokenRelevanceTiebreak * FAMILY_SCORING_POLICY.TOKEN_RELEVANCE_TIEBREAK_WEIGHT
    )
  );

  return {
    ...family,
    evidenceTier,
    evidenceTierRank: familyEvidenceTierRank(evidenceTier),
    score: confidence,
    confidence
  };
}

export function rankFamilyCandidatesForRecovery(
  preparedQuery: PreparedQuery,
  sourceName: string,
  topFamilyLimit: number,
  candidateFamilies: readonly PipelineFamilyCandidate[],
  candidateLeafsByFamilyKey: ReadonlyMap<string, readonly PipelineLeafCandidate[]>,
  jobFunction: string | null = null
): RankedPipelineFamily[] {
  const expandedCandidateFamilies = expandFamilyCandidatesWithGenericHeadPriors(candidateFamilies, preparedQuery);
  const scoredFamilies = expandedCandidateFamilies
    .map((family) => scoreFamilyCandidate(family, candidateLeafsByFamilyKey, preparedQuery, sourceName, jobFunction))
    .sort(compareFamilies);
  const selectedFamilies = selectFamiliesForRecovery(scoredFamilies, preparedQuery, topFamilyLimit);

  return selectedFamilies.map((family, index) => ({
    ...family,
    rank: index + 1,
    supportingLeafCount: family.supportingLeafIds.size,
    leaves: []
  }));
}

function expandFamilyCandidatesWithGenericHeadPriors(
  candidateFamilies: readonly PipelineFamilyCandidate[],
  preparedQuery: PreparedQuery
): PipelineFamilyCandidate[] {
  const hasVenueContext = hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens);

  if (!hasVenueContext) {
    return candidateFamilies.slice();
  }

  const authoritativeHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
  const priors = getGenericHeadFamilyPriors(
    authoritativeHeadTokens,
    preparedQuery.intent.roleTokens,
    preparedQuery.intent.venueTokens,
    Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch)
  );
  const priorList = Array.isArray(priors) ? priors : [];

  if (priorList.length === 0) {
    return candidateFamilies.slice();
  }

  const existingFamilyKeys = new Set(candidateFamilies.map((family) => family.familyKey));
  const injectedFamilies = priorList
    .filter((prior) => !existingFamilyKeys.has(`family:${prior.familyNodeId}`))
    .map((prior) => buildBareFamilyCandidate(prior.familyNodeId, prior.familyLabel));

  return [...candidateFamilies, ...injectedFamilies];
}

function buildBareFamilyCandidate(familyNodeId: number, familyLabel: string): PipelineFamilyCandidate {
  return {
    familyKey: `family:${familyNodeId}`,
    familyKind: 'family',
    familyNodeId,
    familyLabel,
    evidence: [],
    supportingLeafIds: new Set(),
    branchShare: 0,
    branchMarginRatio: null,
    evidenceTier: null,
    evidenceTierRank: Number.POSITIVE_INFINITY,
    score: 0,
    confidence: 0
  };
}

function applyFamilyPriorEvidence(
  family: PipelineFamilyCandidate,
  supportingLeafs: readonly PipelineLeafCandidate[],
  preparedQuery: PreparedQuery,
  jobFunction: string | null
): void {
  if (family.familyKind !== 'family') {
    return;
  }

  if (!hasEvidenceChannel(family.evidence, 'job_function_family_prior')) {
    const jobFunctionPriors = getJobFunctionFamilyPriors(jobFunction ?? undefined);
    const jobFunctionPrior = (Array.isArray(jobFunctionPriors) ? jobFunctionPriors : []).find(
      (prior) => prior.familyNodeId === family.familyNodeId
    );

    if (jobFunctionPrior && hasJobFunctionFamilyPriorRoleGate(family, supportingLeafs, preparedQuery)) {
      family.evidence.push(jobFunctionFamilyPriorEvidence(jobFunctionPrior, jobFunction));
    }
  }

  if (!hasEvidenceChannel(family.evidence, 'generic_head_family_prior')) {
    const authoritativeHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
    const genericHeadPriors = getGenericHeadFamilyPriors(
      authoritativeHeadTokens,
      preparedQuery.intent.roleTokens,
      preparedQuery.intent.venueTokens,
      Boolean(preparedQuery.commonRolePhraseMatch || preparedQuery.familyAliasMatch)
    );
    const genericHeadPriorList = Array.isArray(genericHeadPriors) ? genericHeadPriors : [];
    const genericHeadPrior = genericHeadPriorList.find((prior) => prior.familyNodeId === family.familyNodeId);

    if (genericHeadPrior) {
      const hasVenueContext = hasGenericHeadVenueContext(preparedQuery.intent.roleTokens, preparedQuery.intent.venueTokens);
      const venueOverride = hasVenueContext && genericHeadPriorList.some((prior) => prior.familyNodeId === family.familyNodeId);

      if (venueOverride || hasGenericHeadFamilyPriorRoleGate(family, supportingLeafs, preparedQuery)) {
        family.evidence.push(genericHeadFamilyPriorEvidence(genericHeadPrior, preparedQuery));
      }
    }
  }
}

function hasJobFunctionFamilyPriorRoleGate(
  family: PipelineFamilyCandidate,
  supportingLeafs: readonly PipelineLeafCandidate[],
  preparedQuery: PreparedQuery
): boolean {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return false;
  }

  if (family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
    return true;
  }

  if (
    maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) > 0 ||
    maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery) > 0
  ) {
    return true;
  }

  return supportingLeafs.some((leaf) => hasLeafCandidateRoleGrounding(leaf, preparedQuery));
}

function hasGenericHeadFamilyPriorRoleGate(
  family: PipelineFamilyCandidate,
  supportingLeafs: readonly PipelineLeafCandidate[],
  preparedQuery: PreparedQuery
): boolean {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return false;
  }

  if (family.evidence.some((record) => record.channel === 'exact_alias' || record.channel === 'folded_alias')) {
    return true;
  }

  if (
    maxIntentRoleHeadEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery) ||
    maxIntentRoleEvidenceCoverage(family.evidence, preparedQuery) >= minimumRoleCoverageRatio(preparedQuery)
  ) {
    return true;
  }

  return supportingLeafs.some((leaf) => hasLeafCandidateRoleGrounding(leaf, preparedQuery));
}

function hasLeafCandidateRoleGrounding(leaf: PipelineLeafCandidate, preparedQuery: PreparedQuery): boolean {
  const roleTokens = authoritativeIntentRoleHeadTokens(preparedQuery);

  if (roleTokens.length === 0) {
    return false;
  }

  return matchedIntentTokens(roleTokens, [leaf.canonicalLabel, ...matchedAliasLabels(leaf.evidence)]).matched.length > 0;
}

function jobFunctionFamilyPriorEvidence(prior: JobFunctionFamilyPrior, jobFunction: string | null): PipelineEvidenceRecord {
  return {
    channel: 'job_function_family_prior',
    score: prior.strength === 'primary' ? 0.88 : 0.62,
    sourceStage: 'job_function_context',
    details: {
      job_function: jobFunction,
      prior_strength: prior.strength,
      family_node_id: prior.familyNodeId,
      family_label: prior.familyLabel
    }
  };
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

function matchedAliasLabels(evidence: PipelineEvidenceRecord[]): string[] {
  const aliases = new Set<string>();

  for (const record of evidence) {
    if (record.channel !== 'exact_alias' && record.channel !== 'folded_alias') {
      continue;
    }

    const alias = typeof record.details.alias === 'string' ? record.details.alias.trim() : '';
    const normalizedAlias = typeof record.details.normalized_alias === 'string' ? record.details.normalized_alias.trim() : '';
    const matchedTokens = Array.isArray(record.details.matched_tokens)
      ? record.details.matched_tokens.filter((token): token is string => typeof token === 'string' && token.trim().length > 0)
      : [];

    if (alias) {
      aliases.add(alias);
    }

    if (normalizedAlias) {
      aliases.add(normalizedAlias);
    }

    if (matchedTokens.length > 0) {
      aliases.add(matchedTokens.join(' '));
    }
  }

  return Array.from(aliases);
}

function matchedIntentTokens(tokens: string[], labels: string[]): { matched: string[]; missing: string[] } {
  const labelTokens = new Set(labels.flatMap((label) => tokenizeNormalizedText(foldSearchText(label))));
  const matched = tokens.filter((token) => tokenMatchesLabelTokens(token, labelTokens));

  return {
    matched: Array.from(new Set(matched)).sort(),
    missing: tokens.filter((token) => !matched.includes(token))
  };
}

function maxIntentRoleHeadEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const roleHeadTokens = authoritativeIntentRoleHeadTokens(preparedQuery);
  const altRoleHeadTokens = preparedQuery.intent.altRoleHeadTokens;

  if (roleHeadTokens.length === 0) {
    return 0;
  }

  let maxCoverage = 0;

  for (const record of evidence) {
    const matchedRoleTerms = stringArrayDetail(record.details.matched_role_terms);
    const matchedRoleHeadTerms = roleHeadTokens.filter((token) => tokenListHasEquivalent(matchedRoleTerms, token));

    if (matchedRoleHeadTerms.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedRoleHeadTerms.length / roleHeadTokens.length);
      continue;
    }

    const matchedTokens = stringArrayDetail(record.details.matched_tokens);
    const matchedHeads = roleHeadTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));

    if (matchedHeads.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedHeads.length / roleHeadTokens.length);
      continue;
    }

    // roleHeadTokens/matchedRoleTerms above are in the query's own locale -- a curated cross-locale
    // synonym (e.g. ro "consilier" matched against an English canonical/alias term) would otherwise
    // count as zero coverage here. altRoleHeadTokens is the safe English equivalent resolved once at
    // intent-build time (query-intent.ts); treat any hit against it as full coverage for this record.
    if (tokensOverlap(altRoleHeadTokens, matchedRoleTerms) || tokensOverlap(altRoleHeadTokens, matchedTokens)) {
      maxCoverage = Math.max(maxCoverage, 1);
    }
  }

  return clampScore(maxCoverage);
}

function tokensOverlap(altTerms: readonly string[], candidateTerms: readonly string[]): boolean {
  if (altTerms.length === 0 || candidateTerms.length === 0) {
    return false;
  }

  const foldedCandidates = new Set(candidateTerms.map((term) => foldSearchText(term)));
  return altTerms.some((term) => foldedCandidates.has(term));
}

function minimumRoleCoverageRatio(preparedQuery: PreparedQuery): number {
  const roleTokens = groundingRoleTokens(preparedQuery);

  if (roleTokens.length === 0) {
    return 0;
  }

  return minimumRequiredRoleMatches(preparedQuery) / roleTokens.length;
}

function familyEvidenceTier(evidence: PipelineEvidenceRecord[]): FamilyEvidenceTier {
  if (hasEvidenceChannel(evidence, 'exact_family_canonical')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'exact_canonical')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'exact_alias')) {
    return 'local_exact';
  }

  if (hasEvidenceChannel(evidence, 'useful_exact')) {
    return 'useful_exact';
  }

  if (hasEvidenceChannel(evidence, 'cross_locale_english_backbone')) {
    return 'cross_locale_backbone';
  }

  if (hasEvidenceChannel(evidence, 'folded_alias')) {
    return 'folded_alias';
  }

  if (hasEvidenceChannel(evidence, 'reviewed_family_signal')) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'family_structure')) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'generic_head_family_prior')) {
    return 'strong_phrase';
  }

  if (hasCoveredNgramAliasEvidenceChannel(evidence)) {
    return 'strong_phrase';
  }

  if (hasEvidenceChannel(evidence, 'family_profile')) {
    return 'family_profile';
  }

  if (hasPreparedPhraseWindowFamilyEvidence(evidence)) {
    return 'strong_phrase';
  }

  return 'graph_only';
}

function familyRoleCoverageScore(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  if (
    preparedQuery.intent.roleTokens.length >= 2 &&
    preparedQuery.intent.domainTokens.length === 0 &&
    preparedQuery.intent.venueTokens.length === 0 &&
    !preparedQuery.commonRolePhraseMatch
  ) {
    return maxFullRoleTokenEvidenceCoverage(evidence, preparedQuery);
  }

  return maxIntentRoleEvidenceCoverage(evidence, preparedQuery);
}

function maxLeafFitScore(leafs: readonly PipelineLeafCandidate[]): number {
  if (leafs.length === 0) {
    return 0;
  }

  return Math.max(...leafs.map((leaf) => leaf.leafFitScore ?? 0));
}

function familyEvidenceAuthorityFloor(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  if (hasEvidenceChannel(evidence, 'exact_family_canonical')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  if (hasEvidenceChannel(evidence, 'useful_exact')) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  if (preparedQuery.modifierTokens.length === 0) {
    return 0;
  }

  const usefulQuery = preparedQuery.usefulFoldedRecallTokens.join(' ');

  if (!usefulQuery) {
    return 0;
  }

  const hasPrimaryUsefulExactAlias = evidence.some((record) => {
    if (record.channel !== 'exact_alias') {
      return false;
    }

    const aliasRole = typeof record.details.alias_role === 'string' ? record.details.alias_role : '';
    const foldedAlias = typeof record.details.folded_alias === 'string' ? record.details.folded_alias : '';

    return aliasRole === 'locale_primary' && foldedAlias === usefulQuery;
  });

  return hasPrimaryUsefulExactAlias ? FAMILY_SCORING_POLICY.PRIMARY_USEFUL_EXACT_ALIAS_FLOOR : 0;
}

function maxEvidenceScore(evidence: PipelineEvidenceRecord[], channels: PipelineEvidenceChannel[]): number {
  const channelSet = new Set(channels);
  const matchingEvidence = evidence.filter((record) => channelSet.has(record.channel));
  return Math.max(...matchingEvidence.map((record) => normalizeEvidenceScore(record)), 0);
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

function maxIntentRoleEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const roleTokens = groundingRoleTokens(preparedQuery);

  if (roleTokens.length === 0) {
    return 0;
  }

  let maxCoverage = 0;

  for (const record of evidence) {
    const explicitCoverage = numericDetail(record.details.role_coverage);

    if (explicitCoverage !== null) {
      maxCoverage = Math.max(maxCoverage, explicitCoverage);
      continue;
    }

    const matchedRoleTerms = stringArrayDetail(record.details.matched_role_terms);

    if (matchedRoleTerms.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedRoleTerms.length / roleTokens.length);
      continue;
    }

    const matchedTokens = stringArrayDetail(record.details.matched_tokens);
    const matchedRoleTokens = roleTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));

    if (matchedRoleTokens.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedRoleTokens.length / roleTokens.length);
    }
  }

  return clampScore(maxCoverage);
}

function maxFullRoleTokenEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const roleTokens = [...new Set([...preparedQuery.intent.roleTokens, ...preparedQuery.usefulFoldedRecallTokens])];

  if (roleTokens.length === 0) {
    return 0;
  }

  let maxCoverage = 0;

  for (const record of evidence) {
    const matchedTokens = stringArrayDetail(record.details.matched_tokens);
    const matchedRoleTokens = roleTokens.filter((token) => tokenListHasEquivalent(matchedTokens, token));

    if (matchedRoleTokens.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedRoleTokens.length / roleTokens.length);
    }
  }

  return clampScore(maxCoverage);
}

function maxIntentDomainEvidenceCoverage(evidence: PipelineEvidenceRecord[], preparedQuery: PreparedQuery): number {
  const domainTokens = preparedQuery.intent.domainTokens;

  if (domainTokens.length === 0) {
    return 0;
  }

  let maxCoverage = 0;

  for (const record of evidence) {
    const explicitCoverage = numericDetail(record.details.domain_coverage);

    if (explicitCoverage !== null) {
      maxCoverage = Math.max(maxCoverage, explicitCoverage);
      continue;
    }

    const matchedDomainTerms = stringArrayDetail(record.details.matched_domain_terms);

    if (matchedDomainTerms.length > 0) {
      maxCoverage = Math.max(maxCoverage, matchedDomainTerms.length / domainTokens.length);
    }
  }

  return clampScore(maxCoverage);
}

function averageGenericPenalty(leafs: readonly PipelineLeafCandidate[]): number {
  if (leafs.length === 0) {
    return 0;
  }

  return leafs.reduce((sum, leaf) => sum + genericRiskPenalty(leaf.genericRisk), 0) / leafs.length;
}

function genericRiskPenalty(risk: PipelineLeafCandidate['genericRisk']): number {
  if (risk === 'high') {
    return GENERIC_RISK_PENALTY.HIGH;
  }

  if (risk === 'medium') {
    return GENERIC_RISK_PENALTY.MEDIUM;
  }

  return GENERIC_RISK_PENALTY.LOW;
}

function familyGroupAgreementScore(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const preferredGroups = preparedQuery.intent.occupationClassPreference.preferredFamilyGroups;

  if (!family || preferredGroups.length === 0) {
    return 0;
  }

  return preferredGroups.includes(family.group) ? 1 : 0;
}

function familyGroupMismatchPenalty(familyNodeId: number, preparedQuery: PreparedQuery): number {
  const family = getOccupationFamilyContext(familyNodeId);
  const disfavoredGroups = preparedQuery.intent.occupationClassPreference.disfavoredFamilyGroups;

  if (!family || disfavoredGroups.length === 0) {
    return 0;
  }

  return disfavoredGroups.includes(family.group) ? 1 : 0;
}

function familyCapabilityRelevanceContradictionPenalty(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  const matchedTokens = preparedQuery.usefulFoldedRecallTokens;

  if (matchedTokens.length === 0) {
    return 0;
  }

  const lookup = tryLoadOccupationFamilyCapabilityRelevanceLookup(sourceName);

  if (!lookup) {
    return 0;
  }

  const agreement = familyCapabilityRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, matchedTokens);
  return clampScore(1 - agreement);
}

function familyTokenRelevanceTiebreakScore(familyNodeId: number, preparedQuery: PreparedQuery, sourceName: string): number {
  const matchedTokens = preparedQuery.usefulFoldedRecallTokens;

  if (matchedTokens.length === 0) {
    return 0;
  }

  const lookup = tryLoadOccupationFamilyTokenRelevanceLookup(sourceName);

  if (!lookup) {
    return 0;
  }

  return familyTokenRelevanceMultiplier(lookup, preparedQuery.locale, familyNodeId, matchedTokens);
}

function ratioToScore(ratio: number | null, weak: number, strong: number): number {
  if (ratio === null) {
    return 1;
  }

  if (ratio <= weak) {
    return BRANCH_MARGIN_POLICY.MIN_SCORE;
  }

  if (ratio >= strong) {
    return 1;
  }

  return roundScore(BRANCH_MARGIN_POLICY.MIN_SCORE + ((ratio - weak) / (strong - weak)) * BRANCH_MARGIN_POLICY.SCORE_RANGE);
}

function hasEvidenceChannel(evidence: PipelineEvidenceRecord[], channel: PipelineEvidenceChannel): boolean {
  return evidence.some((record) => record.channel === channel);
}

function hasCoveredNgramAliasEvidenceChannel(evidence: PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'ngram_alias') {
      return false;
    }

    const coverage = record.details.query_useful_token_coverage;
    return typeof coverage === 'number' && coverage > 0;
  });
}

function hasPreparedPhraseWindowFamilyEvidence(evidence: PipelineEvidenceRecord[]): boolean {
  return evidence.some((record) => {
    if (record.channel !== 'lexical') {
      return false;
    }

    const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];
    return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
  });
}

function isPreparedPhraseWindowQuery(value: string): boolean {
  const match = value.match(/^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(\d+)_idx_\d+$/u);

  if (!match) {
    return false;
  }

  return Number.parseInt(match[1] ?? '0', 10) >= 2;
}

function groundingRoleTokens(preparedQuery: PreparedQuery): string[] {
  const minimumMatches = minimumRequiredRoleMatches(preparedQuery);

  if (minimumMatches > 1) {
    return preparedQuery.intent.roleTokens;
  }

  const authoritativeHeads = authoritativeIntentRoleHeadTokens(preparedQuery);
  return authoritativeHeads.length > 0 ? authoritativeHeads : preparedQuery.intent.roleTokens;
}

function minimumRequiredRoleMatches(preparedQuery: PreparedQuery): number {
  if (preparedQuery.intent.roleTokens.length === 0) {
    return 0;
  }

  if (
    preparedQuery.intent.roleHeadRequiresContext &&
    preparedQuery.intent.roleHeadHasContext &&
    preparedQuery.intent.roleTokens.length > authoritativeIntentRoleHeadTokens(preparedQuery).length
  ) {
    return Math.min(2, preparedQuery.intent.roleTokens.length);
  }

  return 1;
}

function authoritativeIntentRoleHeadTokens(preparedQuery: PreparedQuery): string[] {
  if (preparedQuery.intent.authoritativeRoleHeadTokens.length > 0) {
    return preparedQuery.intent.authoritativeRoleHeadTokens;
  }

  if (preparedQuery.intent.roleHeadRequiresContext && !preparedQuery.intent.roleHeadHasContext) {
    return [];
  }

  return preparedQuery.intent.roleHeadTokens.length > 0 ? preparedQuery.intent.roleHeadTokens : preparedQuery.intent.roleTokens;
}

function tokenListHasEquivalent(values: string[], token: string): boolean {
  const valueTokens = new Set(values.map((value) => foldSearchText(value)));
  return tokenMatchesLabelTokens(token, valueTokens);
}

function tokenMatchesLabelTokens(token: string, labelTokens: Set<string>): boolean {
  const foldedToken = foldSearchText(token);

  if (labelTokens.has(foldedToken)) {
    return true;
  }

  return expandTokenVariants([foldedToken], 'en').some((variant) => labelTokens.has(foldSearchText(variant)));
}

function stringArrayDetail(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export type RecoveredFamilySelectionAuthority = {
  roleGrounded: number;
  familyStructureAuthority: number;
  groupAgreement: number;
  groupMismatch: number;
  jobFunctionPrior: number;
  genericHeadPrior: number;
  reviewedSignal: number;
  exactFamilyCanonical: number;
  usefulExact: number;
  primaryExactAliasLeafCount: number;
  exactRoleLeafCount: number;
  partialRoleLeafCount: number;
  bestRoleTokenMatchCount: number;
  capabilityRoleCoverage: number;
  capabilityLeafCount: number;
  exactAliasCount: number;
  foldedAliasCount: number;
  exactEvidenceCount: number;
  roleHeadCoverage: number;
  roleCoverage: number;
  bestLeafRoleCoverage: number;
  bestLeafStructuralPreference: number;
  structuralAlignment: number;
  supportedSpecializationLeafCount: number;
  // 1 when this family is curated as a SPECIALIZED variant (occupationFamilies[].specializationTerms)
  // and the query never mentioned any of those specialization terms -- e.g. "Database and network
  // professionals" for a plain "security personnel" query. 0 for base/generic families (no terms
  // configured) or when the query does mention the specialization.
  familySpecializationMismatch: number;
  profileFamilyLabelCoverage: number;
  profileRoleCoverage: number;
  confidence: number;
  branchShare: number;
};

export function compareFamilies(left: PipelineFamilyCandidate, right: PipelineFamilyCandidate): number {
  return (
    left.evidenceTierRank - right.evidenceTierRank ||
    right.confidence - left.confidence ||
    right.branchShare - left.branchShare ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

// The ordered cascade that resolves ties left over by `compareFamilies`. Each criterion below
// only gets a say once every criterion above it is tied -- keep `FAMILY_SELECTION_AUTHORITY_CASCADE`
// (in rank-family-selection.ts) in sync with this order when editing it, so the CLI's "decisive
// criterion" report stays accurate.
export function compareRecoveredFamilySelectionAuthority(
  left: RankedPipelineFamily,
  right: RankedPipelineFamily,
  preparedQuery: PreparedQuery,
  recoveredFamilySelectionAuthority: (family: RankedPipelineFamily, preparedQuery: PreparedQuery) => RecoveredFamilySelectionAuthority
): number {
  const leftAuthority = recoveredFamilySelectionAuthority(left, preparedQuery);
  const rightAuthority = recoveredFamilySelectionAuthority(right, preparedQuery);

  const exactBranchShareDifference = Math.abs(leftAuthority.branchShare - rightAuthority.branchShare);
  const bothHaveExactAlias = leftAuthority.exactAliasCount > 0 && rightAuthority.exactAliasCount > 0;
  const foldedAliasAuthority = bothHaveExactAlias
    ? 0
    : Number(rightAuthority.foldedAliasCount > 0) - Number(leftAuthority.foldedAliasCount > 0) ||
      rightAuthority.foldedAliasCount - leftAuthority.foldedAliasCount ||
      rightAuthority.exactEvidenceCount - leftAuthority.exactEvidenceCount;

  if (bothHaveExactAlias && exactBranchShareDifference > 0.2) {
    return rightAuthority.branchShare - leftAuthority.branchShare;
  }

  // if (!usesRecoveredRoleAgreementOrdering(preparedQuery)) {
  //   return compareLegacyRecoveredFamilySelectionAuthority(left, right, leftAuthority, rightAuthority, foldedAliasAuthority);
  // }

  // occupationClassHint (behind groupAgreement/groupMismatch) is a soft steer -- "prefer/disfavor
  // families whose group matches the class implied by a management-style label" -- not an
  // authority that should override a family with meaningfully stronger, more specific evidence.
  // Only let it decide within a tier: once one family's evidence tier is clearly better (e.g. a
  // real strong_phrase alias match vs. a generic family_profile fallback), the hint has nothing
  // left to say and the comparison falls through to the confidence/tier-driven checks below.
  const groupHintEligible = left.evidenceTierRank === right.evidenceTierRank;

  return (
    rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
    rightAuthority.familyStructureAuthority - leftAuthority.familyStructureAuthority ||
    // Curated/deliberate signals (group agreement, job-function prior, generic-head prior, reviewed
    // family signal, exact family canonical) must outrank the general roleCoverage/structuralAlignment
    // heuristics below them, since those heuristics can be misled by an incomplete pre-recovery leaf
    // snapshot (see roleCoverage's own comment) or by a narrow/spurious token match that a deliberate
    // curated signal already resolves correctly.
    (groupHintEligible ? rightAuthority.groupAgreement - leftAuthority.groupAgreement : 0) ||
    (groupHintEligible ? leftAuthority.groupMismatch - rightAuthority.groupMismatch : 0) ||
    leftAuthority.familySpecializationMismatch - rightAuthority.familySpecializationMismatch ||
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    rightAuthority.genericHeadPrior - leftAuthority.genericHeadPrior ||
    rightAuthority.reviewedSignal - leftAuthority.reviewedSignal ||
    rightAuthority.exactFamilyCanonical - leftAuthority.exactFamilyCanonical ||
    rightAuthority.usefulExact - leftAuthority.usefulExact ||
    // Only a MAJORITY role-token match (>0.5) is trusted this early -- a minority match (e.g. one
    // generic token out of three) is exactly the kind of narrow/spurious coverage that should lose
    // to the broader multi-signal evidence (capabilityLeafCount, partialRoleLeafCount, etc.) further
    // down, so it's deferred there via the plain roleCoverage difference instead.
    Number(rightAuthority.roleCoverage > 0.5) - Number(leftAuthority.roleCoverage > 0.5) ||
    rightAuthority.profileFamilyLabelCoverage - leftAuthority.profileFamilyLabelCoverage ||
    rightAuthority.structuralAlignment - leftAuthority.structuralAlignment ||
    rightAuthority.supportedSpecializationLeafCount - leftAuthority.supportedSpecializationLeafCount ||
    rightAuthority.primaryExactAliasLeafCount - leftAuthority.primaryExactAliasLeafCount ||
    rightAuthority.exactRoleLeafCount - leftAuthority.exactRoleLeafCount ||
    rightAuthority.bestRoleTokenMatchCount - leftAuthority.bestRoleTokenMatchCount ||
    rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
    rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
    rightAuthority.capabilityRoleCoverage - leftAuthority.capabilityRoleCoverage ||
    rightAuthority.capabilityLeafCount - leftAuthority.capabilityLeafCount ||
    rightAuthority.partialRoleLeafCount - leftAuthority.partialRoleLeafCount ||
    rightAuthority.roleCoverage - leftAuthority.roleCoverage ||
    rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
    Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
    foldedAliasAuthority ||
    rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
    rightAuthority.confidence - leftAuthority.confidence ||
    rightAuthority.branchShare - leftAuthority.branchShare ||
    rightAuthority.bestLeafStructuralPreference - leftAuthority.bestLeafStructuralPreference ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

// Dead: its only call site (commented out above) is disabled, so `usesRecoveredRoleAgreementOrdering`
// no longer picks between this and the cascade above. Kept for now rather than deleted.
export function compareLegacyRecoveredFamilySelectionAuthority(
  left: RankedPipelineFamily,
  right: RankedPipelineFamily,
  leftAuthority: RecoveredFamilySelectionAuthority,
  rightAuthority: RecoveredFamilySelectionAuthority,
  foldedAliasAuthority: number
): number {
  return (
    rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
    rightAuthority.groupAgreement - leftAuthority.groupAgreement ||
    leftAuthority.groupMismatch - rightAuthority.groupMismatch ||
    leftAuthority.familySpecializationMismatch - rightAuthority.familySpecializationMismatch ||
    rightAuthority.jobFunctionPrior - leftAuthority.jobFunctionPrior ||
    rightAuthority.genericHeadPrior - leftAuthority.genericHeadPrior ||
    rightAuthority.reviewedSignal - leftAuthority.reviewedSignal ||
    rightAuthority.exactFamilyCanonical - leftAuthority.exactFamilyCanonical ||
    rightAuthority.usefulExact - leftAuthority.usefulExact ||
    Number(rightAuthority.roleCoverage > 0.5) - Number(leftAuthority.roleCoverage > 0.5) ||
    rightAuthority.structuralAlignment - leftAuthority.structuralAlignment ||
    rightAuthority.supportedSpecializationLeafCount - leftAuthority.supportedSpecializationLeafCount ||
    Number(rightAuthority.exactAliasCount > 0) - Number(leftAuthority.exactAliasCount > 0) ||
    foldedAliasAuthority ||
    rightAuthority.roleHeadCoverage - leftAuthority.roleHeadCoverage ||
    rightAuthority.bestLeafRoleCoverage - leftAuthority.bestLeafRoleCoverage ||
    rightAuthority.roleCoverage - leftAuthority.roleCoverage ||
    rightAuthority.profileRoleCoverage - leftAuthority.profileRoleCoverage ||
    rightAuthority.exactAliasCount - leftAuthority.exactAliasCount ||
    rightAuthority.confidence - leftAuthority.confidence ||
    rightAuthority.branchShare - leftAuthority.branchShare ||
    rightAuthority.bestLeafStructuralPreference - leftAuthority.bestLeafStructuralPreference ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}

export function usesRecoveredRoleAgreementOrdering(preparedQuery: PreparedQuery): boolean {
  return preparedQuery.locale === 'en' && preparedQuery.acronymTokens.length === 0 && exactRoleMatchThreshold(preparedQuery) >= 2;
}

export function applyRecoveredFamilySelectionAuthority(
  family: RankedPipelineFamily,
  rank: number,
  preparedQuery: PreparedQuery,
  recoveredFamilySelectionAuthority: (family: RankedPipelineFamily, preparedQuery: PreparedQuery) => RecoveredFamilySelectionAuthority
): RankedPipelineFamily {
  const selectionAuthority = recoveredFamilySelectionAuthority(family, preparedQuery);
  const authorityFloor = recoveredFamilyConfidenceFloor(selectionAuthority, preparedQuery);
  const confidence = Math.max(family.confidence, authorityFloor);

  return {
    ...family,
    rank,
    selectionAuthority,
    score: confidence,
    confidence
  };
}

export function recoveredFamilyConfidenceFloor(authority: RecoveredFamilySelectionAuthority, preparedQuery: PreparedQuery): number {
  if (authority.exactFamilyCanonical > 0) {
    return FAMILY_SCORING_POLICY.EXACT_FAMILY_CANONICAL_FLOOR;
  }

  if (authority.familyStructureAuthority >= 0.7) {
    return PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE;
  }

  if (!usesRecoveredRoleAgreementOrdering(preparedQuery)) {
    return 0;
  }

  if (authority.exactRoleLeafCount >= 3 && authority.capabilityLeafCount >= 2) {
    return FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_CAPABILITY_FLOOR;
  }

  if (authority.exactRoleLeafCount >= 3) {
    return FAMILY_SCORING_POLICY.RECOVERED_EXACT_ROLE_FLOOR;
  }

  if (authority.profileFamilyLabelCoverage >= 1 && authority.profileRoleCoverage >= 1) {
    return PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE;
  }

  return 0;
}

export function familyEvidenceTierRank(tier: FamilyEvidenceTier): number {
  if (tier === 'local_exact') {
    return 1;
  }

  if (tier === 'useful_exact') {
    return 2;
  }

  if (tier === 'cross_locale_backbone') {
    return 3;
  }

  if (tier === 'folded_alias') {
    return 4;
  }

  if (tier === 'strong_phrase') {
    return 5;
  }

  if (tier === 'family_profile') {
    return 6;
  }

  return 7;
}
