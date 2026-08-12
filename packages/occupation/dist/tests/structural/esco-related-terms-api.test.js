import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeObjectRelatedRows, mergeVerbRelatedRows } from '../../src/api/esco-related-terms.js';
test('mergeVerbRelatedRows preserves forward and reverse verb evidence for common ESCO verbs', () => {
    const rows = mergeVerbRelatedRows('train', [
        {
            source_term: 'train',
            related_term: 'teach',
            relationship_type: 'same_skill',
            evidence_count: 4,
            direction: 'forward',
            source_skill_ids_json: '[1,2]',
            related_skill_ids_json: '[3,4]',
            source_skill_uris_json: '["esco:skill:1","esco:skill:2"]',
            related_skill_uris_json: '["esco:skill:3","esco:skill:4"]',
            source_label_examples_json: '["train employees"]',
            related_label_examples_json: '["teach employees"]'
        },
        {
            source_term: 'teach',
            related_term: 'train',
            relationship_type: 'same_skill',
            evidence_count: 4,
            direction: 'reverse',
            source_skill_ids_json: '[3,4]',
            related_skill_ids_json: '[1,2]',
            source_skill_uris_json: '["esco:skill:3","esco:skill:4"]',
            related_skill_uris_json: '["esco:skill:1","esco:skill:2"]',
            source_label_examples_json: '["teach employees"]',
            related_label_examples_json: '["train employees"]'
        }
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.relatedVerb, 'teach');
    assert.deepEqual(rows[0]?.direction, 'forward');
    assert.deepEqual(rows[0]?.evidenceCount, 4);
    assert.deepEqual(rows[0]?.sourceSkillIds, [1, 2]);
    assert.deepEqual(rows[0]?.relatedSkillIds, [3, 4]);
    assert.deepEqual(rows[0]?.sourceLabelExamples, ['train employees']);
    assert.deepEqual(rows[0]?.relatedLabelExamples, ['teach employees']);
});
test('mergeObjectRelatedRows preserves object provenance for related ESCO skills', () => {
    const rows = mergeObjectRelatedRows('employee', [
        {
            source_term: 'employee',
            related_term: 'staff',
            relationship_type: 'same_verb',
            evidence_count: 3,
            direction: 'forward',
            source_skill_ids_json: '[1,3]',
            related_skill_ids_json: '[2,4]',
            source_skill_uris_json: '["esco:skill:1","esco:skill:3"]',
            related_skill_uris_json: '["esco:skill:2","esco:skill:4"]',
            source_label_examples_json: '["train employees"]',
            related_label_examples_json: '["train staff"]'
        }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.relatedObject, 'staff');
    assert.equal(rows[0]?.evidenceCount, 3);
    assert.deepEqual(rows[0]?.sourceSkillIds, [1, 3]);
    assert.deepEqual(rows[0]?.relatedSkillIds, [2, 4]);
});
