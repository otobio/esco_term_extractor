import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { PipelineGoldenSuiteRunner } from '../../src/search-pipeline/golden-suite.js';

const SOURCE = 'esco_1_2_1';

let runtime: OccupationRuntimeContext;

before(async () => {
  runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache'
  });
});

test('golden suite runner uses the integrated runtime path when runtime is provided with leaf-structure runtime disabled', async () => {
  const runner = new PipelineGoldenSuiteRunner(null as never);
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

test('a same-leaf alias with real token overlap outranks an exact but zero-overlap translated-label collision through the full pipeline', async () => {
  // Regression for the leaf-closeness-ranker fix: enabling the CLI's English alias fallback exposed a
  // bug where the "store manager" alias (an exact match for the query's translated role head) won the
  // closeness pick over "shop manager"'s own matching Estonian alias, despite sharing zero real tokens
  // with the query -- see tests/structural/leaf-closeness-ranker.test.ts for the ranker-level case.
  const runner = new PipelineGoldenSuiteRunner(null as never);
  const result = await runner.run({
    sourceName: SOURCE,
    suite: 'stable',
    caseKeys: ['et-poe-juht'],
    runtime,
    retrievalEngine: runtime.retrievalEngine
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.passed, true);
  assert.equal(result.results[0]?.actual.selectedLabel, 'shop manager');
  assert.equal(result.results[0]?.actual.topFamilyLabel, 'Retail and wholesale trade managers');
});
