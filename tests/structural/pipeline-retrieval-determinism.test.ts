import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';

const SOURCE = 'esco_1_2_1';
let pipeline: OccupationSearchPipeline;

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    leafStructureRuntime: true,
    aliasNgramLocales: ['en', 'ro', 'hu', 'et']
  });
  pipeline = OccupationSearchPipeline.withRuntime(runtime);
});

const DETERMINISM_QUERIES = [
  { query: 'software developer', locale: 'en' },
  { query: 'front desk receptionist', locale: 'en' },
  { query: 'Security Personnel', locale: 'en' },
  { query: 'Agent Servicii Client', locale: 'ro' },
  { query: 'ügyfélszolgálati munkatárs', locale: 'hu' }
];

// Candidate retrieval merges alias-query variants and text-field postings (resolution.md #9, #10);
// repeated runs of the same query must resolve to the same decision, top family, and top leaf
// regardless of any incidental ordering in that merge, not just a stable-but-arbitrary one.
for (const { query, locale } of DETERMINISM_QUERIES) {
  test(`repeated retrieval for "${query}" (${locale}) resolves to the same decision every run`, async () => {
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => pipeline.run({ query, locale, sourceName: SOURCE, limit: 20 }))
    );
    const [firstRun, ...otherRuns] = runs;

    for (const run of otherRuns) {
      assert.equal(run.decision.decisionType, firstRun.decision.decisionType);
      assert.equal(run.decision.selectedLabel, firstRun.decision.selectedLabel);
      assert.equal(run.decision.confidence, firstRun.decision.confidence);
      assert.equal(run.rankedFamilies[0]?.familyLabel, firstRun.rankedFamilies[0]?.familyLabel);
      assert.equal(run.rankedLeaves[0]?.canonicalLabel, firstRun.rankedLeaves[0]?.canonicalLabel);
    }
  });
}
