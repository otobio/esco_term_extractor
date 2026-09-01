import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { classifyOccupationTitle } from '../../../src/occupation-classifier/index.js';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';

const SOURCE = 'esco_1_2_1';

let runtime: OccupationRuntimeContext;

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

test('authority-compatible concept evidence does not reject the matching family', async () => {
  const result = await classifyOccupationTitle({
    query: 'Sef tura patiserie',
    locale: 'ro',
    runtime
  });

  assert.equal(result.decision.type, 'family');
  assert.equal(result.family?.familyLabel, 'Cooks');
});
