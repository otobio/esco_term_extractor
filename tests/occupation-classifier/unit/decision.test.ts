import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankPromotableLeaves } from '../../../src/occupation-classifier/candidates.js';
import { selectDecision } from '../../../src/occupation-classifier/decision.js';
import type {
  CandidateEvidence,
  CandidateLedger,
  CanonicalComparisonQuery,
  FamilyAssessment,
  RankedLeaf
} from '../../../src/occupation-classifier/types.js';

const emptyEvidence = (): CandidateEvidence => ({
  exactCanonical: false,
  weakExactCanonical: false,
  exactPrimaryAlias: false,
  exactSupportingAlias: false,
  foldedAlias: false,
  subphraseAlias: false,
  englishAlias: false,
  titleToken: true,
  ngramAlias: false,
  roleHeadEquivalent: false,
  tieBreakerScore: 0
});

const emptyComparisonQuery = (): CanonicalComparisonQuery => ({
  englishTokens: [],
  modifierTokens: [],
  unresolvedTokens: [],
  canonicalExactKeys: [],
  resolvedRoleHeadTokens: [],
  localRoleHeadTokens: [],
  translationUnits: []
});

function buildRankedLeaf(overrides: {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number;
  familyLabel: string;
  score: number;
}): RankedLeaf {
  return {
    graphNodeId: overrides.graphNodeId,
    canonicalLabel: overrides.canonicalLabel,
    familyNodeId: overrides.familyNodeId,
    familyLabel: overrides.familyLabel,
    evidence: emptyEvidence(),
    status: 'promotable',
    authorityGate: { decision: 'accept', reason: null },
    structuralGate: {
      rawDecision: 'pass_partial',
      decision: 'accept',
      reason: null,
      matchedDimensions: [],
      contradictedDimensions: [],
      queriedDimensionCount: 0,
      matchedDimensionCount: 0,
      unknownDimensionCount: 0,
      judgments: []
    },
    canonical: {
      exactCanonical: false,
      weakExactCanonical: false,
      roleResemblanceTier: 'exact',
      requestedCoverage: 0.5,
      wildDimensionCount: 0,
      tokenCoverage: 0.5,
      hasSharedModifierToken: true,
      // interestingResemblanceOrder 1-5 is what isLeafGrounded in decision.ts requires to treat a
      // leaf as grounded rather than falling through past it entirely.
      interestingResemblanceOrder: 1,
      allowGateAccess: true,
      score: overrides.score
    },
    selectionAuthority: 'canonical',
    rejectReason: null,
    nearMissReason: null
  };
}

function buildFamilyAssessment(overrides: {
  familyNodeId: number;
  familyLabel: string;
  confidence: number;
  structureDecision?: FamilyAssessment['structureDecision'];
  roleGrounded?: boolean;
}): FamilyAssessment {
  return {
    familyNodeId: overrides.familyNodeId,
    familyLabel: overrides.familyLabel,
    exactCanonical: false,
    roleGrounded: overrides.roleGrounded ?? true,
    structureDecision: overrides.structureDecision ?? 'accept',
    supportKind: 'has_promotable_leaf',
    confidence: overrides.confidence,
    rejectReason: null
  };
}

test('selectDecision recovers the shared family when only leaves within the selection margin of the top score agree on it', () => {
  // Mirrors "Reprezentant Vanzari Utilaje Forestiere": the top 4 leaves (scores 0.67/0.65/0.65/0.59)
  // are all within LEAF_SELECTION_MARGIN (0.1) of each other and share one family, but further-down
  // leaves (0.54, 0.42) belong to other, unrelated families. The family recovery must only look at
  // the leaves actually contesting the top spot, not at every leaf that ever cleared the promotable bar.
  const family = buildFamilyAssessment({
    familyNodeId: 100,
    familyLabel: 'Sales, marketing and public relations professionals',
    confidence: 0.6675
  });
  const otherFamilyA = buildFamilyAssessment({
    familyNodeId: 200,
    familyLabel: 'Sales and purchasing agents and brokers',
    confidence: 0.5425
  });
  const otherFamilyB = buildFamilyAssessment({ familyNodeId: 300, familyLabel: 'Business services agents', confidence: 0.4225 });

  const rankedLeaves: RankedLeaf[] = [
    buildRankedLeaf({
      graphNodeId: 1,
      canonicalLabel: 'technical sales representative in machinery and industrial equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.67
    }),
    buildRankedLeaf({
      graphNodeId: 2,
      canonicalLabel: 'technical sales representative in agricultural machinery and equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.65
    }),
    buildRankedLeaf({
      graphNodeId: 3,
      canonicalLabel: 'technical sales representative in office machinery and equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.65
    }),
    buildRankedLeaf({
      graphNodeId: 4,
      canonicalLabel: 'technical sales representative in electronic and telecommunications equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.59
    }),
    buildRankedLeaf({
      graphNodeId: 5,
      canonicalLabel: 'commercial sales representative',
      familyNodeId: 200,
      familyLabel: otherFamilyA.familyLabel,
      score: 0.54
    }),
    buildRankedLeaf({
      graphNodeId: 6,
      canonicalLabel: 'advertising sales agent',
      familyNodeId: 300,
      familyLabel: otherFamilyB.familyLabel,
      score: 0.42
    })
  ];

  const outcome = selectDecision(rankedLeaves, [family, otherFamilyA, otherFamilyB], new Map() as CandidateLedger, emptyComparisonQuery());

  assert.deepEqual(outcome.decision, { type: 'family', reason: 'family_leaf_ambiguity', confidence: family.confidence });
  assert.equal(outcome.selectedFamily?.familyNodeId, 100);
  assert.equal(outcome.selectedLeaf, null);
});

