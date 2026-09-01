import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { gateFamilyStructureForQuery, getFamilyStructureRules, prepareFamilyStructureQuery } from './family-structure/family-structure.js';
import type { QueryStructuralProfile } from './preparation.js';
import type {
  CandidateLedger,
  CanonicalComparisonQuery,
  ExactFamilyCandidate,
  FamilyAssessment,
  SelectedFamily,
  SimpleDecisionReason
} from './types.js';

const RESIDUAL_CONTEXT_REQUIRED_ROLE_HEADS = new Set([
  'assistant',
  'chauffeur',
  'director',
  'driver',
  'manager',
  'operator',
  'technician',
  'worker'
]);

export function selectUniqueExactCanonicalFamily(exactCanonicalFamilies: readonly ExactFamilyCandidate[]): CoreFamilyDecision | null {
  const uniqueFamilyNodeIds = new Set(exactCanonicalFamilies.map((family) => family.familyNodeId));

  if (uniqueFamilyNodeIds.size !== 1) {
    return null;
  }

  const family = exactCanonicalFamilies[0];

  return {
    decision: { type: 'family', reason: 'exact_canonical_family', confidence: 0.9 },
    selectedFamily: { familyNodeId: family.familyNodeId, familyLabel: family.familyLabel }
  };
}

export function validateFamilies(
  _runtime: OccupationRuntimeContext,
  candidateLedger: CandidateLedger,
  exactFamilies: readonly ExactFamilyCandidate[],
  _comparisonQuery: CanonicalComparisonQuery,
  queryProfile?: QueryStructuralProfile
): FamilyAssessment[] {
  const assessments = new Map<number, FamilyAssessment>();
  const structureQuery = queryProfile ? prepareFamilyStructureQuery(queryProfile) : null;

  for (const family of exactFamilies) {
    assessments.set(family.familyNodeId, {
      familyNodeId: family.familyNodeId,
      familyLabel: family.familyLabel,
      exactCanonical: true,
      roleGrounded: true,
      structureDecision: 'accept',
      supportKind: 'exact',
      confidence: 0.9,
      rejectReason: null
    });
  }

  for (const candidate of candidateLedger.values()) {
    if (candidate.familyNodeId === null || assessments.get(candidate.familyNodeId)?.supportKind === 'exact') {
      continue;
    }

    if (candidate.status === 'promotable') {
      const existing = assessments.get(candidate.familyNodeId);

      // A direct exact/folded alias-table hit already proves the leaf -- and therefore its family --
      // independent of role-head/context reasoning, which only exists to arbitrate ambiguous bare
      // role-head guesses. Without this, an ambiguous role head (e.g. "worker") with no query context
      // could downgrade a curated-alias family match to 'partial' and block the leaf from ever being
      // promoted (rankPromotableLeaves only ranks 'accept' families). englishAlias is deliberately
      // excluded -- it fires on generic English-word overlap, not a curated exact match, and trusting
      // it here let unrelated candidates (e.g. "stevedore" on a mistranslated "mail" word) hijack the
      // family decision.
      const hasTrustworthyAliasMatch = candidate.evidence?.exactPrimaryAlias || candidate.evidence?.foldedAlias;

      const structureDecision =
        candidate.canonical.interestingResemblanceOrder > 0 || hasTrustworthyAliasMatch
          ? 'accept'
          : familyStructureDecision(candidate.familyNodeId, structureQuery, 'accept');

      if (!existing || existing.confidence < candidate.canonical.score) {
        assessments.set(candidate.familyNodeId, {
          familyNodeId: candidate.familyNodeId,
          familyLabel: candidate.familyLabel ?? existing?.familyLabel ?? '',
          exactCanonical: false,
          roleGrounded: candidate.canonical.roleResemblanceTier !== 'none',
          structureDecision,
          supportKind: 'has_promotable_leaf',
          confidence: candidate.canonical.score,
          rejectReason: structureDecision === 'reject' ? 'family_structure_contradiction' : null
        });
      }

      continue;
    }

    if (candidate.status === 'near_miss' && !assessments.has(candidate.familyNodeId)) {
      const roleGrounded = candidate.canonical.roleResemblanceTier !== 'none';
      const structureDecision = familyStructureDecision(candidate.familyNodeId, structureQuery, roleGrounded ? 'partial' : 'reject', true);

      assessments.set(candidate.familyNodeId, {
        familyNodeId: candidate.familyNodeId,
        familyLabel: candidate.familyLabel ?? '',
        exactCanonical: false,
        roleGrounded,
        structureDecision,
        supportKind: 'dictionary_gap_from_near_miss',
        confidence: candidate.canonical.score * 0.6,
        rejectReason: structureDecision === 'reject' ? 'family_structure_contradiction' : roleGrounded ? null : 'family_not_role_grounded'
      });
    }
  }

  const hasAcceptedAssessment = [...assessments.values()].some((assessment) => assessment.structureDecision === 'accept');

  if (structureQuery && !hasAcceptedAssessment) {
    for (const rule of getFamilyStructureRules()) {
      const structureDecision = gateFamilyStructureForQuery(rule, structureQuery).decision;
      if (structureDecision !== 'accept') {
        continue;
      }

      const existing = assessments.get(rule.familyNodeId);

      assessments.set(rule.familyNodeId, {
        familyNodeId: rule.familyNodeId,
        familyLabel: rule.familyLabel,
        exactCanonical: existing?.exactCanonical ?? false,
        roleGrounded: structureDecision === 'accept',
        structureDecision,
        supportKind: existing?.supportKind ?? 'structural',
        confidence: Math.max(existing?.confidence ?? 0, 0.58),
        rejectReason: null
      });
    }
  }

  const hasAcceptedFamily = [...assessments.values()].some((assessment) => assessment.structureDecision === 'accept');
  if (!hasAcceptedFamily) {
    const residualFallbackAllowed =
      !structureQuery || hasStructuralContext(structureQuery) || hasSpecificResidualRole(structureQuery.roleHeads);

    for (const assessment of assessments.values()) {
      const rule = getFamilyStructureRules().find((familyRule) => familyRule.familyNodeId === assessment.familyNodeId);
      if (
        residualFallbackAllowed &&
        rule?.residualPolicy === 'residual_when_no_specific_family' &&
        assessment.structureDecision === 'partial' &&
        assessment.supportKind === 'has_promotable_leaf'
      ) {
        assessments.set(assessment.familyNodeId, {
          ...assessment,
          structureDecision: 'accept',
          rejectReason: null
        });
      }
    }
  }

  return [...assessments.values()].sort(compareFamilyAssessments);
}

