import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCoreResult, toRuntimeResult } from '../../../src/occupation-classifier/result.js';
import type {
  CandidateEvidence,
  FamilyAssessment,
  RankedLeaf,
  SelectedFamily,
  SelectedLeaf
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

function buildRankedLeaf(overrides: {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number;
  familyLabel: string;
  score: number;
  interestingResemblanceOrder: number;
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
      wildDimensionValues: [],
      tokenCoverage: 0.5,
      hasSharedModifierToken: true,
      interestingResemblanceOrder: overrides.interestingResemblanceOrder,
      allowGateAccess: true,
      score: overrides.score
    },
    selectionAuthority: 'canonical',
    rejectReason: null,
    nearMissReason: null
  };
}

test('toRuntimeResult omits core/debug-only candidate structures', () => {
  const runtime = toRuntimeResult(
    buildCoreResult({
      candidateLedger: new Map(),
      rankedLeaves: [],
      familyAssessments: [],
      decision: {
        type: 'unresolved',
        reason: 'unresolved_no_candidates',
        confidence: 0
      }
    })
  );

  assert.deepEqual(Object.keys(runtime), ['decision', 'leaf', 'family', 'coverage', 'cleaned', 'query', 'altLeafCanonicalTerms', 'spans']);
  assert.equal('candidateLedger' in runtime, false);
  assert.equal('familyAssessments' in runtime, false);
});

test('toRuntimeResult surfaces other grounded promotable leaves under the selected family as altLeafCanonicalTerms', () => {
  const family: SelectedFamily = { familyNodeId: 100, familyLabel: 'Sales, marketing and public relations professionals' };
  const selectedLeaf: SelectedLeaf = {
    graphNodeId: 1,
    canonicalLabel: 'technical sales representative in machinery and industrial equipment',
    familyNodeId: 100,
    familyLabel: family.familyLabel
  };

  const rankedLeaves: RankedLeaf[] = [
    buildRankedLeaf({
      graphNodeId: 1,
      canonicalLabel: selectedLeaf.canonicalLabel,
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.67,
      interestingResemblanceOrder: 1
    }),
    buildRankedLeaf({
      graphNodeId: 2,
      canonicalLabel: 'technical sales representative in agricultural machinery and equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.65,
      interestingResemblanceOrder: 1
    }),
    // Not grounded (interestingResemblanceOrder 6 == 'structurallyRelated', the weakest tier) -- must
    // be excluded even though it's still status: 'promotable' and in the selected family.
    buildRankedLeaf({
      graphNodeId: 3,
      canonicalLabel: 'solar energy sales consultant',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      score: 0.2,
      interestingResemblanceOrder: 6
    }),
    // Different family entirely -- must be excluded.
    buildRankedLeaf({
      graphNodeId: 4,
      canonicalLabel: 'commercial sales representative',
      familyNodeId: 200,
      familyLabel: 'Sales and purchasing agents and brokers',
      score: 0.54,
      interestingResemblanceOrder: 1
    })
  ];

  const familyAssessment: FamilyAssessment = {
    familyNodeId: 100,
    familyLabel: family.familyLabel,
    exactCanonical: false,
    roleGrounded: true,
    structureDecision: 'accept',
    supportKind: 'has_promotable_leaf',
    confidence: 0.67,
    rejectReason: null
  };

  const runtime = toRuntimeResult(
    buildCoreResult({
      candidateLedger: new Map(),
      rankedLeaves,
      familyAssessments: [familyAssessment],
      decision: { type: 'leaf', reason: 'promotable_leaf', confidence: 0.67 },
      selectedLeaf,
      selectedFamily: null
    })
  );

  assert.deepEqual(runtime.altLeafCanonicalTerms, [
    {
      graphNodeId: 2,
      canonicalTerm: 'technical sales representative in agricultural machinery and equipment',
      familyNodeId: 100,
      familyLabel: family.familyLabel,
      confidence: 0.65
    }
  ]);
});

test('toRuntimeResult leaves altLeafCanonicalTerms empty when no family was selected', () => {
  const runtime = toRuntimeResult(
    buildCoreResult({
      candidateLedger: new Map(),
      rankedLeaves: [],
      familyAssessments: [],
      decision: { type: 'unresolved', reason: 'unresolved_no_candidates', confidence: 0 }
    })
  );

  assert.deepEqual(runtime.altLeafCanonicalTerms, []);
});