test('selectDecision falls back to the best-supported family when the contending leaves within the margin disagree on family', () => {
  const familyA = buildFamilyAssessment({ familyNodeId: 100, familyLabel: 'Family A', confidence: 0.7 });
  const familyB = buildFamilyAssessment({ familyNodeId: 200, familyLabel: 'Family B', confidence: 0.65 });

  const rankedLeaves: RankedLeaf[] = [
    buildRankedLeaf({ graphNodeId: 1, canonicalLabel: 'leaf a', familyNodeId: 100, familyLabel: familyA.familyLabel, score: 0.7 }),
    buildRankedLeaf({ graphNodeId: 2, canonicalLabel: 'leaf b', familyNodeId: 200, familyLabel: familyB.familyLabel, score: 0.65 })
  ];

  const outcome = selectDecision(rankedLeaves, [familyA, familyB], new Map() as CandidateLedger, emptyComparisonQuery());

  assert.deepEqual(outcome.decision, { type: 'family', reason: 'family_leaf_ambiguity', confidence: 0.7 });
  assert.deepEqual(outcome.selectedFamily, { familyNodeId: 100, familyLabel: 'Family A' });
  assert.equal(outcome.selectedLeaf, null);
});

test('selectDecision still abstains when no contending family clears the structural bar', () => {
  const familyA = buildFamilyAssessment({
    familyNodeId: 100,
    familyLabel: 'Family A',
    confidence: 0.7,
    structureDecision: 'partial',
    roleGrounded: false
  });
  const familyB = buildFamilyAssessment({
    familyNodeId: 200,
    familyLabel: 'Family B',
    confidence: 0.65,
    structureDecision: 'partial',
    roleGrounded: false
  });

  const rankedLeaves: RankedLeaf[] = [
    buildRankedLeaf({ graphNodeId: 1, canonicalLabel: 'leaf a', familyNodeId: 100, familyLabel: familyA.familyLabel, score: 0.7 }),
    buildRankedLeaf({ graphNodeId: 2, canonicalLabel: 'leaf b', familyNodeId: 200, familyLabel: familyB.familyLabel, score: 0.65 })
  ];

  const outcome = selectDecision(rankedLeaves, [familyA, familyB], new Map() as CandidateLedger, emptyComparisonQuery());

  assert.deepEqual(outcome.decision, { type: 'unresolved', reason: 'unresolved_ambiguous_leaves', confidence: 0 });
  assert.equal(outcome.selectedFamily, null);
  assert.equal(outcome.selectedLeaf, null);
});

test('rankPromotableLeaves lets role-grounded partial families compete with accepted role-only families', () => {
  const acceptedWeakFamily = buildFamilyAssessment({
    familyNodeId: 14908,
    familyLabel: 'Business services agents',
    confidence: 0.15
  });
  const partialStrongFamily = buildFamilyAssessment({
    familyNodeId: 14965,
    familyLabel: 'Client information workers',
    confidence: 0.68,
    structureDecision: 'partial',
    roleGrounded: true
  });
  const weakLeaf = buildRankedLeaf({
    graphNodeId: 18157,
    canonicalLabel: 'auctioneer',
    familyNodeId: 14908,
    familyLabel: acceptedWeakFamily.familyLabel,
    score: 0.15
  });
  const strongLeaf = buildRankedLeaf({
    graphNodeId: 15531,
    canonicalLabel: 'customer service representative',
    familyNodeId: 14965,
    familyLabel: partialStrongFamily.familyLabel,
    score: 0.68
  });
  const ledger = new Map([
    [weakLeaf.graphNodeId, weakLeaf],
    [strongLeaf.graphNodeId, strongLeaf]
  ]);

  const rankedLeaves = rankPromotableLeaves(ledger, [acceptedWeakFamily, partialStrongFamily]);

  assert.equal(rankedLeaves[0].canonicalLabel, 'customer service representative');
  assert.equal(rankedLeaves[1].canonicalLabel, 'auctioneer');
});
