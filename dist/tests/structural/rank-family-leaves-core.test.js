import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cliRankFamilyLeaves, scoreLeaf, sumScoreBreakdown } from '../../src/cli/rank-family-leaves-core.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../../src/utils/texts.js';
const SOURCE = 'esco_1_2_1';
const CLOSENESS_RANKER = new TokenLeafClosenessRanker();
test('scoreLeaf raw exact canonical match short-circuits all supporting score fields', async () => {
    const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
    const canonicalLabel = 'electrician';
    const canonicalTokens = foldedTokenSet(canonicalLabel);
    const closeness = rankCloseness(prepared, canonicalLabel, []);
    const breakdown = scoreLeaf(closeness, [], genericStructure(101, canonicalLabel), prepared, canonicalTokens, canonicalTokens, new Set(), [], null, 'en', canonicalLabel, 'electrician', 101, new Map());
    assert.equal(breakdown.exactCanonicalMatch, 55);
    assert.equal(sumScoreBreakdown(breakdown), 55);
    assert.equal(breakdown.roleHeadOrUsefulCanonical, 0);
    assert.equal(breakdown.familyFit, 0);
    assert.equal(breakdown.usefulTokenCoverage, 0);
});
test('scoreLeaf credits exact translated role aliases for non-English role queries', async () => {
    const prepared = await prepareQuery('projekt menedzser', 'hu', { sourceName: SOURCE });
    const canonicalLabel = 'programme manager';
    const aliases = ['project manager'];
    const canonicalTokens = foldedTokenSet(canonicalLabel);
    const matchedLabelTokens = foldedTokenSet('project manager');
    const closeness = rankCloseness(prepared, canonicalLabel, aliases);
    const breakdown = scoreLeaf(closeness, aliases, genericStructure(102, canonicalLabel), prepared, canonicalTokens, matchedLabelTokens, new Set(), [], null, 'hu', canonicalLabel, 'projekt menedzser', 102, new Map());
    assert.equal(breakdown.translatedRoleAliasExact, 12);
    assert.equal(breakdown.exactCanonicalMatch, 0);
    assert.ok(sumScoreBreakdown(breakdown) > 0);
});
test('cliRankFamilyLeaves preserves exact and translated alias ranking with in-memory artifacts', async () => {
    const exactPrepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
    const exactRanked = rankSyntheticLeaves(exactPrepared, 'electrician', 'en', 'electrician', [
        leaf(201, 'mining electrician'),
        leaf(202, 'electrician')
    ]);
    assert.equal(exactRanked[0]?.canonicalLabel, 'electrician');
    assert.equal(exactRanked[0]?.scoreBreakdown.exactCanonicalMatch, 55);
    const translatedPrepared = await prepareQuery('projekt menedzser', 'hu', { sourceName: SOURCE });
    const translatedRanked = rankSyntheticLeaves(translatedPrepared, 'projekt menedzser', 'hu', 'projekt menedzser', [
        leaf(301, 'project assistant'),
        leaf(302, 'programme manager', [alias('en', 'project manager')])
    ]);
    assert.equal(translatedRanked[0]?.canonicalLabel, 'programme manager');
    assert.equal(translatedRanked[0]?.scoreBreakdown.translatedRoleAliasExact, 12);
});
function rankSyntheticLeaves(preparedQuery, effectiveQuery, locale, exactQueryText, leaves) {
    const aliasesByNodeId = new Map(leaves.map((record) => [record.graphNodeId, record.aliases ?? []]));
    const artifact = {
        getAliases: (graphNodeId) => aliasesByNodeId.get(graphNodeId) ?? [],
        getCapabilityLabels: () => []
    };
    const leafStructureArtifact = {
        getRecord: (graphNodeId) => genericStructure(graphNodeId, leaves.find((record) => record.graphNodeId === graphNodeId)?.canonicalLabel ?? '')
    };
    return cliRankFamilyLeaves(artifact, leafStructureArtifact, leaves, preparedQuery, effectiveQuery, locale, exactQueryText);
}
function rankCloseness(preparedQuery, canonicalLabel, aliases) {
    return CLOSENESS_RANKER.rank({
        query: {
            locale: preparedQuery.locale,
            normalized: preparedQuery.normalized,
            folded: preparedQuery.folded,
            foldedTokens: preparedQuery.foldedTokens,
            usefulFoldedRecallTokens: preparedQuery.usefulFoldedRecallTokens
        },
        canonicalLabel,
        aliases
    });
}
function foldedTokenSet(value) {
    return new Set(tokenizeNormalizedText(foldSearchText(value)));
}
function leaf(graphNodeId, canonicalLabel, aliases = []) {
    return {
        searchMetaId: graphNodeId,
        graphNodeId,
        canonicalLabel,
        genericRisk: 'low',
        hasHierarchy: true,
        hasCapabilitySupport: false,
        familyNodeId: 1,
        familyLabel: 'Synthetic family',
        groupNodeId: null,
        groupLabel: null,
        parentNodeId: null,
        parentLabel: null,
        ancestors: [],
        siblings: [],
        aliases
    };
}
function alias(localeCode, value) {
    return {
        localeCode,
        alias: value,
        normalizedAlias: value,
        aliasRole: 'locale_primary',
        isPrimary: true,
        confidence: 1,
        weight: 1
    };
}
function genericStructure(graphNodeId, canonicalLabel) {
    return {
        graphNodeId,
        canonicalLabel,
        familyNodeId: 1,
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
