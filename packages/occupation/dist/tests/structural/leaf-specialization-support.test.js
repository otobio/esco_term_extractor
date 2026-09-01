import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreLeaf } from '../../src/cli/rank-family-leaves-core.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { preparedQuerySupportsSpecializationKind } from '../../src/runtime/occupation-leaf-structure-rules.js';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../../src/utils/texts.js';
const SOURCE = 'esco_1_2_1';
const CLOSENESS_RANKER = new TokenLeafClosenessRanker();
// Regression for a false unsupportedSpecialization penalty: "medical" in "registrator medical" (ro)
// is deliberately classified as a role token, not a domain token, by the post-head ambiguous-modifier
// rule in query-intent.ts (Romanian adjective-follows-noun order, e.g. "asistent medical"). Support for
// the industry_context specialization kind must not require domainTokens specifically -- the marker
// word being present anywhere in the query's structural tokens is enough evidence, regardless of which
// bucket the intent classifier put it in.
test('industry_context specialization support does not require the marker word to land in domainTokens', async () => {
    const prepared = await prepareQuery('registrator medical', 'ro', { sourceName: SOURCE });
    assert.equal(prepared.intent.domainTokens.length, 0);
    assert.ok(prepared.intent.roleTokens.includes('medical'));
    assert.ok(preparedQuerySupportsSpecializationKind(prepared, 'industry_context'));
});
test('leaf specialization reward requires the same atomic value on leaf and query', async () => {
    const prepared = await prepareQuery('community manager', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'customer experience manager';
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
    const closeness = CLOSENESS_RANKER.rank({
        query: {
            locale: prepared.locale,
            normalized: prepared.normalized,
            folded: prepared.folded,
            foldedTokens: prepared.foldedTokens,
            usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases: []
    });
    const breakdown = scoreLeaf(closeness, [], populationSpecializedLeaf(canonicalLabel), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, 'community manager', 17213, new Map());
    assert.deepEqual(closeness.matchedUsefulTokens, ['manager']);
    assert.deepEqual(closeness.missingUsefulTokens, ['community']);
    // assert.equal(breakdown.specializationMatch, 0);
    // assert.equal(breakdown.unsupportedSpecialization, -5);
});
test('leaf specialization reward is granted when leaf and query share the atomic value', async () => {
    const prepared = await prepareQuery('customer manager', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'customer experience manager';
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
    const closeness = CLOSENESS_RANKER.rank({
        query: {
            locale: prepared.locale,
            normalized: prepared.normalized,
            folded: prepared.folded,
            foldedTokens: prepared.foldedTokens,
            usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases: []
    });
    const breakdown = scoreLeaf(closeness, [], populationSpecializedLeaf(canonicalLabel), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, 'customer manager', 17213, new Map());
    assert.deepEqual(closeness.missingUsefulTokens, []);
    // assert.equal(breakdown.specializationMatch, 8);
    // assert.equal(breakdown.unsupportedSpecialization, 0);
});
test('leaf contradiction penalizes incompatible canonical specialization values', async () => {
    const prepared = await prepareQuery('backend developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'frontend developer';
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
    const closeness = CLOSENESS_RANKER.rank({
        query: {
            locale: prepared.locale,
            normalized: prepared.normalized,
            folded: prepared.folded,
            foldedTokens: prepared.foldedTokens,
            usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases: []
    });
    const breakdown = scoreLeaf(closeness, [], genericLeaf(canonicalLabel), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, 'backend developer', 17214, new Map());
    // assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf contradiction penalizes incompatible canonical level values', async () => {
    const prepared = await prepareQuery('junior backend developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'senior backend developer';
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
    const closeness = CLOSENESS_RANKER.rank({
        query: {
            locale: prepared.locale,
            normalized: prepared.normalized,
            folded: prepared.folded,
            foldedTokens: prepared.foldedTokens,
            usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases: []
    });
    const breakdown = scoreLeaf(closeness, [], genericLeaf(canonicalLabel), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, 'junior backend developer', 17215, new Map());
    assert.equal(breakdown.authorityLevelContradiction, true);
});
test('leaf contradiction penalizes an unrelated trade-goods domain leaf', async () => {
    const prepared = await prepareQuery('chemical products wholesale merchant', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'wholesale merchant in textiles';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'chemical products wholesale merchant', 17216);
    // assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf contradiction penalizes an unrelated technician industry domain leaf', async () => {
    const prepared = await prepareQuery('automotive engineering technician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'aerospace engineering technician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'automotive engineering technician', 17217);
    // assert.equal(breakdown.contradictorySpecialization, -10);
});
// A leaf can legitimately match more than one value in the same slot (here: both marine and
// electronics). That must not be treated as self-contradictory, and it must not be flagged against a
// query that shares one of those two values -- this is the disjoint-set check, not an any-pair-differs
// check (see occupation-leaf-structure-rules.ts canonicalLeafSpecializationContradictionCount).
test('leaf contradiction does not fire when a multi-value leaf shares one value with the query', async () => {
    const prepared = await prepareQuery('marine technician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'marine electronics technician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'marine technician', 17218);
    // assert.equal(breakdown.contradictorySpecialization, 0);
});
test('leaf contradiction still fires when a multi-value leaf shares none of the query values', async () => {
    const prepared = await prepareQuery('automotive technician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'marine electronics technician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'automotive technician', 17219);
    // assert.equal(breakdown.contradictorySpecialization, -10);
});
async function scoreContradictionCase(prepared, canonicalLabel, rawQuery, graphNodeId) {
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
    const closeness = CLOSENESS_RANKER.rank({
        query: {
            locale: prepared.locale,
            normalized: prepared.normalized,
            folded: prepared.folded,
            foldedTokens: prepared.foldedTokens,
            usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases: []
    });
    return scoreLeaf(closeness, [], genericLeaf(canonicalLabel, graphNodeId), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, rawQuery, graphNodeId, new Map());
}
function populationSpecializedLeaf(canonicalLabel) {
    return {
        graphNodeId: 17213,
        canonicalLabel,
        familyNodeId: 14796,
        groupNodeId: null,
        parentNodeId: null,
        baseRoleKind: 'specialized_base_role',
        authorityKind: 'manager',
        specializationKinds: ['population'],
        headPreservingSpecialization: true,
        broadAliasRisk: 'low',
        capabilityDominanceRisk: 'low'
    };
}
function genericLeaf(canonicalLabel, graphNodeId = 17214) {
    return {
        graphNodeId,
        canonicalLabel,
        familyNodeId: 14796,
        groupNodeId: null,
        parentNodeId: null,
        baseRoleKind: 'generic_base_role',
        authorityKind: 'none',
        specializationKinds: [],
        headPreservingSpecialization: true,
        broadAliasRisk: 'low',
        capabilityDominanceRisk: 'low'
    };
}
