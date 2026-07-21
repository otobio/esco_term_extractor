import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareOccupationRetrievalQuery } from '../../query/occupation-retrieval-query.js';
import { prepareQuery } from '../../query/query-preparation.js';

const SOURCE = 'esco_1_2_1';

test('query preparation preserves multi-occupation spans as independent contexts', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD'
  });

  assert.deepEqual(prepared.querySpans, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
  assert.equal(prepared.query, 'LUCRATOR COMERCIAL AJUTOR BUCATAR FAST FOOD');
  assert.deepEqual(prepared.keptQuerySignals, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
});

test('intent classifier keeps role terms primary and domain terms supporting', async () => {
  const prepared = await prepareQuery('Airline Compliance Auditors', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.domainTokens, ['airline']);
  assert.deepEqual(prepared.intent.roleTokens, ['compliance', 'auditors']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['auditors']);
  assert.ok(prepared.intent.confidence >= 0.8);
});

test('acronym preparation preserves acronym token and expands controlled long form', async () => {
  const prepared = await prepareQuery('HVAC technician', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.acronymTokens, ['HVAC']);
  assert.ok(prepared.usefulFoldedTokens.includes('HVAC'));
  assert.ok(prepared.usefulFoldedTokens.includes('heating'));
  assert.ok(prepared.usefulFoldedTokens.includes('ventilation'));
  assert.ok(prepared.usefulFoldedTokens.includes('air'));
  assert.ok(prepared.usefulFoldedTokens.includes('conditioning'));
  assert.ok(prepared.intent.roleTokens.includes('technician'));
  assert.deepEqual(prepared.intent.roleHeadTokens, ['technician']);
});

test('job level noise does not dominate useful role tokens', async () => {
  const prepared = await prepareQuery('Senior Data Analyst', 'en', { sourceName: SOURCE });

  assert.ok(prepared.modifierTokens.includes('senior'));
  assert.ok(!prepared.usefulFoldedTokens.includes('senior'));
  assert.ok(prepared.usefulFoldedTokens.includes('data'));
  assert.ok(prepared.usefulFoldedTokens.includes('analyst'));
});