function hasStructuralContext(query: { conceptIdsByDimension: ReadonlyMap<string, readonly string[]> }): boolean {
  for (const values of query.conceptIdsByDimension.values()) {
    if (values.length > 0) {
      return true;
    }
  }

  return false;
}

function hasSpecificResidualRole(roleHeads: readonly string[]): boolean {
  return roleHeads.some((roleHead) => !RESIDUAL_CONTEXT_REQUIRED_ROLE_HEADS.has(roleHead));
}

function compareFamilyAssessments(first: FamilyAssessment, second: FamilyAssessment): number {
  const structureDelta = familyStructureRank(second.structureDecision) - familyStructureRank(first.structureDecision);
  if (structureDelta !== 0) {
    return structureDelta;
  }

  return second.confidence - first.confidence;
}

function familyStructureRank(decision: FamilyAssessment['structureDecision']): number {
  if (decision === 'accept') {
    return 2;
  }
  if (decision === 'partial') {
    return 1;
  }
  return 0;
}

function familyStructureDecision(
  familyNodeId: number,
  structureQuery: ReturnType<typeof prepareFamilyStructureQuery> | null,
  fallback: FamilyAssessment['structureDecision'],
  // A near-miss leaf is already a weak match; letting it nominate a family on a gate result of
  // 'unknown' (no domain evidence either way, not necessarily any real support) turns "we don't know"
  // into "good enough," which is how unrelated families used to win on bare role-head overlap alone.
  // requireConceptSupport demands a genuine 'partial' gate decision (real matched concepts/authority)
  // before falling through to 'partial' -- 'unknown' collapses to 'reject' instead.
  requireConceptSupport = false
): FamilyAssessment['structureDecision'] {
  if (!structureQuery) {
    return fallback;
  }

  const decision = gateFamilyStructureForQuery(familyNodeId, structureQuery).decision;
  if (decision === 'reject') {
    return 'reject';
  }
  if (decision === 'accept') {
    return 'accept';
  }
  if (decision === 'unknown' && requireConceptSupport) {
    return 'reject';
  }
  return fallback === 'reject' ? 'reject' : 'partial';
}

export type CoreFamilyDecision = {
  decision: {
    type: 'family';
    reason: Extract<SimpleDecisionReason, 'exact_canonical_family' | 'family_dictionary_gap' | 'family_leaf_ambiguity'>;
    confidence: number;
  };
  selectedFamily: SelectedFamily;
};
