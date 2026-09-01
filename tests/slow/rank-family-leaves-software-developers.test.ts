import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { cliRankFamilyLeaves, resolveFamily } from '../../src/cli/rank-family-leaves-core.js';

// These tests exercise `cliRankFamilyLeaves` directly against the real "Software and applications
// developers and analysts" family (loaded from the real esco_1_2_1 runtime artifacts), bypassing the
// full search pipeline, so we can assert exact sibling-leaf ranking order for authority/specialization
// behavior. Mirrors tests/slow/rank-family-leaves-shop-salespersons.test.ts.
//
// Several of these are EXPECTED TO FAIL right now -- that is diagnostic, not a bug. They document the
// intended ranking behavior ahead of still-pending specialization scoring fixes.

const SOURCE = 'esco_1_2_1';
const LOCALE = 'en';
const FAMILY = 'Software and applications developers and analysts';

let searchMetaArtifact: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>;
let leafStructureArtifact: Awaited<ReturnType<typeof loadOccupationLeafStructureArtifactRequired>>;
let familyLeaves: ReturnType<typeof searchMetaArtifact.getLeafCoreRecordsForFamilies>;

before(async () => {
  const [loadedSearchMeta, loadedLeafStructure] = await Promise.all([
    loadOccupationSearchMetaArtifactRequired(SOURCE),
    loadOccupationLeafStructureArtifactRequired(SOURCE)
  ]);

  searchMetaArtifact = loadedSearchMeta;
  leafStructureArtifact = loadedLeafStructure;

  const family = resolveFamily(searchMetaArtifact, FAMILY);
  familyLeaves = searchMetaArtifact.getLeafCoreRecordsForFamilies([family.familyNodeId]);
});

async function rankQuery(query: string, locale: string = LOCALE) {
  const cleanedQuery = await cleanOccupationQuerySurface(query, locale);
  const effectiveQuery = cleanedQuery || query;
  const preparedQuery = await prepareQuery(effectiveQuery, locale, { sourceName: SOURCE });

  return cliRankFamilyLeaves(searchMetaArtifact, leafStructureArtifact, familyLeaves, preparedQuery, effectiveQuery, locale);
}

function labelsOf(ranked: Awaited<ReturnType<typeof rankQuery>>): string[] {
  return ranked.map((leaf) => leaf.canonicalLabel);
}

function assertOrder(actualLabels: string[], expectedOrderPrefix: string[], query: string): void {
  const actualPrefix = actualLabels.slice(0, expectedOrderPrefix.length);
  assert.deepEqual(
    actualPrefix,
    expectedOrderPrefix,
    `query="${query}" expected top ${expectedOrderPrefix.length} = ${JSON.stringify(expectedOrderPrefix)}, got ${JSON.stringify(actualPrefix)} (full: ${JSON.stringify(actualLabels.slice(0, 8))})`
  );
}

test('bare developer: generic software developer must not lose to a specialized sibling', async () => {
  const ranked = await rankQuery('developer');
  assertOrder(labelsOf(ranked), ['software developer'], 'developer');
});

test('mobile developer: mobile application developer wins', async () => {
  const ranked = await rankQuery('mobile developer');
  assertOrder(labelsOf(ranked), ['mobile application developer'], 'mobile developer');
});

test('app developer: mobile application developer beats ICT application developer', async () => {
  const ranked = await rankQuery('app developer');
  assertOrder(labelsOf(ranked), ['mobile application developer', 'ICT application developer'], 'app developer');
});

test('cloud developer: cloud software developer must not lose to cloud engineer', async () => {
  const ranked = await rankQuery('cloud developer');
  assertOrder(labelsOf(ranked), ['cloud software developer'], 'cloud developer');
});

test('games developer: digital games developer wins', async () => {
  const ranked = await rankQuery('games developer');
  assertOrder(labelsOf(ranked), ['digital games developer', 'digital games tester'], 'games developer');
});

test('UI developer: user interface developer beats user interface designer', async () => {
  const ranked = await rankQuery('UI developer');
  assertOrder(labelsOf(ranked), ['user interface developer', 'user interface designer'], 'UI developer');
});

test('IoT software developer: IoT developer wins over the generic and embedded siblings', async () => {
  const ranked = await rankQuery('IoT software developer');
  assertOrder(labelsOf(ranked), ['IoT developer', 'software developer'], 'IoT software developer');
});

test('blockchain software developer: blockchain developer must not lose to generic software developer', async () => {
  const ranked = await rankQuery('blockchain software developer');
  assertOrder(labelsOf(ranked), ['blockchain developer'], 'blockchain software developer');
});

test('blockchain developer: blockchain developer beats blockchain architect', async () => {
  const ranked = await rankQuery('blockchain developer');
  assertOrder(labelsOf(ranked), ['blockchain developer', 'blockchain architect'], 'blockchain developer');
});

test('software architect: software architect beats ICT system architect', async () => {
  const ranked = await rankQuery('software architect');
  assertOrder(labelsOf(ranked), ['software architect', 'ICT system architect'], 'software architect');
});

// Isolates the industryContextInherentToFamily kind-vs-cluster granularity mechanism specifically.
// The family label "Software and applications developers and analysts" contains "software" (ict
// cluster), so leaves whose ONLY industry_context marker is "software" (or another ict-cluster word
// like "application"/"cloud") are exempt from decay on a bare query -- that's baseline family
// membership, not a query-supported specialization. But "embedded systems software developer" also
// carries "embedded", a SEPARATE industry_context cluster the family label says nothing about; that
// extra claim must not ride tax-free on the "software" exemption just because both live under the
// same industry_context kind on the same leaf.
test('bare developer: a leaf with an extra non-family-inherent industry_context cluster (embedded) must rank behind plain software developer', async () => {
  const ranked = await rankQuery('developer');
  const labels = labelsOf(ranked);
  const softwareDeveloperIndex = labels.indexOf('software developer');
  const embeddedIndex = labels.indexOf('embedded systems software developer');
  assert.ok(softwareDeveloperIndex !== -1, `"software developer" missing from ranking: ${JSON.stringify(labels.slice(0, 10))}`);
  assert.ok(embeddedIndex !== -1, `"embedded systems software developer" missing from ranking: ${JSON.stringify(labels.slice(0, 10))}`);
  assert.ok(
    embeddedIndex > softwareDeveloperIndex,
    `query="developer" expected "embedded systems software developer" (index ${embeddedIndex}) to rank behind "software developer" (index ${softwareDeveloperIndex}); the query gives no evidence for "embedded" so it must not escape decay`
  );
});

// The flip side: when the query DOES supply evidence for the extra cluster, the leaf must still win
// on the strength of that match -- proves the fix withdraws the exemption rather than blanket-
// penalizing every leaf that happens to carry more than one industry_context marker.
test('embedded developer: embedded systems software developer wins when the query actually supports "embedded"', async () => {
  const ranked = await rankQuery('embedded developer');
  assertOrder(labelsOf(ranked), ['embedded systems software developer'], 'embedded developer');
});
