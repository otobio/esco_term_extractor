import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { parseCsvRecords } from '../../../src/utils/csv/parse-csv.js';
import { foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../../../src/utils/texts.js';
import { loadSpecializationSchemaLookup } from '../../../src/occupation-classifier/specialization-schema.js';
// A frozen clone of every specialization-schema CSV, kept solely so this test's own enumeration of
// role heads/concepts/aliases can never silently shrink if someone edits the live source CSVs (e.g.
// during a "simplification" refactor that drops rows by accident). Each row cloned here is resolved
// against the LIVE loader (loadSpecializationSchemaLookup, reading the real src/ CSVs), so a row that
// disappears from the live data -- or a loader change that breaks parsing/indexing -- fails this test.
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/specialization-schema-snapshot');
function readFixture(name) {
    return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}
let lookupsByLocale;
let conceptRulesById;
before(async () => {
    const [global, ro, hu] = await Promise.all([
        loadSpecializationSchemaLookup(undefined),
        loadSpecializationSchemaLookup('ro'),
        loadSpecializationSchemaLookup('hu')
    ]);
    lookupsByLocale = new Map([
        ['', global],
        ['ro', ro],
        ['hu', hu]
    ]);
    conceptRulesById = new Map();
    for (const row of parseCsvRecords(readFixture('specialization-concept-rules.csv'))) {
        const conceptId = row.concept_id?.trim();
        const canonical = row.canonical?.trim();
        const dimension = row.dimension?.trim();
        if (conceptId && canonical && dimension) {
            conceptRulesById.set(conceptId, { canonical, dimension });
        }
    }
});
test('every specialization role_head alias resolves to its canonical role head via the live schema loader', () => {
    const lookup = lookupsByLocale.get('');
    assert.ok(lookup, 'expected the global schema lookup to be loaded');
    const rows = parseCsvRecords(readFixture('specialization-role-head-aliases.csv'));
    assert.ok(rows.length > 0, 'expected role-head alias fixture rows');
    const failures = [];
    for (const row of rows) {
        const roleHead = row.role_head?.trim();
        const alias = row.alias?.trim();
        if (!roleHead || !alias) {
            continue;
        }
        const key = foldWeakPunctuationLookupText(alias);
        const resolved = lookup.roleHeadAliasesByLocalToken.get(key) ?? [];
        if (!resolved.includes(roleHead)) {
            failures.push(`"${alias}" -> expected role_head "${roleHead}", got [${resolved.join(', ')}]`);
        }
    }
    if (failures.length > 0) {
        console.log('role_head alias resolution failures:', failures);
    }
    assert.equal(failures.length, 0, `expected every role_head alias to resolve, found ${failures.length} failures`);
});
test('every specialization concept alias resolves to its concept id and dimension via the live schema loader', () => {
    const conceptFilesByLocale = [
        ['', 'specialization-concept-aliases.csv'],
        ['ro', 'specialization-concept-aliases.ro.csv'],
        ['hu', 'specialization-concept-aliases.hu.csv']
    ];
    const failures = [];
    let total = 0;
    for (const [locale, fileName] of conceptFilesByLocale) {
        const lookup = lookupsByLocale.get(locale);
        assert.ok(lookup, `expected the "${locale || 'global'}" schema lookup to be loaded`);
        const rows = parseCsvRecords(readFixture(fileName));
        assert.ok(rows.length > 0, `expected concept-alias fixture rows in ${fileName}`);
        for (const row of rows) {
            const conceptId = row.concept_id?.trim();
            const alias = row.alias?.trim();
            if (!conceptId || !alias) {
                continue;
            }
            const rule = conceptRulesById.get(conceptId);
            if (!rule) {
                failures.push(`${fileName}: "${alias}" references unknown concept_id "${conceptId}"`);
                continue;
            }
            total += 1;
            const aliasTokens = tokenizeNormalizedText(foldWeakPunctuationLookupText(alias));
            const firstToken = aliasTokens[0];
            const candidates = (firstToken ? lookup.conceptAliasesByFirstToken.get(firstToken) : undefined) ?? [];
            const matched = candidates.find((candidate) => candidate.conceptId === conceptId && candidate.aliasTokens.join(' ') === aliasTokens.join(' '));
            if (!matched || matched.concept.dimension !== rule.dimension || matched.concept.canonical !== foldWeakPunctuationLookupText(rule.canonical)) {
                failures.push(`${fileName}: "${alias}" -> expected concept_id "${conceptId}" (${rule.dimension}:${rule.canonical}), not found in live index`);
            }
        }
    }
    if (failures.length > 0) {
        console.log('concept alias resolution failures:', failures.slice(0, 50), `(total failures: ${failures.length})`);
    }
    assert.ok(total > 0, 'expected concept-alias rows to be checked');
    assert.equal(failures.length, 0, `expected every concept alias to resolve, found ${failures.length}/${total} failures`);
});
