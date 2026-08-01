import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareQuery } from '../../query/query-preparation.js';
import { buildAliasHeadTokenFallbackWindows, buildAliasPhraseWindows } from '../../retrieval/alias-phrase-windows.js';
const SOURCE = 'esco_1_2_1';
test('alias phrase windows cover the full multi-token query down to two-word windows', async () => {
    const preparedQuery = await prepareQuery('senior data analyst', 'en', { sourceName: SOURCE });
    const windows = buildAliasPhraseWindows(preparedQuery);
    assert.ok(windows.includes('data analyst'));
    assert.ok(!windows.includes('data'));
    assert.ok(!windows.includes('analyst'));
});
test('alias phrase windows gate a single-token query on minimum length', async () => {
    const shortQuery = await prepareQuery('chef', 'en', { sourceName: SOURCE });
    const longQuery = await prepareQuery('accountant', 'en', { sourceName: SOURCE });
    assert.deepEqual(buildAliasPhraseWindows(shortQuery), []);
    assert.ok(buildAliasPhraseWindows(longQuery).includes('accountant'));
});
test('head-token fallback windows restrict a multi-token query to its role head, not every useful token', async () => {
    const securityPersonnel = await prepareQuery('security personnel', 'en', { sourceName: SOURCE });
    assert.deepEqual(securityPersonnel.intent.roleHeadTokens, ['security']);
    assert.deepEqual(buildAliasHeadTokenFallbackWindows(securityPersonnel), ['security']);
});
test('head-token fallback windows skip the generic wrapper even when it alone passes the length gate', async () => {
    const mediaPersonnel = await prepareQuery('media personnel', 'en', { sourceName: SOURCE });
    assert.deepEqual(mediaPersonnel.intent.roleHeadTokens, ['media']);
    // "media" (5 chars) is below MIN_SINGLE_TOKEN_PHRASE_LENGTH, but the fallback must not substitute
    // "personnel" (9 chars) just because it happens to pass the length gate.
    assert.deepEqual(buildAliasHeadTokenFallbackWindows(mediaPersonnel), []);
});
test('head-token fallback windows are empty when the query has no classified role head', async () => {
    const preparedQuery = await prepareQuery('senior data analyst', 'en', { sourceName: SOURCE });
    const withoutHead = { ...preparedQuery, intent: { ...preparedQuery.intent, roleHeadTokens: [] } };
    assert.deepEqual(buildAliasHeadTokenFallbackWindows(withoutHead), []);
});
