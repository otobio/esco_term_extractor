import assert from 'node:assert/strict';
import test from 'node:test';
import { LEAF_AUTHORITY_KINDS, LEAF_BASE_ROLE_KINDS, LEAF_RISK_LEVELS, LEAF_SPECIALIZATION_KINDS } from '../../runtime/occupation-leaf-structure-contract.js';
test('leaf structure contract exposes stable category vocabularies', () => {
    assert.deepEqual(LEAF_BASE_ROLE_KINDS, ['generic_base_role', 'specialized_base_role']);
    assert.deepEqual(LEAF_AUTHORITY_KINDS, ['none', 'lead', 'supervisor', 'manager', 'director', 'chief', 'auditor']);
    assert.deepEqual(LEAF_SPECIALIZATION_KINDS, ['venue', 'channel', 'product', 'population', 'task_focus', 'industry_context']);
    assert.deepEqual(LEAF_RISK_LEVELS, ['low', 'medium', 'high']);
});
test('leaf structure record shape supports artifact-backed specialization metadata', () => {
    const record = {
        graphNodeId: 15531,
        canonicalLabel: 'customer service representative',
        familyNodeId: 14965,
        groupNodeId: 14970,
        parentNodeId: 14970,
        baseRoleKind: 'generic_base_role',
        authorityKind: 'none',
        specializationKinds: [],
        headPreservingSpecialization: false,
        broadAliasRisk: 'medium',
        capabilityDominanceRisk: 'low'
    };
    assert.equal(record.baseRoleKind, 'generic_base_role');
    assert.equal(record.authorityKind, 'none');
    assert.deepEqual(record.specializationKinds, []);
});
test('leaf structure manifest shape is minimal and exporter-oriented', () => {
    const manifest = {
        schemaVersion: 2,
        sourceName: 'esco_1_2_1',
        generatedAt: '2026-08-10T00:00:00.000Z',
        count: 1,
        stringCount: 1,
        familyPostingKeyCount: 1,
        familyPostingCount: 1,
        files: {
            strings: 'occupation-leaf-structure.esco_1_2_1.binary.strings.bin',
            recordRows: 'occupation-leaf-structure.esco_1_2_1.binary.record-rows.bin',
            familyPostings: 'occupation-leaf-structure.esco_1_2_1.binary.family-postings.idx',
            familyPostingRows: 'occupation-leaf-structure.esco_1_2_1.binary.family-posting-rows.bin'
        }
    };
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.files.recordRows.endsWith('.bin'), true);
});
