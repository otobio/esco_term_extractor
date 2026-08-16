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
test('Romanian common job titles classify role heads and modifiers cleanly', () => {
    const scenarios = [
        {
            tokens: ['secretara', 'medicala'],
            roleHeadTokens: ['secretara'],
            roleTokens: ['secretara', 'medicala'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['asistenta', 'medicala'],
            roleHeadTokens: ['asistenta'],
            roleTokens: ['asistenta', 'medicala'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['agent', 'vanzari'],
            roleHeadTokens: ['agent'],
            roleTokens: ['agent', 'vanzari'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['consilier', 'vanzari'],
            roleHeadTokens: ['consilier'],
            roleTokens: ['consilier', 'vanzari'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['receptioner', 'hotel'],
            roleHeadTokens: ['receptioner'],
            roleTokens: ['receptioner'],
            venueTokens: ['hotel'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['operator', 'depozit'],
            roleHeadTokens: ['operator'],
            roleTokens: ['operator'],
            venueTokens: ['depozit'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['curier'],
            roleHeadTokens: ['curier'],
            roleTokens: ['curier'],
            unresolvedModifierTokens: []
        },
        {
            tokens: ['casier'],
            roleHeadTokens: ['casier'],
            roleTokens: ['casier'],
            unresolvedModifierTokens: []
        }
    ];
    for (const scenario of scenarios) {
        const result = classifyOccupationQueryIntent({
            locale: 'ro',
            foldedTokens: [...scenario.tokens],
            usefulFoldedTokens: [...scenario.tokens],
            stopTokens: [],
            noiseTokens: [],
            modifierTokens: []
        });
        assert.deepEqual(result.roleHeadTokens, [...scenario.roleHeadTokens], `expected role head for ${scenario.tokens.join(' ')}`);
        assert.deepEqual(result.roleTokens, [...scenario.roleTokens], `expected role tokens for ${scenario.tokens.join(' ')}`);
        assert.deepEqual(result.unresolvedModifierTokens, [...scenario.unresolvedModifierTokens], `expected unresolved tokens for ${scenario.tokens.join(' ')}`);
        if ('venueTokens' in scenario) {
            assert.deepEqual(result.venueTokens, [...scenario.venueTokens], `expected venue tokens for ${scenario.tokens.join(' ')}`);
        }
    }
});
test('Romanian structural fallback prefers an occupation-shaped noun over an adjectival modifier', () => {
    const result = classifyOccupationQueryIntent({
        locale: 'ro',
        foldedTokens: ['consultant', 'financiar'],
        usefulFoldedTokens: ['consultant', 'financiar'],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: []
    });
    assert.deepEqual(result.roleHeadTokens, ['consultant']);
    assert.deepEqual(result.roleTokens, ['consultant', 'financiar']);
    assert.deepEqual(result.unresolvedModifierTokens, []);
    assert.ok(result.diagnostics.some((d) => d.kind === 'role_head' && d.token === 'consultant'));
    assert.ok(result.diagnostics.some((d) => d.kind === 'role_modifier' && d.token === 'financiar'));
});
test('Romanian refactor coverage handles common role-head and non-role phrases correctly', () => {
    const scenarios = [
        {
            label: 'medic',
            foldedTokens: ['medic'],
            stopTokens: [],
            roleHeadTokens: ['medic'],
            roleTokens: ['medic'],
            unresolvedModifierTokens: []
        },
        {
            label: 'medic stomatolog',
            foldedTokens: ['medic', 'stomatolog'],
            stopTokens: [],
            roleHeadTokens: ['medic'],
            roleTokens: ['medic', 'stomatolog'],
            unresolvedModifierTokens: []
        },
        {
            label: 'medic pentru copii',
            foldedTokens: ['medic', 'pentru', 'copii'],
            stopTokens: ['pentru'],
            roleHeadTokens: ['medic'],
            roleTokens: ['medic', 'copii'],
            unresolvedModifierTokens: []
        },
        {
            label: 'profesor matematica',
            foldedTokens: ['profesor', 'matematica'],
            stopTokens: [],
            roleHeadTokens: ['profesor'],
            roleTokens: ['profesor', 'matematica'],
            unresolvedModifierTokens: []
        },
        {
            label: 'consultant financiar',
            foldedTokens: ['consultant', 'financiar'],
            stopTokens: [],
            roleHeadTokens: ['consultant'],
            roleTokens: ['consultant', 'financiar'],
            unresolvedModifierTokens: []
        },
        {
            label: 'specialist securitate',
            foldedTokens: ['specialist', 'securitate'],
            stopTokens: [],
            roleHeadTokens: ['specialist'],
            roleTokens: ['specialist', 'securitate'],
            unresolvedModifierTokens: []
        },
        {
            label: 'programator software',
            foldedTokens: ['programator', 'software'],
            stopTokens: [],
            roleHeadTokens: ['programator'],
            roleTokens: ['programator', 'software'],
            unresolvedModifierTokens: []
        },
        {
            label: 'operator depozit',
            foldedTokens: ['operator', 'depozit'],
            stopTokens: [],
            roleHeadTokens: ['operator'],
            roleTokens: ['operator'],
            venueTokens: ['depozit'],
            unresolvedModifierTokens: []
        },
        {
            label: 'restaurant italian',
            foldedTokens: ['restaurant', 'italian'],
            stopTokens: [],
            roleHeadTokens: [],
            roleTokens: [],
            venueTokens: ['restaurant'],
            unresolvedModifierTokens: ['italian']
        },
        {
            label: 'client restaurant',
            foldedTokens: ['client', 'restaurant'],
            stopTokens: [],
            roleHeadTokens: [],
            roleTokens: [],
            venueTokens: ['restaurant'],
            unresolvedModifierTokens: ['client']
        },
        {
            label: 'student',
            foldedTokens: ['student'],
            stopTokens: [],
            roleHeadTokens: [],
            roleTokens: [],
            unresolvedModifierTokens: ['student']
        },
        {
            label: 'pacient',
            foldedTokens: ['pacient'],
            stopTokens: [],
            roleHeadTokens: [],
            roleTokens: [],
            unresolvedModifierTokens: ['pacient']
        },
        {
            label: 'manager',
            foldedTokens: ['manager'],
            stopTokens: [],
            roleHeadTokens: ['manager'],
            roleTokens: ['manager'],
            unresolvedModifierTokens: []
        },
        {
            label: 'manager financiar',
            foldedTokens: ['manager', 'financiar'],
            stopTokens: [],
            roleHeadTokens: ['manager'],
            roleTokens: ['manager', 'financiar'],
            unresolvedModifierTokens: []
        },
        {
            label: 'sef productie',
            foldedTokens: ['sef', 'productie'],
            stopTokens: [],
            roleHeadTokens: ['sef'],
            roleTokens: ['sef', 'productie'],
            unresolvedModifierTokens: []
        },
        {
            label: 'electrician',
            foldedTokens: ['electrician'],
            stopTokens: [],
            roleHeadTokens: ['electrician'],
            roleTokens: ['electrician'],
            unresolvedModifierTokens: []
        },
        {
            label: 'electrician industrial',
            foldedTokens: ['electrician', 'industrial'],
            stopTokens: [],
            roleHeadTokens: ['electrician'],
            roleTokens: ['electrician', 'industrial'],
            unresolvedModifierTokens: []
        }
    ];
    for (const scenario of scenarios) {
        const result = classifyOccupationQueryIntent({
            locale: 'ro',
            foldedTokens: [...scenario.foldedTokens],
            usefulFoldedTokens: [...scenario.foldedTokens],
            stopTokens: [...scenario.stopTokens],
            noiseTokens: [],
            modifierTokens: []
        });
        assert.deepEqual(result.roleHeadTokens, [...scenario.roleHeadTokens], `expected role head for ${scenario.label}`);
        assert.deepEqual(result.roleTokens, [...scenario.roleTokens], `expected role tokens for ${scenario.label}`);
        assert.deepEqual(result.unresolvedModifierTokens, [...scenario.unresolvedModifierTokens], `expected unresolved tokens for ${scenario.label}`);
        if ('venueTokens' in scenario) {
            assert.deepEqual(result.venueTokens, [...scenario.venueTokens], `expected venue tokens for ${scenario.label}`);
        }
    }
});
test('Romanian structural role heuristics improve grouped standalone and technical-tail cases', () => {
    const scenarios = [
        {
            label: 'standalone occupation-shaped nouns',
            foldedTokens: ['stivuitorist'],
            stopTokens: [],
            roleHeadTokens: ['stivuitorist'],
            roleTokens: ['stivuitorist'],
            unresolvedModifierTokens: [],
            minConfidence: 0.68,
            roleHeadReasonIncludes: 'Romanian structural score'
        },
        {
            label: 'construction venue with rehabilitation network tail',
            foldedTokens: ['sef', 'santier', 'reabilitare', 'retele', 'termice'],
            stopTokens: [],
            roleHeadTokens: ['sef'],
            roleTokens: ['sef', 'reabilitare', 'retele', 'termice'],
            venueTokens: ['santier'],
            unresolvedModifierTokens: [],
            minConfidence: 0.4
        },
        {
            label: 'industrial venue with material tail',
            foldedTokens: ['laborant', 'fabrica', 'caramida'],
            stopTokens: [],
            roleHeadTokens: ['laborant'],
            roleTokens: ['laborant', 'caramida'],
            venueTokens: ['fabrica'],
            unresolvedModifierTokens: [],
            minConfidence: 0.7
        },
        {
            label: 'existing maintenance phrase stays intact',
            foldedTokens: ['electrician', 'intretinere', 'reparatii'],
            stopTokens: [],
            roleHeadTokens: ['electrician'],
            roleTokens: ['electrician', 'intretinere', 'reparatii'],
            unresolvedModifierTokens: [],
            minConfidence: 0.8
        }
    ];
    for (const scenario of scenarios) {
        const result = classifyOccupationQueryIntent({
            locale: 'ro',
            foldedTokens: [...scenario.foldedTokens],
            usefulFoldedTokens: [...scenario.foldedTokens],
            stopTokens: [...scenario.stopTokens],
            noiseTokens: [],
            modifierTokens: []
        });
        assert.deepEqual(result.roleHeadTokens, [...scenario.roleHeadTokens], `expected role head for ${scenario.label}`);
        assert.deepEqual(result.roleTokens, [...scenario.roleTokens], `expected role tokens for ${scenario.label}`);
        assert.deepEqual(result.unresolvedModifierTokens, [...scenario.unresolvedModifierTokens], `expected unresolved tokens for ${scenario.label}`);
        assert.ok(result.confidence >= scenario.minConfidence, `expected confidence >= ${scenario.minConfidence} for ${scenario.label}`);
        if ('venueTokens' in scenario) {
            assert.deepEqual(result.venueTokens, [...scenario.venueTokens], `expected venue tokens for ${scenario.label}`);
        }
        if ('roleHeadReasonIncludes' in scenario) {
            assert.ok(result.diagnostics.some((entry) => entry.kind === 'role_head' && entry.reason.includes(scenario.roleHeadReasonIncludes)), `expected role-head reason containing "${scenario.roleHeadReasonIncludes}" for ${scenario.label}`);
        }
    }
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
