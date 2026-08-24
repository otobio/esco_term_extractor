import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreLeaf } from '../../src/cli/rank-family-leaves-core.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import type { OccupationLeafStructureRecord } from '../../src/runtime/occupation-leaf-structure-contract.js';
import { preparedQuerySupportsSpecializationKind } from '../../src/runtime/occupation-leaf-structure-rules.js';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../../src/utils/texts.js';

const SOURCE = 'esco_1_2_1';
const CLOSENESS_RANKER = new TokenLeafClosenessRanker();

// Regression for a false unsupportedSpecialization penalty: "medical" in "registrator medical" (ro)
// is deliberately classified as a role token, not a domain token, by the post-head ambiguous-modifier
// rule in query-intent.ts (Romanian adjective-follows-noun order, e.g. "asistent medical"). Support for
// the industry_context specialization kind must not require domainTokens specifically -- the marker
// word being present anywhere in the query's structural tokens is enough evidence, regardless of which
// bucket the intent classifier put it in.
test('industry_context specialization support does not require the marker word to land in domainTokens', async () => {
  const prepared = await prepareQuery('registrator medical', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.intent.domainTokens.length, 0);
  assert.ok(prepared.intent.roleTokens.includes('medical'));
  assert.ok(preparedQuerySupportsSpecializationKind(prepared, 'industry_context'));
});

test('leaf specialization reward requires the same atomic value on leaf and query', async () => {
  const prepared = await prepareQuery('community manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'customer experience manager';
  const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
  const closeness = CLOSENESS_RANKER.rank({
    query: {
      locale: prepared.locale,
      normalized: prepared.normalized,
      folded: prepared.folded,
      foldedTokens: prepared.foldedTokens,
      usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
    },
    canonicalLabel,
    aliases: []
  });

  const breakdown = scoreLeaf(
    closeness,
    [],
    populationSpecializedLeaf(canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'community manager',
    17213,
    new Map()
  );

  assert.deepEqual(closeness.matchedUsefulTokens, ['manager']);
  assert.deepEqual(closeness.missingUsefulTokens, ['community']);
  assert.equal(breakdown.specializationMatch, 0);
  assert.equal(breakdown.unsupportedSpecialization, -5);
});

test('leaf specialization reward is granted when leaf and query share the atomic value', async () => {
  const prepared = await prepareQuery('customer manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'customer experience manager';
  const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(canonicalLabel)));
  const closeness = CLOSENESS_RANKER.rank({
    query: {
      locale: prepared.locale,
      normalized: prepared.normalized,
      folded: prepared.folded,
      foldedTokens: prepared.foldedTokens,
      usefulFoldedRecallTokens: prepared.usefulFoldedRecallTokens
    },
    canonicalLabel,
    aliases: []
  });

  const breakdown = scoreLeaf(
    closeness,
    [],
    populationSpecializedLeaf(canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'customer manager',
    17213,
    new Map()
  );

  assert.deepEqual(closeness.missingUsefulTokens, []);
  assert.equal(breakdown.specializationMatch, 8);
  assert.equal(breakdown.unsupportedSpecialization, 0);
});

function populationSpecializedLeaf(canonicalLabel: string): OccupationLeafStructureRecord {
  return {
    graphNodeId: 17213,
    canonicalLabel,
    familyNodeId: 14796,
    groupNodeId: null,
    parentNodeId: null,
    baseRoleKind: 'specialized_base_role',
    authorityKind: 'manager',
    specializationKinds: ['population'],
    headPreservingSpecialization: true,
    broadAliasRisk: 'low',
    capabilityDominanceRisk: 'low'
  };
}
