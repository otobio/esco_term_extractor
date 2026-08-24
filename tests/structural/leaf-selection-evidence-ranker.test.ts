import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LeafSelectionEvidenceRanker } from '../../src/search-pipeline/ranking/leaf-selection-evidence-ranker.js';

const ranker = new LeafSelectionEvidenceRanker();

test('leaf useful-exact sits below raw exact alias and above phrase evidence', () => {
  const usefulExact = ranker.rank({
    evidence: [],
    closeness: {
      matchedLabelSource: 'canonical',
      exactNormalizedLabel: false,
      exactFoldedLabel: false
    },
    usefulExactLabel: true,
    familyScopedFit: null,
    capabilityFit: null
  });

  const exactAlias = ranker.rank({
    evidence: [{ channel: 'exact_alias', details: {} }],
    closeness: null,
    usefulExactLabel: false,
    familyScopedFit: null,
    capabilityFit: null
  });

  const strongPhrase = ranker.rank({
    evidence: [{ channel: 'lexical', details: { matched_queries: ['authority_010_prepared_health_phrase_window_len_2_idx_0'] } }],
    closeness: null,
    usefulExactLabel: false,
    familyScopedFit: null,
    capabilityFit: null
  });

  assert.equal(usefulExact.tier, 'useful_exact');
  assert.ok(exactAlias.tierRank < usefulExact.tierRank);
  assert.ok(usefulExact.tierRank < strongPhrase.tierRank);
});

test('leaf useful-exact rejects non-generic extra label terms', () => {
  const result = ranker.rank({
    evidence: [],
    closeness: {
      matchedLabelSource: 'canonical',
      exactNormalizedLabel: false,
      exactFoldedLabel: false
    },
    usefulExactLabel: false,
    familyScopedFit: null,
    capabilityFit: null
  });

  assert.equal(result.tier, 'weak');
});
