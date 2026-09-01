import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthorityTier, leafAuthorityLevelKindsContradict } from '../../../src/occupation-classifier/candidates.js';
import { LEAF_LEVEL_KINDS, type LeafLevelKind } from '../../../src/runtime/occupation-leaf-structure-rules.js';

const AUTHORITY_TIERS: LeafLevelKind[] = ['supervisor', 'manager', 'director', 'chief'];
const NON_AUTHORITY_TIERS: LeafLevelKind[] = ['assistant', 'junior', 'senior', 'lead'];

test('isAuthorityTier classifies supervisor/manager/director/chief as authority tiers', () => {
  for (const tier of AUTHORITY_TIERS) {
    assert.equal(isAuthorityTier(tier), true, `expected "${tier}" to be an authority tier`);
  }
});

test('isAuthorityTier classifies none/assistant/junior/senior/lead as non-authority tiers', () => {
  for (const tier of ['none', ...NON_AUTHORITY_TIERS] as LeafLevelKind[]) {
    assert.equal(isAuthorityTier(tier), false, `expected "${tier}" not to be an authority tier`);
  }
});

// -- an unspecified query level is a "don't care" for non-authority leaves, but a query that never
// asked for a supervisor-and-above role still rejects one: those are a distinct role class that
// must be explicitly requested --

test('leafAuthorityLevelKindsContradict does not contradict an unspecified query level against a non-authority leaf', () => {
  for (const leafLevel of ['none', ...NON_AUTHORITY_TIERS] as LeafLevelKind[]) {
    assert.equal(leafAuthorityLevelKindsContradict('none', leafLevel), false, `query "none" vs leaf "${leafLevel}" should not contradict`);
  }
});

test('leafAuthorityLevelKindsContradict contradicts an unspecified query level against an authority-tier leaf', () => {
  for (const leafLevel of AUTHORITY_TIERS) {
    assert.equal(
      leafAuthorityLevelKindsContradict('none', leafLevel),
      true,
      `query "none" vs leaf "${leafLevel}" should contradict (authority tier must be explicitly requested)`
    );
  }
});

// -- a leaf with no detected level is treated as a plain non-authority-tier signal, since
// isAuthorityTier('none') is false: it contradicts an authority-tier query (tier mismatch) but
// not a non-authority-tier query (same tier band) --

test('leafAuthorityLevelKindsContradict contradicts an authority-tier query against a leaf with no level at all', () => {
  for (const queryLevel of AUTHORITY_TIERS) {
    assert.equal(leafAuthorityLevelKindsContradict(queryLevel, 'none'), true, `query "${queryLevel}" vs leaf "none" should contradict`);
  }
});

test('leafAuthorityLevelKindsContradict does not contradict a non-authority-tier query against a leaf with no level at all', () => {
  for (const queryLevel of NON_AUTHORITY_TIERS) {
    assert.equal(
      leafAuthorityLevelKindsContradict(queryLevel, 'none'),
      false,
      `query "${queryLevel}" vs leaf "none" should not contradict (both non-authority tier)`
    );
  }
});

// -- same tier band on both sides never contradicts, regardless of the exact matching level --

test('leafAuthorityLevelKindsContradict does not contradict when both sides are authority tiers', () => {
  for (const queryLevel of AUTHORITY_TIERS) {
    for (const leafLevel of AUTHORITY_TIERS) {
      assert.equal(
        leafAuthorityLevelKindsContradict(queryLevel, leafLevel),
        false,
        `query "${queryLevel}" vs leaf "${leafLevel}" should not contradict (both authority tiers)`
      );
    }
  }
});

test('leafAuthorityLevelKindsContradict does not contradict when both sides are non-authority tiers', () => {
  for (const queryLevel of NON_AUTHORITY_TIERS) {
    for (const leafLevel of NON_AUTHORITY_TIERS) {
      assert.equal(
        leafAuthorityLevelKindsContradict(queryLevel, leafLevel),
        false,
        `query "${queryLevel}" vs leaf "${leafLevel}" should not contradict (both non-authority tiers)`
      );
    }
  }
});

// -- crossing the authority/non-authority boundary always contradicts, in either direction --

test('leafAuthorityLevelKindsContradict contradicts when the query names an authority tier the leaf does not have', () => {
  for (const queryLevel of AUTHORITY_TIERS) {
    for (const leafLevel of NON_AUTHORITY_TIERS) {
      assert.equal(
        leafAuthorityLevelKindsContradict(queryLevel, leafLevel),
        true,
        `query "${queryLevel}" vs leaf "${leafLevel}" should contradict (authority vs non-authority)`
      );
    }
  }
});

test('leafAuthorityLevelKindsContradict contradicts when the query names a non-authority tier but the leaf is an authority tier', () => {
  for (const queryLevel of NON_AUTHORITY_TIERS) {
    for (const leafLevel of AUTHORITY_TIERS) {
      assert.equal(
        leafAuthorityLevelKindsContradict(queryLevel, leafLevel),
        true,
        `query "${queryLevel}" vs leaf "${leafLevel}" should contradict (non-authority vs authority)`
      );
    }
  }
});

// -- exhaustive matrix over every declared level kind, derived directly from the formula --

test('leafAuthorityLevelKindsContradict matches isAuthorityTier(query) !== isAuthorityTier(leaf) for every non-"none" query level', () => {
  for (const queryLevel of LEAF_LEVEL_KINDS) {
    if (queryLevel === 'none') {
      continue;
    }
    for (const leafLevel of LEAF_LEVEL_KINDS) {
      const expectedContradiction: boolean = isAuthorityTier(queryLevel) !== isAuthorityTier(leafLevel);
      assert.equal(
        leafAuthorityLevelKindsContradict(queryLevel, leafLevel),
        expectedContradiction,
        `query "${queryLevel}" vs leaf "${leafLevel}" should be ${expectedContradiction}`
      );
    }
  }
});

test('leafAuthorityLevelKindsContradict is reflexive: identical levels never contradict', () => {
  for (const level of LEAF_LEVEL_KINDS) {
    assert.equal(leafAuthorityLevelKindsContradict(level, level), false, `"${level}" vs itself should not contradict`);
  }
});
