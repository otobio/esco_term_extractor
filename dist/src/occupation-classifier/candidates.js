import { foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { buildQueryStructuralProfile } from './preparation.js';
import { VAGUE_ROLE_HEAD_TOKENS, isKnownRoleHeadWord, isRankRoleHead, leafAuthorityLevelKindsContradict, ROLE_HEAD_STRICT_GROUP_BY_TOKEN, roleHeadsAreBroadlySimilar, selectStrongRoleHeads } from './role-head-groups.js';
import conceptLeafFrequencyJson from './specialization/specialization-schema/concept-leaf-frequency.json' with { type: 'json' };
import { SPECIALIZATION_DATA_DIMENSIONS, specializationGate } from './specialization/specialization-gate.js';
import { conceptUnitCoverageForComparisonQuery, modifierTokenUnitsForComparisonQuery } from './translation.js';
const WILD_DIMENSION_PENALTY = 0.1;
const GENERIC_ROLE_HEAD_PENALTY = 0.15;
export const RECOVERABLE_DIMENSION_WEIGHT = 0.6;
const CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES = conceptLeafFrequencyJson.totalLeaves;
const CONCEPT_LEAF_FREQUENCY_BY_ID = conceptLeafFrequencyJson.leafCountByConceptId;
export function conceptSpecificityWeight(conceptId, floor, ceiling) {
    const leafCount = CONCEPT_LEAF_FREQUENCY_BY_ID[conceptId];
    if (!leafCount || leafCount <= 0) {
        return ceiling;
    }
    const specificity = Math.log(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES / leafCount) / Math.log(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES);
    return floor + (ceiling - floor) * Math.max(0, Math.min(1, specificity));
}
function mostSpecificConceptWeight(conceptIds, floor, ceiling) {
    return conceptIds.reduce((best, conceptId) => Math.max(best, conceptSpecificityWeight(conceptId, floor, ceiling)), floor);
}
const PROMOTION_SCORE_THRESHOLD = 0.45;
export const LEAF_SELECTION_MARGIN = 0.1;
const ROLE_RESEMBLANCE_TIER_RANK = {
    exact: 2,
    similar: 1,
    generic: 0,
    different: 0,
    none: 0
};
export function selectUniqueExactCanonicalLeaf(rows, runtime, retrievalRequest, queryProfile, comparisonQuery) {
    const exactKeys = new Set(retrievalRequest.englishCanonicalExactKeys);
    const matchedGraphNodeIds = new Set();
    for (const row of rows) {
        if (!exactKeys.has(row.weakFoldedCanonicalLabel)) {
            continue;
        }
        const core = runtime.searchMetaArtifact.getCoreRecord(row.graphNodeId);
        if (!core?.familyNodeId) {
            continue;
        }
        matchedGraphNodeIds.add(row.graphNodeId);
    }
    if (matchedGraphNodeIds.size !== 1) {
        return null;
    }
    let graphNodeId = 0;
    for (const matchedGraphNodeId of matchedGraphNodeIds) {
        graphNodeId = matchedGraphNodeId;
        break;
    }
    const core = runtime.searchMetaArtifact.getCoreRecord(graphNodeId);
    if (!core?.familyNodeId) {
        return null;
    }
    if (queryProfile && !exactCanonicalLeafCoversQuery(core.canonicalLabel, queryProfile, comparisonQuery)) {
        return null;
    }
    return leafDecision(graphNodeId, core, 'exact_canonical_leaf', 1);
}
function structuralCombinationConsumedTokens(queryProfile) {
    const consumed = new Set();
    if (queryProfile.profile.tokens.length > 1) {
        return consumed;
    }
    for (const match of queryProfile.profile.structural_combination) {
        for (const concept of match.concepts) {
            for (let index = concept.start; index <= concept.end; index += 1) {
                const token = queryProfile.profile.tokens[index];
                if (token) {
                    consumed.add(token);
                }
            }
            // The concept's own canonical (English) form -- required-token units built from a translated
            // comparisonQuery carry the English form, not the raw local-language query token above.
            for (const canonicalToken of concept.canonicalTokens) {
                for (const token of tokenizeNormalizedText(canonicalToken)) {
                    consumed.add(token);
                }
            }
        }
    }
    return consumed;
}
function exactCanonicalLeafCoversQuery(canonicalLabel, queryProfile, comparisonQuery) {
    const canonicalTokens = new Set(tokenizeNormalizedText(foldWeakPunctuationLookupText(canonicalLabel)));
    for (const consumedToken of structuralCombinationConsumedTokens(queryProfile)) {
        canonicalTokens.add(consumedToken);
    }
    const queryRoleHeads = selectStrongRoleHeads(queryProfile.profile.role_head);
    if (queryRoleHeads.length > 0) {
        const canonicalProfile = buildQueryStructuralProfile(canonicalLabel, 'en');
        const canonicalRoleHeads = selectStrongRoleHeads(canonicalProfile.profile.role_head);
        if (roleResemblanceTierFor(queryRoleHeads, canonicalRoleHeads) === 'none') {
            return false;
        }
    }
    if (comparisonQuery) {
        const queryResemblance = buildQueryResemblanceInput(queryProfile, comparisonQuery);
        for (const unit of queryResemblance.requiredNonRoleTokenUnits) {
            let unitMatched = false;
            for (const alternative of unit) {
                let alternativeMatched = true;
                for (const token of alternative) {
                    if (!canonicalTokens.has(token)) {
                        alternativeMatched = false;
                        break;
                    }
                }
                if (alternativeMatched) {
                    unitMatched = true;
                    break;
                }
            }
            if (!unitMatched) {
                return false;
            }
        }
        return true;
    }
    const knownTokens = new Set(queryRoleHeads);
    if (queryProfile.authority !== 'none') {
        knownTokens.add(queryProfile.authority);
    }
    const requiredTokens = queryConceptLiteralTokens(queryProfile, knownTokens);
    if (queryProfile.authority !== 'none') {
        requiredTokens.push(queryProfile.authority);
    }
    return requiredTokens.every((token) => canonicalTokens.has(token));
}
export function selectUniqueExactAliasLeaf(rows, rawAliasResults, runtime, _retrievalRequest, comparisonQuery) {
    const matchedGraphNodeIds = new Set();
    for (const row of rows) {
        const core = runtime.searchMetaArtifact.getCoreRecord(row.graphNodeId);
        if (!core?.familyNodeId) {
            continue;
        }
        if (!isSafeExactAliasMatch(core.canonicalLabel, comparisonQuery)) {
            continue;
        }
        matchedGraphNodeIds.add(row.graphNodeId);
    }
    if (matchedGraphNodeIds.size > 0) {
        const graphNodeId = [...matchedGraphNodeIds][0];
        const core = runtime.searchMetaArtifact.getCoreRecord(graphNodeId);
        if (!core?.familyNodeId) {
            return null;
        }
        return leafDecision(graphNodeId, core, 'exact_primary_alias_leaf', 0.96);
    }
    // Check the other raw fields
    for (const subphraseRow of rawAliasResults.subphraseRows) {
        if (isSafeExactAliasMatch(subphraseRow.canonical_label, comparisonQuery)) {
            const kore = runtime.searchMetaArtifact.getCoreRecord(subphraseRow.graph_node_id);
            if (!kore?.familyNodeId) {
                return null;
            }
            return leafDecision(subphraseRow.graph_node_id, kore, 'exact_primary_alias_leaf', 0.6);
        }
    }
    return null;
}
function isSafeExactAliasMatch(canonicalLabel, comparisonQuery) {
    const weakFoldedCanonical = foldWeakPunctuationLookupText(canonicalLabel);
    if (comparisonQuery.canonicalExactKeys.includes(weakFoldedCanonical)) {
        return true;
    }
    // At the very least must be multi-token
    if (comparisonQuery.englishTokens.length > 1 &&
        comparisonQuery.englishTokens.every((token) => tokenizeNormalizedText(weakFoldedCanonical).includes(token))) {
        return true;
    }
    // TODO: Explore this later likely safer
    // const tokenized = tokenizeNormalizedText(weakFoldedCanonical).filter((token) => ['in', 'of', 'the', 'and'].includes(token));
    // // At the very least must be multi-token
    // if (comparisonQuery.englishTokens.length > 1 && tokenized.every((token) => comparisonQuery.englishTokens.includes(token))) {
    //   return true;
    // }
    return false;
}
function leafDecision(graphNodeId, core, reason, confidence) {
    return {
        decision: { type: 'leaf', reason, confidence },
        selectedLeaf: {
            graphNodeId,
            canonicalLabel: core.canonicalLabel,
            familyNodeId: core.familyNodeId,
            familyLabel: core.familyLabel
        }
    };
}
function assessCandidate(candidate, comparisonQuery, queryProfile, queryResemblance, locale) {
    const canonicalProfile = buildQueryStructuralProfile(candidate.canonicalLabel);
    const authorityConflict = leafAuthorityLevelKindsContradict(queryProfile.authority, canonicalProfile.authority);
    const authorityGate = {
        decision: authorityConflict ? 'reject' : 'accept',
        reason: authorityConflict ? 'authority_conflict' : null
    };
    const structuralGate = computeStructuralGate(queryProfile, canonicalProfile, locale);
    const canonical = computeCanonicalResemblance(candidate, comparisonQuery, queryProfile, canonicalProfile, structuralGate, queryResemblance);
    if (!candidate.familyNodeId) {
        return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'missing_core_record');
    }
    if (authorityGate.decision === 'reject') {
        // if (
        //     structuralGate.decision !== 'reject'
        //     && structuralGate.rawDecision === 'pass_strict'
        //     && structuralGate.matchedDimensionCount > 0
        //     && structuralGate.judgments.every((judgement) => judgement.kind === 'exact_concept' || judgement.kind === 'exact_literal'))
        // {
        //   // Specialcase bypass for exact role with wrong authority selection
        // } else {
        return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'authority_conflict');
        //}
    }
    if (structuralGate.decision === 'reject') {
        return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'structural_contradiction');
    }
    // exactPrimaryAlias/foldedAlias are direct alias-table hits for this exact leaf, not the shakier
    // exactSupportingAlias (which recall hands to every leaf in a family). That direct hit already proves
    // the candidate is correct even when the translated/canonical role-head tokens don't visibly match --
    // don't let the role-head gate hard-reject it, including a computed 'different' tier (e.g. "software
    // engineer" vs "software developer": no shared role-head group, but the alias table already says yes).
    const hasTrustworthyAliasMatch = candidate.evidence.exactPrimaryAlias || candidate.evidence.foldedAlias || candidate.evidence.englishAlias;
    if (canonical.roleResemblanceTier === 'different' && !hasTrustworthyAliasMatch) {
        return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'role_contradiction');
    }
    // A query role head that exactly names a specific (non-generic) role head the candidate shares is
    // itself strong evidence, same spirit as the alias rescue above -- "cook" asked for and "cook" found
    // should not need to clear the general score threshold to be selectable.
    //const hasExactRoleHeadMatch = canonical.roleResemblanceTier === 'exact';
    // A query role head unrelated to the candidate's (e.g. "person" vs "seller") is normally a hard
    // reject -- but if the query also named a domain/product modifier (e.g. "bakery") that the
    // structural gate confirmed the candidate actually shares, the role-head mismatch alone shouldn't
    // veto it: the candidate still has to clear the score threshold below on that domain evidence, it's
    // just no longer barred from the attempt.
    const hasMatchedDomainDimension = structuralGate.matchedDimensionCount > 0;
    // Same rescue, cheaper evidence: even without a recognized structural dimension match, a literal
    // token the query named (e.g. "bakery") appearing in the candidate's own label is proof the query
    // and candidate are talking about the same thing -- the structural gate reject case above already
    // returned before this point, so reaching here already means no contradiction was found.
    const hasUncontradictedSharedToken = canonical.hasSharedModifierToken;
    if (canonical.roleResemblanceTier === 'none' &&
        !hasTrustworthyAliasMatch &&
        !hasMatchedDomainDimension &&
        !hasUncontradictedSharedToken) {
        return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'no_canonical_relationship');
    }
    const status = decideStatus(canonical);
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        familyNodeId: candidate.familyNodeId,
        familyLabel: candidate.familyLabel,
        evidence: candidate.evidence,
        status,
        authorityGate,
        structuralGate,
        canonical,
        selectionAuthority: selectionAuthorityFor(candidate, canonical),
        rejectReason: status === 'hard_rejected' ? 'no_canonical_relationship' : null,
        nearMissReason: status === 'near_miss' ? nearMissReasonFor(canonical) : null
    };
}
function decideStatus(canonical) {
    if (canonical.allowGateAccess) {
        return 'promotable';
    }
    if (canonical.score <= 0) {
        return 'hard_rejected';
    }
    if (canonical.score >= PROMOTION_SCORE_THRESHOLD) {
        return 'promotable';
    }
    return 'near_miss';
}
function selectionAuthorityFor(candidate, canonical) {
    if (canonical.exactCanonical || canonical.weakExactCanonical) {
        return 'canonical';
    }
    const hasAliasEvidence = candidate.evidence.exactPrimaryAlias ||
        candidate.evidence.exactSupportingAlias ||
        candidate.evidence.foldedAlias ||
        candidate.evidence.subphraseAlias ||
        candidate.evidence.englishAlias;
    if (hasAliasEvidence) {
        return canonical.roleResemblanceTier !== 'none' ? 'canonical_with_alias' : 'alias_only';
    }
    return 'retrieval_only';
}
function nearMissReasonFor(canonical) {
    return canonical.roleResemblanceTier !== 'none' ? 'missing_role_head_translation' : 'low_canonical_resemblance';
}
function rejectedAssessment(candidate, canonical, authorityGate, structuralGate, rejectReason) {
    return {
        graphNodeId: candidate.graphNodeId,
        canonicalLabel: candidate.canonicalLabel,
        familyNodeId: candidate.familyNodeId,
        familyLabel: candidate.familyLabel,
        evidence: candidate.evidence,
        status: 'hard_rejected',
        authorityGate,
        structuralGate,
        canonical,
        selectionAuthority: 'retrieval_only',
        rejectReason,
        nearMissReason: null
    };
}
function computeStructuralGate(queryProfile, canonicalProfile, locale) {
    const gate = specializationGate(queryProfile.profile, canonicalProfile.profile, { locale });
    return {
        rawDecision: gate.decision,
        decision: gate.decision === 'reject' ? 'reject' : 'accept',
        reason: gate.decision === 'reject' ? 'specialization_contradiction' : null,
        matchedDimensions: gate.compatibleDimensions,
        contradictedDimensions: gate.contradictionDimensions,
        queriedDimensionCount: gate.queriedDimensions.length,
        matchedDimensionCount: gate.compatibleDimensions.length,
        unknownDimensionCount: gate.unknownDimensions.length,
        judgments: gate.judgments
    };
}
// Ranking-only signal (never feeds the score itself, see computeCanonicalResemblance below): a
// generic role head matching itself proves nothing, so it never earns 'exact'/'similar' credit.
function roleResemblanceTierFor(queryRoleHeads, canonicalRoleHeads) {
    let hasSimilar = false;
    let hasGeneric = false;
    for (const queryRoleHead of queryRoleHeads) {
        for (const canonicalRoleHead of canonicalRoleHeads) {
            const queryStrictGroup = ROLE_HEAD_STRICT_GROUP_BY_TOKEN.get(queryRoleHead);
            const isStrictlyEquivalent = queryRoleHead === canonicalRoleHead ||
                (queryStrictGroup !== undefined && queryStrictGroup === ROLE_HEAD_STRICT_GROUP_BY_TOKEN.get(canonicalRoleHead));
            const isBroadlySimilar = isStrictlyEquivalent || roleHeadsAreBroadlySimilar(queryRoleHead, canonicalRoleHead);
            if (!isBroadlySimilar) {
                continue;
            }
            if (VAGUE_ROLE_HEAD_TOKENS.has(queryRoleHead) || VAGUE_ROLE_HEAD_TOKENS.has(canonicalRoleHead)) {
                hasGeneric = true;
                continue;
            }
            if (isStrictlyEquivalent) {
                return 'exact';
            }
            hasSimilar = true;
        }
    }
    if (hasSimilar) {
        return 'similar';
    }
    if (hasGeneric) {
        return 'generic';
    }
    if (hasRealRoleHead(queryRoleHeads) && hasRealRoleHead(canonicalRoleHeads)) {
        return 'different';
    }
    return 'none';
}
function isUninformativeRoleHead(roleHead) {
    return VAGUE_ROLE_HEAD_TOKENS.has(roleHead) || isRankRoleHead(roleHead, 'pure');
}
function hasRealRoleHead(roleHeads) {
    for (const roleHead of roleHeads) {
        if (isKnownRoleHeadWord(roleHead) && !isUninformativeRoleHead(roleHead)) {
            return true;
        }
    }
    return false;
}
export function computeCanonicalResemblance(candidate, comparisonQuery, queryProfile, canonicalProfile, structuralGate, queryResemblance = buildQueryResemblanceInput(queryProfile, comparisonQuery)) {
    const candidateTokens = tokenizeNormalizedText(candidate.canonicalWeakFolded);
    const candidateTokenSet = new Set(candidateTokens);
    const canonicalRoleHeads = selectStrongRoleHeads(canonicalProfile.profile.role_head);
    const roleResemblanceTier = roleResemblanceTierFor(queryResemblance.roleHeads, canonicalRoleHeads);
    const exactCanonical = candidate.evidence.exactCanonical || comparisonQuery.canonicalExactKeys.includes(candidate.canonicalWeakFolded);
    const weakExactCanonical = candidate.evidence.weakExactCanonical;
    const hasTrustworthyAliasMatch = candidate.evidence.exactPrimaryAlias || candidate.evidence.foldedAlias || candidate.evidence.englishAlias;
    // ---------------------------------------------------------
    // Structural specialization resemblance
    // ---------------------------------------------------------
    // Unknown dimensions stay in the denominator (not subtracted out): a leaf that simply carries no
    // data for a dimension the query asked about is not evidence of a match, so it must not score the
    // same as a leaf that does engage that dimension (exactly or semantically). Excluding it here used
    // to give data-absent leaves a free pass over leaves with a real, if imperfect, semantic match.
    const judgedRequestedDimensionCount = structuralGate.queriedDimensionCount;
    const matchedDimensionWeight = structuralGate.judgments.reduce((total, judgment) => {
        if (judgment.kind === 'exact_concept') {
            return total + mostSpecificConceptWeight(judgment.matchedValues, RECOVERABLE_DIMENSION_WEIGHT, 1);
        }
        if (judgment.kind === 'exact_literal') {
            return total + 1;
        }
        // Same partial credit as recoverable_available: an equivalence-class match (e.g. "car" ~
        // "vehicle") is a real semantic hit, not the absence of one, so it must outscore a dimension
        // the leaf has no data for at all.
        if (judgment.kind === 'recoverable_available' || judgment.kind === 'equivalent_concept') {
            return total + RECOVERABLE_DIMENSION_WEIGHT;
        }
        return total;
    }, 0);
    // Vacuous 1 only when the query named no dimension at all; zero signal on a queried dimension scores 0.
    let flatRequestedCoverage;
    if (structuralGate.queriedDimensionCount === 0) {
        flatRequestedCoverage = 1;
    }
    else if (judgedRequestedDimensionCount <= 0) {
        flatRequestedCoverage = 0;
    }
    else {
        flatRequestedCoverage = matchedDimensionWeight / judgedRequestedDimensionCount;
    }
    let unitConceptCoverage = null;
    if (comparisonQuery.translationUnits.length > 0) {
        const canonicalConceptIdsByDimension = new Map();
        for (const concept of canonicalProfile.profile.concepts) {
            const conceptIds = canonicalConceptIdsByDimension.get(concept.dimension) ?? [];
            if (!conceptIds.includes(concept.conceptId)) {
                conceptIds.push(concept.conceptId);
                canonicalConceptIdsByDimension.set(concept.dimension, conceptIds);
            }
        }
        unitConceptCoverage = conceptUnitCoverageForComparisonQuery(comparisonQuery, canonicalConceptIdsByDimension);
    }
    const requestedCoverage = unitConceptCoverage === null ? flatRequestedCoverage : Math.max(flatRequestedCoverage, unitConceptCoverage);
    // Counts by value, not by dimension presence: more unrequested values is wilder.
    const wildDimensionValues = [];
    const wildDimensionCount = SPECIALIZATION_DATA_DIMENSIONS.reduce((total, dimension) => {
        const querySet = new Set(queryProfile.profile[dimension]);
        const extraValues = canonicalProfile.profile[dimension].filter((value) => !querySet.has(value));
        for (const value of extraValues) {
            wildDimensionValues.push({ dimension, value });
        }
        return total + extraValues.length;
    }, 0);
    const wildDimensionPenalty = wildDimensionCount * WILD_DIMENSION_PENALTY;
    const genericRoleHeadPenalty = roleResemblanceTier === 'generic' ? GENERIC_ROLE_HEAD_PENALTY : 0;
    // Additive: each penalty is judged independently against its own evidence, then combined here so
    // future penalties (e.g. authority mismatch, industry drift) can mix in without reworking the ones
    // already scored.
    const penalty = wildDimensionPenalty + genericRoleHeadPenalty;
    // ---------------------------------------------------------
    // Token-level resemblance
    // ---------------------------------------------------------
    const ROLE_WEIGHT = 0.4;
    const AUTHORITY_WEIGHT = 0.25;
    const MODIFIER_WEIGHT = 0.35;
    // Exact role-head > broad role-head > no role-head.
    let roleScore = 0;
    if (roleResemblanceTier === 'exact') {
        roleScore = 1;
    }
    else if (roleResemblanceTier === 'similar') {
        roleScore = 0.5;
    }
    // No requested authority is neutral.
    const authorityScore = queryProfile.authority === 'none' ? 1 : canonicalProfile.authority === queryProfile.authority ? 1 : 0;
    // Defensive check: don't let something classified as a modifier
    // also count as the role-head or authority.
    let sharedModifierTokenUnitCount = 0;
    for (const unit of queryResemblance.modifierTokenUnits) {
        let unitMatched = false;
        for (const alternative of unit) {
            let alternativeMatched = true;
            for (const token of alternative) {
                if (!candidateTokenSet.has(token)) {
                    alternativeMatched = false;
                    break;
                }
            }
            if (alternativeMatched) {
                unitMatched = true;
                break;
            }
        }
        if (unitMatched) {
            sharedModifierTokenUnitCount++;
        }
    }
    const modifierScore = queryResemblance.modifierTokenUnits.length === 0 ? 1 : sharedModifierTokenUnitCount / queryResemblance.modifierTokenUnits.length;
    const hasSharedModifierToken = sharedModifierTokenUnitCount > 0;
    const tokenSimilarityCoverageScore = ROLE_WEIGHT * roleScore + AUTHORITY_WEIGHT * authorityScore + MODIFIER_WEIGHT * modifierScore;
    // ---------------------------------------------------------
    // Modifier token completeness
    // ---------------------------------------------------------
    let hasUncoveredRequiredNonRoleTokens = false;
    for (const unit of queryResemblance.requiredNonRoleTokenUnits) {
        let unitMatched = false;
        for (const alternative of unit) {
            let alternativeMatched = true;
            for (const token of alternative) {
                if (!candidateTokenSet.has(token)) {
                    alternativeMatched = false;
                    break;
                }
            }
            if (alternativeMatched) {
                unitMatched = true;
                break;
            }
        }
        if (!unitMatched) {
            hasUncoveredRequiredNonRoleTokens = true;
            break;
        }
    }
    // ---------------------------------------------------------
    // Final resemblance
    // ---------------------------------------------------------
    const TOKEN_SIMILARITY_WEIGHT = 0.6;
    const STRUCTURAL_WEIGHT = 0.4;
    const baseScore = TOKEN_SIMILARITY_WEIGHT * tokenSimilarityCoverageScore + STRUCTURAL_WEIGHT * requestedCoverage;
    const isExactCandidate = roleResemblanceTier === 'exact' && modifierScore === 1 && !hasUncoveredRequiredNonRoleTokens;
    const isPhraseMatchCandidate = roleResemblanceTier === 'exact' && modifierScore > 0;
    const isSimilarExactCandidate = roleResemblanceTier === 'similar' && modifierScore === 1 && !hasUncoveredRequiredNonRoleTokens;
    const isSimilarPhraseMatchCandidate = roleResemblanceTier === 'similar' && modifierScore > 0;
    const structurallyRelated = structuralGate.rawDecision === 'pass_strict' && requestedCoverage > 0;
    // Only items where there is chance of this been the canonical are given an order the rest get a 0
    let resemblanceOrder = 0;
    if (exactCanonical) {
        resemblanceOrder = 1;
    }
    else if (isExactCandidate) {
        resemblanceOrder = 2;
    }
    else if (isPhraseMatchCandidate) {
        resemblanceOrder = 3;
    }
    else if (isSimilarExactCandidate) {
        resemblanceOrder = 4;
    }
    else if (isSimilarPhraseMatchCandidate) {
        resemblanceOrder = 5;
    }
    else if (structurallyRelated) {
        resemblanceOrder = 6;
    }
    const allowAccessGate = exactCanonical ||
        weakExactCanonical ||
        resemblanceOrder > 0 ||
        roleResemblanceTier === 'exact' ||
        hasTrustworthyAliasMatch ||
        structuralGate.matchedDimensionCount > 0 ||
        hasSharedModifierToken;
    const score = Math.max(0, baseScore - penalty);
    return {
        exactCanonical,
        weakExactCanonical,
        roleResemblanceTier: roleResemblanceTier,
        requestedCoverage,
        wildDimensionCount,
        wildDimensionValues,
        tokenCoverage: tokenSimilarityCoverageScore,
        hasSharedModifierToken,
        interestingResemblanceOrder: resemblanceOrder,
        allowGateAccess: allowAccessGate,
        score
    };
}
function buildQueryResemblanceInput(queryProfile, comparisonQuery) {
    const roleHeads = selectStrongRoleHeads(queryProfile.profile.role_head);
    const knownTokens = new Set();
    for (const roleHead of roleHeads) {
        knownTokens.add(roleHead);
    }
    if (queryProfile.authority !== 'none') {
        knownTokens.add(queryProfile.authority);
    }
    const modifierTokens = queryConceptLiteralTokens(queryProfile, knownTokens);
    const translatedModifierTokenUnits = comparisonQuery ? modifierTokenUnitsForComparisonQuery(comparisonQuery) : [];
    const modifierTokenUnits = [];
    if (translatedModifierTokenUnits.length > 0) {
        for (const unit of translatedModifierTokenUnits) {
            const tokenizedUnit = [];
            for (const token of unit) {
                const parts = tokenizeNormalizedText(token);
                if (parts.length > 0) {
                    tokenizedUnit.push(parts);
                }
            }
            if (tokenizedUnit.length > 0) {
                modifierTokenUnits.push(tokenizedUnit);
            }
        }
    }
    else {
        for (const token of modifierTokens) {
            modifierTokenUnits.push([[token]]);
        }
    }
    const requiredNonRoleTokens = [];
    const requiredNonRoleTokenUnits = [];
    if (queryProfile.authority !== 'none') {
        requiredNonRoleTokens.push(queryProfile.authority);
        requiredNonRoleTokenUnits.push([[queryProfile.authority]]);
    }
    for (const token of modifierTokens) {
        requiredNonRoleTokens.push(token);
    }
    for (const unit of modifierTokenUnits) {
        requiredNonRoleTokenUnits.push(unit);
    }
    return { roleHeads, modifierTokens, modifierTokenUnits, requiredNonRoleTokens, requiredNonRoleTokenUnits };
}
function queryConceptLiteralTokens(queryProfile, knownTokens) {
    const tokens = [];
    const seenTokens = new Set();
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        for (const literal of queryProfile.profile.literal[dimension]) {
            for (const token of tokenizeNormalizedText(literal)) {
                if (!knownTokens.has(token) && !seenTokens.has(token)) {
                    seenTokens.add(token);
                    tokens.push(token);
                }
            }
        }
    }
    return tokens;
}
export function assessCandidatesThroughFilterFunnel(hydratedCandidates, comparisonQuery, _leafStructureArtifact, queryProfile, locale) {
    const ledger = new Map();
    const queryResemblance = buildQueryResemblanceInput(queryProfile, comparisonQuery);
    for (const candidate of hydratedCandidates) {
        ledger.set(candidate.graphNodeId, assessCandidate(candidate, comparisonQuery, queryProfile, queryResemblance, locale));
    }
    return ledger;
}
export function rankPromotableLeaves(candidateLedger, families) {
    const allowedFamilyIds = new Set();
    for (const family of families) {
        if (family.structureDecision === 'accept' || (family.structureDecision === 'partial' && family.roleGrounded)) {
            allowedFamilyIds.add(family.familyNodeId);
        }
    }
    return [...candidateLedger.values()]
        .filter((candidate) => candidate.status === 'promotable' && candidate.familyNodeId !== null && allowedFamilyIds.has(candidate.familyNodeId))
        .sort(compareRankedLeaves);
}
export function compareRankedLeaves(first, second) {
    // 1. Primary resemblance score.
    const scoreDelta = second.canonical.score - first.canonical.score;
    if (Math.abs(scoreDelta) > 1e-9) {
        return scoreDelta;
    }
    // 2. Among score ties, direct proof (exact canonical / trustworthy alias) always wins over coincidence.
    const authoritativeDelta = Number(first.canonical.interestingResemblanceOrder) - Number(second.canonical.interestingResemblanceOrder);
    if (authoritativeDelta !== 0) {
        return authoritativeDelta;
    }
    // 3. An exact (non-generic) role-head match beats a same-group similar one; a generic or absent
    // match earns no credit either way.
    const roleTierDelta = ROLE_RESEMBLANCE_TIER_RANK[second.canonical.roleResemblanceTier] - ROLE_RESEMBLANCE_TIER_RANK[first.canonical.roleResemblanceTier];
    if (roleTierDelta !== 0) {
        return roleTierDelta;
    }
    // 4. More matched structural dimensions wins.
    const structuralDelta = second.structuralGate.matchedDimensions.length - first.structuralGate.matchedDimensions.length;
    if (structuralDelta !== 0) {
        return structuralDelta;
    }
    // 5. Prefer the candidate with fewer unexplained extra
    // specialization dimensions.
    const specificityDelta = first.canonical.wildDimensionCount - second.canonical.wildDimensionCount;
    if (specificityDelta !== 0) {
        return specificityDelta;
    }
    return 0;
}
