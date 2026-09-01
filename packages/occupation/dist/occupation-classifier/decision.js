import { LEAF_SELECTION_MARGIN } from './candidates.js';
export function selectDecision(rankedLeaves, families, candidateLedger, _comparisonQuery) {
    if (rankedLeaves.length > 0) {
        const top = rankedLeaves[0];
        const runnerUp = rankedLeaves[1];
        // rankedLeaves is already sorted by resemblance (rankPromotableLeaves -> compareRankedLeaves).
        // A clear score leader is selected outright, even if other, unrelated-family candidates also
        // cleared the promotable bar -- being promotable elsewhere is not the same as being the best
        // match. Only when the top two are within margin of each other is this genuinely ambiguous --
        // except an exact score tie, which compareRankedLeaves has already broken deterministically
        // (role-head tier, structural match count, specialization wildness, then shorter label): that's
        // a resolved pick, not an ambiguity, so it's selected outright too.
        const scoreDelta = runnerUp ? top.canonical.score - runnerUp.canonical.score : null;
        const isExactTie = scoreDelta !== null && Math.abs(scoreDelta) < 1e-9;
        if (isLeafGrounded(top) &&
            (!runnerUp || (scoreDelta !== null && scoreDelta >= LEAF_SELECTION_MARGIN - 1e-9) || isExactTie)) {
            return {
                decision: { type: 'leaf', reason: 'promotable_leaf', confidence: top.canonical.score },
                selectedLeaf: toSelectedLeaf(top),
                selectedFamily: null
            };
        }
        // Only the leaves actually contesting the top spot -- those within the same selection margin used
        // above -- matter for this fallback. rankedLeaves as a whole routinely spans many unrelated,
        // far-lower-scoring families (e.g. a single stray titleToken hit), and lumping those into the
        // uniqueness check below defeats the family recovery even when every leaf genuinely in contention
        // agrees on the family.
        const contendingLeaves = rankedLeaves.filter((leaf) => top.canonical.score - leaf.canonical.score <= LEAF_SELECTION_MARGIN + 1e-9);
        const distinctFamilyNodeIds = new Set(contendingLeaves.map((leaf) => leaf.familyNodeId));
        if (distinctFamilyNodeIds.size === 1) {
            const familyNodeId = contendingLeaves[0].familyNodeId;
            const family = familyNodeId === null ? undefined : families.find((assessment) => assessment.familyNodeId === familyNodeId);
            if (family) {
                return {
                    decision: { type: 'family', reason: 'family_leaf_ambiguity', confidence: family.confidence },
                    selectedLeaf: null,
                    selectedFamily: toSelectedFamily(family)
                };
            }
        }
        return {
            decision: { type: 'unresolved', reason: 'unresolved_ambiguous_leaves', confidence: 0 },
            selectedLeaf: null,
            selectedFamily: null
        };
    }
    const dictionaryGapFamily = families.find((assessment) => assessment.structureDecision !== 'reject');
    if (dictionaryGapFamily) {
        return {
            decision: { type: 'family', reason: 'family_dictionary_gap', confidence: dictionaryGapFamily.confidence },
            selectedLeaf: null,
            selectedFamily: toSelectedFamily(dictionaryGapFamily)
        };
    }
    const hasAnyCandidates = candidateLedger.size > 0;
    const allHardRejected = hasAnyCandidates && [...candidateLedger.values()].every((candidate) => candidate.status === 'hard_rejected');
    return {
        decision: {
            type: 'unresolved',
            reason: !hasAnyCandidates ? 'unresolved_no_candidates' : allHardRejected ? 'unresolved_all_candidates_rejected' : 'unresolved_low_confidence',
            confidence: 0
        },
        selectedLeaf: null,
        selectedFamily: null
    };
}
export function buildFamilyCandidateSet(_exactCanonicalFamilies, _candidateLedger) {
    return new Set();
}
// A leaf with no real resemblance evidence (interestingResemblanceOrder === 0) and no curated exact/
// folded alias hit is not a genuine pick -- it only reached rankedLeaves because it was the lone
// promotable candidate under an accepted family. Selecting it outright as "the" leaf answer overstates
// confidence the query never actually provided; falling through to the family-level path (below) is
// the honest answer for a query that only supports the family, not a specific role within it.
export function isLeafGrounded(leaf) {
    // interestingResemblanceOrder 6 is 'structurallyRelated' -- the weakest tier, meaning only a loose
    // structural relation was found, not an exact/phrase/similar match. That's too thin to select a
    // specific leaf outright (e.g. it let "solar energy sales consultant" win on a bare "sales advisor"
    // query, sharing nothing but the word "sales"), so only orders 1-5 count as grounding here.
    return ((leaf.canonical.interestingResemblanceOrder > 0 && leaf.canonical.interestingResemblanceOrder < 6) ||
        Boolean(leaf.evidence?.exactPrimaryAlias) ||
        Boolean(leaf.evidence?.foldedAlias));
}
function toSelectedLeaf(leaf) {
    return {
        graphNodeId: leaf.graphNodeId,
        canonicalLabel: leaf.canonicalLabel,
        familyNodeId: leaf.familyNodeId,
        familyLabel: leaf.familyLabel
    };
}
function toSelectedFamily(family) {
    return { familyNodeId: family.familyNodeId, familyLabel: family.familyLabel };
}
