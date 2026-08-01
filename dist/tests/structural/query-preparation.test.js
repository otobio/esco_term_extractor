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
test('curated common role phrases canonicalize before fallback heads', async () => {
    const prepared = await prepareQuery('Customer suport ceha sau slovaca', 'en', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleTokens, ['customer', 'support']);
    assert.deepEqual(prepared.intent.roleHeadTokens, ['support']);
    assert.equal(prepared.commonRolePhraseMatch?.canonicalEnglish, 'customer support');
    assert.equal(prepared.commonRolePhraseMatch?.surfaceTokens.join(' ').toLowerCase(), 'customer suport');
});
test('venue context stays separate from the role head for generic supervisor queries', async () => {
    const prepared = await prepareQuery('restaurant supervisor', 'en', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleHeadTokens, ['supervisor']);
    assert.deepEqual(prepared.intent.venueTokens, ['restaurant']);
    assert.deepEqual(prepared.intent.domainTokens, []);
});
test('curated family aliases canonicalize low-confidence locale titles', async () => {
    const prepared = await prepareQuery('lucrator depozit', 'ro', { sourceName: SOURCE });
    assert.equal(prepared.commonRolePhraseMatch?.canonicalEnglish, 'warehouse worker');
    assert.deepEqual(prepared.intent.roleTokens, ['warehouse', 'worker']);
    assert.deepEqual(prepared.intent.roleHeadTokens, ['worker']);
});
test('english generic fallback keeps the rightmost useful token as head', async () => {
    const prepared = await prepareQuery('software data', 'en', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleTokens, ['data']);
    assert.deepEqual(prepared.intent.roleHeadTokens, ['data']);
    assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['software']);
});
test('romanian generic fallback prefers the leftmost useful token', async () => {
    const prepared = await prepareQuery('depozit muncitor', 'ro', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleTokens, ['depozit']);
    assert.deepEqual(prepared.intent.roleHeadTokens, ['depozit']);
    assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['muncitor']);
});
test('hungarian generic fallback prefers the leftmost useful token', async () => {
    const prepared = await prepareQuery('depozit raktar', 'hu', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleTokens, ['depozit']);
    assert.deepEqual(prepared.intent.roleHeadTokens, ['depozit']);
    assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['raktar']);
});
test('ordered frame markers prefer the higher generic head when stacked', async () => {
    const prepared = await prepareQuery('assistant manager', 'en', { sourceName: SOURCE });
    assert.deepEqual(prepared.intent.roleHeadTokens, ['manager']);
    assert.ok(prepared.intent.roleTokens.includes('assistant'));
    assert.ok(prepared.intent.roleTokens.includes('manager'));
});
test('clean occupation titles stay out of the ambiguous phrase atlas', async () => {
    const prepared = await prepareQuery('software developer', 'en', { sourceName: SOURCE });
    assert.equal(prepared.commonRolePhraseMatch, null);
});
