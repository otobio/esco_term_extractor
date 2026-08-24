import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityFitRanker } from '../../src/search-pipeline/ranking/capability-fit-ranker.js';
const ranker = new CapabilityFitRanker();
test('capability fit uses verb-shaped query variants for cleaner-style titles', () => {
    const fit = ranker.rank({
        familyScopedFoldedTokens: ['cleaner'],
        capabilityVerbFoldedAdditionTokens: ['cleaning'],
        capabilityLabels: ['cleaning']
    });
    assert.equal(fit.tier, 'strong');
    assert.equal(fit.coverage, 1);
    assert.deepEqual(fit.matchedCapabilityTerms, ['cleaning']);
    assert.deepEqual(fit.missingCapabilityTerms, []);
});
