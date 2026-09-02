import { buildQueryStructuralProfile } from '../preparation.js';
import { isAuthorityVocabularyWord, isFamilyAuthorityContradicted, compareFamilyStructureConceptDimensions, findFamilyStructureRoleBridges, assessFamilyStructureCompatibility, prepareFamilyStructureQuery, requireFamilyStructureRule } from './family-structure.js';
export function compareFamilyStructureToQuery(family, query) {
    const rule = typeof family === 'number' ? requireFamilyStructureRule(family) : family;
    const queryProfile = typeof query === 'string' ? buildQueryStructuralProfile(query) : query;
    const preparedQuery = prepareFamilyStructureQuery(queryProfile);
    const queryRoleHeads = preparedQuery.roleHeads;
    const matchedRoleHeads = intersect(queryRoleHeads, rule.roleHeads);
    const missingRoleHeads = queryRoleHeads.filter((roleHead) => !rule.roleHeads.includes(roleHead));
    const roleHeadMatched = matchedRoleHeads.length > 0;
    const roleHeadIsBareAuthorityDuplicate = queryRoleHeads.length > 0 && queryRoleHeads.every((roleHead) => isAuthorityVocabularyWord(roleHead, preparedQuery.authority));
    const roleHeadHasNoDistinctSignal = queryRoleHeads.length === 0 || roleHeadIsBareAuthorityDuplicate;
    const bridgeIds = roleHeadMatched || roleHeadHasNoDistinctSignal ? [] : findFamilyStructureRoleBridges(queryRoleHeads, preparedQuery, rule);
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
function rejectionReasons(input) {
    const reasons = [];
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
function intersect(left, right) {
    const rightSet = new Set(right);
    return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
}
