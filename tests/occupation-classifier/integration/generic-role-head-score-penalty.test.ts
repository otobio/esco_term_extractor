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
// + foldedAlias). But its translated role head ("worker") is generic, so recall also pulls in dozens
// of unrelated trades (bricklayer, plumber, roofer, ...) purely via the broad "worker" role-head
// group -- a roleResemblanceTier of 'generic', which already earns zero role-head credit (roleScore
// stays 0). Even so, the query has no authority/specialization signal, so the authority+structural
// score floor alone (0.55) cleared PROMOTION_SCORE_THRESHOLD (0.45) and beat the trustworthy
// alias-matched "shelf filler" (0.45) -- the query resolved as unresolved_ambiguous_leaves instead of
// picking the aliased leaf. A 'generic' role-head match must stay eligible (not hard rejected -- it
// may still be the best available near-miss elsewhere) but must never be allowed to outscore/outrank
// a candidate whose role-head evidence is actually meaningful.
test('a generic role-head match does not outscore a trustworthy exact-alias leaf', async () => {
  const result = await classifyOccupationTitle({
    query: 'LUCRATOR COMERCIAL',
    locale: 'ro',
    runtime
  });

  assert.equal(result.decision.type, 'leaf');
  assert.equal(result.leaf?.canonicalLabel, 'shelf filler');
});
