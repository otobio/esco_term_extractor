import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';
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
async function runPipeline(query, locale, disabledCommonRolePhraseRoleKeys = []) {
    return pipeline.run({
        query,
        locale,
        sourceName: SOURCE,
        limit: 20,
        disabledCommonRolePhraseRoleKeys
    });
}
test('support representative still needs the english curated phrase rescue', async () => {
    const enabled = await runPipeline('support representative', 'en');
    const disabled = await runPipeline('support representative', 'en', ['customer_care_representative']);
    assert.equal(enabled.decision.selectedLabel, 'customer service representative');
    assert.equal(disabled.decision.decisionType, 'unresolved');
    assert.equal(disabled.rankedFamilies[0]?.familyLabel, 'Administration professionals');
    assert.equal(disabled.rankedLeaves[0]?.canonicalLabel, 'human resources officer');
});
test('service representative still needs the english curated phrase rescue', async () => {
    const enabled = await runPipeline('service representative', 'en');
    const disabled = await runPipeline('service representative', 'en', ['customer_service_representative']);
    assert.equal(enabled.decision.selectedLabel, 'customer service representative');
    assert.equal(disabled.decision.decisionType, 'family');
    assert.equal(disabled.decision.selectedLabel, 'Other sales workers');
    assert.equal(disabled.rankedLeaves[0]?.canonicalLabel, 'rental service representative');
});
test('call center operator is better without the english curated phrase rewrite', async () => {
    const enabled = await runPipeline('call center operator', 'en');
    const disabled = await runPipeline('call center operator', 'en', ['call_center_operator']);
    assert.equal(enabled.decision.decisionType, 'family');
    assert.equal(enabled.decision.selectedLabel, 'Administrative and specialised secretaries');
    assert.equal(enabled.rankedLeaves[0]?.canonicalLabel, 'call centre analyst');
    assert.equal(disabled.decision.decisionType, 'family');
    assert.equal(disabled.decision.selectedLabel, 'Other sales workers');
    assert.equal(disabled.rankedLeaves[0]?.canonicalLabel, 'call centre agent');
});
test('call centre operator is better without the english curated phrase rewrite', async () => {
    const enabled = await runPipeline('call centre operator', 'en');
    const disabled = await runPipeline('call centre operator', 'en', ['call_center_operator']);
    assert.equal(enabled.decision.decisionType, 'family');
    assert.equal(enabled.decision.selectedLabel, 'Administrative and specialised secretaries');
    assert.equal(enabled.rankedLeaves[0]?.canonicalLabel, 'call centre analyst');
    assert.equal(disabled.decision.decisionType, 'leaf');
    assert.equal(disabled.decision.selectedLabel, 'call centre agent');
});
