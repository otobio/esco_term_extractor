import { buildQueryStructuralProfile, type QueryStructuralProfile } from '../preparation.js';
import type { FamilyStructureConceptDimension, FamilyStructureDecision, FamilyStructureRule } from './family-structure.js';
import {
  isAuthorityVocabularyWord,
  isFamilyAuthorityContradicted,
  compareFamilyStructureConceptDimensions,
  findFamilyStructureRoleBridges,
  assessFamilyStructureCompatibility,
  prepareFamilyStructureQuery,
  requireFamilyStructureRule
} from './family-structure.js';
import type { LeafLevelKind } from '../../runtime/occupation-leaf-structure-rules.js';

export type FamilyStructureComparison = {
  familyNodeId: number;
  familyLabel: string;
  decision: FamilyStructureDecision;
  roleHeadMatched: boolean;
  roleHeadHasNoDistinctSignal: boolean;
  matchedRoleHeads: readonly string[];
  missingRoleHeads: readonly string[];
  authorityMatched: boolean;
  authorityContradicted: boolean;
  matchedAuthorityLevels: readonly LeafLevelKind[];
  matchedConcepts: readonly FamilyStructureMatchedConcept[];
  contradictedDimensions: readonly FamilyStructureConceptDimension[];
  unknownDimensions: readonly FamilyStructureConceptDimension[];
  bridgeIds: readonly string[];
  residualPolicy: FamilyStructureRule['residualPolicy'];
  reasons: readonly string[];
};

export type FamilyStructureMatchedConcept = {
  dimension: FamilyStructureConceptDimension;
  values: readonly string[];
};

export function compareFamilyStructureToQuery(
  family: FamilyStructureRule | number,
  query: QueryStructuralProfile | string
): FamilyStructureComparison {
  const rule = typeof family === 'number' ? requireFamilyStructureRule(family) : family;
  const queryProfile = typeof query === 'string' ? buildQueryStructuralProfile(query) : query;
  const preparedQuery = prepareFamilyStructureQuery(queryProfile);
  const queryRoleHeads = preparedQuery.roleHeads;
  const matchedRoleHeads = intersect(queryRoleHeads, rule.roleHeads);
  const missingRoleHeads = queryRoleHeads.filter((roleHead) => !rule.roleHeads.includes(roleHead));
  const roleHeadMatched = matchedRoleHeads.length > 0;
  const roleHeadIsBareAuthorityDuplicate =
    queryRoleHeads.length > 0 && queryRoleHeads.every((roleHead) => isAuthorityVocabularyWord(roleHead, preparedQuery.authority));
  const roleHeadHasNoDistinctSignal = queryRoleHeads.length === 0 || roleHeadIsBareAuthorityDuplicate;
  const bridgeIds =
    roleHeadMatched || roleHeadHasNoDistinctSignal ? [] : findFamilyStructureRoleBridges(queryRoleHeads, preparedQuery, rule);
  const authorityContradicted = isFamilyAuthorityContradicted(preparedQuery.authority, rule.authorityLevels);
  const { matchedConcepts, contradictedDimensions, unknownDimensions } = compareFamilyStructureConceptDimensions(preparedQuery, rule);
  const reasons = rejectionReasons({
    authorityContradicted,
    contradictedDimensions,
    bridgeIds,
    queryAuthority: queryProfile.authority,
    queryRoleHeads,
    roleHeadMatched,
    roleHeadHasNoDistinctSignal,
    rule
  });
  const gateDecision = assessFamilyStructureCompatibility(rule, preparedQuery).decision;

  return {
    familyNodeId: rule.familyNodeId,
    familyLabel: rule.familyLabel,
    decision: gateDecision,
    roleHeadMatched,
    roleHeadHasNoDistinctSignal,
    matchedRoleHeads,
    missingRoleHeads,
    authorityMatched: !authorityContradicted,
    authorityContradicted,
    matchedAuthorityLevels: authorityContradicted || preparedQuery.authority === 'none' ? [] : [preparedQuery.authority],
    matchedConcepts,
    contradictedDimensions,
    unknownDimensions,
    bridgeIds,
    residualPolicy: rule.residualPolicy,
    reasons
  };
}

function rejectionReasons(input: {
  authorityContradicted: boolean;
  contradictedDimensions: readonly FamilyStructureConceptDimension[];
  bridgeIds: readonly string[];
  queryAuthority: LeafLevelKind;
  queryRoleHeads: readonly string[];
  roleHeadMatched: boolean;
  roleHeadHasNoDistinctSignal: boolean;
  rule: FamilyStructureRule;
}): string[] {
  const reasons: string[] = [];

  if (!input.roleHeadMatched && !input.roleHeadHasNoDistinctSignal && input.bridgeIds.length === 0) {
    reasons.push(`role_head mismatch: query=[${input.queryRoleHeads.join(', ')}] family=[${input.rule.roleHeads.join(', ')}]`);
  }
  if (input.authorityContradicted) {
    reasons.push(`authority mismatch: query=${input.queryAuthority} family=[${input.rule.authorityLevels.join(', ')}]`);
  }
  if (input.roleHeadMatched) {
    for (const dimension of input.contradictedDimensions) {
      reasons.push(`${dimension} contradiction`);
    }
  }

  return reasons;
}

function intersect<T extends string>(left: readonly T[], right: readonly string[]): T[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
}
