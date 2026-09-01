import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { cliRankFamilyLeaves, resolveFamily } from '../../src/cli/rank-family-leaves-core.js';
// These tests exercise `cliRankFamilyLeaves` directly against the real "Shop salespersons" family
// (loaded from the real esco_1_2_1 runtime artifacts), bypassing the full search pipeline, so we can
// assert exact sibling-leaf ranking order for authority/specialization behavior.
//
// Several of these are EXPECTED TO FAIL right now -- that is diagnostic, not a bug. They document the
// intended ranking behavior ahead of the still-pending broad/narrow specialization scoring reconciliation.
const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';
const FAMILY = 'Shop salespersons';
let searchMetaArtifact;
let leafStructureArtifact;
let familyLeaves;
before(async () => {
    const [loadedSearchMeta, loadedLeafStructure] = await Promise.all([
        loadOccupationSearchMetaArtifactRequired(SOURCE),
        loadOccupationLeafStructureArtifactRequired(SOURCE)
    ]);
    searchMetaArtifact = loadedSearchMeta;
    leafStructureArtifact = loadedLeafStructure;
    const family = resolveFamily(searchMetaArtifact, FAMILY);
    familyLeaves = searchMetaArtifact.getLeafCoreRecordsForFamilies([family.familyNodeId]);
});
async function rankQuery(query, locale = LOCALE) {
    const cleanedQuery = await cleanOccupationQuerySurface(query, locale);
    const effectiveQuery = cleanedQuery || query;
    const preparedQuery = await prepareQuery(effectiveQuery, locale, { sourceName: SOURCE });
    return cliRankFamilyLeaves(searchMetaArtifact, leafStructureArtifact, familyLeaves, preparedQuery, effectiveQuery, locale);
}
function labelsOf(ranked) {
    return ranked.map((leaf) => leaf.canonicalLabel);
}
function assertOrder(actualLabels, expectedOrderPrefix, query) {
    const actualPrefix = actualLabels.slice(0, expectedOrderPrefix.length);
    assert.deepEqual(actualPrefix, expectedOrderPrefix, `query="${query}" expected top ${expectedOrderPrefix.length} = ${JSON.stringify(expectedOrderPrefix)}, got ${JSON.stringify(actualPrefix)} (full: ${JSON.stringify(actualLabels.slice(0, 8))})`);
}
test('shop assistant: authority mismatch must not let shop supervisor outrank shop assistant', async () => {
    const ranked = await rankQuery('shop assistant needed');
    assertOrder(labelsOf(ranked), ['shop assistant', 'sales assistant', 'shop supervisor'], 'shop assistant needed');
});
test('shop supervisor: supervisor query ranks the supervisor leaf first', async () => {
    const ranked = await rankQuery('shop floor supervisor');
    assertOrder(labelsOf(ranked), ['shop supervisor', 'shop assistant'], 'shop floor supervisor');
});
test('bakery sales person: domain-specialized leaf beats generic seller', async () => {
    const ranked = await rankQuery('bakery sales person');
    assertOrder(labelsOf(ranked), ['bakery specialised seller', 'specialised seller'], 'bakery sales person');
});
test('vehicle dealer: motor vehicles parts advisor beats motor vehicles specialised seller', async () => {
    const ranked = await rankQuery('vehicle dealer');
    assertOrder(labelsOf(ranked), ['motor vehicles parts advisor', 'motor vehicles specialised seller'], 'vehicle dealer');
});
test('video recording equipment on sales: audio and video equipment specialised seller beats music and video shop specialised seller', async () => {
    const ranked = await rankQuery('video recording equipment sales');
    assertOrder(labelsOf(ranked), ['audio and video equipment specialised seller', 'music and video shop specialised seller'], 'video recording equipment sales');
});
test('bakery specialised seller: exact domain match beats generic seller', async () => {
    const ranked = await rankQuery('specialised bakery products seller');
    assertOrder(labelsOf(ranked), ['bakery specialised seller', 'specialised seller'], 'specialised bakery products seller');
});
test('motor vehicles parts seller: parts advisor beats generic vehicle seller beats generic seller', async () => {
    const ranked = await rankQuery('motor vehicles parts seller');
    assertOrder(labelsOf(ranked), ['motor vehicles parts advisor', 'motor vehicles specialised seller', 'specialised seller'], 'motor vehicles parts seller');
});
test('motor vehicles seller: generic vehicle seller beats parts advisor beats generic seller', async () => {
    const ranked = await rankQuery('motor vehicles seller');
    assertOrder(labelsOf(ranked), ['motor vehicles specialised seller', 'motor vehicles parts advisor', 'specialised seller'], 'motor vehicles seller');
});
test('audio equipment seller: audio/video seller beats generic seller beats music/video shop seller', async () => {
    const ranked = await rankQuery('audio equipment seller');
    assertOrder(labelsOf(ranked), ['audio and video equipment specialised seller', 'specialised seller', 'music and video shop specialised seller'], 'audio equipment seller');
});
test('video equipment seller: audio/video seller beats music/video shop seller beats generic seller', async () => {
    const ranked = await rankQuery('video equipment seller');
    assertOrder(labelsOf(ranked), ['audio and video equipment specialised seller', 'music and video shop specialised seller', 'specialised seller'], 'video equipment seller');
});
test('jewellery seller: jewellery and watches specialised seller wins', async () => {
    const ranked = await rankQuery('jewellery seller');
    assertOrder(labelsOf(ranked), ['jewellery and watches specialised seller'], 'jewellery seller');
});
test('furniture seller: furniture specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('furniture seller');
    assertOrder(labelsOf(ranked), ['furniture specialised seller', 'specialised seller'], 'furniture seller');
});
test('clothing seller: clothing specialised seller beats textile specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('clothing seller');
    assertOrder(labelsOf(ranked), ['clothing specialised seller', 'textile specialised seller', 'specialised seller'], 'clothing seller');
});
test('bakery seller: bakery specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('bakery seller');
    assertOrder(labelsOf(ranked), ['bakery specialised seller', 'specialised seller'], 'bakery seller');
});
test('medical goods seller: medical goods specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('medical goods seller');
    assertOrder(labelsOf(ranked), ['medical goods specialised seller', 'specialised seller'], 'medical goods seller');
});
test('sporting goods seller: sporting accessories specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('sporting goods seller');
    assertOrder(labelsOf(ranked), ['sporting accessories specialised seller', 'specialised seller'], 'sporting goods seller');
});
test('tobacco seller: tobacco specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('tobacco seller');
    assertOrder(labelsOf(ranked), ['tobacco specialised seller', 'specialised seller'], 'tobacco seller');
});
test('cosmetics seller: cosmetics and perfume specialised seller beats generic seller', async () => {
    const ranked = await rankQuery('cosmetics seller');
    assertOrder(labelsOf(ranked), ['cosmetics and perfume specialised seller', 'specialised seller'], 'cosmetics seller');
});
test('personal shop assistant: personal shopper beats shop assistant', async () => {
    const ranked = await rankQuery('personal shop assistant');
    assertOrder(labelsOf(ranked), ['personal shopper', 'shop assistant'], 'personal shop assistant');
});
test('checkout supervisor: checkout supervisor beats shop supervisor', async () => {
    const ranked = await rankQuery('checkout desk supervisor');
    assertOrder(labelsOf(ranked), ['checkout supervisor', 'shop supervisor'], 'checkout desk supervisor');
});
