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

test('job function prior disambiguates broad builder title toward construction family', async () => {
  const result = await pipeline.run({
    query: 'Builder',
    locale: 'en',
    sourceName: SOURCE,
    jobFunction: 'skilled_trades',
    limit: 20
  });

  assert.equal(result.queryContext.jobFunction, 'skilled_trades');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Building frame and related trades workers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'job_function_family_prior'));
});

test('job function prior does not override role intent without matching family evidence', async () => {
  const result = await pipeline.run({
    query: 'Airline Compliance Auditors',
    locale: 'en',
    sourceName: SOURCE,
    jobFunction: 'transport_driving',
    limit: 20
  });

  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Ship and aircraft controllers and technicians');
  assert.notEqual(result.decision.selectedLabel, 'airline pilot');
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
  assert.equal(result.spanResults[1]?.decision.selectedLabel, 'Food preparation assistants');
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

test('bare supervisor prefers the supervisor family over the technical alias drift', async () => {
  const result = await pipeline.run({
    query: 'supervisor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Mining, manufacturing and construction supervisors');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Process control technicians');
});

test('venue context keeps supervisor away from the manufacturing default', async () => {
  const result = await pipeline.run({
    query: 'restaurant supervisor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.venueTokens, ['restaurant']);
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Mining, manufacturing and construction supervisors');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Hotel and restaurant managers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps manager aligned with the right operating family', async () => {
  const result = await pipeline.run({
    query: 'factory manager',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.ok(result.preparedQuery.intent.roleTokens.includes('factory'));
  assert.deepEqual(result.preparedQuery.intent.venueTokens, []);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Manufacturing, mining, construction, and distribution managers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps assistant away from the wrong administrative default', async () => {
  const result = await pipeline.run({
    query: 'hospital assistant',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.venueTokens, ['hospital']);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Personal care workers in health services');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps operator out of the wrong clerical family', async () => {
  const result = await pipeline.run({
    query: 'factory operator',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.ok(result.preparedQuery.intent.roleTokens.includes('factory'));
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Process control technicians');
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Material-recording and transport clerks');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps technician aligned with the right ICT family', async () => {
  const result = await pipeline.run({
    query: 'computer technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Information and communications technology operations and user support technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps technician aligned with the right health family', async () => {
  const result = await pipeline.run({
    query: 'hospital technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Medical and pharmaceutical technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps technician aligned with the right life-science family', async () => {
  const result = await pipeline.run({
    query: 'agricultural technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Life science technicians and related associate professionals');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('industrial venue keeps technician in the general engineering family', async () => {
  const result = await pipeline.run({
    query: 'factory technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Physical and engineering science technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps officer aligned with the right health support family', async () => {
  const result = await pipeline.run({
    query: 'hospital officer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Other health associate professionals');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps worker aligned with the right industrial labor family', async () => {
  const result = await pipeline.run({
    query: 'factory worker',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Manufacturing labourers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});
