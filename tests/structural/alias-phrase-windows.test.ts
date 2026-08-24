import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { buildAliasHeadTokenFallbackWindows, buildAliasPhraseWindows } from '../../src/retrieval/authority-query-preparation.js';

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

  assert.deepEqual(buildAliasHeadTokenFallbackWindows(securityPersonnel), ['security']);
});

test('head-token fallback windows skip the generic wrapper even when it alone passes the length gate', async () => {
  const mediaPersonnel = await prepareQuery('media personnel', 'en', { sourceName: SOURCE });

  const windows = buildAliasHeadTokenFallbackWindows(mediaPersonnel);

  assert.ok(!windows.includes('personnel'));
  assert.ok(windows.every((window) => window !== 'personnel'));
});

test('fallback windows include only authority-bearing sales tokens for wrapper-style locale queries', async () => {
  const english = await prepareQuery('Sales Personnel', 'en', { sourceName: SOURCE });
  const romanian = await prepareQuery('personal vânzări', 'ro', { sourceName: SOURCE });
  const hungarian = await prepareQuery('értékesítési személyzet', 'hu', { sourceName: SOURCE });
  const estonian = await prepareQuery('müügi personal', 'et', { sourceName: SOURCE });

  assert.deepEqual(buildAliasHeadTokenFallbackWindows(english), ['sales']);
  assert.deepEqual(buildAliasHeadTokenFallbackWindows(romanian), ['vanzari']);
  assert.deepEqual(buildAliasHeadTokenFallbackWindows(hungarian), ['ertekesitesi']);
  assert.deepEqual(buildAliasHeadTokenFallbackWindows(estonian), ['muugi']);
});

test('fallback windows depend only on prepared intent, not phrase or family alias matches', async () => {
  const preparedQuery = await prepareQuery('lucrator depozit', 'ro', { sourceName: SOURCE });
  const withoutAnchors = {
    ...preparedQuery,
    commonRolePhraseMatch: null,
    familyAliasMatch: null
  };

  assert.deepEqual(buildAliasHeadTokenFallbackWindows(preparedQuery), buildAliasHeadTokenFallbackWindows(withoutAnchors));
});

test('head-token fallback windows are empty when the query has no classified role head', async () => {
  const preparedQuery = await prepareQuery('senior data analyst', 'en', { sourceName: SOURCE });
  const withoutHead = { ...preparedQuery, intent: { ...preparedQuery.intent, roleHeadTokens: [] } };

  assert.deepEqual(buildAliasHeadTokenFallbackWindows(withoutHead), []);
});

test('fallback windows keep the specific token for a two-token generic-head query even without intent head classification', async () => {
  const preparedQuery = await prepareQuery('hotel supervisor', 'en', { sourceName: SOURCE });
  const withoutHead = {
    ...preparedQuery,
    intent: {
      ...preparedQuery.intent,
      roleHeadTokens: [],
      genericRoleHeadTokens: [],
      authoritativeRoleHeadTokens: []
    }
  };

  assert.deepEqual(buildAliasHeadTokenFallbackWindows(withoutHead), ['hotel']);
});
