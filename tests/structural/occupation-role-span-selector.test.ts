import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectOccupationRoleSpan } from '../../src/query/occupation-role-span-selector.js';

const SOURCE = 'esco_1_2_1';

test('role-span selection uses per-token compound reconstruction for mixed Hungarian queries', async () => {
  const selection = await selectOccupationRoleSpan({
    sourceName: SOURCE,
    locale: 'hu',
    originalQuery: 'Banki projektvezeto',
    querySpans: ['Banki projektvezeto']
  });

  assert.equal(selection.roleQuery, 'project manager');
  assert.equal(selection.contextQuery, 'Banki');
  assert.equal(selection.selectedSpan?.text, 'projekt vezeto');
  assert.ok(selection.selectedSpan?.evidence.includes('curated_role_phrase_exact'));
  assert.ok(selection.selectedSpan?.evidence.includes('compound_expanded_surface'));
});
