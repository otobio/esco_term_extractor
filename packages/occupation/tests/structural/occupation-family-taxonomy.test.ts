import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOccupationFamilyContext } from '../../src/api/occupation-family-taxonomy.js';
import { getGenericHeadFamilyPriors } from '../../src/search-pipeline/generic-head-family-priors.js';

test('occupation family taxonomy resolves by id, slug, and label', () => {
  const byId = getOccupationFamilyContext(14706);
  const bySlug = getOccupationFamilyContext('hotel_and_restaurant_managers');
  const byLabel = getOccupationFamilyContext('Hotel And Restaurant Managers');

  assert.ok(byId);
  assert.equal(byId?.label, 'Hotel And Restaurant Managers');
  assert.equal(bySlug?.id, byId?.id);
  assert.equal(byLabel?.id, byId?.id);
});

test('health-oriented generic-head priors stay on pink-trait families', () => {
  const priors = getGenericHeadFamilyPriors(['supervisor'], ['medical', 'supervisor'], [], false);
  const primary = priors.find((prior) => prior.strength === 'primary');
  const family = primary ? getOccupationFamilyContext(primary.familyNodeId) : undefined;

  assert.ok(primary);
  assert.ok(family);
  assert.ok(family?.collarTraits.includes('pink'));
  assert.equal(family?.group, 'technical');
});

test('Romanian generic-head aliases resolve to the same hospitality prior family', () => {
  const priors = getGenericHeadFamilyPriors(['supervizor'], ['supervizor'], ['restaurant'], false);
  const primary = priors.find((prior) => prior.strength === 'primary');
  const family = primary ? getOccupationFamilyContext(primary.familyNodeId) : undefined;

  assert.equal(primary?.familyNodeId, 14706);
  assert.equal(family?.collarKind, 'white');
  assert.equal(family?.group, 'executive');
});

test('industrial worker priors remain blue-collar elementary families', () => {
  const priors = getGenericHeadFamilyPriors(['worker'], ['factory', 'worker'], [], false);
  const primary = priors.find((prior) => prior.strength === 'primary');
  const family = primary ? getOccupationFamilyContext(primary.familyNodeId) : undefined;

  assert.equal(primary?.familyNodeId, 15248);
  assert.equal(family?.collarKind, 'blue');
  assert.equal(family?.group, 'elementary');
});
