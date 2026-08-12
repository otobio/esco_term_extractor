import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { PipelineGoldenSuiteRunner } from '../../src/search-pipeline/golden-suite.js';
const SOURCE = 'esco_1_2_1';
let runtime;
before(async () => {
    runtime = await OccupationRuntimeContext.load({
        sourceName: SOURCE,
        retrievalBackend: 'binary-cache'
    });
});
test('golden suite runner uses the integrated runtime path when runtime is provided with leaf-structure runtime disabled', async () => {
    const runner = new PipelineGoldenSuiteRunner(null);
    const result = await runner.run({
        sourceName: SOURCE,
        suite: 'stable',
        caseKeys: ['exact-software-developer'],
        runtime,
        retrievalEngine: runtime.retrievalEngine
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.passed, true);
    assert.equal(result.results[0]?.actual.selectedLabel, 'software developer');
    assert.equal(result.results[0]?.actual.topFamilyLabel, 'Software and applications developers and analysts');
});
