import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOccupationLeafStructureArtifactRequired } from '../../runtime/occupation-leaf-structure-artifact.js';
const SOURCE = 'esco_1_2_1';
const MINIMUM_FAMILY_IDS = [14727, 14735, 14739, 14796, 14802, 14808, 14842, 14908, 14942, 15135, 15139];
test('leaf structure artifact loads the full-family categorization payload with the seeded core families present', async () => {
    const artifact = await loadOccupationLeafStructureArtifactRequired(SOURCE);
    const records = artifact.getAllRecords();
    const familyIds = Array.from(new Set(records.map((record) => record.familyNodeId).filter((value) => value !== null))).sort((left, right) => left - right);
    assert.equal(artifact.manifest.sourceName, SOURCE);
    assert.equal(artifact.manifest.schemaVersion, 2);
    assert.equal(familyIds.length, 125);
    for (const familyId of MINIMUM_FAMILY_IDS) {
        assert.ok(familyIds.includes(familyId));
    }
    assert.ok(artifact.manifest.count >= 3000);
});
test('leaf structure artifact includes generic base-role anchors for core technical families', async () => {
    const artifact = await loadOccupationLeafStructureArtifactRequired(SOURCE);
    assert.equal(artifact.getRecord(18165)?.canonicalLabel, 'software developer');
    assert.equal(artifact.getRecord(18165)?.baseRoleKind, 'generic_base_role');
    assert.equal(artifact.getRecord(17023)?.canonicalLabel, 'database administrator');
    assert.equal(artifact.getRecord(17023)?.baseRoleKind, 'generic_base_role');
    assert.equal(artifact.getRecord(16951)?.canonicalLabel, 'electrical engineer');
    assert.equal(artifact.getRecord(16951)?.baseRoleKind, 'generic_base_role');
});
