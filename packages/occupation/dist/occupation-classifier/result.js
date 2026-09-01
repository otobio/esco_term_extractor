import { isLeafGrounded } from './decision.js';
export function buildCoreResult(input) {
    return {
        candidateLedger: input.candidateLedger,
        rankedLeaves: input.rankedLeaves,
        familyAssessments: input.familyAssessments,
        decision: input.decision,
        selectedLeaf: input.selectedLeaf ?? null,
        selectedFamily: input.selectedFamily ?? null,
        coverage: {
            status: input.decision.type === 'multi_span' ? 'multi_span' : 'insufficient_evidence',
            canonicalComparsion: input?.comparisonQuery,
        },
        cleaned: input.cleaned ?? null,
        spans: input.spans
    };
}
export function toRuntimeResult(coreResult) {
    const family = coreResult.selectedFamily ?? familyFromLeaf(coreResult.selectedLeaf);
    return {
        decision: coreResult.decision,
        leaf: coreResult.selectedLeaf,
        family,
        coverage: coreResult.coverage,
        cleaned: coreResult.cleaned,
        query: coreResult.coverage?.canonicalComparsion || null,
        altLeafCanonicalTerms: buildAltLeafCanonicalTerms(coreResult, family),
        spans: coreResult.spans?.map((span) => ({
            query: span.query,
            result: toRuntimeResult(span.result)
        }))
    };
}
// Other promotable leaves under the selected family -- extra information should the caller want it,
// not part of the decision itself. An alt leaf is only meaningful relative to a family -- it never
// exists in a vacuum -- so when no family was selected (e.g. unresolved_ambiguous_leaves, where the
// decision deliberately declines to pick a family because the contending leaves disagree on one --
// see selectDecision) there is nothing to anchor alt leaves to either, and the list is empty.
//
// Gated on isLeafGrounded so a family-level abstention (e.g. family_leaf_ambiguity) surfaces only the
// leaves that were genuinely contending for that family, not every promotable leaf regardless of how
// weak its own match was (isLeafGrounded exists specifically to keep out allowGateAccess-promoted leaves
// with no real resemblance evidence, e.g. a bare "sales advisor" query pulling in "solar energy sales
// consultant" at 0.20 confidence on the strength of "sales" alone).
function buildAltLeafCanonicalTerms(coreResult, family) {
    if (!family) {
        return [];
    }
    const selectedLeafGraphNodeId = coreResult.selectedLeaf?.graphNodeId ?? null;
    const candidateLeaves = coreResult.rankedLeaves.filter((leaf) => leaf.familyNodeId === family.familyNodeId && isLeafGrounded(leaf));
    return candidateLeaves
        .filter((leaf) => leaf.graphNodeId !== selectedLeafGraphNodeId)
        .map((leaf) => ({
        graphNodeId: leaf.graphNodeId,
        canonicalTerm: leaf.canonicalLabel,
        familyNodeId: leaf.familyNodeId,
        familyLabel: leaf.familyLabel,
        confidence: leaf.canonical.score
    }));
}
export function toDebugResult(coreResult, debugTrace) {
    return {
        runtime: toRuntimeResult(coreResult),
        trace: debugTrace,
        candidates: [...coreResult.candidateLedger.values()],
        familyAssessments: coreResult.familyAssessments
    };
}
export function coreUnresolved(reason) {
    return buildCoreResult({
        candidateLedger: new Map(),
        rankedLeaves: [],
        familyAssessments: [],
        decision: {
            type: 'unresolved',
            reason,
            confidence: 0
        }
    });
}
function familyFromLeaf(leaf) {
    if (!leaf || leaf.familyNodeId === null || leaf.familyLabel === null) {
        return null;
    }
    return { familyNodeId: leaf.familyNodeId, familyLabel: leaf.familyLabel };
}
function comparableTokenValues(comparisonQuery) {
    if (!comparisonQuery) {
        return [];
    }
    return comparisonQuery.englishTokens;
}
