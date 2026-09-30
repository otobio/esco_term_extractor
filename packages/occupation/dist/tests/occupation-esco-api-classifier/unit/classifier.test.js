import assert from 'node:assert/strict';
import test from 'node:test';
import { EscoApiClient, classifyOccupationTitleViaEscoApi } from '../../../src/occupation-esco-api-classifier/index.js';
import { fakeFetch } from '../fixtures/fake-esco-api.js';
function classify(query, locale, fetch = fakeFetch) {
    return classifyOccupationTitleViaEscoApi({ query, locale, client: new EscoApiClient({ fetch, retries: 0 }) });
}
function recordSearchLanguages(languages) {
    return (url, init) => {
        const parsed = new URL(url);
        if (!parsed.pathname.endsWith('/resource/concept')) {
            languages.push(parsed.searchParams.get('language') ?? '');
        }
        return fakeFetch(url, init);
    };
}
test('alternative label resolves leaf and ignores skill terms', async () => {
    const result = await classify('ajutor bucătar', 'ro');
    assert.equal(result.decision.reason, 'exact_alternative_label_leaf');
    assert.equal(result.leaf?.label, 'kitchen assistant');
    assert.equal(result.family?.code, '941');
});
test('ISCO group label resolves family without leaf', async () => {
    const result = await classify('Bucătari', 'ro');
    assert.equal(result.decision.reason, 'exact_family_label');
    assert.equal(result.leaf, null);
    assert.equal(result.family?.label, 'Cooks');
});
test('preferred label resolves HU leaf', async () => {
    const result = await classify('könyvelő', 'hu');
    assert.equal(result.decision.reason, 'exact_preferred_label_leaf');
    assert.equal(result.leaf?.label, 'accountant');
});
test('gendered label variants match either form', async () => {
    const result = await classify('waiter', 'en');
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.code, '5131.1');
});
test('domain term alone does not pull pilot leaf or family', async () => {
    const result = await classify('Airline Compliance Auditors', 'en');
    assert.equal(result.decision.type, 'family');
    assert.equal(result.family?.code, '241');
    assert.ok(!result.altLeaves.some((leaf) => leaf.code.startsWith('3153')));
    assert.deepEqual(result.coverage.missingTokens.sort(), ['airline', 'compliance']);
});
test('unresolved mixed-language span retries in English', async () => {
    const languages = [];
    const result = await classify('nurse nővér', 'hu', recordSearchLanguages(languages));
    assert.deepEqual(languages, ['hu', 'hu', 'en', 'en']);
    assert.equal(result.evidenceLanguage, 'en');
    assert.equal(result.family?.code, '222');
});
test('English span under a non-English locale searches English only', async () => {
    const languages = [];
    const result = await classify('waiter', 'hu', recordSearchLanguages(languages));
    assert.deepEqual(languages, ['en', 'en']);
    assert.equal(result.evidenceLanguage, 'en');
    assert.equal(result.leaf?.code, '5131.1');
});
test('slash-separated title returns independent spans', async () => {
    const result = await classify('LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD', 'ro');
    assert.equal(result.decision.type, 'multi_span');
    assert.equal(result.leaf, null);
    assert.equal(result.family, null);
    assert.equal(result.spans?.length, 2);
    assert.equal(result.spans?.[0]?.result.leaf?.label, 'shelf filler');
});
test('unsupported locale fails clearly', async () => {
    await assert.rejects(() => classify('cook', 'xx'), /Unsupported ESCO API locale/u);
});
