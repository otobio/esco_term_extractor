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
test('intent vocabulary builder rescues single-occurrence head-only terms for any locale', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'senior frigotehnist',
            aliases: [
                {
                    localeCode: 'ro',
                    alias: 'frigotehnist',
                    normalizedAlias: 'frigotehnist',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const romanian = records.find((entry) => entry.localeCode === 'ro');
    assert.ok(romanian);
    assert.ok(romanian.roleHeadTerms.includes('frigotehnist'));
});
test('intent vocabulary builder rescues single-occurrence hu agent nouns via suffix', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'team leader',
            aliases: [
                {
                    localeCode: 'hu',
                    alias: 'vezeto',
                    normalizedAlias: 'vezeto',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const hungarian = records.find((entry) => entry.localeCode === 'hu');
    assert.ok(hungarian);
    assert.ok(hungarian.roleHeadTerms.includes('vezeto'));
});
test('intent vocabulary builder rescues single-occurrence et agent nouns via suffix', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'compiler',
            aliases: [
                {
                    localeCode: 'et',
                    alias: 'koostaja',
                    normalizedAlias: 'koostaja',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const estonian = records.find((entry) => entry.localeCode === 'et');
    assert.ok(estonian);
    assert.ok(estonian.roleHeadTerms.includes('koostaja'));
});
test('intent vocabulary builder applies reviewed locale overrides before binary generation', () => {
    const overrides = [
        {
            localeCode: 'ro',
            add: {
                domainModifierTerms: ['auto'],
                rolePhrases: ['tinichigiu auto']
            },
            remove: {
                roleModifierTerms: ['auto']
            }
        }
    ];
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'sheet metal worker',
            aliases: [
                {
                    localeCode: 'ro',
                    alias: 'tinichigiu auto',
                    normalizedAlias: 'tinichigiu auto',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ], overrides);
    const romanian = records.find((entry) => entry.localeCode === 'ro');
    assert.ok(romanian);
    assert.ok(romanian.domainModifierTerms.includes('auto'));
    assert.ok(!romanian.roleModifierTerms.includes('auto'));
    assert.ok(romanian.rolePhrases.includes('tinichigiu auto'));
});
test('intent vocabulary builder does not rescue hu adjectival -hato/-heto suffix forms', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'classifiable role',
            aliases: [
                {
                    localeCode: 'hu',
                    alias: 'sorolhato',
                    normalizedAlias: 'sorolhato',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const hungarian = records.find((entry) => entry.localeCode === 'hu');
    assert.ok(hungarian);
    assert.ok(!hungarian.roleHeadTerms.includes('sorolhato'));
});
test('intent vocabulary builder does not rescue a suffix-matching term only seen as a modifier', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({
            graphNodeId: 1,
            canonicalLabel: 'fruit grower',
            aliases: [
                {
                    localeCode: 'et',
                    alias: 'puuvilja kasvataja',
                    normalizedAlias: 'puuvilja kasvataja',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const estonian = records.find((entry) => entry.localeCode === 'et');
    assert.ok(estonian);
    assert.ok(!estonian.roleHeadTerms.includes('puuvilja'));
});
test('intent vocabulary builder does not rescue en/ro terms also seen as a modifier elsewhere', () => {
    const records = buildOccupationIntentVocabularyRecords([
        record({ graphNodeId: 1, canonicalLabel: 'computer repair technician' }),
        record({
            graphNodeId: 2,
            canonicalLabel: 'universitar lecturer',
            aliases: [
                {
                    localeCode: 'ro',
                    alias: 'lector universitar',
                    normalizedAlias: 'lector universitar',
                    aliasRole: 'locale_primary',
                    isPrimary: true,
                    confidence: 1,
                    weight: 1
                }
            ]
        })
    ]);
    const english = records.find((entry) => entry.localeCode === 'en');
    const romanian = records.find((entry) => entry.localeCode === 'ro');
    assert.ok(english);
    assert.ok(romanian);
    assert.ok(!english.roleHeadTerms.includes('computer'));
    assert.ok(!romanian.roleHeadTerms.includes('universitar'));
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
