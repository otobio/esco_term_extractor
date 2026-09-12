import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFamilies } from '../../../src/occupation-classifier/families.js';
import { buildQueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';
import type {
  CandidateAssessment,
  CandidateEvidence,
  CanonicalComparisonQuery,
  StructuralGate,
  TranslationUnit
} from '../../../src/occupation-classifier/types.js';

const comparisonQuery: CanonicalComparisonQuery = {
  englishTokens: [],
  modifierTokens: [],
  unresolvedTokens: [],
  canonicalExactKeys: [],
  resolvedRoleHeadTokens: [],
  localRoleHeadTokens: [],
  translationUnits: []
};

function evidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
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
    tieBreakerScore: 0,
    ...overrides
  };
}

function structuralGate(overrides: Partial<StructuralGate> = {}): StructuralGate {
  return {
    rawDecision: 'pass_partial',
    decision: 'accept',
    reason: null,
    matchedDimensions: [],
    contradictedDimensions: [],
    queriedDimensionCount: 0,
    matchedDimensionCount: 0,
    unknownDimensionCount: 0,
    judgments: [],
    ...overrides
  };
}

function candidate(overrides: Partial<CandidateAssessment>): CandidateAssessment {
  return {
    graphNodeId: 1,
    canonicalLabel: 'business consultant',
    familyNodeId: 14791,
    familyLabel: 'Administration professionals',
    evidence: evidence(),
    status: 'promotable',
    authorityGate: { decision: 'accept', reason: null },
    structuralGate: structuralGate(),
    canonical: {
      exactCanonical: false,
      weakExactCanonical: false,
      roleResemblanceTier: 'exact',
      requestedCoverage: 0.5,
      wildDimensionCount: 0,
      wildDimensionValues: [],
      tokenCoverage: 0.8,
      hasSharedModifierToken: true,
      interestingResemblanceOrder: 1,
      allowGateAccess: true,
      score: 0.69
    },
    selectionAuthority: 'canonical',
    rejectReason: null,
    nearMissReason: null,
    ...overrides
  };
}

test('validateFamilies lets a strong leaf keep an incomplete family rule eligible', () => {
  const families = validateFamilies(
    {} as never,
    new Map([
      [
        1,
        candidate({
          structuralGate: structuralGate({
            matchedDimensions: ['knowledge_domain'],
            matchedDimensionCount: 1,
            queriedDimensionCount: 2,
            unknownDimensionCount: 1
          })
        })
      ]
    ]),
    [],
    comparisonQuery,
    buildQueryStructuralProfile('business sales consultant')
  );

  const administration = families.find((family) => family.familyNodeId === 14791);

  assert.equal(administration?.structureDecision, 'accept');
  assert.equal(administration?.rejectReason, null);
});

test('validateFamilies treats same-source translated concept aliases as alternatives', () => {
  const units: TranslationUnit[] = [
    {
      localText: 'vanzari',
      alternatives: [
        { kind: 'concept', token: 'business', dimension: 'knowledge_domain', conceptId: 'business' },
        { kind: 'concept', token: 'sales', dimension: 'task', conceptId: 'sales' }
      ]
    },
    { localText: 'consultant', alternatives: [{ kind: 'role_head', token: 'consultant' }] }
  ];
  const query: CanonicalComparisonQuery = {
    englishTokens: ['business', 'sales', 'consultant'],
    modifierTokens: ['business', 'sales'],
    unresolvedTokens: [],
    canonicalExactKeys: ['business consultant', 'sales consultant'],
    resolvedRoleHeadTokens: ['consultant'],
    localRoleHeadTokens: ['consultant'],
    translationUnits: units
  };
  const families = validateFamilies(
    {} as never,
    new Map([
      [
        1,
        candidate({
          canonical: {
            exactCanonical: true,
            weakExactCanonical: false,
            roleResemblanceTier: 'exact',
            requestedCoverage: 1,
            wildDimensionCount: 0,
            wildDimensionValues: [],
            tokenCoverage: 1,
            hasSharedModifierToken: true,
            interestingResemblanceOrder: 1,
            allowGateAccess: true,
            score: 1
          }
        })
      ]
    ]),
    [],
    query,
    buildQueryStructuralProfile('business sales consultant')
  );

  const administration = families.find((family) => family.familyNodeId === 14791);

  assert.equal(administration?.structureDecision, 'accept');
  assert.equal(administration?.rejectReason, null);
});

test('validateFamilies lets a single-token exact canonical role leaf validate its family without dimension matches', () => {
  const families = validateFamilies(
    {} as never,
    new Map([
      [
        1,
        candidate({
          canonicalLabel: 'cook',
          familyNodeId: 14791,
          familyLabel: 'Administration professionals',
          evidence: evidence({ exactCanonical: true }),
          canonical: {
            exactCanonical: true,
            weakExactCanonical: false,
            roleResemblanceTier: 'exact',
            requestedCoverage: 1,
            wildDimensionCount: 0,
            wildDimensionValues: [],
            tokenCoverage: 1,
            hasSharedModifierToken: false,
            interestingResemblanceOrder: 1,
            allowGateAccess: true,
            score: 1
          }
        })
      ]
    ]),
    [],
    comparisonQuery,
    buildQueryStructuralProfile('cook')
  );

  const administration = families.find((family) => family.familyNodeId === 14791);

  assert.equal(administration?.structureDecision, 'accept');
  assert.equal(administration?.rejectReason, null);
});

test('validateFamilies keeps a rejected family rejected when the leaf has no direct or structural proof', () => {
  const families = validateFamilies(
    {} as never,
    new Map([
      [
        1,
        candidate({
          canonical: {
            exactCanonical: false,
            weakExactCanonical: false,
            roleResemblanceTier: 'exact',
            requestedCoverage: 0,
            wildDimensionCount: 0,
            wildDimensionValues: [],
            tokenCoverage: 0.5,
            hasSharedModifierToken: false,
            interestingResemblanceOrder: 1,
            allowGateAccess: true,
            score: 0.5
          }
        })
      ]
    ]),
    [],
    comparisonQuery,
    buildQueryStructuralProfile('sales consultant')
  );

  const administration = families.find((family) => family.familyNodeId === 14791);

  assert.equal(administration?.structureDecision, 'reject');
  assert.equal(administration?.rejectReason, 'family_structure_contradiction');
});

test('validateFamilies keeps a rejected family rejected when the leaf itself has a structural contradiction', () => {
  const families = validateFamilies(
    {} as never,
    new Map([
      [
        1,
        candidate({
          evidence: evidence({ exactCanonical: true }),
          structuralGate: structuralGate({
            decision: 'reject',
            reason: 'specialization_contradiction',
            contradictedDimensions: ['task'],
            queriedDimensionCount: 1
          }),
          canonical: {
            exactCanonical: true,
            weakExactCanonical: false,
            roleResemblanceTier: 'exact',
            requestedCoverage: 0,
            wildDimensionCount: 0,
            wildDimensionValues: [],
            tokenCoverage: 1,
            hasSharedModifierToken: false,
            interestingResemblanceOrder: 1,
            allowGateAccess: true,
            score: 1
          }
        })
      ]
    ]),
    [],
    comparisonQuery,
    buildQueryStructuralProfile('sales consultant')
  );

  const administration = families.find((family) => family.familyNodeId === 14791);

  assert.equal(administration?.structureDecision, 'reject');
  assert.equal(administration?.rejectReason, 'family_structure_contradiction');
});
