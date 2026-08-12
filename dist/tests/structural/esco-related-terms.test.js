import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEscoRelatedTermsDataset, buildEscoVerbInventory, extractEscoLabelFact } from '../../src/skills/esco-related-terms.js';
test('extractEscoLabelFact splits the first token as the verb and the remainder as the object', () => {
    const fact = extractEscoLabelFact('Train employees quickly');
    assert.ok(fact);
    assert.equal(fact?.normalizedLabel, 'train employees quickly');
    assert.equal(fact?.verb, 'train');
    assert.equal(fact?.object, 'employees quickly');
});
test('buildEscoVerbInventory keeps only verbs that meet the minimum occurrence threshold', () => {
    const labels = [
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Train employees', labelType: 'preferred_label', sourceLabel: 'Train employees' },
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Train staff', labelType: 'alt_label', sourceLabel: 'Train staff' },
        { skillId: 2, skillUri: 'esco:skill:2', label: 'Teach employees', labelType: 'preferred_label', sourceLabel: 'Teach employees' }
    ];
    const inventory = buildEscoVerbInventory(labels);
    assert.deepEqual(inventory, [
        {
            term: 'train',
            occurrenceCount: 2,
            skillCount: 1,
            labelCount: 2
        }
    ]);
});
test('buildEscoRelatedTermsDataset derives verb and object relationships from ESCO labels and relations', () => {
    const labels = [
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Train employees', labelType: 'preferred_label', sourceLabel: 'Train employees' },
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Teach employees', labelType: 'alt_label', sourceLabel: 'Teach employees' },
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Train employees', labelType: 'alt_label', sourceLabel: 'Train employees' },
        { skillId: 1, skillUri: 'esco:skill:1', label: 'Train staff', labelType: 'hidden_label', sourceLabel: 'Train staff' },
        { skillId: 2, skillUri: 'esco:skill:2', label: 'Coach employees', labelType: 'preferred_label', sourceLabel: 'Coach employees' },
        { skillId: 2, skillUri: 'esco:skill:2', label: 'Coach staff', labelType: 'alt_label', sourceLabel: 'Coach staff' },
        { skillId: 3, skillUri: 'esco:skill:3', label: 'Manage employees', labelType: 'preferred_label', sourceLabel: 'Manage employees' },
        { skillId: 3, skillUri: 'esco:skill:3', label: 'Manage staff', labelType: 'alt_label', sourceLabel: 'Manage staff' }
    ];
    const relations = [
        {
            relationId: 99,
            relationKind: 'skill_skill',
            localeCode: 'en',
            sourceSkillId: 1,
            sourceSkillUri: 'esco:skill:1',
            sourceLabel: 'Train employees',
            relatedSkillId: 2,
            relatedSkillUri: 'esco:skill:2',
            relatedLabel: 'Coach employees'
        }
    ];
    const dataset = buildEscoRelatedTermsDataset(labels, relations, {
        minVerbOccurrences: 1,
        minObjectOccurrences: 1
    });
    assert.ok(dataset.verbInventory.some((row) => row.term === 'train' && row.occurrenceCount === 2));
    assert.ok(dataset.verbInventory.some((row) => row.term === 'teach' && row.occurrenceCount === 1));
    assert.ok(dataset.objectInventory.some((row) => row.term === 'employees' && row.occurrenceCount === 4));
    assert.ok(dataset.objectInventory.some((row) => row.term === 'staff' && row.occurrenceCount === 3));
    const sameSkillVerb = dataset.verbRelatedRows.find((row) => row.source_verb === 'train' && row.related_verb === 'teach' && row.relationship_type === 'same_skill');
    assert.ok(sameSkillVerb);
    assert.equal(sameSkillVerb?.evidence_count, 1);
    assert.deepEqual(sameSkillVerb?.source_skill_ids, [1]);
    assert.deepEqual(sameSkillVerb?.related_skill_ids, [1]);
    const sameObjectVerb = dataset.verbRelatedRows.find((row) => {
        if (row.relationship_type !== 'same_object') {
            return false;
        }
        const terms = new Set([row.source_verb, row.related_verb]);
        return terms.has('train') && terms.has('coach');
    });
    assert.ok(sameObjectVerb);
    assert.equal(sameObjectVerb?.evidence_count, 2);
    assert.deepEqual(sameObjectVerb?.source_skill_ids, [1]);
    assert.deepEqual(sameObjectVerb?.related_skill_ids, [2]);
    const sameVerbObject = dataset.objectRelatedRows.find((row) => row.source_object === 'employees' && row.related_object === 'staff' && row.relationship_type === 'same_verb');
    assert.ok(sameVerbObject);
    assert.equal(sameVerbObject?.evidence_count, 3);
    assert.deepEqual(sameVerbObject?.source_skill_ids, [1, 2, 3]);
    assert.deepEqual(sameVerbObject?.related_skill_ids, [1, 2, 3]);
    const explicitRelation = dataset.verbRelatedRows.find((row) => row.source_verb === 'train' && row.related_verb === 'coach' && row.relationship_type === 'esco_related_skill');
    assert.ok(explicitRelation);
    assert.equal(explicitRelation?.evidence_count, 1);
    assert.ok(explicitRelation?.source_label_examples.includes('Train employees'));
    assert.ok(explicitRelation?.related_label_examples.includes('Coach employees'));
});
