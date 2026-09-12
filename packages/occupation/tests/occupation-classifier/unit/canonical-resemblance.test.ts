import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCanonicalResemblance, selectUniqueExactCanonicalLeaf } from '../../../src/occupation-classifier/candidates.js';
import { buildQueryStructuralProfile, type QueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';
import { specializationGate } from '../../../src/occupation-classifier/specialization/specialization-gate.js';
import type {
  CandidateEvidence,
  CanonicalComparisonQuery,
  ClassifierRetrievalRequest,
  HydratedCandidate,
  StructuralGate,
  TranslationUnit
} from '../../../src/occupation-classifier/types.js';
import type { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';
import { foldWeakPunctuationLookupText } from '../../../src/utils/texts.js';

function candidate(canonicalLabel: string, evidence: Partial<CandidateEvidence> = {}): HydratedCandidate {
  return {
    graphNodeId: 1,
    canonicalLabel,
    canonicalWeakFolded: foldWeakPunctuationLookupText(canonicalLabel),
    familyNodeId: 100,
    familyLabel: 'Test family',
    evidence: {
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
      tieBreakerScore: 0,
      ...evidence
    }
  };
}

function comparisonQuery(
  canonicalExactKeys: readonly string[] = [],
  translationUnits: readonly TranslationUnit[] = []
): CanonicalComparisonQuery {
  return {
    englishTokens: [],
    modifierTokens: translationUnits.flatMap((unit) =>
      unit.alternatives.filter((alternative) => alternative.kind !== 'role_head').map((alternative) => alternative.token)
    ),
    unresolvedTokens: [],
    canonicalExactKeys: [...canonicalExactKeys],
    resolvedRoleHeadTokens: [],
    localRoleHeadTokens: [],
    translationUnits: [...translationUnits]
  };
}

function retrievalRequest(canonicalExactKeys: readonly string[]): ClassifierRetrievalRequest {
  return {
    sourceName: 'esco_1_2_1',
    locale: 'en',
    localFullAliasKey: '',
    localAliasTokens: [],
    englishCanonicalExactKeys: [...canonicalExactKeys],
    englishWeakFoldedTokens: [],
    englishFullAliasKey: '',
    englishModifierTokens: [],
    englishRoleHeadTokens: [],
    localRoleHeadTokens: [],
    roleHeadEquivalentTerms: [],
    fuzzyAliasRecallEnabled: false
  };
}

function runtimeWithLeaf(canonicalLabel: string): OccupationRuntimeContext {
  return {
    searchMetaArtifact: {
      getCoreRecord: () => ({
        graphNodeId: 1,
        canonicalLabel,
        weakFoldedCanonicalLabel: foldWeakPunctuationLookupText(canonicalLabel),
        familyNodeId: 100,
        familyLabel: 'Test family'
      })
    }
  } as unknown as OccupationRuntimeContext;
}

function structuralGateFor(queryProfile: QueryStructuralProfile, canonicalProfile: QueryStructuralProfile): StructuralGate {
  const gate = specializationGate(queryProfile.profile, canonicalProfile.profile, { locale: 'en' });

  return {
    rawDecision: gate.decision,
    decision: gate.decision === 'reject' ? 'reject' : 'accept',
    reason: gate.decision === 'reject' ? 'specialization_contradiction' : null,
    matchedDimensions: gate.compatibleDimensions,
    contradictedDimensions: gate.contradictionDimensions,
    queriedDimensionCount: gate.queriedDimensions.length,
    matchedDimensionCount: gate.compatibleDimensions.length,
    unknownDimensionCount: gate.unknownDimensions.length,
    judgments: gate.judgments
  };
}

function resemblance(query: string, canonicalLabel: string, evidence: Partial<CandidateEvidence> = {}) {
  const queryProfile = buildQueryStructuralProfile(query, 'en');
  const canonicalProfile = buildQueryStructuralProfile(canonicalLabel, 'en');

  return computeCanonicalResemblance(
    candidate(canonicalLabel, evidence),
    comparisonQuery(),
    queryProfile,
    canonicalProfile,
    structuralGateFor(queryProfile, canonicalProfile)
  );
}

test('computeCanonicalResemblance treats multiple strong query role heads as alternatives', () => {
  const receptionist = resemblance('representative technical receptionist', 'receptionist');
  const representative = resemblance('representative technical receptionist', 'technical sales representative');

  assert.equal(receptionist.roleResemblanceTier, 'exact');
  assert.equal(representative.roleResemblanceTier, 'exact');
});

test('computeCanonicalResemblance does not require unmatched alternative role heads for exactness', () => {
  const result = resemblance('representative technical receptionist', 'technical sales representative');

  assert.equal(result.roleResemblanceTier, 'exact');
  assert.equal(result.hasSharedModifierToken, true);
  assert.equal(result.interestingResemblanceOrder, 2);
});

test('computeCanonicalResemblance requires concept-backed modifier literals for full exactness', () => {
  const result = resemblance('representative technical receptionist', 'receptionist');

  assert.equal(result.roleResemblanceTier, 'exact');
  assert.equal(result.hasSharedModifierToken, false);
  assert.equal(result.interestingResemblanceOrder, 0);
});

test('computeCanonicalResemblance ignores query tokens that did not resolve to a concept dimension', () => {
  const result = resemblance('receptionist randomword', 'receptionist');

  assert.equal(result.roleResemblanceTier, 'exact');
  assert.equal(result.hasSharedModifierToken, false);
  assert.equal(result.interestingResemblanceOrder, 2);
});

test('computeCanonicalResemblance keeps generic role-head matches out of exact tiers', () => {
  const result = resemblance('worker', 'construction worker');

  assert.equal(result.roleResemblanceTier, 'generic');
  assert.equal(result.interestingResemblanceOrder, 0);
});

test('computeCanonicalResemblance scores same-strict-group role heads as exact', () => {
  const result = resemblance('actress', 'actor');

  assert.equal(result.roleResemblanceTier, 'exact');
});

test('computeCanonicalResemblance scores same-broad-group-but-not-strict role heads as similar', () => {
  const result = resemblance('archivist', 'librarian');

  assert.equal(result.roleResemblanceTier, 'similar');
});

test('computeCanonicalResemblance scores unrelated role heads as different', () => {
  const result = resemblance('electrician', 'plumber');

  assert.equal(result.roleResemblanceTier, 'different');
});

test('computeCanonicalResemblance keeps a vague-token role head out of exact even when strictly equivalent', () => {
  const result = resemblance('labourer', 'operative');

  assert.equal(result.roleResemblanceTier, 'generic');
});

test('computeCanonicalResemblance marks exact canonical evidence as first-order authority', () => {
  const queryProfile = buildQueryStructuralProfile('solar system panel', 'en');
  const canonicalProfile = buildQueryStructuralProfile('electrician', 'en');
  const exactCanonicalCandidate = candidate('electrician', { exactCanonical: true });
  const result = computeCanonicalResemblance(
    exactCanonicalCandidate,
    comparisonQuery(['electrician']),
    queryProfile,
    canonicalProfile,
    structuralGateFor(queryProfile, canonicalProfile)
  );

  assert.equal(result.exactCanonical, true);
  assert.equal(result.interestingResemblanceOrder, 1);
  assert.equal(result.allowGateAccess, true);
});

test('computeCanonicalResemblance treats same-source translated concept aliases as alternatives', () => {
  const queryProfile = buildQueryStructuralProfile('business sales consultant', 'en');
  const canonicalProfile = buildQueryStructuralProfile('business consultant', 'en');
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

  const result = computeCanonicalResemblance(
    candidate('business consultant'),
    comparisonQuery(['business consultant'], units),
    queryProfile,
    canonicalProfile,
    structuralGateFor(queryProfile, canonicalProfile)
  );

  assert.equal(result.hasSharedModifierToken, true);
  assert.equal(result.requestedCoverage, 1);
  assert.equal(result.tokenCoverage, 1);
  assert.equal(result.interestingResemblanceOrder, 1);
});

test('selectUniqueExactCanonicalLeaf does not shortcut when exact key misses concept-backed query tokens', () => {
  const result = selectUniqueExactCanonicalLeaf(
    [{ graphNodeId: 1, weakFoldedCanonicalLabel: 'electrician' }],
    runtimeWithLeaf('electrician'),
    retrievalRequest(['electrician']),
    buildQueryStructuralProfile('solar system panel', 'en')
  );

  assert.equal(result, null);
});

test('selectUniqueExactCanonicalLeaf shortcuts when exact key covers a strong role head and concept-backed tokens', () => {
  const result = selectUniqueExactCanonicalLeaf(
    [{ graphNodeId: 1, weakFoldedCanonicalLabel: 'technical receptionist' }],
    runtimeWithLeaf('technical receptionist'),
    retrievalRequest(['technical receptionist']),
    buildQueryStructuralProfile('technical receptionist', 'en')
  );

  assert.equal(result?.selectedLeaf.canonicalLabel, 'technical receptionist');
  assert.equal(result?.decision.reason, 'exact_canonical_leaf');
});

test('selectUniqueExactCanonicalLeaf treats translated concept alternatives as one required source unit', () => {
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
  const result = selectUniqueExactCanonicalLeaf(
    [{ graphNodeId: 1, weakFoldedCanonicalLabel: 'business consultant' }],
    runtimeWithLeaf('business consultant'),
    retrievalRequest(['business consultant']),
    buildQueryStructuralProfile('business sales consultant', 'en'),
    comparisonQuery(['business consultant'], units)
  );

  assert.equal(result?.selectedLeaf.canonicalLabel, 'business consultant');
  assert.equal(result?.decision.reason, 'exact_canonical_leaf');
});
