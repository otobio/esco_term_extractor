import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { classifyOccupationTitleDebug } from '../../../src/occupation-classifier/index.js';
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
test('role-head default industry does not bypass authority conflict by itself', async () => {
    const result = await classify('Farmacist sef- Baicoi');
    const pharmacist = result.candidates.find((candidate) => candidate.canonicalLabel === 'pharmacist');
    assert.ok(pharmacist, 'expected pharmacist candidate to be assessed');
    assert.equal(pharmacist.status, 'hard_rejected');
    assert.equal(pharmacist.rejectReason, 'authority_conflict');
    assert.equal(pharmacist.authorityGate.decision, 'reject');
    assert.equal(pharmacist.structuralGate.rawDecision, 'pass_partial');
    assert.equal(pharmacist.structuralGate.matchedDimensionCount, 0);
    assert.equal(pharmacist.canonical.roleResemblanceTier, 'exact');
});
async function classify(query) {
    return classifyOccupationTitleDebug({ query, locale: 'ro', runtime });
}
