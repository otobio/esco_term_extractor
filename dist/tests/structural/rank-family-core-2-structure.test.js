import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankFamilyCandidatesForRecovery } from '../../src/cli/rank-family-core-2.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
const SOURCE = 'esco_1_2_1';
const NO_LEAVES = new Map();
test('core2 family ranking pushes structurally impossible exact-family candidates below compatible families', async () => {
    const preparedQuery = await prepareQuery('truck driver', 'en', { sourceName: SOURCE });
    const families = [
        familyCandidate(15212, 'Car Van And Motorcycle Drivers', 0.98, [
            evidence('exact_family_canonical', 1, { coverage: 1, role_coverage: 1 })
        ]),
        familyCandidate(15215, 'Heavy Truck And Bus Drivers', 0.35, [evidence('family_profile', 0.5, { coverage: 1, role_coverage: 1 })])
    ];
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 2, families, NO_LEAVES));
    assert.equal(ranked[0]?.familyNodeId, 15215);
    assert.equal(ranked[1]?.familyNodeId, 15212);
    assert.equal(ranked[1]?.rankingScore?.structuralRejected, true);
    assert.equal(ranked[1]?.rankingScore?.floor, 0);
});
test('core2 family ranking uses multi-dimension structure support to narrow close survivors', async () => {
    const preparedQuery = await prepareQuery('network security professionals', 'en', { sourceName: SOURCE });
    const families = [
        familyCandidate(14802, 'Software And Applications Developers And Analysts', 0.4, [
            evidence('family_profile', 0.5, { coverage: 1, role_coverage: 1 })
        ]),
        familyCandidate(14808, 'Database And Network Professionals', 0.4, [evidence('family_profile', 0.5, { coverage: 1, role_coverage: 1 })])
    ];
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 2, families, NO_LEAVES));
    assert.equal(ranked[0]?.familyNodeId, 14808);
    assert.equal(ranked[1]?.familyNodeId, 14802);
    assert.ok((ranked[0]?.rankingScore?.structuralSupport ?? 0) >= (ranked[1]?.rankingScore?.structuralSupport ?? 0));
});
test('core2 keeps real venue supervisor titles on the hospitality manager family', async () => {
    const preparedQuery = await prepareQuery('supervizor restaurant', 'ro', { sourceName: SOURCE });
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 3, [
        familyCandidate(14979, 'Material-recording and transport clerks', 0.42, [evidence('graph_support', 0.1, {})]),
        familyCandidate(15000, 'Waiters and bartenders', 0.49, [evidence('family_profile', 1, { coverage: 1, role_coverage: 1 })])
    ], NO_LEAVES));
    assert.equal(ranked[0]?.familyNodeId, 14706);
    assert.ok((ranked[0]?.evidence ?? []).some((record) => record.channel === 'generic_head_family_prior'));
    assert.equal(ranked[0]?.rankingScore?.structuralRejected, false);
});
test('core2 does not structurally reject health-support supervisor titles', async () => {
    const preparedQuery = await prepareQuery('medical supervisor', 'en', { sourceName: SOURCE });
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 3, [
        familyCandidate(14914, 'Administrative and specialised secretaries', 0.72, [
            evidence('family_profile', 1, { coverage: 1, role_coverage: 1 })
        ]),
        familyCandidate(14886, 'Other health associate professionals', 0.2, [
            evidence('family_profile', 1, { coverage: 1, role_coverage: 1 })
        ])
    ], NO_LEAVES));
    assert.equal(ranked[0]?.familyNodeId, 14886);
    assert.ok((ranked[0]?.evidence ?? []).some((record) => record.channel === 'generic_head_family_prior'));
    assert.equal(ranked[0]?.rankingScore?.structuralRejected, false);
});
test('core2 does not structurally reject hospital assistant health-support titles', async () => {
    const preparedQuery = await prepareQuery('hospital assistant', 'en', { sourceName: SOURCE });
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 3, [
        familyCandidate(14874, 'Medical and pharmaceutical technicians', 0.53, [evidence('graph_support', 0.02, {})]),
        familyCandidate(15039, 'Personal care workers in health services', 0.2, [
            evidence('family_profile', 1, { coverage: 1, role_coverage: 1 })
        ])
    ], NO_LEAVES));
    assert.equal(ranked[0]?.familyNodeId, 15039);
    assert.ok((ranked[0]?.evidence ?? []).some((record) => record.channel === 'generic_head_family_prior'));
    assert.equal(ranked[0]?.rankingScore?.structuralRejected, false);
});
test('core2 bridges Romanian assembly operators to assembler families without phrase canonicalization', async () => {
    const preparedQuery = await prepareQuery('Operator montaj', 'ro', { sourceName: SOURCE });
    const ranked = rankedWithScores(rankFamilyCandidatesForRecovery(preparedQuery, SOURCE, 2, [
        familyCandidate(15109, 'Blacksmiths, toolmakers and related trades workers', 0.55, [
            evidence('family_profile', 1, { coverage: 1, role_coverage: 1 })
        ]),
        familyCandidate(15204, 'Assemblers', 0.2, [
            evidence('reviewed_family_signal', 0.82, { matched_tokens: ['montaj'], matched_role_terms: ['operator'] })
        ])
    ], NO_LEAVES));
    assert.equal(preparedQuery.commonRolePhraseMatch, null);
    assert.equal(ranked[0]?.familyNodeId, 15204);
    assert.equal(ranked[0]?.rankingScore?.structuralRejected, false);
    assert.ok((ranked[0]?.evidence ?? []).some((record) => record.channel === 'reviewed_family_signal'));
});
function familyCandidate(familyNodeId, familyLabel, confidence, evidenceRecords) {
    return {
        familyKey: `family:${familyNodeId}`,
        familyKind: 'family',
        familyNodeId,
        familyLabel,
        evidence: [...evidenceRecords],
        supportingLeafIds: new Set(),
        branchShare: 0,
        branchMarginRatio: null,
        evidenceTier: null,
        evidenceTierRank: Number.POSITIVE_INFINITY,
        score: confidence,
        confidence
    };
}
function evidence(channel, score, details) {
    return {
        channel,
        score,
        sourceStage: 'test',
        details
    };
}
function rankedWithScores(ranked) {
    return ranked;
}
