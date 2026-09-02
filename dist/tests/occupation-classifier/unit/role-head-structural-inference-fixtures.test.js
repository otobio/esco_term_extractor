import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { getFamilyStructureRules } from '../../../src/occupation-classifier/family-structure/family-structure.js';
import { inferRoleHeadsFromStructuralContext } from '../../../src/occupation-classifier/role-head-groups.js';
// Each fixture snapshots a family's own concept signature (its full profile, and each individual
// concept dimension in isolation) at a point where it was verified to resolve inference back to
// that family alone, covering all of its non-rank/non-generic role heads. Regenerate with
// `npm run classifier:role-head-fixtures:generate` after an intentional change to inference
// behavior or to family-structure-rules.tsv; a failure here otherwise means a regression.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/role-head-structural-inference-fixtures.json');
const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
test(`role-head structural inference fixtures loaded (${fixtures.length} cases)`, () => {
    assert.ok(fixtures.length >= 100, `expected at least 100 fixtures, found ${fixtures.length}`);
});
const familyRules = getFamilyStructureRules();
for (const fixture of fixtures) {
    test(`infers ${fixture.familyLabel} (node=${fixture.familyNodeId}) role heads from its ${fixture.label} concept signature`, () => {
        const result = inferRoleHeadsFromStructuralContext({
            authority: fixture.authority,
            roleHeads: [],
            conceptIdsByDimension: new Map(fixture.dimensions),
            familyRules
        });
        const resultFamilyIds = new Set(result.map((inference) => inference.familyNodeId));
        assert.deepEqual(resultFamilyIds, new Set([fixture.familyNodeId]));
        const heads = new Set(result.map((inference) => inference.roleHead));
        assert.deepEqual(heads, new Set(fixture.expectedRoleHeads));
    });
}
