import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';

const SOURCE = 'esco_1_2_1';
let pipeline: OccupationSearchPipeline;

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    leafStructureRuntime: true,
    aliasNgramLocales: ['en', 'ro', 'hu', 'et']
  });
  pipeline = OccupationSearchPipeline.withRuntime(runtime);
});

test('generic customer-service query prefers the client-information family and representative leaf over unsupported supervisor recovery', async () => {
  const result = await pipeline.run({
    query: 'Customer Service Representatives',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'customer service representative');
  assert.notEqual(result.rankedLeaves[0]?.canonicalLabel, 'call centre supervisor');
});

test('customer-care query prefers the generic customer-service leaf over venue-shifted night auditor', async () => {
  const result = await pipeline.run({
    query: 'Customer Care Specialist',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
  assert.notEqual(result.rankedLeaves[0]?.canonicalLabel, 'night auditor');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'customer service representative');
});

test('Hungarian customer-service query keeps the client-information family and ranks a real leaf above the family node', async () => {
  const result = await pipeline.run({
    query: 'ügyfélszolgálati munkatárs',
    locale: 'hu',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'customer service representative');
  assert.notEqual(result.rankedLeaves[0]?.canonicalLabel, result.rankedFamilies[0]?.familyLabel);
});

test('generic cleaner query prefers cleaner leaves over unsupported industry-specialized aliases', async () => {
  const result = await pipeline.run({
    query: 'cleaner',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Domestic, hotel and office cleaners and helpers');
  assert.match(result.rankedLeaves[0]?.canonicalLabel, /cleaner/);
  //assert.notEqual(result.rankedLeaves[0]?.canonicalLabel, 'aircraft groomer');
});

test('exact manager query still promotes the requested manager leaf', async () => {
  const result = await pipeline.run({
    query: 'sales manager',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'sales manager');
});
