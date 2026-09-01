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
// authority gate + specialization/structural gate) directly against the real "Shop salespersons"
// family (loaded from the real esco_1_2_1 runtime artifacts), bypassing retrieval/recall, so we can
// assert exact sibling-leaf ranking order for authority/specialization behavior.
//
// Ported from tests/slow/rank-family-leaves-shop-salespersons.test.ts (old pipeline). This file is a
// diagnostic backlog for leaf ordering, not part of the production family-filter gate yet.
const diagnosticTest = test.skip;

const SOURCE = 'esco_1_2_1';
const LOCALE: SupportedQueryLocale = 'ro';
const FAMILY = 'Shop salespersons';

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

// The real pipeline only ever ranks 'promotable' candidates (rankPromotableLeaves) -- 'hard_rejected'
// and 'near_miss' candidates never reach ranking at all, no matter what raw score they end up with.
// rankQuery returns every candidate (promotable, near_miss, hard_rejected alike) so a test can inspect
// any of them, but the ranking assertion itself must mirror that same promotable-only filter or it'll
// assert an order the real pipeline could never produce.
function promotableOnly(ranked: CandidateAssessment[]): CandidateAssessment[] {
  return ranked.filter((candidate) => candidate.status === 'promotable');
}

function rejectedLabelsOf(ranked: CandidateAssessment[]): string[] {
  return ranked.filter((candidate) => candidate.status === 'hard_rejected').map((candidate) => candidate.canonicalLabel);
}

function assertOrder(ranked: CandidateAssessment[], expectedOrderPrefix: string[], query: string): void {
  const actualLabels = labelsOf(promotableOnly(ranked));
  const actualPrefix = actualLabels.slice(0, expectedOrderPrefix.length);
  assert.deepEqual(
    actualPrefix,
    expectedOrderPrefix,
    `query="${query}" expected top ${expectedOrderPrefix.length} promotable = ${JSON.stringify(expectedOrderPrefix)}, got ${JSON.stringify(actualPrefix)} (full promotable: ${JSON.stringify(actualLabels.slice(0, 8))})`
  );
}

// Confirms a candidate was actually excluded by the filter funnel (hard_rejected), not merely
// out-ranked -- a query can score a leaf low without ever rejecting it, and that's a materially
// different guarantee than the real pipeline never showing it as an option at all.
function assertExcluded(ranked: CandidateAssessment[], expectedExcludedLabels: string[], query: string): void {
  const rejected = new Set(rejectedLabelsOf(ranked));

  for (const label of expectedExcludedLabels) {
    const candidate = ranked.find((entry) => entry.canonicalLabel === label);
    assert.ok(
      rejected.has(label),
      `query="${query}" expected "${label}" to be hard_rejected, got status=${candidate?.status ?? 'not found'}`
    );
  }
}

test('shop assistant: authority mismatch must not let shop supervisor outrank shop assistant', async () => {
  // "shop floor assistant" (not "shop assistant needed") deliberately avoids an exact canonical
  // match against the "shop assistant" leaf -- an exact match would trivially win top rank and the
  // test would no longer exercise the authority-mismatch ranking behavior it's named for.
  const ranked = await rankQuery('shop floor assistant');
  assertOrder(ranked, ['shop assistant'], 'shop floor assistant');
  assertExcluded(ranked, ['shop supervisor'], 'shop floor assistant');
});

test('shop supervisor: supervisor query ranks the supervisor leaf first', async () => {
  const ranked = await rankQuery('shop floor supervisor');
  assertOrder(ranked, ['shop supervisor'], 'shop floor supervisor');
  assertExcluded(ranked, ['shop assistant'], 'shop floor assistant');
});

diagnosticTest('bakery seller: domain-specialized leaf beats generic seller', async () => {
  const ranked = await rankQuery('bakery seller');
  assertOrder(ranked, ['bakery specialised seller', 'specialised seller'], 'bakery seller');
});

diagnosticTest('vehicle dealer: motor vehicles parts advisor beats motor vehicles specialised seller', async () => {
  const ranked = await rankQuery('vehicle dealer');
  for (const rank of ranked) {
    console.log(rank.canonicalLabel, ' -> ', rank.status, rank.structuralGate.reason);
  }
  assertOrder(ranked, ['motor vehicles parts advisor', 'motor vehicles specialised seller'], 'vehicle dealer');
});

