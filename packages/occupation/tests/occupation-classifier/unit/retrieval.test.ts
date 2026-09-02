import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRetrievalRequest } from '../../../src/occupation-classifier/retrieval.js';
import type { CanonicalComparisonQuery, ClassifierSurface } from '../../../src/occupation-classifier/types.js';
import type { QueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';

function comparisonQuery(overrides: Partial<CanonicalComparisonQuery> = {}): CanonicalComparisonQuery {
  return {
    englishTokens: ['reception'],
    modifierTokens: [],
    unresolvedTokens: [],
    canonicalExactKeys: [],
    resolvedRoleHeadTokens: [],
    localRoleHeadTokens: [],
    translationUnits: [],
    ...overrides
  };
}

function structuralProfile(roleHead: string[]): QueryStructuralProfile {
  return {
    authority: 'unknown',
    profile: {
      venue: [],
      channel: [],
      product: [],
      population: [],
      task: [],
      industry: [],
      knowledge_domain: [],
      work_object: [],
      role_head: roleHead,
      available: { venue: [], channel: [], product: [], population: [], task: [], industry: [], knowledge_domain: [], work_object: [] },
      concept: { venue: [], channel: [], product: [], population: [], task: [], industry: [], knowledge_domain: [], work_object: [] },
      literal: { venue: [], channel: [], product: [], population: [], task: [], industry: [], knowledge_domain: [], work_object: [] },
      structural_combination: [],
      tokens: [],
      unresolved: []
    }
  } as unknown as QueryStructuralProfile;
}

const surface: ClassifierSurface = {
  spanText: 'Receptie',
  weakFolded: 'receptie',
  weakFoldedTokens: ['receptie']
};

test('buildRetrievalRequest adds structurally-derived role heads on top of translation-derived ones', () => {
  // No resolvedRoleHeadTokens from translation (comparisonQuery falls back to englishTokens),
  // but the structural combination layer derived "receptionist" for this query.
  const request = buildRetrievalRequest('esco_1_2_1', 'ro', surface, comparisonQuery(), structuralProfile(['receptionist']));

  assert.ok(request.englishRoleHeadTokens.includes('reception'), 'keeps the translation-derived fallback token');
  assert.ok(request.englishRoleHeadTokens.includes('receptionist'), 'adds the structurally-derived role head');
  assert.ok(
    request.englishCanonicalExactKeys.includes('receptionist'),
    'derived role head becomes an exact-canonical lookup key so the plain "receptionist" leaf is retrievable'
  );
});

test('buildRetrievalRequest keeps resolved role heads when present and still adds structural ones', () => {
  const request = buildRetrievalRequest(
    'esco_1_2_1',
    'ro',
    surface,
    comparisonQuery({ resolvedRoleHeadTokens: ['adviser'] }),
    structuralProfile(['receptionist'])
  );

  assert.ok(request.englishRoleHeadTokens.includes('adviser'), 'keeps the resolved role head from translation');
  assert.ok(request.englishRoleHeadTokens.includes('receptionist'), 'still adds the structurally-derived role head');
});

test('buildRetrievalRequest does not duplicate a role head present in both sources', () => {
  const request = buildRetrievalRequest(
    'esco_1_2_1',
    'ro',
    surface,
    comparisonQuery({ resolvedRoleHeadTokens: ['receptionist'] }),
    structuralProfile(['receptionist'])
  );

  assert.equal(request.englishRoleHeadTokens.filter((token) => token === 'receptionist').length, 1);
});
