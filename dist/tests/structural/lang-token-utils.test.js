import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBroadToken } from '../../src/utils/lang.js';
test('isBroadToken uses OOV anchor-count scale to identify broad retrieval tokens', () => {
    assert.equal(isBroadToken({ token: 'operator', locale: 'ro', anchorCount: 53229 }), true);
    assert.equal(isBroadToken({ token: 'mediu', locale: 'ro', anchorCount: 93 }), false);
    assert.equal(isBroadToken({ token: 'dezinfectie', locale: 'ro', anchorCount: 0 }), false);
});
test('isBroadToken treats locale function words as broad without anchor counts', () => {
    assert.equal(isBroadToken({ token: 'de', locale: 'ro' }), true);
    assert.equal(isBroadToken({ token: 'and', locale: 'en' }), true);
    assert.equal(isBroadToken({ token: 'dezinfectie', locale: 'ro' }), false);
});
