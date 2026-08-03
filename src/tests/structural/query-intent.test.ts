import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_INTENT_VOCABULARY, classifyOccupationQueryIntent, type OccupationIntentVocabulary } from '../../query/query-intent.js';

test('classifyOccupationQueryIntent returns empty intent when term tokens are empty or noise', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'en',
    foldedTokens: ['for', 'and'],
    usefulFoldedTokens: [],
    stopTokens: ['for', 'and'],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.equal(result.confidence, 0);
  assert.deepEqual(result.roleTokens, []);
  assert.deepEqual(result.roleHeadTokens, []);
  assert.deepEqual(result.diagnostics, []);
});

test('pre-head role modifier separation for English (en)', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'en',
    foldedTokens: ['airline', 'compliance', 'auditors'],
    usefulFoldedTokens: ['airline', 'compliance', 'auditors'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(result.domainTokens, ['airline']);
  assert.deepEqual(result.roleTokens, ['compliance', 'auditors']);
  assert.deepEqual(result.roleHeadTokens, ['auditors']);
  assert.ok(result.confidence >= 0.7);
  assert.ok(result.diagnostics.some((d) => d.kind === 'role_head' && d.token === 'auditors'));
  assert.ok(result.diagnostics.some((d) => d.kind === 'role_modifier' && d.token === 'compliance'));
  assert.ok(result.diagnostics.some((d) => d.kind === 'domain_modifier' && d.token === 'airline'));
});

test('post-head role modifier scanning for forward-scan locales (ro)', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'ro',
    foldedTokens: ['inginer', 'software'],
    usefulFoldedTokens: ['inginer', 'software'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(result.roleHeadTokens, ['inginer']);
  assert.deepEqual(result.roleTokens, ['inginer', 'software']);
  assert.ok(result.diagnostics.some((d) => d.kind === 'role_head' && d.token === 'inginer'));
  assert.ok(result.diagnostics.some((d) => d.kind === 'role_modifier' && d.token === 'software'));
});

test('venue context modifier stays separate from role head', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'en',
    foldedTokens: ['restaurant', 'supervisor'],
    usefulFoldedTokens: ['restaurant', 'supervisor'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(result.roleHeadTokens, ['supervisor']);
  assert.deepEqual(result.roleTokens, ['supervisor']);
  assert.deepEqual(result.venueTokens, ['restaurant']);
  assert.deepEqual(result.domainTokens, []);
});

test('seniority and credential modifier classification', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'en',
    foldedTokens: ['senior', 'certified', 'accountant'],
    usefulFoldedTokens: ['certified', 'accountant'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: ['senior']
  });

  assert.deepEqual(result.seniorityTokens, ['senior']);
  assert.deepEqual(result.credentialTokens, ['certified']);
  assert.deepEqual(result.roleHeadTokens, ['accountant']);
});

test('fallback scan direction: English prefers rightmost useful token', () => {
  const result = classifyOccupationQueryIntent({
    locale: 'en',
    foldedTokens: ['customrole', 'fallbacktitle'],
    usefulFoldedTokens: ['customrole', 'fallbacktitle'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(result.roleHeadTokens, ['fallbacktitle']);
  assert.ok(result.diagnostics.some((d) => d.reason.includes('rightmost useful token fallback')));
});

test('fallback scan direction: Romanian and Hungarian prefer leftmost useful token', () => {
  const roResult = classifyOccupationQueryIntent({
    locale: 'ro',
    foldedTokens: ['customrole', 'fallbacktitle'],
    usefulFoldedTokens: ['customrole', 'fallbacktitle'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(roResult.roleHeadTokens, ['customrole']);
  assert.ok(roResult.diagnostics.some((d) => d.reason.includes('leftmost useful token fallback')));

  const huResult = classifyOccupationQueryIntent({
    locale: 'hu',
    foldedTokens: ['customrole', 'fallbacktitle'],
    usefulFoldedTokens: ['customrole', 'fallbacktitle'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: []
  });

  assert.deepEqual(huResult.roleHeadTokens, ['customrole']);
  assert.ok(huResult.diagnostics.some((d) => d.reason.includes('leftmost useful token fallback')));
});

test('custom vocabulary input works with custom role heads and phrases', () => {
  const customVocab: OccupationIntentVocabulary = {
    localeProfiles: [
      {
        localeCode: 'custom',
        roleHeadTerms: ['leadspecialist'],
        roleModifierTerms: ['automation'],
        domainModifierTerms: ['robotics'],
        credentialModifierTerms: ['licensed'],
        ambiguousModifierTerms: ['industrial'],
        rolePhrases: ['automation leadspecialist'],
        domainPhrases: ['robotics sector']
      }
    ]
  };

  const result = classifyOccupationQueryIntent({
    locale: 'custom' as unknown as Parameters<typeof classifyOccupationQueryIntent>[0]['locale'],
    foldedTokens: ['robotics', 'automation', 'leadspecialist'],
    usefulFoldedTokens: ['robotics', 'automation', 'leadspecialist'],
    stopTokens: [],
    noiseTokens: [],
    modifierTokens: [],
    vocabulary: customVocab
  });

  assert.deepEqual(result.roleHeadTokens, ['leadspecialist']);
  assert.deepEqual(result.domainTokens, ['robotics']);
  assert.deepEqual(result.roleTokens, ['automation', 'leadspecialist']);
});

test('BUILTIN_INTENT_VOCABULARY exposes expected locale profiles', () => {
  assert.ok(Array.isArray(BUILTIN_INTENT_VOCABULARY.localeProfiles));
  assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'en'));
  assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'ro'));
  assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'unknown'));
});
