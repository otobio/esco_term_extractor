import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreLeaf } from '../../src/cli/rank-family-leaves-core-v2.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { buildSpecializationDimensionProfile, compareSpecializationDimensionProfiles } from '../../src/runtime/occupation-leaf-structure-rules-v2.js';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../../src/utils/texts.js';
const SOURCE = 'esco_1_2_1';
const CLOSENESS_RANKER = new TokenLeafClosenessRanker();
// Parity checks: the v2 profile-diff model must classify the same slot outcomes as the v1 ad-hoc
// comparison for the existing contradiction/alignment cases it was refactored from.
test('leaf contradiction penalizes incompatible canonical specialization values (v2)', async () => {
    const prepared = await prepareQuery('backend developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'frontend developer';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'backend developer', 27214);
    assert.equal(breakdown.contradictorySpecialization, -10);
    assert.equal(breakdown.alignedSpecializationValue, 0);
});
test('leaf contradiction does not fire when a multi-value leaf shares one value with the query (v2)', async () => {
    const prepared = await prepareQuery('marine technician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'marine electronics technician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'marine technician', 27218);
    assert.equal(breakdown.contradictorySpecialization, 0);
});
test('leaf contradiction still fires when a multi-value leaf shares none of the query values (v2)', async () => {
    const prepared = await prepareQuery('automotive technician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'marine electronics technician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'automotive technician', 27219);
    assert.equal(breakdown.contradictorySpecialization, -10);
});
// The concrete case the dimensional-profile rework targets: query and leaf naming the SAME
// specialization value explicitly should be rewarded, not scored identically to "leaf has no opinion".
test('leaf and query naming the same specialization value earns an alignment reward (v2)', async () => {
    // "frontend engineer" vs "frontend developer" -- different role head, so this does not trip the
    // raw-exact-canonical-match short-circuit (which would otherwise zero out every supporting field,
    // this one included), while still sharing the "frontend" specialization value explicitly.
    const prepared = await prepareQuery('frontend engineer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'frontend developer';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'frontend engineer', 27220);
    assert.equal(breakdown.exactCanonicalMatch, 0);
    assert.equal(breakdown.contradictorySpecialization, 0);
    assert.equal(breakdown.alignedSpecializationValue, 5);
});
test('leaf contradiction penalizes incompatible software development domain values (v2)', async () => {
    const prepared = await prepareQuery('web developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'mobile application developer';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'web developer', 27221);
    assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf and query naming the same software development domain value earns an alignment reward (v2)', async () => {
    const prepared = await prepareQuery('mobile developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'mobile application developer';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'mobile developer', 27222);
    assert.equal(breakdown.contradictorySpecialization, 0);
    assert.equal(breakdown.alignedSpecializationValue, 5);
});
test('leaf contradiction penalizes an unrelated trade-goods domain leaf added from the sales families (v2)', async () => {
    const prepared = await prepareQuery('toys specialised seller', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'second-hand goods specialised seller';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'toys specialised seller', 27223);
    assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf contradiction penalizes an unrelated technician industry domain leaf added from the electrician family (v2)', async () => {
    const prepared = await prepareQuery('domestic electrician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'building electrician';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'domestic electrician', 27224);
    assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf contradiction penalizes an explicit junior query against a manager-level leaf (v2)', async () => {
    const prepared = await prepareQuery('junior backend developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'backend development manager';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'junior backend developer', 27225);
    assert.equal(breakdown.contradictoryLevel, -10);
});
test('leaf contradiction penalizes an explicit assistant query against a manager-level leaf (v2)', async () => {
    const prepared = await prepareQuery('assistant backend developer', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'backend development manager';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'assistant backend developer', 27226);
    assert.equal(breakdown.contradictoryLevel, -10);
});
test('leaf contradiction penalizes an unrelated customer service channel leaf added from the client information family (v2)', async () => {
    const prepared = await prepareQuery('live chat operator', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'telephone switchboard operator';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'live chat operator', 27227);
    assert.equal(breakdown.contradictorySpecialization, -10);
});
test('leaf and query naming the same customer service channel value earns an alignment reward (v2)', async () => {
    const prepared = await prepareQuery('travel consultant', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'travel agent';
    const breakdown = await scoreContradictionCase(prepared, canonicalLabel, 'travel consultant', 27228);
    assert.equal(breakdown.contradictorySpecialization, 0);
    assert.equal(breakdown.alignedSpecializationValue, 5);
});
test('buildSpecializationDimensionProfile exposes unsupported specificity when only the leaf has an opinion', () => {
    const leafProfile = buildSpecializationDimensionProfile(new Set(tokenizeNormalizedText(foldSearchText('frontend developer'))));
    const queryProfile = buildSpecializationDimensionProfile(new Set(tokenizeNormalizedText(foldSearchText('developer'))));
    const comparison = compareSpecializationDimensionProfiles(leafProfile, queryProfile);
    assert.equal(comparison.contradictionCount, 0);
    assert.equal(comparison.alignmentCount, 0);
    assert.equal(comparison.unsupportedSpecificityCount, 1);
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
function genericLeaf(canonicalLabel, graphNodeId) {
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
