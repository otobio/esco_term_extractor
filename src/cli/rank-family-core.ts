// Family-selection authority: the tie-break cascade that decides which family wins once several
// families are tied on the coarse evidence tier (see occupation-search-pipeline.ts's
// `familyEvidenceTierRank`). Extracted out of the pipeline (rather than duplicated) so both the
// pipeline and the isolated `rank-family-selection` CLI (see rank-family-selection.ts) share this
// one cascade -- same pattern as rank-family-leaves-core.ts for leaf ranking.
//
// `recoveredFamilySelectionAuthority` itself stays in occupation-search-pipeline.ts: it draws on
// evidence-scoring helpers (`maxEvidenceScore`, `hasFamilyRoleGrounding`, `leafStructuralPreferenceScore`,
// etc.) that are shared with unrelated pipeline stages (leaf-first resolution, family priors), so
// moving it here would drag most of the pipeline along with it. This file owns the cascade/ORDER
// logic that consumes an already-computed `RecoveredFamilySelectionAuthority`.
import type { FamilyEvidenceTier, PipelineFamilyCandidate, RankedPipelineFamily } from '../search-pipeline/occupation-search-pipeline.js';
import { exactRoleMatchThreshold } from '../search-pipeline/occupation-search-pipeline.js';
import type { PreparedQuery } from '../query/query-preparation.js';
import { FAMILY_SCORING_POLICY, PIPELINE_DECISION_GATE } from '../scoring/scoring-policy.js';

export type RecoveredFamilySelectionAuthority = {
  roleGrounded: number;
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

  return (
    rightAuthority.roleGrounded - leftAuthority.roleGrounded ||
    // Curated/deliberate signals (group agreement, job-function prior, generic-head prior, reviewed
    // family signal, exact family canonical) must outrank the general roleCoverage/structuralAlignment
    // heuristics below them, since those heuristics can be misled by an incomplete pre-recovery leaf
    // snapshot (see roleCoverage's own comment) or by a narrow/spurious token match that a deliberate
    // curated signal already resolves correctly.
    rightAuthority.groupAgreement - leftAuthority.groupAgreement ||
    leftAuthority.groupMismatch - rightAuthority.groupMismatch ||
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
