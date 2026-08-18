import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityFitRanker } from '../../src/search-pipeline/ranking/capability-fit-ranker.js';
const ranker = new CapabilityFitRanker();
test('capability fit uses verb-shaped query variants for cleaner-style titles', () => {
    const preparedQuery = {
        raw: 'Cleaner',
        locale: 'en',
        normalized: 'cleaner',
        folded: 'cleaner',
        surfaceTokens: ['Cleaner'],
        tokens: ['cleaner'],
        foldedTokens: ['cleaner'],
        usefulTokens: ['cleaner'],
        usefulFoldedTokens: ['cleaner'],
        expandedTokens: ['cleaner'],
        expandedFoldedTokens: ['cleaning'],
        capabilityVerbFoldedTokens: ['cleaning'],
        genericTokens: [],
        stopTokens: [],
        noiseTokens: [],
        modifierTokens: [],
        acronymTokens: [],
        compoundSplitTokens: [],
        compoundSplitFoldedTokens: [],
        intent: {
            roleTokens: ['cleaner'],
            roleHeadTokens: ['cleaner'],
            genericRoleHeadTokens: [],
            authoritativeRoleHeadTokens: ['cleaner'],
            occupationClassPreference: {
                preferredFamilyGroups: [],
                disfavoredFamilyGroups: []
            },
            roleHeadRequiresContext: false,
            roleHeadHasContext: false,
            venueTokens: [],
            domainTokens: [],
            seniorityTokens: [],
            credentialTokens: [],
            ambiguousTokens: [],
            unresolvedModifierTokens: [],
            confidence: 0.9,
            diagnostics: []
        },
        commonRolePhraseMatch: null,
        familyAliasMatch: null,
        isGenericShape: false,
        familyScopedTokens: ['cleaner'],
        familyScopedFoldedTokens: ['cleaner']
    };
    const fit = ranker.rank({
        preparedQuery,
        capabilityLabels: ['cleaning']
    });
    assert.equal(fit.tier, 'strong');
    assert.equal(fit.coverage, 1);
    assert.deepEqual(fit.matchedCapabilityTerms, ['cleaning']);
    assert.deepEqual(fit.missingCapabilityTerms, []);
});
