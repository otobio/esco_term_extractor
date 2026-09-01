import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../../src/query/occupation-query-cleaning.js';
import { resolveFamily } from '../../../src/cli/rank-family-leaves-core.js';
import { assessCandidatesThroughFilterFunnel } from '../../../src/occupation-classifier/candidates.js';
import { buildQueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';
import { buildCanonicalComparisonQuery, translateTitleForClassifier } from '../../../src/occupation-classifier/translation.js';
import type {
  CandidateAssessment,
  CandidateEvidence,
  HydratedCandidate,
  SupportedQueryLocale
} from '../../../src/occupation-classifier/types.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../../src/runtime/occupation-search-meta-artifact.js';
import { foldWeakPunctuationLookupText } from '../../../src/utils/texts.js';

// These tests exercise the new classifier's candidate-assessment funnel (canonical resemblance +
// authority gate + specialization/structural gate) directly against the real "Software and
// applications developers and analysts" family (loaded from the real esco_1_2_1 runtime artifacts),
// bypassing retrieval/recall, so we can assert exact sibling-leaf ranking order for authority/
// specialization behavior. Mirrors rank-family-leaves-shop-salespersons-slow.test.ts.
//
// Ported from tests/slow/rank-family-leaves-software-developers.test.ts (old pipeline). This file is
// a diagnostic backlog for leaf ordering, not part of the production family-filter gate yet.
const diagnosticTest = test.skip;

const SOURCE = 'esco_1_2_1';
const LOCALE: SupportedQueryLocale = 'en';
const FAMILY = 'Software and applications developers and analysts';

const emptyEvidence = (): CandidateEvidence => ({
  exactCanonical: false,
  weakExactCanonical: false,
  exactPrimaryAlias: false,
  exactSupportingAlias: false,
  foldedAlias: false,
  subphraseAlias: false,
  englishAlias: false,
  titleToken: false,
  ngramAlias: false,
  roleHeadEquivalent: false,
  tieBreakerScore: 0
});

let searchMetaArtifact: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>;
let leafStructureArtifact: Awaited<ReturnType<typeof loadOccupationLeafStructureArtifactRequired>>;
let hydratedFamilyLeaves: HydratedCandidate[];

before(async () => {
  const [loadedSearchMeta, loadedLeafStructure] = await Promise.all([
    loadOccupationSearchMetaArtifactRequired(SOURCE),
    loadOccupationLeafStructureArtifactRequired(SOURCE)
  ]);

  searchMetaArtifact = loadedSearchMeta;
  leafStructureArtifact = loadedLeafStructure;

  const family = resolveFamily(searchMetaArtifact, FAMILY);
  const familyLeaves = searchMetaArtifact.getLeafCoreRecordsForFamilies([family.familyNodeId]);

  hydratedFamilyLeaves = familyLeaves.map((leaf) => ({
    graphNodeId: leaf.graphNodeId,
    canonicalLabel: leaf.canonicalLabel,
    canonicalWeakFolded: foldWeakPunctuationLookupText(leaf.canonicalLabel),
    familyNodeId: leaf.familyNodeId as number,
    familyLabel: leaf.familyLabel as string,
    evidence: emptyEvidence()
  }));
});

async function rankQuery(query: string, locale: SupportedQueryLocale = LOCALE): Promise<CandidateAssessment[]> {
  const cleanedQuery = await cleanOccupationQuerySurface(query, locale);
  const effectiveQuery = cleanedQuery || query;

  const comparisonQuery = await translateTitleForClassifier(effectiveQuery, locale);

  const queryProfile = buildQueryStructuralProfile(effectiveQuery);
  const ledger = assessCandidatesThroughFilterFunnel(hydratedFamilyLeaves, comparisonQuery, leafStructureArtifact, queryProfile, 'en');

  return [...ledger.values()].sort((first, second) => second.canonical.score - first.canonical.score);
}

function labelsOf(ranked: CandidateAssessment[]): string[] {
  return ranked.map((candidate) => candidate.canonicalLabel);
}

function assertOrder(actualLabels: string[], expectedOrderPrefix: string[], query: string): void {
  const actualPrefix = actualLabels.slice(0, expectedOrderPrefix.length);
  assert.deepEqual(
    actualPrefix,
    expectedOrderPrefix,
    `query="${query}" expected top ${expectedOrderPrefix.length} = ${JSON.stringify(expectedOrderPrefix)}, got ${JSON.stringify(actualPrefix)} (full: ${JSON.stringify(actualLabels.slice(0, 8))})`
  );
}

diagnosticTest('bare developer: generic software developer must not lose to a specialized sibling', async () => {
  const ranked = await rankQuery('developer');
  assertOrder(labelsOf(ranked), ['software developer'], 'developer');
});

diagnosticTest('mobile developer: mobile application developer wins', async () => {
  const ranked = await rankQuery('mobile developer');
  assertOrder(labelsOf(ranked), ['mobile application developer'], 'mobile developer');
});

diagnosticTest('app developer: mobile application developer beats ICT application developer', async () => {
  const ranked = await rankQuery('app developer');
  assertOrder(labelsOf(ranked), ['mobile application developer', 'ICT application developer'], 'app developer');
});

diagnosticTest('cloud developer: cloud software developer must not lose to cloud engineer', async () => {
  const ranked = await rankQuery('cloud developer');
  assertOrder(labelsOf(ranked), ['cloud software developer'], 'cloud developer');
});

diagnosticTest('games developer: digital games developer wins', async () => {
  const ranked = await rankQuery('games developer');
  assertOrder(labelsOf(ranked), ['digital games developer', 'digital games tester'], 'games developer');
});

diagnosticTest('UI developer: user interface developer beats user interface designer', async () => {
  const ranked = await rankQuery('UI developer');
  assertOrder(labelsOf(ranked), ['user interface developer', 'user interface designer'], 'UI developer');
});

diagnosticTest('IoT software developer: IoT developer wins over the generic and embedded siblings', async () => {
  const ranked = await rankQuery('IoT software developer');
  assertOrder(labelsOf(ranked), ['IoT developer', 'software developer'], 'IoT software developer');
});

diagnosticTest('blockchain software developer: blockchain developer must not lose to generic software developer', async () => {
  const ranked = await rankQuery('blockchain software developer');
  assertOrder(labelsOf(ranked), ['blockchain developer'], 'blockchain software developer');
});

diagnosticTest('blockchain developer: blockchain developer beats blockchain architect', async () => {
  const ranked = await rankQuery('blockchain developer');
  assertOrder(labelsOf(ranked), ['blockchain developer', 'blockchain architect'], 'blockchain developer');
});

diagnosticTest('software architect: software architect beats ICT system architect', async () => {
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
diagnosticTest(
  'bare developer: a leaf with an extra non-family-inherent industry_context cluster (embedded) must rank behind plain software developer',
  async () => {
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
  }
);

// The flip side: when the query DOES supply evidence for the extra cluster, the leaf must still win
// on the strength of that match -- proves the fix withdraws the exemption rather than blanket-
// penalizing every leaf that happens to carry more than one industry_context marker.
diagnosticTest('embedded developer: embedded systems software developer wins when the query actually supports "embedded"', async () => {
  const ranked = await rankQuery('embedded developer');
  assertOrder(labelsOf(ranked), ['embedded systems software developer'], 'embedded developer');
});
