import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareFamilyStructureQuery } from '../../../src/occupation-classifier/family-structure/family-structure.js';
import { scoreFamilyStatisticalFit } from '../../../src/occupation-classifier/family-statistics/family-statistics.js';
import { buildQueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';

test('family statistics prefer nursing over secretarial families for Romanian medical nurse wording', () => {
  const query = prepareFamilyStructureQuery(buildQueryStructuralProfile('Asistent Medical Generalist', 'ro'));
  const nursing = scoreFamilyStatisticalFit(14750, query);
  const secretaries = scoreFamilyStatisticalFit(14914, query);

  assert.deepEqual(query.roleHeads, ['nurse']);
  assert.ok(nursing.score > secretaries.score);
  assert.ok(nursing.score > 0);
});

test('family statistics prefer business administration over finance professionals for budget manager', () => {
  const query = prepareFamilyStructureQuery(buildQueryStructuralProfile('budget manager', 'en'));
  const businessAdministration = scoreFamilyStatisticalFit(14677, query);
  const financeProfessionals = scoreFamilyStatisticalFit(14787, query);

  assert.deepEqual(query.roleHeads, ['manager']);
  assert.deepEqual(query.conceptIdsByDimension.get('knowledge_domain'), ['budget_knowledge_domain']);
  assert.ok(businessAdministration.score > financeProfessionals.score);
  assert.ok(businessAdministration.features.includes('pair:manager|knowledge_domain:budget_knowledge_domain'));
});
