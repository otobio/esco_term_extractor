import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';

const SOURCE = 'esco_1_2_1';
let pipeline: OccupationSearchPipeline;

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro']
  });
  pipeline = OccupationSearchPipeline.withRuntime(runtime);
});

test('exact canonical occupation promotes a leaf with exact coverage', async () => {
  const result = await pipeline.run({
    query: 'software developer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'software developer');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
  assert.equal(result.coverageStatus.signals.missingUsefulTokens.length, 0);
});

test('market title family support does not become unsafe leaf authority', async () => {
  const result = await pipeline.run({
    query: 'Fullstack developer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Software and applications developers and analysts');
  assert.equal(result.coverageStatus.status, 'likely_dictionary_gap');
  assert.ok(result.coverageStatus.signals.missingRoleTokens.includes('fullstack'));
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'ngram_alias'));
});

test('domain context cannot dominate role intent for airline compliance query', async () => {
  const result = await pipeline.run({
    query: 'Airline Compliance Auditors',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Ship and aircraft controllers and technicians');
  assert.notEqual(result.decision.selectedLabel, 'airline pilot');
  assert.deepEqual(result.preparedQuery.intent.domainTokens, ['airline']);
  assert.deepEqual(result.preparedQuery.intent.roleTokens, ['compliance', 'auditors']);
  assert.ok(['unresolved', 'family'].includes(result.decision.decisionType));
});

test('slash-separated Romanian title returns independent multi-span results', async () => {
  const result = await pipeline.run({
    query: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'multi_span');
  assert.equal(result.spanResults.length, 2);
  assert.deepEqual(result.queryContext.querySpans, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
  assert.equal(result.rankedFamilies.length, 0);
  assert.equal(result.rankedLeaves.length, 0);
  assert.equal(result.spanResults[1]?.decision.selectedLabel, 'kitchen assistant');
});

test('localized exact alias can resolve through English backbone canonical leaf', async () => {
  const result = await pipeline.run({
    query: 'analist de date',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'data analyst');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Software and applications developers and analysts');
});
