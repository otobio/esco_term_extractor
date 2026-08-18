import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { retrieveBinaryAliasNgramHits } from '../../src/retrieval/alias-ngram-retriever.js';
import { createBinaryRetrievalEngine } from '../../src/retrieval/binary-retrieval-engine.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../../src/runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
const SOURCE = 'esco_1_2_1';
test('binary retrieval keeps exact and folded alias evidence separate', async () => {
    const engine = createBinaryRetrievalEngine();
    const preparedQuery = await prepareQuery('software developer', 'en', { sourceName: SOURCE });
    const result = await engine.aliases.retrieve({
        sourceName: SOURCE,
        locale: 'en',
        preparedQuery,
        exactAliasQueries: ['software developer'],
        foldedAliasQueries: ['software developer'],
        limit: 10
    });
    assert.ok(result.exactRows.some((row) => row.canonical_label === 'software developer'));
    assert.ok(result.foldedRows.some((row) => row.canonical_label === 'software developer'));
    assert.ok(result.scannedAliasHitCount >= result.exactRows.length + result.foldedRows.length);
});
test('binary retrieval applies locale/source/family boundaries', async () => {
    const engine = createBinaryRetrievalEngine();
    const searchMeta = await loadOccupationSearchMetaArtifactRequired(SOURCE);
    const softwareDeveloper = searchMeta.getAllCoreRecords().find((record) => record.canonicalLabel === 'software developer');
    const electricalFamily = searchMeta
        .getAllCoreRecords()
        .find((record) => record.familyLabel === 'Electrical equipment installers and repairers');
    assert.ok(softwareDeveloper?.familyNodeId);
    assert.ok(electricalFamily?.familyNodeId);
    const softwareFamilyHits = await engine.occupations.retrieveWithinFamily({
        sourceName: SOURCE,
        locale: 'en',
        familyNodeId: softwareDeveloper.familyNodeId,
        query: 'software developer',
        limit: 20
    });
    const electrotechnologyFamilyHits = await engine.occupations.retrieveWithinFamily({
        sourceName: SOURCE,
        locale: 'en',
        familyNodeId: electricalFamily.familyNodeId,
        query: 'software developer',
        limit: 20
    });
    assert.ok(softwareFamilyHits.some((hit) => hit.canonicalLabel === 'software developer'));
    assert.ok(!electrotechnologyFamilyHits.some((hit) => hit.canonicalLabel === 'software developer'));
});
test('binary alias-ngram retrieves family-supporting market title without direct leaf authority', async () => {
    const index = await loadOccupationAliasNgramBinaryIfAvailable(SOURCE, 'en', true);
    assert.ok(index);
    const preparedQuery = await prepareQuery('Fullstack developer', 'en', { sourceName: SOURCE });
    const hits = retrieveBinaryAliasNgramHits(index, preparedQuery, { limit: 20 });
    const softwareFamilyHits = hits.filter((hit) => hit.familyLabel === 'Software and applications developers and analysts');
    assert.ok(softwareFamilyHits.length > 0);
    assert.ok(softwareFamilyHits.some((hit) => hit.aliasRole === 'family_supporting'));
    assert.ok(softwareFamilyHits.some((hit) => hit.matchedTokens.includes('developer') || hit.matchedFeatures.some((feature) => feature.includes('fullstack'))));
});
test('binary alias-ngram credits a bare HU role word against a compound alias via vocabulary split', async () => {
    // Pins the "Sofőr" bug: "sofőr" (driver) never appears as a standalone alias/label anywhere in ESCO's
    // HU corpus -- only suffixed onto vehicle-type compounds like "kamionsofőr" (truck driver). Without
    // alias-side compound-split expansion, a bare "Sofőr" query only matched via weak character-ngram
    // cosine similarity, letting unrelated families (e.g. ICT/webmaster) outrank the correct driver family.
    const index = await loadOccupationAliasNgramBinaryIfAvailable(SOURCE, 'hu', true);
    assert.ok(index);
    const preparedQuery = await prepareQuery('Sofőr', 'hu', { sourceName: SOURCE });
    const hits = retrieveBinaryAliasNgramHits(index, preparedQuery, { limit: 20 });
    const driverFamilyHits = hits.filter((hit) => hit.familyLabel === 'Heavy truck and bus drivers');
    assert.ok(driverFamilyHits.length > 0);
    assert.ok(driverFamilyHits.some((hit) => hit.matchedTokens.includes('sofor')));
    assert.ok(hits[0]?.familyLabel === 'Heavy truck and bus drivers');
});
