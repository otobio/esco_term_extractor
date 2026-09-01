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

// Bug: "bucatar fast food" (ro) translates to "cook restaurant", which asks for no product/work-object
// specialization at all. The base leaf "cook" and the specialized leaf "fish cook" both score 0.79 --
// an exact tie -- because wildDimensionCount never charges "fish cook" for its unrequested "fish"
// specialization. classifySpecializationQuery("fish cook") only resolves "fish" into
// profile.work_object/profile.product when the candidate's role head belongs to the "commercial" or
// "technical" role-mode group (see fish_product/fish_work_object in specialization-concept-rules.csv),
// but "cook" carries no role_mode tag in specialization-role-heads.csv, so the concept never resolves
// and "fish" is left in `unresolved`/`available` only -- invisible to the wild-dimension penalty. The
// query ties instead of preferring the base leaf, and falls back to family_leaf_ambiguity instead of
// resolving to the leaf "cook". This is the same class of bug behind the shop-salespersons ranking
// failures: a base leaf must be preferred over a specialized sibling when the query does not request
// (and the leaf does not carry) that specialization.
test('a base leaf is preferred over a specialized sibling leaf when the query requests no specialization', async () => {
  const result = await classifyOccupationTitle({
    query: 'bucatar fast food',
    locale: 'ro',
    runtime
  });

  assert.equal(result.decision.type, 'leaf');
  assert.equal(result.leaf?.canonicalLabel, 'cook');
});
