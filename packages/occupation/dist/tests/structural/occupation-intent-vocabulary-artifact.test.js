import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { INTENT_VOCABULARY_BINARY_SCHEMA_VERSION, buildOccupationIntentVocabularyBinaryFiles, buildOccupationIntentVocabularyRecords, loadOccupationIntentVocabularyArtifactRequired } from '../../src/runtime/occupation-intent-vocabulary-artifact.js';
function record(overrides) {
    return {
        searchMetaId: 1,
        graphNodeId: 1,
        canonicalLabel: 'default manager',
        genericRisk: 'low',
        hasHierarchy: true,
        hasCapabilitySupport: false,
        familyNodeId: 100,
        familyLabel: null,
        groupNodeId: null,
        groupLabel: null,
        parentNodeId: null,
        parentLabel: null,
        ancestors: [],
        siblings: [],
        aliases: [],
        capabilityLabels: [],
        ...overrides
    };
}
test('intent vocabulary builder routes obvious domain nouns away from role modifiers', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({ graphNodeId: 1, canonicalLabel: 'automobile mechanic' }),
        record({ graphNodeId: 2, canonicalLabel: 'laundromat manager' })
    ]);
    const english = records.find((entry) => entry.localeCode === 'en');
    assert.ok(english);
    assert.ok(english.domainModifierTerms.includes('automobile'));
    assert.ok(english.domainModifierTerms.includes('laundromat'));
    assert.ok(!english.roleModifierTerms.includes('automobile'));
    assert.ok(!english.roleModifierTerms.includes('laundromat'));
});
test('intent vocabulary builder downgrades mixed head and modifier evidence to ambiguous', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({ graphNodeId: 1, canonicalLabel: 'operations manager' }),
        record({ graphNodeId: 2, canonicalLabel: 'operations analyst' }),
        record({ graphNodeId: 3, canonicalLabel: 'operations' }),
        record({ graphNodeId: 4, canonicalLabel: 'operations' })
    ]);
    const english = records.find((entry) => entry.localeCode === 'en');
    assert.ok(english);
    assert.ok(!english.roleModifierTerms.includes('operations'));
    assert.ok(english.roleHeadTerms.includes('operations') || english.ambiguousModifierTerms.includes('operations'));
});
test('intent vocabulary loader sanitizes contradictory locale records from disk', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'intent-vocab-'));
    const manifestPath = path.join(tempDir, 'occupation-intent-vocabulary.test.binary.manifest.json');
    const previousEnv = process.env.OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH;
    try {
        const records = [
            {
                localeCode: 'en',
                roleHeadTerms: ['manager'],
                roleModifierTerms: ['automobile', 'bank', 'manager'],
                domainModifierTerms: [],
                credentialModifierTerms: [],
                ambiguousModifierTerms: [],
                rolePhrases: ['operations manager'],
                domainPhrases: []
            }
        ];
        const binary = buildOccupationIntentVocabularyBinaryFiles(records, 'occupation-intent-vocabulary.test.binary');
        const manifest = {
            schemaVersion: INTENT_VOCABULARY_BINARY_SCHEMA_VERSION,
            sourceName: 'test_source',
            generatedAt: new Date('2026-08-03T00:00:00.000Z').toISOString(),
            localeCount: 1,
            stringCount: binary.stringCount,
            termIdCount: binary.termIdCount,
            phraseIdCount: binary.phraseIdCount,
            files: binary.manifestFiles
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
        await Promise.all(Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(tempDir, fileName), buffer)));
        process.env.OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH = manifestPath;
        const loaded = await loadOccupationIntentVocabularyArtifactRequired('test_source');
        const english = loaded.artifact.resolveLocaleProfile?.('en') ?? null;
        assert.ok(english);
        assert.deepEqual(english.roleHeadTerms, ['manager']);
        assert.ok(english.domainModifierTerms.includes('automobile'));
        assert.ok(english.domainModifierTerms.includes('bank'));
        assert.ok(!english.roleModifierTerms.includes('manager'));
        assert.deepEqual(english.rolePhrases, ['operations manager']);
    }
    finally {
        if (previousEnv === undefined) {
            delete process.env.OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH;
        }
        else {
            process.env.OCCUPATION_INTENT_VOCABULARY_ARTIFACT_PATH = previousEnv;
        }
        await rm(tempDir, { recursive: true, force: true });
    }
});
