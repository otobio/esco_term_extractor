import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';

test('cleanOccupationQuerySurface keeps strict peeler then OOV behavior for Romanian recruiter noise', async () => {
  assert.equal(await cleanOccupationQuerySurface('Cautam colegi pentru Pizza Hut!', 'ro'), 'pentru');
  assert.equal(await cleanOccupationQuerySurface('Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'ro'), 'Sales Advisor Boutique');
});

test('cleanOccupationQuerySurface stays strict when OOV drops unknown tail tokens', async () => {
  assert.equal(await cleanOccupationQuerySurface('depozit helperxx', 'ro'), 'depozit');
  assert.equal(await cleanOccupationQuerySurface('depozit raktarxx', 'hu'), 'depozit');
});

test('cleanOccupationQuerySurface applies common noise peeling for English and Estonian surfaces', async () => {
  assert.equal(await cleanOccupationQuerySurface('Hiring HVAC technician', 'en'), 'HVAC technician');
  assert.equal(await cleanOccupationQuerySurface('andmeanalüütik (m/w/d)', 'et'), 'andmeanalüütik');
});

test('cleanOccupationQuerySurface keeps exact occupational cores for Hungarian localized titles', async () => {
  assert.equal(await cleanOccupationQuerySurface('Operátor gyártás (Budapest, Pest megye)', 'hu'), 'Operátor gyártás');
});
