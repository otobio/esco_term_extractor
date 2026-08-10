import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { familyTokenRelevanceMultiplier, tryLoadOccupationFamilyTokenRelevanceLookup } from '../../query/occupation-family-token-relevance.js';
import { analyzeOccupationSemanticSurface } from '../../query/occupation-semantic-lexicon.js';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';
const SOURCE = 'esco_1_2_1';
let pipeline;
before(async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: SOURCE,
        retrievalBackend: 'binary-cache',
        leafStructureRuntime: true,
        aliasNgramLocales: ['en', 'ro', 'hu', 'et']
    });
    pipeline = OccupationSearchPipeline.withRuntime(runtime);
});
test('semantic bootstrap support exists for ro and hu but not et', async () => {
    const romanian = await analyzeOccupationSemanticSurface('supervizor restaurant', 'ro');
    const hungarian = await analyzeOccupationSemanticSurface('szoftverfejlesztő', 'hu');
    const estonian = await analyzeOccupationSemanticSurface('müügiesindaja', 'et');
    assert.equal(romanian.supportedLocale, true);
    assert.equal(hungarian.supportedLocale, true);
    assert.equal(estonian.supportedLocale, false);
});
test('family-token relevance multiplier is bounded for primary and low-confidence locales', () => {
    const lookup = tryLoadOccupationFamilyTokenRelevanceLookup(SOURCE);
    assert.ok(lookup);
    const romanianMultiplier = familyTokenRelevanceMultiplier(lookup, 'ro', 14965, ['customer', 'service']);
    const hungarianMultiplier = familyTokenRelevanceMultiplier(lookup, 'hu', 14965, ['customer', 'service']);
    const estonianMultiplier = familyTokenRelevanceMultiplier(lookup, 'et', 14965, ['customer', 'service']);
    assert.ok(romanianMultiplier >= 0 && romanianMultiplier <= 1);
    assert.ok(hungarianMultiplier >= 0 && hungarianMultiplier <= 1);
    assert.ok(estonianMultiplier >= 0 && estonianMultiplier <= 1);
});
// test('customer service representatives now resolve through the client-information family with the representative leaf', async () => {
//   const result = await pipeline.run({
//     query: 'Customer Service Representatives',
//     locale: 'en',
//     sourceName: SOURCE,
//     limit: 20
//   });
//   assert.equal(result.decision.decisionType, 'leaf');
//   assert.equal(result.decision.selectedLabel, 'customer service representative');
//   assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
//   assert.equal(result.rankedFamilies[0]?.rank, 1);
//   assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'customer service representative');
//   assert.equal(result.rankedLeaves[0]?.selectionEvidence?.tier, 'exact_alias');
//   assert.equal(result.rankedLeaves[0]?.closeness?.matchedLabel, 'customer service');
// });
// test('customer care specialist stays in the client-information family and no longer drifts to night auditor', async () => {
//   const result = await pipeline.run({
//     query: 'Customer Care Specialist',
//     locale: 'en',
//     sourceName: SOURCE,
//     limit: 20
//   });
//   assert.equal(result.decision.decisionType, 'family');
//   assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
//   assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'customer service representative');
//   assert.equal(result.rankedLeaves[0]?.familyScopedFit?.tier, 'capability_aligned');
//   assert.equal(result.rankedLeaves[0]?.selectionEvidence?.tier, 'strong_phrase');
//   assert.ok((result.rankedLeaves[0]?.closeness?.score ?? 0) <= 0.25);
//   assert.ok(result.coverageStatus.signals.missingRoleTokens.includes('specialist'));
// });
test('romanian customer-service title preserves the multilingual rescue shape with stronger family separation', async () => {
    const result = await pipeline.run({
        query: 'Agent Servicii Client',
        locale: 'ro',
        sourceName: SOURCE,
        limit: 20
    });
    assert.equal(result.decision.decisionType, 'leaf');
    assert.equal(result.decision.selectedLabel, 'customer service representative');
    assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
    assert.equal(result.rankedFamilies[1]?.familyLabel, 'Sales, marketing and public relations professionals');
    assert.ok((result.rankedFamilies[0]?.confidence ?? 0) > (result.rankedFamilies[1]?.confidence ?? 0));
    assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_signal'));
    assert.ok((result.rankedFamilies[2]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_penalty'));
});
