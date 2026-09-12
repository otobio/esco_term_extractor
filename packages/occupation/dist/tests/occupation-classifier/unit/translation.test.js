import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translateTitleForClassifier } from '../../../src/occupation-classifier/translation.js';
test('translateTitleForClassifier maps every found Romanian translation without classifying intent', async () => {
    const translated = await translateTitleForClassifier('bucatar vanzari', 'ro');
    assert.deepEqual(Object.keys(translated), [
        'englishTokens',
        'modifierTokens',
        'unresolvedTokens',
        'canonicalExactKeys',
        'resolvedRoleHeadTokens',
        'localRoleHeadTokens',
        'translationUnits'
    ]);
    assert.ok(translated.englishTokens.includes('cook'));
    assert.ok(translated.englishTokens.includes('sales'));
    assert.deepEqual(translated.unresolvedTokens, []);
});
test('translateTitleForClassifier scans text and does not depend on role/modifier intent classification', async () => {
    const translated = await translateTitleForClassifier('foo vanzari bucatar', 'ro');
    assert.ok(translated.englishTokens.includes('cook'));
    assert.ok(translated.englishTokens.includes('sales'));
    assert.deepEqual(translated.unresolvedTokens, ['foo']);
});
test('buildCanonicalComparisonQuery keeps translated structure without runtime debug payload', async () => {
    const query = await translateTitleForClassifier('software developer', 'en');
    assert.ok(query.englishTokens.includes('developer'));
    assert.ok(query.englishTokens.includes('software'));
    assert.deepEqual(query.unresolvedTokens, []);
    assert.ok(query.canonicalExactKeys.some((key) => key.includes('software')));
});
// Bug: "ajutor" (RO for "assistant"/"helper") is a rank/level word (LEAF_LEVEL_KINDS), so it was
// excluded from safeInputTokens before any translation level ran -- it was silently dropped from the
// translation entirely instead of being translated. Fixed by translating rank tokens directly from
// LEVEL_SPECIALIZATION_SYNONYMS (the kind name itself is the exact, curated English word), so the
// rank survives translation without going through the less-accurate general role-head lookup.
test('translateTitleForClassifier translates a rank/level word instead of silently dropping it', async () => {
    const translated = await translateTitleForClassifier('ajutor bucatar', 'ro');
    assert.ok(translated.englishTokens.includes('assistant'));
    assert.ok(translated.englishTokens.includes('cook'));
    assert.deepEqual(translated.unresolvedTokens, []);
});
// Bug: specialization-schema.ts only ever read the global specialization-concept-aliases.csv, so
// locale-curated phrase aliases like "human_resources,resurse umane,96" in
// specialization-concept-aliases.ro.csv were never loaded into the schema conceptMatches searches --
// "resurse umane" always fell through to unresolvedTokens. Fixed by merging the locale-specific alias
// file into the schema lookup, cached per locale (see loadSpecializationSchemaLookup).
test('translateTitleForClassifier resolves a Romanian locale-curated concept-alias phrase', async () => {
    const translated = await translateTitleForClassifier('manager resurse umane', 'ro');
    assert.ok(translated.englishTokens.includes('human resources'));
    assert.deepEqual(translated.unresolvedTokens, []);
    assert.deepEqual(translated.canonicalExactKeys, ['manager human resources']);
});
// Same locale-curated phrase bug, Hungarian side -- and guards that the per-locale schema cache in
// specialization-schema.ts doesn't let the first locale's alias set "stick" for every other locale
// (a single locale-agnostic cache was the original bug: whichever locale ran first would silently
// win for all subsequent locales in the same process).
test('translateTitleForClassifier resolves a Hungarian locale-curated concept-alias phrase without leaking Romanian aliases', async () => {
    const ro = await translateTitleForClassifier('manager resurse umane', 'ro');
    const hu = await translateTitleForClassifier('humánerőforrás menedzser', 'hu');
    assert.ok(ro.englishTokens.includes('human resources'));
    assert.ok(hu.englishTokens.includes('human resources'));
    assert.deepEqual(hu.unresolvedTokens, []);
});
// Bug: a multi-token concept-alias match (e.g. "resurse umane") is keyed in matchedByLocalToken by
// the joined phrase, not by each individual input token, so unresolvedTokens (computed by checking
// matchedByLocalToken.has(token) per original token) wrongly reported "resurse" and "umane" as
// unresolved even though the phrase as a whole matched. Fixed by tracking resolved positions by
// original token index instead of by token-string lookup.
test('translateTitleForClassifier does not report the tokens of a matched multi-token phrase as unresolved', async () => {
    const translated = await translateTitleForClassifier('resurse umane', 'ro');
    assert.deepEqual(translated.unresolvedTokens, []);
});
// Bug: specialization-role-head-aliases.csv has 30+ multi-token aliases (e.g. "muncitor manual" ->
// hand, "conducator auto" -> driver), but the role-head-alias translation level only ever looked up
// a single input token at a time, so every multi-token role-head alias was silently unreachable.
// Fixed by matching role-head aliases through the same greedy-longest-window search as concept
// aliases (see phraseAliasMatches), instead of a single-token map lookup.
test('translateTitleForClassifier resolves a multi-token role-head alias phrase', async () => {
    const translated = await translateTitleForClassifier('muncitor manual', 'ro');
    assert.ok(translated.englishTokens.includes('hand'));
    assert.deepEqual(translated.unresolvedTokens, []);
});
// A second multi-token role-head alias, distinct curated row from "muncitor manual" above, guarding
// against a fix that only special-cased one alias. Also exercises a phrase whose first token ("agent")
// has no colliding single-token concept alias, so this locks in the greedy-longest-window search
// (phraseAliasMatches) working even when there is nothing else competing for the same tokens.
test('translateTitleForClassifier resolves a second, distinct multi-token role-head alias phrase', async () => {
    const translated = await translateTitleForClassifier('agent electoral', 'ro');
    assert.ok(translated.englishTokens.includes('canvasser'));
    assert.deepEqual(translated.unresolvedTokens, []);
});
test('translateTitleForClassifier keeps both the role head and the concept when a token carries both', async () => {
    const translated = await translateTitleForClassifier('farmacist', 'ro');
    assert.deepEqual(translated.englishTokens.sort(), ['medical', 'pharmacist']);
    assert.deepEqual(translated.modifierTokens, ['medical']);
    assert.deepEqual(translated.resolvedRoleHeadTokens, ['pharmacist']);
    assert.deepEqual(translated.localRoleHeadTokens, ['farmacist']);
});
test('translateTitleForClassifier keeps same-source concept aliases as one alternative unit', async () => {
    const translated = await translateTitleForClassifier('consultant vanzari', 'ro');
    const salesUnit = translated.translationUnits.find((unit) => unit.localText === 'vanzari');
    assert.ok(salesUnit);
    assert.deepEqual(salesUnit.alternatives.map((alternative) => alternative.token).sort(), ['business', 'sales']);
    assert.equal(salesUnit.alternatives.every((alternative) => alternative.kind === 'concept'), true);
    assert.deepEqual(translated.canonicalExactKeys.sort(), ['business consultant', 'sales consultant']);
});