diagnosticTest(
  'video recording equipment on sales: audio and video equipment specialised seller beats music and video shop specialised seller',
  async () => {
    const ranked = await rankQuery('video recording equipment sales');
    assertOrder(
      ranked,
      ['audio and video equipment specialised seller', 'music and video shop specialised seller'],
      'video recording equipment sales'
    );
  }
);

diagnosticTest('bakery specialised seller: exact domain match beats generic seller', async () => {
  const ranked = await rankQuery('specialised bakery products seller');
  assertOrder(ranked, ['bakery specialised seller', 'specialised seller'], 'specialised bakery products seller');
});

diagnosticTest('motor vehicles parts seller: parts advisor beats generic vehicle seller beats generic seller', async () => {
  const ranked = await rankQuery('motor vehicles parts seller');
  assertOrder(
    ranked,
    ['motor vehicles parts advisor', 'motor vehicles specialised seller', 'specialised seller'],
    'motor vehicles parts seller'
  );
});

diagnosticTest('motor vehicles seller: generic vehicle seller beats parts advisor beats generic seller', async () => {
  const ranked = await rankQuery('motor vehicles seller');
  assertOrder(ranked, ['motor vehicles specialised seller', 'motor vehicles parts advisor', 'specialised seller'], 'motor vehicles seller');
});

diagnosticTest('audio equipment seller: audio/video seller beats generic seller beats music/video shop seller', async () => {
  const ranked = await rankQuery('audio equipment seller');
  assertOrder(
    ranked,
    ['audio and video equipment specialised seller', 'specialised seller', 'music and video shop specialised seller'],
    'audio equipment seller'
  );
});

diagnosticTest('video equipment seller: audio/video seller beats music/video shop seller beats generic seller', async () => {
  const ranked = await rankQuery('video equipment seller');
  assertOrder(
    ranked,
    ['audio and video equipment specialised seller', 'music and video shop specialised seller', 'specialised seller'],
    'video equipment seller'
  );
});

diagnosticTest('jewellery seller: jewellery and watches specialised seller wins', async () => {
  const ranked = await rankQuery('jewellery seller');
  assertOrder(ranked, ['jewellery and watches specialised seller'], 'jewellery seller');
});

diagnosticTest('furniture seller: furniture specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('furniture seller');
  assertOrder(ranked, ['furniture specialised seller', 'specialised seller'], 'furniture seller');
});

diagnosticTest('clothing seller: clothing specialised seller beats textile specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('clothing seller');
  assertOrder(ranked, ['clothing specialised seller', 'textile specialised seller', 'specialised seller'], 'clothing seller');
});

diagnosticTest('bakery seller: bakery specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('bakery seller');
  assertOrder(ranked, ['bakery specialised seller', 'specialised seller'], 'bakery seller');
});

diagnosticTest('medical goods seller: medical goods specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('medical goods seller');
  assertOrder(ranked, ['medical goods specialised seller', 'specialised seller'], 'medical goods seller');
});

diagnosticTest('sporting goods seller: sporting accessories specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('sporting goods seller');
  assertOrder(ranked, ['sporting accessories specialised seller', 'specialised seller'], 'sporting goods seller');
});

diagnosticTest('tobacco seller: tobacco specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('tobacco seller');
  assertOrder(ranked, ['tobacco specialised seller', 'specialised seller'], 'tobacco seller');
});

diagnosticTest('cosmetics seller: cosmetics and perfume specialised seller beats generic seller', async () => {
  const ranked = await rankQuery('cosmetics seller');
  assertOrder(ranked, ['cosmetics and perfume specialised seller', 'specialised seller'], 'cosmetics seller');
});

diagnosticTest('personal shop assistant: personal shopper beats shop assistant', async () => {
  const ranked = await rankQuery('personal shop assistant');
  assertOrder(ranked, ['personal shopper', 'shop assistant'], 'personal shop assistant');
});

diagnosticTest('checkout supervisor: checkout supervisor beats shop supervisor', async () => {
  const ranked = await rankQuery('checkout desk supervisor');
  assertOrder(ranked, ['checkout supervisor', 'shop supervisor'], 'checkout desk supervisor');
});
