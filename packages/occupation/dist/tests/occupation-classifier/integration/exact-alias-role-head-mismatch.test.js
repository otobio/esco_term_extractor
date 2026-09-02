import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { classifyOccupationTitle } from '../../../src/occupation-classifier/index.js';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';
const SOURCE = 'esco_1_2_1';
let runtime;
before(async () => {
    runtime = await OccupationRuntimeContext.load({
        sourceName: SOURCE,
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
});
// Bug: "LUCRATOR COMERCIAL" (ro) has a genuine exact alias match to "shelf filler" (exactPrimaryAlias
// + foldedAlias), but the classifier's translated tokens ("business market worker") give it a role-head
// that reads as unrelated to "filler". The role-head-mismatch hard reject was firing even though a
// trustworthy exact alias (not the shakier family-derived exactSupportingAlias) already proves the
// candidate is correct -- so the query resolved as unresolved_all_candidates_rejected instead of
// picking the aliased leaf.
test('exact primary/folded alias match overrides a role-head mismatch and resolves the leaf', async () => {
    const result = await classifyOccupationTitle({
        query: 'LUCRATOR COMERCIAL',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'shelf filler');
});
// Bug: alias-proven "human resources manager" tied on score with a crowd of unrelated "___ manager"
// candidates; compareRankedLeaves must give authoritative evidence an outright tie-break win.
test('exact primary/folded alias match outranks a crowd of coincidentally tied same-score candidates', async () => {
    const result = await classifyOccupationTitle({
        query: 'Manager Resurse Umane',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'human resources manager');
});
test('authority-compatible pastry context infers the culinary role head and resolves the leaf', async () => {
    const result = await classifyOccupationTitle({
        query: 'Sef tura patiserie',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'head pastry chef');
    assert.equal(result.leaf?.familyLabel, 'Cooks');
});
test('exact canonical role-head shortcut yields to a better structurally grounded leaf', async () => {
    const result = await classifyOccupationTitle({
        query: 'Solar System Panel',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.decision.reason, 'promotable_leaf');
    assert.equal(result.leaf?.canonicalLabel, 'solar energy technician');
    assert.notEqual(result.leaf?.canonicalLabel, 'electrician');
});
test('leaf structural evidence keeps an incomplete family rule eligible for selection', async () => {
    const result = await classifyOccupationTitle({
        query: 'Consultant Vanzari - Mobexpert Baia Mare',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'business consultant');
    assert.equal(result.leaf?.familyLabel, 'Administration professionals');
});
test('role-grounded partial family leaf can beat a weak accepted alias-only family leaf', async () => {
    const result = await classifyOccupationTitle({
        query: 'Customer Agent with English and Irish understanding',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'customer service representative');
    assert.equal(result.leaf?.familyLabel, 'Client information workers');
});
