import { assessFamilyStructureCompatibility, getFamilyStructureRule, getFamilyStructureRules, isRoleHeadAmbiguousAcrossFamilies, prepareFamilyStructureQuery } from './family-structure/family-structure.js';
import { conceptUnitCoverageForComparisonQuery } from './translation.js';
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
export function selectUniqueExactCanonicalFamily(exactCanonicalFamilies) {
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
export function validateFamilies(_runtime, candidateLedger, exactFamilies, comparisonQuery, queryProfile) {
    const assessments = new Map();
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
            const gateResult = structureQuery ? assessFamilyStructureCompatibility(candidate.familyNodeId, structureQuery) : null;
            const rawStructureDecision = familyStructureDecision(candidate.familyNodeId, structureQuery, 'partial', true, gateResult);
            const structureDecision = translationUnitsCoverRejectedFamily(candidate, rawStructureDecision, comparisonQuery, 'partial');
            const hasTrustworthyAliasMatch = candidate.evidence?.exactPrimaryAlias || candidate.evidence?.foldedAlias;
            const hasExactRoleCanonical = candidate.canonical.roleResemblanceTier === 'exact' && candidate.canonical.interestingResemblanceOrder === 1;
            const leafValidatedFamily = rawStructureDecision === 'reject' && leafCanValidateRejectedFamily(candidate);
            const acceptedByDirectLeafAuthority = (structureDecision !== 'reject' || leafValidatedFamily) && (hasTrustworthyAliasMatch || hasExactRoleCanonical);
            // A leaf's own role-head match can be 'none' simply because the query's role head (e.g.
            // "specialist") is generic and never appears verbatim on any single leaf's canonical label --
            // that's not evidence AGAINST the leaf, just an uninformative token (same reasoning as
            // roleHeadOnlyAmbiguousMismatch in family-structure.ts). When every query role head is this
            // kind of cross-family-ambiguous term and the structure gate didn't reject the family outright,
            // treat the family as grounded so concept/authority evidence can still promote its leaves.
            // A genuine family-level role-head match (the gate's own roleHeadMatched, e.g. "manager" or
            // "treasurer" literally appearing in this family's role heads) is its own grounding signal,
            // independent of whether the candidate leaf's own label happens to resemble the query.
            const hasOnlyAmbiguousQueryRoleHeads = (structureQuery?.roleHeads.length ?? 0) > 0 && structureQuery.roleHeads.every(isRoleHeadAmbiguousAcrossFamilies);
            const roleGrounded = candidate.canonical.roleResemblanceTier !== 'none' ||
                (structureDecision !== 'reject' && (hasOnlyAmbiguousQueryRoleHeads || gateResult?.roleHeadMatched === true));
            if (!existing || existing.confidence < candidate.canonical.score) {
                assessments.set(candidate.familyNodeId, {
                    familyNodeId: candidate.familyNodeId,
                    familyLabel: candidate.familyLabel ?? existing?.familyLabel ?? '',
                    exactCanonical: false,
                    roleGrounded,
                    structureDecision: acceptedByDirectLeafAuthority ? 'accept' : structureDecision,
                    supportKind: 'has_promotable_leaf',
                    confidence: candidate.canonical.score,
                    rejectReason: rawStructureDecision === 'reject' && structureDecision === 'reject' && !leafValidatedFamily
                        ? 'family_structure_contradiction'
                        : null
                });
            }
            continue;
        }
        if (candidate.status === 'near_miss' && !assessments.has(candidate.familyNodeId)) {
            const candidateRoleGrounded = candidate.canonical.roleResemblanceTier !== 'none';
            const rawStructureDecision = familyStructureDecision(candidate.familyNodeId, structureQuery, candidateRoleGrounded ? 'partial' : 'reject', true);
            const structureDecision = translationUnitsCoverRejectedFamily(candidate, rawStructureDecision, comparisonQuery, candidateRoleGrounded ? 'partial' : 'reject');
            const roleGrounded = candidateRoleGrounded;
            let rejectReason;
            if (rawStructureDecision === 'reject' && structureDecision === 'reject') {
                rejectReason = 'family_structure_contradiction';
            }
            else if (!roleGrounded) {
                rejectReason = 'family_not_role_grounded';
            }
            else {
                rejectReason = null;
            }
            assessments.set(candidate.familyNodeId, {
                familyNodeId: candidate.familyNodeId,
                familyLabel: candidate.familyLabel ?? '',
                exactCanonical: false,
                roleGrounded,
                structureDecision,
                supportKind: 'dictionary_gap_from_near_miss',
                confidence: candidate.canonical.score * 0.6,
                rejectReason
            });
        }
    }
    const hasAcceptedAssessment = [...assessments.values()].some((assessment) => assessment.structureDecision === 'accept');
    if (structureQuery && !hasAcceptedAssessment) {
        for (const rule of getFamilyStructureRules()) {
            const structureDecision = assessFamilyStructureCompatibility(rule, structureQuery).decision;
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
        const residualFallbackAllowed = !structureQuery || hasStructuralContext(structureQuery) || hasSpecificResidualRole(structureQuery.roleHeads);
        for (const assessment of assessments.values()) {
            const rule = getFamilyStructureRules().find((familyRule) => familyRule.familyNodeId === assessment.familyNodeId);
            if (residualFallbackAllowed &&
                rule?.residualPolicy === 'residual_when_no_specific_family' &&
                assessment.structureDecision === 'partial' &&
                assessment.supportKind === 'has_promotable_leaf') {
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
function hasStructuralContext(query) {
    for (const values of query.conceptIdsByDimension.values()) {
        if (values.length > 0) {
            return true;
        }
    }
    return false;
}
function hasSpecificResidualRole(roleHeads) {
    return roleHeads.some((roleHead) => !RESIDUAL_CONTEXT_REQUIRED_ROLE_HEADS.has(roleHead));
}
function compareFamilyAssessments(first, second) {
    const structureDelta = familyStructureRank(second.structureDecision) - familyStructureRank(first.structureDecision);
    if (structureDelta !== 0) {
        return structureDelta;
    }
    return second.confidence - first.confidence;
}
function familyStructureRank(decision) {
    if (decision === 'accept') {
        return 2;
    }
    if (decision === 'partial') {
        return 1;
    }
    return 0;
}
function familyStructureDecision(familyNodeId, structureQuery, fallback, 
// A near-miss leaf is already a weak match; letting it nominate a family on a gate result of
// 'unknown' (no domain evidence either way, not necessarily any real support) turns "we don't know"
// into "good enough," which is how unrelated families used to win on bare role-head overlap alone.
// requireConceptSupport demands a genuine 'partial' gate decision (real matched concepts/authority)
// before falling through to 'partial' -- 'unknown' collapses to 'reject' instead.
requireConceptSupport = false, precomputedGateResult) {
    if (!structureQuery) {
        return fallback;
    }
    const decision = (precomputedGateResult ?? assessFamilyStructureCompatibility(familyNodeId, structureQuery)).decision;
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
function translationUnitsCoverRejectedFamily(candidate, structureDecision, comparisonQuery, fallback) {
    if (structureDecision !== 'reject' || candidate.familyNodeId === null || candidate.canonical.roleResemblanceTier === 'none') {
        return structureDecision;
    }
    const rule = getFamilyStructureRule(candidate.familyNodeId);
    if (!rule || conceptUnitCoverageForComparisonQuery(comparisonQuery, rule.conceptsByDimension) !== 1) {
        return structureDecision;
    }
    return fallback === 'reject' ? 'reject' : 'partial';
}
function leafCanValidateRejectedFamily(candidate) {
    if (!candidate.structuralGate) {
        return false;
    }
    const roleTier = candidate.canonical.roleResemblanceTier;
    const hasDirectLeafEvidence = candidate.canonical.exactCanonical || candidate.evidence.exactPrimaryAlias || candidate.evidence.foldedAlias;
    const hasStructuralLeafEvidence = candidate.structuralGate.matchedDimensionCount > 0 && candidate.canonical.requestedCoverage > 0;
    return ((roleTier === 'exact' || roleTier === 'similar') &&
        candidate.canonical.interestingResemblanceOrder > 0 &&
        (hasDirectLeafEvidence || hasStructuralLeafEvidence) &&
        candidate.structuralGate.decision !== 'reject' &&
        candidate.structuralGate.contradictedDimensions.length === 0);
}
