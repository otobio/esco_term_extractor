import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCapabilityRecords, type SourceCapabilityConceptRow } from '../../src/graph/capability/build-capability-graph.js';

type ConceptRowInput = Partial<Omit<SourceCapabilityConceptRow, 'constructor'>>;

function conceptRow(overrides: ConceptRowInput): SourceCapabilityConceptRow {
  return {
    id: 1,
    source_kind: 'esco',
    source_name: 'esco_1_2_1',
    locale_code: 'en',
    external_uri: 'http://data.europa.eu/esco/skill/example',
    entity_kind: 'skill',
    concept_type: null,
    preferred_label: 'sell products',
    normalized_label: 'sell products',
    description: null,
    definition_text: null,
    ...overrides
  } as SourceCapabilityConceptRow;
}

test('buildCapabilityRecords keeps one record per locale instead of collapsing to english', () => {
  const records = buildCapabilityRecords([
    conceptRow({ locale_code: 'en', preferred_label: 'sell products' }),
    conceptRow({ locale_code: 'ro', preferred_label: 'vinde produse' }),
    conceptRow({ locale_code: 'hu', preferred_label: 'termékek értékesítése' })
  ]);

  assert.equal(records.length, 3);
  const byLocale = new Map(records.map((record) => [record.localeCode, record]));
  assert.equal(byLocale.get('en')?.label, 'sell products');
  assert.equal(byLocale.get('ro')?.label, 'vinde produse');
  assert.equal(byLocale.get('hu')?.label, 'termékek értékesítése');

  // Every locale variant of the same concept shares the same canonical key so the
  // UNIQUE (canonical_key, locale_code) constraint gives each locale its own row.
  const canonicalKeys = new Set(records.map((record) => record.canonicalKey));
  assert.equal(canonicalKeys.size, 1);
});

test('buildCapabilityRecords picks the best-labeled row among duplicate rows in the same locale', () => {
  const records = buildCapabilityRecords([
    conceptRow({ locale_code: 'ro', preferred_label: '9c1d1e2a-aaaa-bbbb-cccc-000000000000' }),
    conceptRow({ locale_code: 'ro', preferred_label: 'vinde produse', description: 'sales skill' })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.label, 'vinde produse');
  assert.equal(records[0]?.localeCode, 'ro');
});
