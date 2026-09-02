import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { buildQueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';
import { getFamilyStructureQueryRoleHeads, requireFamilyStructureRule, shortlistFamilyStructureMatches } from '../../../src/occupation-classifier/family-structure/family-structure.js';
import { VAGUE_ROLE_HEAD_TOKENS, isRankRoleHead } from '../../../src/occupation-classifier/role-head-groups.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../../src/runtime/occupation-search-meta-artifact.js';
const SOURCE = 'esco_1_2_1';
let leaves;
before(async () => {
    const searchMeta = await loadOccupationSearchMetaArtifactRequired(SOURCE);
    leaves = searchMeta
        .getAllCoreRecords()
        .filter((record) => record.familyNodeId !== null && record.graphNodeId !== record.familyNodeId)
        .map((record) => ({ canonicalLabel: record.canonicalLabel, familyNodeId: record.familyNodeId }));
});
// Structural family validation (families.ts's roleGrounded / family-structure gate) is the fallback that
// decides which family a query resolves to whenever role_head alone isn't enough to ground a leaf directly.
// This checks that fallback against every real leaf's own canonical title, with no retrieval involved: for
// each leaf, does the structure gate ever contradict the leaf's own TRUE family, or accept a WRONG family
// while leaving the true family out of contention? Either is a gap in family validation, independent of any
// retrieval/candidate-scoring noise.
test('every real leaf keeps its true family structurally viable against its own title', () => {
    assert.ok(leaves.length > 0, 'expected leaves to be loaded');
    const trueFamilyRejected = [];
    const wrongFamilyOnlyAccepted = [];
    for (const leaf of leaves) {
        const profile = buildQueryStructuralProfile(leaf.canonicalLabel, 'en');
        const shortlist = shortlistFamilyStructureMatches(profile);
        const trueFamilyLabel = requireFamilyStructureRule(leaf.familyNodeId).familyLabel;
        const trueFamilyRejectedHere = shortlist.rejected.some((assessment) => assessment.familyNodeId === leaf.familyNodeId);
        if (trueFamilyRejectedHere) {
            trueFamilyRejected.push(`${leaf.canonicalLabel} (family=${leaf.familyNodeId} ${trueFamilyLabel})`);
            continue;
        }
        const acceptedFamilyIds = shortlist.accepted
            .filter((assessment) => assessment.decision === 'accept')
            .map((assessment) => assessment.familyNodeId);
        if (acceptedFamilyIds.length > 0 && !acceptedFamilyIds.includes(leaf.familyNodeId)) {
            const acceptedFamilies = acceptedFamilyIds
                .map((familyNodeId) => `${familyNodeId} ${requireFamilyStructureRule(familyNodeId).familyLabel}`)
                .join(', ');
            wrongFamilyOnlyAccepted.push(`${leaf.canonicalLabel} (family=${leaf.familyNodeId} ${trueFamilyLabel}, accepted=${acceptedFamilies})`);
        }
    }
    // Locked-in baselines (measured against esco_1_2_1): every real leaf's own title now keeps its true
    // family structurally viable -- no leaf is rejected on its own title, and no wrong family is accepted
    // in preference to it. Update these counts deliberately (with a look at the printed cases above) if a
    // structural-gate change intentionally regresses either, not silently by re-running until green.
    const MAX_TRUE_FAMILY_REJECTED = 0;
    const MAX_WRONG_FAMILY_ONLY_ACCEPTED = 0;
    if (trueFamilyRejected.length > 0) {
        console.log('true family rejected by its own leaf title:', trueFamilyRejected);
    }
    if (wrongFamilyOnlyAccepted.length > 0) {
        console.log('wrong family(ies) accepted instead of the true family:', wrongFamilyOnlyAccepted);
    }
    assert.ok(trueFamilyRejected.length <= MAX_TRUE_FAMILY_REJECTED, `expected at most ${MAX_TRUE_FAMILY_REJECTED} leaves whose true family is structurally rejected by their own title, found ${trueFamilyRejected.length}`);
    assert.ok(wrongFamilyOnlyAccepted.length <= MAX_WRONG_FAMILY_ONLY_ACCEPTED, `expected at most ${MAX_WRONG_FAMILY_ONLY_ACCEPTED} leaves where a wrong family is structurally accepted instead of the true family, found ${wrongFamilyOnlyAccepted.length}`);
});
// Locks in the confirmed role_head coverage stats so a regression in either direction is caught. These are
// the family-structure-gate's OWN role heads (getFamilyStructureQueryRoleHeads, after the ambiguous-token
// filtering the gate applies) -- a stricter measure than the raw specialization role_head field, and a
// meaningful fraction resolve to rank/generic role heads only (or none at all), which is the real risk to
// families.ts's roleGrounded gate.
test('role_head coverage across every real leaf matches the confirmed baseline', () => {
    assert.ok(leaves.length > 0, 'expected leaves to be loaded');
    let emptyRoleHeadCount = 0;
    let rankOnlyRoleHeadCount = 0;
    for (const leaf of leaves) {
        const profile = buildQueryStructuralProfile(leaf.canonicalLabel, 'en');
        const roleHeads = getFamilyStructureQueryRoleHeads(profile);
        if (roleHeads.length === 0) {
            emptyRoleHeadCount += 1;
            continue;
        }
        if (roleHeads.every((roleHead) => isRankRoleHead(roleHead, 'pure') || VAGUE_ROLE_HEAD_TOKENS.has(roleHead))) {
            rankOnlyRoleHeadCount += 1;
        }
    }
    assert.equal(leaves.length, 3039, `expected 3039 real leaves, found ${leaves.length}`);
    // Confirmed baselines: 9/3039 leaves resolve no usable family-structure-gate role head at all, and
    // 309/3039 (~10%) resolve to rank/generic role heads only. Small bands absorb unrelated vocabulary churn
    // while still catching a real regression in either direction.
    assert.ok(Math.abs(emptyRoleHeadCount - 9) <= 5, `expected leaves with no usable role_head near 9, found ${emptyRoleHeadCount}`);
    assert.ok(Math.abs(rankOnlyRoleHeadCount - 309) <= 15, `expected rank-only role_head count near 792, found ${rankOnlyRoleHeadCount}`);
});
