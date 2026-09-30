import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { getCanonicalTerm } from '../../src/api/canonical-term.js';
import { fakeFetch } from '../occupation-esco-api-classifier/fixtures/fake-esco-api.js';
const MODES = ['v1', 'v2', 'v3'];
before(() => {
    globalThis.fetch = fakeFetch;
});
async function allModes(input, locale) {
    const [v1, v2, v3] = await Promise.all(MODES.map((mode) => getCanonicalTerm({ input, locale, mode })));
    return { v1, v2, v3 };
}
function assertTermShape(term, label) {
    if (term === null) {
        return;
    }
    assert.equal(typeof term.graphNodeId, 'number', `${label}.graphNodeId`);
    assert.ok(term.graphNodeId >= 0, `${label}.graphNodeId maps to a graph node`);
    assert.equal(typeof term.canonicalTerm, 'string', `${label}.canonicalTerm`);
    assert.equal(typeof term.confidence, 'number', `${label}.confidence`);
}
function assertContextShape(context, label) {
    assert.deepEqual(Object.keys(context).sort(), [
        'altFamilyCanonicalTerms',
        'altLeafCanonicalTerms',
        'capabilityTerms',
        'coverageStatus',
        'decision',
        'input',
        'selectedFamilyTerm',
        'selectedLeafTerm',
        'spanIndex'
    ]);
    assert.deepEqual(Object.keys(context.decision).sort(), ['confidence', 'decisionType', 'selectedCanonicalTerm', 'selectedGraphNodeId']);
    assert.equal(typeof context.spanIndex, 'number');
    assertTermShape(context.selectedLeafTerm, `${label}.selectedLeafTerm`);
    assertTermShape(context.selectedFamilyTerm, `${label}.selectedFamilyTerm`);
    context.altLeafCanonicalTerms.forEach((term, index) => assertTermShape(term, `${label}.altLeafCanonicalTerms[${index}]`));
    context.altFamilyCanonicalTerms.forEach((term, index) => assertTermShape(term, `${label}.altFamilyCanonicalTerms[${index}]`));
    for (const capability of context.capabilityTerms) {
        assert.deepEqual(Object.keys(capability).sort(), ['canonicalTerm', 'capabilityId', 'capabilityType', 'confidence']);
    }
}
function assertSameResultShape(results) {
    for (const mode of MODES) {
        assert.deepEqual(Object.keys(results[mode]).sort(), ['input', 'locale', 'occupationContexts'], mode);
        results[mode].occupationContexts.forEach((context, index) => assertContextShape(context, `${mode}[${index}]`));
    }
}
test('v1, v2 and v3 resolve an exact English title to the same leaf and family graph nodes', async () => {
    const results = await allModes('financial auditor', 'en');
    assertSameResultShape(results);
    for (const mode of MODES) {
        const [context] = results[mode].occupationContexts;
        assert.equal(context?.decision.decisionType, 'leaf', mode);
        assert.equal(context?.selectedLeafTerm?.canonicalTerm, 'financial auditor', mode);
        assert.equal(context?.selectedLeafTerm?.graphNodeId, results.v1.occupationContexts[0]?.selectedLeafTerm?.graphNodeId, mode);
        assert.equal(context?.selectedFamilyTerm?.graphNodeId, results.v1.occupationContexts[0]?.selectedFamilyTerm?.graphNodeId, mode);
        assert.ok((context?.capabilityTerms.length ?? 0) > 0, mode);
    }
});
test('v1, v2 and v3 return one occupation context per slash-separated span', async () => {
    const results = await allModes('LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD', 'ro');
    assertSameResultShape(results);
    for (const mode of MODES) {
        assert.deepEqual(results[mode].occupationContexts.map((context) => context.spanIndex), [1, 2], mode);
    }
});
