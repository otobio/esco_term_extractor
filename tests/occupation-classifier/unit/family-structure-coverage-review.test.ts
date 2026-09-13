import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewFamilyStructureCoverage } from '../../../src/occupation-classifier/family-structure/review-family-structure-coverage.js';

test('family structure rules include all leaf-backed coverage details above review threshold', () => {
  const review = reviewFamilyStructureCoverage();

  assert.equal(review.leafCount, 3039);
  assert.equal(review.additions.length, 0, formatAdditions(review.additions));
});

function formatAdditions(additions: ReturnType<typeof reviewFamilyStructureCoverage>['additions']): string {
  if (additions.length === 0) {
    return '';
  }
  return additions
    .map((addition) =>
      [
        addition.familyNodeId,
        addition.familyLabel,
        addition.field,
        addition.value,
        `${addition.evidenceCount}/${addition.familyLeafCount}`,
        addition.evidenceRatio.toFixed(3)
      ].join('\t')
    )
    .join('\n');
}
