import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';

const ranker = new TokenLeafClosenessRanker();

test('a same-leaf alias with real token overlap outranks an exact but zero-overlap translated-label collision', () => {
  // Regression for: Estonian "poe juht" (role-translated to "store manager") previously picked the
  // "store manager" alias purely because it exactly matched that translation, even though it shares
  // no tokens with the query at all -- losing to "kaupluse juht", which actually matches "juht".
  const rank = ranker.rank({
    query: {
      locale: 'et',
      normalized: 'store manager',
      folded: 'poe juht',
      foldedTokens: ['poe', 'juht'],
      usefulFoldedRecallTokens: ['poe', 'juht']
    },
    canonicalLabel: 'shop manager',
    aliases: ['store manager', 'kaupluse juht']
  });

  assert.equal(rank.matchedLabel, 'kaupluse juht');
  assert.deepEqual(rank.matchedUsefulTokens, ['juht']);
});

test("an exact translated-label match still wins when it is the leaf's only candidate", () => {
  // Regression guard for: Hungarian "projekt menedzser" (role-translated to "project manager") must
  // still resolve to the canonical label exactly, since no other alias competes for this leaf.
  const rank = ranker.rank({
    query: {
      locale: 'hu',
      normalized: 'project manager',
      folded: 'projekt menedzser',
      foldedTokens: ['projekt', 'menedzser'],
      usefulFoldedRecallTokens: ['projekt', 'menedzser']
    },
    canonicalLabel: 'project manager',
    aliases: []
  });

  assert.equal(rank.matchedLabel, 'project manager');
  assert.equal(rank.matchedLabelSource, 'canonical');
  assert.equal(rank.exactNormalizedLabel, true);
  assert.equal(rank.usefulQueryCoverage, 1);
});
