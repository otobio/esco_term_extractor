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
        if (isLeafGrounded(top) && (!runnerUp || (scoreDelta !== null && scoreDelta >= LEAF_SELECTION_MARGIN - 1e-9) || isExactTie)) {
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
        // The contending leaves themselves don't agree on a family, but that doesn't mean no family is
        // supportable -- a query can carry enough independent structural signal (role heads, authority,
        // concepts) for one family to clearly outrank the others even when the leaf-level tie is noise
        // (e.g. a single ambiguous token like "general" spuriously tying two unrelated leaves). Prefer the
        // best-supported family among those actually in contention over abstaining outright.
        const contendingFamilies = families.filter((assessment) => distinctFamilyNodeIds.has(assessment.familyNodeId));
        const bestContendingFamily = pickBestFamily(contendingFamilies);
        if (bestContendingFamily) {
            return {
                decision: { type: 'family', reason: 'family_leaf_ambiguity', confidence: bestContendingFamily.confidence },
                selectedLeaf: null,
                selectedFamily: toSelectedFamily(bestContendingFamily)
            };
        }
        const anyFamilyFallback = pickBestFamily(families);
        if (anyFamilyFallback) {
            return {
                decision: { type: 'family', reason: 'family_dictionary_gap', confidence: anyFamilyFallback.confidence },
                selectedLeaf: null,
                selectedFamily: toSelectedFamily(anyFamilyFallback)
            };
        }
        return {
            decision: { type: 'unresolved', reason: 'unresolved_ambiguous_leaves', confidence: 0 },
            selectedLeaf: null,
            selectedFamily: null
        };
    }
    const dictionaryGapFamily = pickBestFamily(families);
    if (dictionaryGapFamily) {
        return {
            decision: { type: 'family', reason: 'family_dictionary_gap', confidence: dictionaryGapFamily.confidence },
            selectedLeaf: null,
            selectedFamily: toSelectedFamily(dictionaryGapFamily)
        };
    }
    const hasAnyCandidates = candidateLedger.size > 0;
    const allHardRejected = hasAnyCandidates && [...candidateLedger.values()].every((candidate) => candidate.status === 'hard_rejected');
    let reason;
    if (!hasAnyCandidates) {
        reason = 'unresolved_no_candidates';
    }
    else if (allHardRejected) {
        reason = 'unresolved_all_candidates_rejected';
    }
    else {
        reason = 'unresolved_low_confidence';
    }
    return {
        decision: { type: 'unresolved', reason, confidence: 0 },
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
// Picks the single most defensible family from a set of structurally-surviving candidates: an
// outright 'accept' beats a 'partial' that only cleared because roleGrounded propped it up, and ties
// within a tier break on confidence. Families that didn't even clear the role-grounded partial bar
// aren't real candidates -- returning undefined here is the honest "nothing to fall back to" signal.
function pickBestFamily(families) {
    let best;
    for (const family of families) {
        const eligible = family.structureDecision === 'accept' || (family.structureDecision === 'partial' && family.roleGrounded);
        if (!eligible) {
            continue;
        }
        if (!best) {
            best = family;
            continue;
        }
        const familyRank = family.structureDecision === 'accept' ? 1 : 0;
        const bestRank = best.structureDecision === 'accept' ? 1 : 0;
        if (familyRank > bestRank || (familyRank === bestRank && family.confidence > best.confidence)) {
            best = family;
        }
    }
    return best;
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
