import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOccupationNoisePeelingProfile, extractOccupationTitleChunks, getOccupationNoisePeelingProfile, normalizeSearchText, peelOccupationTitleNoise, peelOccupationTitleNoiseWithProfile } from '../../query/occupation-noise-peeling.js';
test('normalizeSearchText correctly folds diacritics, lowercases, and strips punctuation', () => {
    assert.equal(normalizeSearchText('Şofer cat. C / C+E (București)'), 'sofer cat c c e bucuresti');
    assert.equal(normalizeSearchText('  Műszaki---Vezető!!! '), 'muszaki vezeto');
    assert.equal(normalizeSearchText(''), '');
});
test('extractOccupationTitleChunks splits parentheticals and delimited title sections', () => {
    const chunks = extractOccupationTitleChunks('Inginer SRL / Proiectant [Full-Time] (Bucuresti)');
    assert.deepEqual(chunks, [
        { surface: 'Inginer SRL', origin: 'lead', isBracket: false },
        { surface: 'Proiectant', origin: 'trail', isBracket: false },
        { surface: 'Full-Time', origin: 'trail', isBracket: true },
        { surface: 'Bucuresti', origin: 'trail', isBracket: true }
    ]);
});
test('extractOccupationTitleChunks handles title with only brackets', () => {
    const chunks = extractOccupationTitleChunks('(Munkatars) [Budapest]');
    assert.deepEqual(chunks, [
        { surface: 'Munkatars', origin: 'trail', isBracket: true },
        { surface: 'Budapest', origin: 'trail', isBracket: true }
    ]);
});
test('extractOccupationTitleChunks handles whitespace and empty input', () => {
    assert.deepEqual(extractOccupationTitleChunks(''), []);
    assert.deepEqual(extractOccupationTitleChunks('   '), []);
});
test('locale handling: supported locales (ro, hu) vs unsupported locales', () => {
    const roResult = peelOccupationTitleNoise('Inginer Mecanic', 'ro');
    assert.equal(roResult.supportedLocale, true);
    assert.equal(roResult.locale, 'ro');
    const roCaseResult = peelOccupationTitleNoise('Inginer Mecanic', ' RO ');
    assert.equal(roCaseResult.supportedLocale, true);
    assert.equal(roCaseResult.locale, 'ro');
    const huResult = peelOccupationTitleNoise('Műszaki Rajzoló', 'hu');
    assert.equal(huResult.supportedLocale, true);
    assert.equal(huResult.locale, 'hu');
    const enResult = peelOccupationTitleNoise('Software Engineer', 'en');
    assert.equal(enResult.supportedLocale, false);
    assert.equal(enResult.locale, 'en');
    assert.equal(enResult.peeledTitle, 'Software Engineer');
    const emptyResult = peelOccupationTitleNoise('Software Engineer', '');
    assert.equal(emptyResult.supportedLocale, false);
    assert.equal(emptyResult.peeledTitle, 'Software Engineer');
});
test('profile lookup returns profile for supported locales and null for unsupported', () => {
    assert.ok(getOccupationNoisePeelingProfile('ro') !== null);
    assert.ok(getOccupationNoisePeelingProfile('hu') !== null);
    assert.equal(getOccupationNoisePeelingProfile('en'), null);
    assert.equal(getOccupationNoisePeelingProfile(undefined), null);
});
test('peels noise_ui_artifact in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Hiring / Inginer Constructor', 'ro');
    assert.equal(roRes.peeledTitle, 'Inginer Constructor');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_ui_artifact'));
    const huRes = peelOccupationTitleNoise('Szures / Villanyszerelő', 'hu');
    assert.equal(huRes.peeledTitle, 'Villanyszerelő');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_ui_artifact'));
});
test('peels noise_employment_flag in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Contabil / full time', 'ro');
    assert.equal(roRes.peeledTitle, 'Contabil');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));
    const roFixedTermRes = peelOccupationTitleNoise('Stivuitorist / perioada determinata', 'ro');
    assert.equal(roFixedTermRes.peeledTitle, 'Stivuitorist');
    assert.ok(roFixedTermRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));
    const huRes = peelOccupationTitleNoise('Eladó / teljes munkaido', 'hu');
    assert.equal(huRes.peeledTitle, 'Eladó');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));
});
test('peels noise_shift in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Operator productie / 2 schimburi', 'ro');
    assert.equal(roRes.peeledTitle, 'Operator productie');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_shift'));
    const huRes = peelOccupationTitleNoise('Gépkezelő / 3 schimburi', 'hu');
    assert.equal(huRes.peeledTitle, 'Gépkezelő');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_shift'));
});
test('peels noise_date in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Asistent medical / Start date Ianuarie', 'ro');
    assert.equal(roRes.peeledTitle, 'Asistent medical');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_date'));
    const huRes = peelOccupationTitleNoise('Könyvelő / Marcius', 'hu');
    assert.equal(huRes.peeledTitle, 'Könyvelő');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_date'));
});
test('peels noise_salary in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Șofer / RON', 'ro');
    assert.equal(roRes.peeledTitle, 'Șofer');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_salary'));
    const huRes = peelOccupationTitleNoise('Raktáros / HUF', 'hu');
    assert.equal(huRes.peeledTitle, 'Raktáros');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_salary'));
});
test('peels noise_identifier in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Mecanic auto / REF12345', 'ro');
    assert.equal(roRes.peeledTitle, 'Mecanic auto');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_identifier'));
    const huRes = peelOccupationTitleNoise('Szakács / WHC9999', 'hu');
    assert.equal(huRes.peeledTitle, 'Szakács');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_identifier'));
});
test('peels noise_application_cta in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Cautam / Electrician naval', 'ro');
    assert.equal(roRes.peeledTitle, 'Electrician naval');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_application_cta'));
    const huRes = peelOccupationTitleNoise('Jelentkezz / Adminisztratív munkatárs', 'hu');
    assert.equal(huRes.peeledTitle, 'Adminisztratív munkatárs');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_application_cta'));
});
test('peels noise_language in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Analist financiar / with English', 'ro');
    assert.equal(roRes.peeledTitle, 'Analist financiar');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_language'));
    const huRes = peelOccupationTitleNoise('IT Support / German required', 'hu');
    assert.equal(huRes.peeledTitle, 'IT Support');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_language'));
});
test('peels noise_location in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Inginer automatizari / Bucuresti', 'ro');
    assert.equal(roRes.peeledTitle, 'Inginer automatizari');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_location'));
    const huRes = peelOccupationTitleNoise('Szoftverfejlesztő / Budapest', 'hu');
    assert.equal(huRes.peeledTitle, 'Szoftverfejlesztő');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_location'));
});
test('peels noise_employer_brand in ro and hu', () => {
    const roRes = peelOccupationTitleNoise('Sofer livrator / Bringo', 'ro');
    assert.equal(roRes.peeledTitle, 'Sofer livrator');
    assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_employer_brand'));
    const huRes = peelOccupationTitleNoise('Munkatárs / Pizza Hut', 'hu');
    assert.equal(huRes.peeledTitle, 'Munkatárs');
    assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_employer_brand'));
});
test('peels noise_parenthetical_info from brackets', () => {
    const roRes = peelOccupationTitleNoise('Proiectant (m/f) [Full-Time]', 'ro');
    assert.equal(roRes.peeledTitle, 'Proiectant');
    assert.equal(roRes.noiseChunks.length, 2);
    assert.ok(roRes.noiseChunks.every((c) => c.kind === 'noise_parenthetical_info'));
});
test('inline mixed surface noise peeling strips noise tokens without delimiters', () => {
    const ctaRes = peelOccupationTitleNoise('Cautam Electrician naval', 'ro');
    assert.equal(ctaRes.peeledTitle, 'Electrician naval');
    const brandRes = peelOccupationTitleNoise('Sofer livrator Pizza Hut', 'ro');
    assert.equal(brandRes.peeledTitle, 'Sofer livrator');
    const locationRes = peelOccupationTitleNoise('Inginer automatizari Bucuresti', 'ro');
    assert.equal(locationRes.peeledTitle, 'Inginer automatizari');
});
test('language teacher guardrail: English teacher is NOT peeled as noise_language', () => {
    const roRes = peelOccupationTitleNoise('English teacher', 'ro');
    assert.equal(roRes.peeledTitle, 'English teacher');
    assert.ok(!roRes.noiseChunks.some((c) => c.kind === 'noise_language'));
    const huRes = peelOccupationTitleNoise('German teacher', 'hu');
    assert.equal(huRes.peeledTitle, 'German teacher');
    assert.ok(!huRes.noiseChunks.some((c) => c.kind === 'noise_language'));
});
test('address context guardrail: number in address context is not peeled as noise_date', () => {
    const roRes = peelOccupationTitleNoise('Bucatar / Sector 12', 'ro');
    assert.ok(!roRes.noiseChunks.some((c) => c.kind === 'noise_date'));
    const roNrRes = peelOccupationTitleNoise('Bucatar / Nr 12', 'ro');
    assert.ok(!roNrRes.noiseChunks.some((c) => c.kind === 'noise_date'));
});
test('shift chunk containing core occupation token preserves occupation token', () => {
    const res = peelOccupationTitleNoise('Operator 8 ore', 'ro');
    assert.equal(res.peeledTitle, 'Operator 8 ore');
    assert.equal(res.noiseChunks.length, 0);
});
test('custom profile building and peeling with profile', () => {
    const customProfile = buildOccupationNoisePeelingProfile({
        locale: 'custom_test',
        noiseRules: [
            {
                kind: 'noise_ui_artifact',
                matchType: 'phrase',
                confidence: 0.99,
                terms: ['custom_noise']
            }
        ],
        occupationExemptions: ['engineer'],
        locationHints: ['custom_city'],
        locationContextMarkers: ['zone'],
        locationSuffixHints: ['street']
    });
    const res = peelOccupationTitleNoiseWithProfile('Engineer / custom_noise', customProfile);
    assert.equal(res.peeledTitle, 'Engineer');
    assert.equal(res.noiseChunks.length, 1);
    assert.equal(res.noiseChunks[0]?.kind, 'noise_ui_artifact');
});
