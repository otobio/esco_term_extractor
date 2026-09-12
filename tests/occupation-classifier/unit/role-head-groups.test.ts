import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferRoleHeadsFromStructuralContext } from '../../../src/occupation-classifier/role-head-groups.js';

const FAMILY_RULES = [
  {
    familyNodeId: 14998,
    familyLabel: 'Cooks',
    roleHeads: ['chef', 'cook', 'head'],
    authorityLevels: ['none', 'supervisor'],
    conceptsByDimension: new Map<string, readonly string[]>([['work_object', ['pastry_work_object']]])
  },
  {
    familyNodeId: 14994,
    familyLabel: 'Travel attendants, conductors and guides',
    roleHeads: ['conductor', 'guide'],
    authorityLevels: ['none'],
    conceptsByDimension: new Map<string, readonly string[]>([['work_object', ['shift_work_object']]])
  }
] as const;

test('authority plus pastry context infers role heads from matching family structure', () => {
  assert.deepEqual(
    inferRoleHeadsFromStructuralContext({
      authority: 'chief',
      roleHeads: ['boss'],
      conceptIdsByDimension: new Map([['work_object', ['pastry_work_object']]]),
      familyRules: FAMILY_RULES
    }).map((inference) => inference.roleHead),
    ['chef', 'cook', 'head']
  );
});

test('missing authority defaults to non-management role heads from matching family structure', () => {
  assert.deepEqual(
    inferRoleHeadsFromStructuralContext({
      authority: 'none',
      roleHeads: [],
      conceptIdsByDimension: new Map([['work_object', ['pastry_work_object']]]),
      familyRules: FAMILY_RULES
    }).map((inference) => inference.roleHead),
    ['chef', 'cook']
  );
});

test('structural context does not infer role heads from scheduling context alone', () => {
  assert.deepEqual(
    inferRoleHeadsFromStructuralContext({
      authority: 'chief',
      roleHeads: ['boss'],
      conceptIdsByDimension: new Map([['work_object', ['shift_work_object']]]),
      familyRules: FAMILY_RULES
    }),
    []
  );
});

test('structural context does not infer role heads without matching occupational concepts', () => {
  assert.deepEqual(
    inferRoleHeadsFromStructuralContext({
      authority: 'chief',
      roleHeads: ['boss'],
      conceptIdsByDimension: new Map([['work_object', ['unknown_work_object']]]),
      familyRules: FAMILY_RULES
    }),
    []
  );
});

test('structural context does not infer role heads when a clear primary role head already exists', () => {
  assert.deepEqual(
    inferRoleHeadsFromStructuralContext({
      authority: 'chief',
      roleHeads: ['technician'],
      conceptIdsByDimension: new Map([['work_object', ['pastry_work_object']]]),
      familyRules: FAMILY_RULES
    }),
    []
  );
});
