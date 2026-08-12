import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_INTENT_VOCABULARY, BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE, classifyOccupationQueryIntent } from '../../src/query/query-intent.js';
function builtinProfile(localeCode) {
    const profile = BUILTIN_INTENT_VOCABULARY.localeProfiles.find((entry) => entry.localeCode === localeCode);
    assert.ok(profile, `missing built-in intent vocabulary profile for locale ${localeCode}`);
    return profile;
}
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
test('Romanian venue context stays separate from generic role head', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'ro',
        foldedTokens: ['supervizor', 'restaurant'],
        usefulFoldedTokens: ['supervizor', 'restaurant'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleHeadTokens, ['supervizor']);
    assert.deepEqual(result.roleTokens, ['supervizor']);
    assert.deepEqual(result.venueTokens, ['restaurant']);
    assert.deepEqual(result.domainTokens, []);
});
test('Romanian generic worker head is recognized directly instead of fallback guessing', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'ro',
        foldedTokens: ['lucrator', 'comercial'],
        usefulFoldedTokens: ['lucrator', 'comercial'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleHeadTokens, ['lucrator']);
    assert.ok(result.diagnostics.some((d) => d.kind === 'role_head' && d.token === 'lucrator'));
    assert.ok(result.confidence >= 0.7);
});
test('standalone generic heads require extra context before becoming authoritative', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['manager'],
        usefulFoldedTokens: ['manager'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleHeadTokens, ['manager']);
    assert.deepEqual(result.genericRoleHeadTokens, ['manager']);
    assert.deepEqual(result.authoritativeRoleHeadTokens, []);
    assert.equal(result.roleHeadRequiresContext, true);
    assert.equal(result.roleHeadHasContext, false);
    assert.ok(result.confidence < 0.6);
    assert.ok(result.diagnostics.some((d) => d.reason.includes('generic role head requires additional context')));
});
test('generic heads keep authority when role or venue context is present', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['restaurant', 'supervisor'],
        usefulFoldedTokens: ['restaurant', 'supervisor'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleHeadTokens, ['supervisor']);
    assert.deepEqual(result.genericRoleHeadTokens, ['supervisor']);
    assert.deepEqual(result.authoritativeRoleHeadTokens, ['supervisor']);
    assert.equal(result.roleHeadRequiresContext, true);
    assert.equal(result.roleHeadHasContext, true);
    assert.ok(result.confidence >= 0.7);
});
test('generic heads keep authority when domain context is present', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['airline', 'manager'],
        usefulFoldedTokens: ['airline', 'manager'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.domainTokens, ['airline']);
    assert.deepEqual(result.roleHeadTokens, ['manager']);
    assert.deepEqual(result.authoritativeRoleHeadTokens, ['manager']);
    assert.equal(result.roleHeadRequiresContext, true);
    assert.equal(result.roleHeadHasContext, true);
});
test('generic heads keep authority when role modifiers are present', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['project', 'manager'],
        usefulFoldedTokens: ['project', 'manager'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleTokens, ['project', 'manager']);
    assert.deepEqual(result.roleHeadTokens, ['manager']);
    assert.deepEqual(result.authoritativeRoleHeadTokens, ['manager']);
    assert.equal(result.roleHeadRequiresContext, true);
    assert.equal(result.roleHeadHasContext, true);
    assert.deepEqual(result.occupationClassPreference.preferredFamilyGroups, ['executive']);
    assert.deepEqual(result.occupationClassPreference.disfavoredFamilyGroups, ['professional']);
});
test('non-management heads do not add a family-group preference', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['compliance', 'auditor'],
        usefulFoldedTokens: ['compliance', 'auditor'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.occupationClassPreference.preferredFamilyGroups, []);
    assert.deepEqual(result.occupationClassPreference.disfavoredFamilyGroups, []);
});
test('Hungarian managerial heads mark an executive family-group preference', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'hu',
        foldedTokens: ['projekt', 'menedzser'],
        usefulFoldedTokens: ['projekt', 'menedzser'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.occupationClassPreference.preferredFamilyGroups, ['executive']);
});
test('compound non-management role expansions do not add a family-group preference', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'et',
        foldedTokens: ['tarkvaraarendaja'],
        usefulFoldedTokens: ['tarkvaraarendaja'],
        roleExpansionFoldedTokens: ['tarkvara', 'arendaja'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.occupationClassPreference.preferredFamilyGroups, []);
    assert.deepEqual(result.occupationClassPreference.disfavoredFamilyGroups, []);
});
test('occupation class hints ignore inherited property names', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'en',
        foldedTokens: ['constructor'],
        usefulFoldedTokens: ['constructor'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.occupationClassPreference.preferredFamilyGroups, []);
    assert.deepEqual(result.occupationClassPreference.disfavoredFamilyGroups, []);
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
    const customVocab = {
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
        locale: 'custom',
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
test('role phrases protect non-dictionary phrase members before token filtering', () => {
    const customVocab = {
        localeProfiles: [
            {
                localeCode: 'custom',
                roleHeadTerms: ['architect'],
                roleModifierTerms: [],
                domainModifierTerms: [],
                credentialModifierTerms: [],
                ambiguousModifierTerms: [],
                rolePhrases: ['solution architect'],
                domainPhrases: []
            }
        ]
    };
    const result = classifyOccupationQueryIntent({
        locale: 'custom',
        foldedTokens: ['solution', 'architect'],
        usefulFoldedTokens: ['architect'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: [],
        vocabulary: customVocab
    });
    assert.deepEqual(result.roleTokens, ['solution', 'architect']);
    assert.ok(result.diagnostics.some((d) => d.token === 'solution' && d.kind === 'role_modifier'));
});
test('domain phrases classify protected members as domain modifiers', () => {
    const customVocab = {
        localeProfiles: [
            {
                localeCode: 'custom',
                roleHeadTerms: ['auditor'],
                roleModifierTerms: ['compliance'],
                domainModifierTerms: [],
                credentialModifierTerms: [],
                ambiguousModifierTerms: [],
                rolePhrases: [],
                domainPhrases: ['civil aviation']
            }
        ]
    };
    const result = classifyOccupationQueryIntent({
        locale: 'custom',
        foldedTokens: ['civil', 'aviation', 'compliance', 'auditor'],
        usefulFoldedTokens: ['compliance', 'auditor'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: [],
        vocabulary: customVocab
    });
    assert.deepEqual(result.domainTokens, ['civil', 'aviation']);
    assert.deepEqual(result.roleTokens, ['compliance', 'auditor']);
    assert.ok(result.diagnostics.some((d) => d.token === 'civil' && d.kind === 'domain_modifier'));
    assert.ok(result.diagnostics.some((d) => d.token === 'aviation' && d.kind === 'domain_modifier'));
});
test('BUILTIN_INTENT_VOCABULARY exposes expected locale profiles', () => {
    assert.ok(Array.isArray(BUILTIN_INTENT_VOCABULARY.localeProfiles));
    assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'en'));
    assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'ro'));
    assert.ok(BUILTIN_INTENT_VOCABULARY.localeProfiles.some((p) => p.localeCode === 'unknown'));
});
test('built-in intent vocabulary stores terms in one normalized token form without duplicates', () => {
    const fields = [
        'roleHeadTerms',
        'roleModifierTerms',
        'domainModifierTerms',
        'credentialModifierTerms',
        'ambiguousModifierTerms'
    ];
    for (const profile of BUILTIN_INTENT_VOCABULARY.localeProfiles) {
        for (const field of fields) {
            const values = profile[field];
            assert.equal(values.length, new Set(values).size, `expected no duplicate stored terms for ${profile.localeCode}.${field}`);
            for (const value of values) {
                assert.equal(value, value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim());
            }
        }
    }
});
test('built-in venue context sets store one normalized token form without duplicates', () => {
    for (const [localeCode, values] of Object.entries(BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE)) {
        const stored = Array.from(values);
        assert.equal(stored.length, values.size, `expected no duplicate stored venue terms for ${localeCode}`);
        for (const value of stored) {
            assert.equal(value, value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim());
        }
    }
});
test('built-in locale domain vocab keeps core parity for non-English locales', () => {
    const expectedDomainTerms = {
        ro: ['aviatie', 'bancar', 'educatie', 'logistica', 'telecom', 'transport'],
        hu: ['banki', 'logisztika', 'oktatas', 'telekom', 'szallitasi'],
        et: ['haridus', 'logistika', 'pangandus', 'telekom', 'toostus', 'transport']
    };
    for (const [localeCode, terms] of Object.entries(expectedDomainTerms)) {
        const profile = builtinProfile(localeCode);
        const normalizedTerms = new Set(profile.domainModifierTerms.map((term) => term.normalize('NFKD').replace(/\p{M}/gu, '')));
        for (const term of terms) {
            assert.ok(normalizedTerms.has(term), `expected ${localeCode} domain intent parity term ${term}`);
        }
    }
});
test('built-in locale venue vocab keeps core parity for non-English locales', () => {
    const expectedVenueTerms = {
        ro: ['aeroport', 'clinica', 'depozit', 'fabrica', 'hotel', 'restaurant', 'scoala', 'spital'],
        hu: ['etterem', 'gyar', 'hotel', 'iroda', 'iskola', 'klinika', 'korhaz', 'raktar', 'repuloter'],
        et: ['haigla', 'hotell', 'kliinik', 'kontor', 'kool', 'ladu', 'lennujaam', 'restoran', 'tehas']
    };
    for (const [localeCode, terms] of Object.entries(expectedVenueTerms)) {
        const normalizedTerms = new Set(Array.from(BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE[localeCode]).map((term) => term.normalize('NFKD').replace(/\p{M}/gu, '')));
        for (const term of terms) {
            assert.ok(normalizedTerms.has(term), `expected ${localeCode} venue intent parity term ${term}`);
        }
    }
});
test('venue context stays separate from generic heads across locales', () => {
    const cases = [
        { locale: 'en', tokens: ['airport', 'manager'], venue: 'airport', head: 'manager' },
        { locale: 'ro', tokens: ['aeroport', 'manager'], venue: 'aeroport', head: 'manager' },
        { locale: 'hu', tokens: ['repülőtér', 'menedzser'], venue: 'repülőtér', head: 'menedzser' },
        { locale: 'et', tokens: ['lennujaam', 'juht'], venue: 'lennujaam', head: 'juht' }
    ];
    for (const scenario of cases) {
        const result = classifyOccupationQueryIntent({
            locale: scenario.locale,
            foldedTokens: [...scenario.tokens],
            usefulFoldedTokens: [...scenario.tokens],
            stopTokens: [],
            noiseTokens: [],
            modifierTokens: []
        });
        assert.deepEqual(result.venueTokens, [scenario.venue], `expected venue token for ${scenario.locale}`);
        assert.deepEqual(result.roleHeadTokens, [scenario.head], `expected role head for ${scenario.locale}`);
        assert.deepEqual(result.authoritativeRoleHeadTokens, [scenario.head], `expected authoritative role head for ${scenario.locale}`);
        assert.equal(result.roleHeadRequiresContext, true, `expected generic-head context gate for ${scenario.locale}`);
        assert.equal(result.roleHeadHasContext, true, `expected generic-head context satisfaction for ${scenario.locale}`);
    }
});
test('domain context stays separate from generic heads across locales', () => {
    const cases = [
        { locale: 'en', tokens: ['banking', 'manager'], domain: 'banking', head: 'manager' },
        { locale: 'ro', tokens: ['bancar', 'manager'], domain: 'bancar', head: 'manager' },
        { locale: 'hu', tokens: ['banki', 'menedzser'], domain: 'banki', head: 'menedzser' },
        { locale: 'et', tokens: ['pangandus', 'juht'], domain: 'pangandus', head: 'juht' }
    ];
    for (const scenario of cases) {
        const result = classifyOccupationQueryIntent({
            locale: scenario.locale,
            foldedTokens: [...scenario.tokens],
            usefulFoldedTokens: [...scenario.tokens],
            stopTokens: [],
            noiseTokens: [],
            modifierTokens: []
        });
        assert.deepEqual(result.domainTokens, [scenario.domain], `expected domain token for ${scenario.locale}`);
        assert.deepEqual(result.roleHeadTokens, [scenario.head], `expected role head for ${scenario.locale}`);
        assert.deepEqual(result.authoritativeRoleHeadTokens, [scenario.head], `expected authoritative role head for ${scenario.locale}`);
        assert.equal(result.roleHeadRequiresContext, true, `expected generic-head context gate for ${scenario.locale}`);
        assert.equal(result.roleHeadHasContext, true, `expected generic-head context satisfaction for ${scenario.locale}`);
    }
});
