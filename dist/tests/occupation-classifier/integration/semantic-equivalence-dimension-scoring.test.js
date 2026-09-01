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
// Bug: candidates.ts scored an `equivalent_concept` product-dimension match (e.g. "car" ~ "vehicle")
// as zero weight, and excluded `unknown` dimensions from the requestedCoverage denominator entirely
// -- so a leaf with NO product data at all (e.g. "advertising sales agent") scored *better* on
// requestedCoverage than "vehicle rental agent", which actually recognised the query's product via an
// equivalence class. That let generic "... sales agent" leaves outrank the semantically correct
// "vehicle rental agent". Fixed by giving equivalent_concept the same partial credit as
// recoverable_available, and by keeping unknown dimensions in the denominator as a zero-weight miss
// instead of dropping them.
test('a product equivalence-class match outranks leaves with no product data at all', async () => {
    const result = await classifyOccupationTitle({
        query: 'Car Rental Sales Agent - Iasi',
        locale: 'ro',
        runtime
    });
    assert.equal(result.decision.type, 'leaf');
    assert.equal(result.leaf?.canonicalLabel, 'vehicle rental agent');
});
