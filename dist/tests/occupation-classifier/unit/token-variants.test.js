import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandLocaleTokenVariants, expandLocaleTokenVariantArray, tokenMatchesLocaleVariant, reconstructCompoundExpandedSurface, splitCompoundTokensWithArtifact } from '../../../src/query/token-variants.js';
// Characterization tests for the pure token-variant rules. Every expected value below was captured
// from the implementation as it stands, so that allocation and memory work on this module cannot
// silently change retrieval matching. Some pinned values are linguistically wrong -- see
// KNOWN_QUIRK_CASES at the bottom. They are recorded on purpose; changing any of them is a
// deliberate behaviour change, not a refactor.
//
// To extend: add a row to the relevant table. No new test blocks are needed.
// The curated-list locales (en, ro, et, unknown) never read the artifact, so the pure splitting path
// runs without loading one.
const NO_ARTIFACT = null;
const EXPANSION_CASES = {
    en: [
        ['it', ['it'], 'below min length'],
        ['ai', ['ai'], 'two letters'],
        ['cnc', ['cnc', 'cncs'], 'lowercase three'],
        ['HVAC', ['HVAC'], 'visible acronym'],
        ['CNC', ['CNC'], 'visible acronym three'],
        ['IT', ['IT'], 'short acronym'],
        ['companies', ['companies', 'company'], 'ies plural'],
        ['ies', ['ies', 'iess'], 'ies below guard'],
        ['policies', ['policies', 'policy'], 'ies plural'],
        ['drivers', ['drivers', 'driver'], 's plural'],
        ['bus', ['bus', 'buss'], 's at min length'],
        ['boss', ['boss', 'bosss'], 'ss guard'],
        ['glass', ['glass', 'glasss'], 'ss guard longer'],
        ['company', ['company', 'companies'], 'y singular'],
        ['day', ['day', 'days'], 'y at min length'],
        ['manager', ['manager', 'managor'], 'er to or'],
        ['her', ['her', 'hers'], 'er at min length'],
        ['doctor', ['doctor', 'docter'], 'or to er'],
        ['or', ['or'], 'or below guard'],
        ['chef', ['chef', 'chefs'], 'default plural'],
        ['nurse', ['nurse', 'nurses'], 'default plural'],
        ['welder', ['welder', 'weldor'], 'er to or'],
        ['operator', ['operator', 'operater'], 'or to er'],
        ['analysis', ['analysis', 'analysi'], 's plural'],
        ['', [''], 'empty token'],
        ['aries', ['aries', 'ary'], 'ies guard at length five'],
        ['ties', ['ties', 'tie'], 'ies guard below length five'],
        ['abs', ['abs', 'abss'], 's guard at length three'],
        ['cabs', ['cabs', 'cab'], 's guard above length three'],
        ['sky', ['sky', 'skys'], 'y guard at length three'],
        ['ruby', ['ruby', 'rubies'], 'y guard above length three'],
        ['per', ['per', 'pers'], 'er guard at length three'],
        ['peer', ['peer', 'peor'], 'er guard above length three'],
        ['for', ['for', 'fors'], 'or guard at length three'],
        ['door', ['door', 'doer'], 'or guard above length three']
    ],
    ro: [
        ['medic', ['medic', 'doctor', 'physician', 'medici'], 'map to english'],
        ['medici', ['medici', 'medic', 'doctor', 'physician'], 'map plural'],
        ['soferi', ['soferi', 'sofer', 'driver'], 'map with english'],
        ['șoferi', ['șoferi', 'șofer', 'driver'], 'map diacritic'],
        ['contabili', ['contabili', 'contabil'], 'map reduction'],
        ['contabila', ['contabila', 'contabil'], 'map feminine'],
        ['programatori', ['programatori', 'programator'], 'map reduction'],
        ['programatoare', ['programatoare', 'programator', 'programatoar'], 'map feminine'],
        ['vanzatori', ['vanzatori', 'vanzator'], 'map reduction'],
        ['vânzători', ['vânzători', 'vânzător'], 'map diacritic'],
        ['stivuitorist', ['stivuitorist', 'forklift', 'stivuitoristi'], 'map to english'],
        ['stivuitoriști', ['stivuitoriști', 'stivuitorist', 'forklift', 'stivuitorișt'], 'map diacritic plural'],
        ['registratori', ['registratori', 'registrator', 'records', 'registrar'], 'map multi value'],
        ['specialisti', ['specialisti', 'specialist'], 'map reduction'],
        ['specialiști', ['specialiști', 'specialist', 'specialișt'], 'map diacritic'],
        ['profesoară', ['profesoară', 'profesor', 'profesoar'], 'map diacritic feminine'],
        ['achizitor', ['achizitor', 'buyer', 'achizitori'], 'map to english only'],
        ['strungari', ['strungari', 'strungar', 'lathe'], 'map with english'],
        ['electricieni', ['electricieni', 'electrician', 'electricien'], 'map reduction'],
        ['tehnicieni', ['tehnicieni', 'tehnician', 'tehnicien'], 'map reduction'],
        ['abc', ['abc'], 'below min length'],
        ['sofa', ['sofa'], 'at min length'],
        ['ingineri', ['ingineri', 'inginer'], 'i plural'],
        ['casier', ['casier', 'casieri'], 'consonant adds i'],
        ['manager', ['manager', 'manageri'], 'consonant adds i'],
        ['asistente', ['asistente', 'asistent'], 'e ending'],
        ['patiserie', ['patiserie', 'patiseri', 'patiser'], 'rie trade noun'],
        ['brutarie', ['brutarie', 'brutari', 'brutar'], 'rie trade noun'],
        ['productie', ['productie', 'producti'], 'ie not stripped'],
        ['directoare', ['directoare', 'directoar', 'director'], 'oare to or'],
        ['directoarea', ['directoarea', 'directoare', 'director'], 'oarea to or'],
        ['muncitoare', ['muncitoare', 'muncitoar', 'muncitor'], 'toare to tor'],
        ['muncitoarea', ['muncitoarea', 'muncitoare', 'muncitor'], 'toarea to tor'],
        ['inspectori', ['inspectori', 'inspector'], 'ori ending'],
        ['masiniste', ['masiniste', 'masinist', 'masinistt'], 'iste to ist'],
        ['masinistei', ['masinistei', 'masiniste', 'masinistt'], 'istei to ist'],
        ['bucatara', ['bucatara', 'bucatar'], 'a ending'],
        ['bucătară', ['bucătară', 'bucătar'], 'a diacritic ending'],
        ['sudor', ['sudor', 'sudori'], 'consonant adds i'],
        ['sudori', ['sudori', 'sudor'], 'ori ending'],
        ['', [''], 'empty token'],
        ['somi', ['somi'], 'i guard at length four'],
        ['sonti', ['sonti', 'sont'], 'i guard above length four'],
        ['sone', ['sone'], 'e guard at length four'],
        ['sonte', ['sonte', 'sont'], 'e guard above length four'],
        ['sonta', ['sonta'], 'a guard at length five'],
        ['sontea', ['sontea', 'sonte'], 'a guard above length five'],
        ['sorie', ['sorie', 'sori'], 'rie guard at length five'],
        ['sonrie', ['sonrie', 'sonri', 'sonr'], 'rie guard above length five'],
        ['sontoare', ['sontoare', 'sontoar', 'sontor'], 'oare guard at length eight'],
        ['sonsori', ['sonsori', 'sonsor'], 'ori guard above length five'],
        ['sotori', ['sotori', 'sotor'], 'ori guard at length six']
    ],
    hu: [
        ['bolt', ['bolt'], 'below min length'],
        ['szak', ['szak'], 'at min length'],
        ['mernok', ['mernok', 'merno', 'mern'], 'k and ok both strip'],
        ['mernokok', ['mernokok', 'mernoko', 'mernok'], 'k and ok both strip'],
        ['vezetok', ['vezetok', 'vezeto', 'vezet'], 'k and ok both strip'],
        ['vezeto', ['vezeto', 'vezetok'], 'adds k'],
        ['szerelok', ['szerelok', 'szerelo', 'szerel'], 'k and ok both strip'],
        ['pincerek', ['pincerek', 'pincere', 'pincer'], 'k and ek both strip'],
        ['titkarok', ['titkarok', 'titkaro', 'titkar'], 'k and ok both strip'],
        ['könyvelő', ['könyvelő', 'könyvelők'], 'adds k'],
        ['könyvelők', ['könyvelők', 'könyvelő'], 'k reduction'],
        ['munkak', ['munkak', 'munka', 'munk'], 'k and ak both strip'],
        ['főnökök', ['főnökök', 'főnökö', 'főnök'], 'k and ok diacritic both strip'],
        ['orvos', ['orvos', 'orvosk'], 'adds k'],
        ['', [''], 'empty token'],
        ['sonk', ['sonk'], 'k guard at length four'],
        ['sontk', ['sontk', 'sont'], 'k guard above length four'],
        ['sonok', ['sonok', 'sono'], 'ok guard at length five'],
        ['sontok', ['sontok', 'sonto', 'sont'], 'ok guard above length five']
    ],
    et: [
        ['juht', ['juht'], 'below min length'],
        ['juhid', ['juhid', 'juhi'], 'below id guard strips d only'],
        ['insener', ['insener', 'insenerd'], 'adds d'],
        ['insenerid', ['insenerid', 'insener', 'inseneri'], 'id and d both strip'],
        ['arendaja', ['arendaja', 'arendajad'], 'adds d'],
        ['arendajad', ['arendajad', 'arendaja'], 'd strips'],
        ['opetaja', ['opetaja', 'opetajad'], 'adds d'],
        ['analuutik', ['analuutik', 'analuutikd'], 'adds d'],
        ['spetsialist', ['spetsialist', 'spetsialistd'], 'adds d'],
        ['tarkvara', ['tarkvara', 'tarkvarad'], 'adds d'],
        ['', [''], 'empty token'],
        ['sond', ['sond'], 'd guard at length four'],
        ['sontd', ['sontd', 'sont'], 'd guard above length four'],
        ['sonid', ['sonid', 'soni'], 'id guard at length five'],
        ['sontid', ['sontid', 'sont', 'sonti'], 'id guard above length five']
    ],
    unknown: [
        ['manager', ['manager'], 'no rules'],
        ['', [''], 'empty token'],
        ['a', ['a'], 'single char'],
        ['drivers', ['drivers'], 'no reduction'],
        ['ingineri', ['ingineri'], 'no reduction']
    ]
};
const MATCH_CASES = {
    en: [
        ['driver', ['driver'], true, 'identity'],
        ['drivers', ['driver'], true, 'forward reduction'],
        ['driver', ['drivers'], true, 'reverse reduction'],
        ['manager', ['managor'], true, 'er to or forward'],
        ['managor', ['manager'], true, 'or to er reverse'],
        ['companies', ['company'], true, 'ies reduction'],
        ['company', ['companies'], true, 'ies reverse'],
        ['boss', ['bos'], false, 'ss guard blocks'],
        ['driver', ['welder'], false, 'unrelated'],
        ['driver', [], false, 'empty values'],
        ['driver', ['welder', 'drivers', 'cook'], true, 'multi value set']
    ],
    ro: [
        ['dezvoltatoare', ['dezvoltator'], true, 'curated map forward'],
        ['dezvoltator', ['dezvoltatoare'], true, 'curated map reverse'],
        ['soferi', ['sofer'], true, 'map forward'],
        ['sofer', ['soferi'], true, 'map reverse'],
        ['ingineri', ['inginer'], true, 'i reduction forward'],
        ['inginer', ['ingineri'], true, 'i reduction reverse'],
        ['muncitoare', ['muncitor'], true, 'toare to tor'],
        ['medici', ['doctor'], true, 'map to english'],
        ['contabil', ['vanzator'], false, 'unrelated'],
        ['inginer', ['sudor', 'ingineri'], true, 'multi value set']
    ],
    hu: [
        ['mernokok', ['mernok'], true, 'ok reduction forward'],
        ['mernok', ['mernokok'], true, 'ok reduction reverse'],
        ['könyvelők', ['könyvelő'], true, 'k reduction diacritic'],
        ['könyvelő', ['könyvelők'], true, 'k reduction diacritic reverse'],
        ['mernok', ['orvos'], false, 'unrelated']
    ],
    et: [
        ['insenerid', ['insener'], true, 'id reduction forward'],
        ['insener', ['insenerid'], true, 'id reduction reverse'],
        ['juhid', ['juht'], false, 'id guard blocks short stem'],
        ['insener', ['arendaja'], false, 'unrelated']
    ],
    unknown: [
        ['drivers', ['driver'], false, 'no rules blocks reduction'],
        ['driver', ['driver'], true, 'identity still matches']
    ]
};
const ARRAY_CASES = {
    en: [
        [[], [], 'empty input'],
        [['driver'], ['driver', 'drivor'], 'single token'],
        [['drivers', 'driver'], ['drivers', 'driver', 'drivor'], 'overlapping variants deduped'],
        [['manager', 'doctor'], ['manager', 'managor', 'doctor', 'docter'], 'two tokens']
    ],
    ro: [
        [['soferi', 'medici'], ['soferi', 'sofer', 'driver', 'medici', 'medic', 'doctor', 'physician'], 'curated map tokens'],
        [['inginer', 'ingineri'], ['inginer', 'ingineri'], 'overlapping reduction']
    ],
    hu: [[['mernok', 'mernokok'], ['mernok', 'merno', 'mern', 'mernokok', 'mernoko'], 'overlapping plural']],
    et: [[['insener', 'insenerid'], ['insener', 'insenerd', 'insenerid', 'inseneri'], 'overlapping plural']],
    unknown: [[['manager', 'manager'], ['manager'], 'duplicates deduped']]
};
const SPLIT_CASES = {
    et: [
        [['tarkvaraarendaja'], ['tarkvara', 'arendaja'], 'software developer'],
        [['andmeanaluutik'], ['andme', 'analuutik'], 'data analyst'],
        [['tarkvarainsener'], ['tarkvara', 'insener'], 'software engineer'],
        [['tarkvara'], [], 'known part alone'],
        [['programmer'], [], 'unknown token'],
        [['juhid'], [], 'below min length'],
        [['tarkvaraarendaja', 'andmeanaluutik'], ['tarkvara', 'arendaja', 'andme', 'analuutik'], 'multiple tokens'],
        [[], [], 'empty input']
    ],
    en: [[['tarkvaraarendaja'], [], 'no curated parts']],
    ro: [[['tarkvaraarendaja'], [], 'no curated parts']],
    unknown: [[['tarkvaraarendaja'], [], 'no curated parts']]
};
const RECONSTRUCT_CASES = [
    [['autoszerelo'], null, null, 'null splits'],
    [['autoszerelo'], [[]], null, 'all empty splits'],
    [['autoszerelo'], [['auto', 'szerelo']], 'auto szerelo', 'single split token'],
    [['raktari', 'munkatars'], [[], ['munka', 'tars']], 'raktari munka tars', 'second token split'],
    [['raktari', 'munkatars'], [['rakt', 'ari'], []], 'rakt ari munkatars', 'first token split'],
    [['a', 'b', 'c'], [[], ['x', 'y'], []], 'a x y c', 'middle token split'],
    [[], [], null, 'empty tokens'],
    [['one', 'two'], [['a', 'b']], 'a b two', 'splits shorter than tokens']
];
function localeEntries(table) {
    return Object.entries(table);
}
for (const [locale, cases] of localeEntries(EXPANSION_CASES)) {
    for (const [token, expected, note] of cases) {
        test(`expandLocaleTokenVariants ${locale} ${note}: "${token}"`, () => {
            assert.deepEqual([...expandLocaleTokenVariants(token, locale)], [...expected]);
        });
    }
}
for (const [locale, cases] of localeEntries(MATCH_CASES)) {
    for (const [token, values, expected, note] of cases) {
        test(`tokenMatchesLocaleVariant ${locale} ${note}: "${token}"`, () => {
            assert.equal(tokenMatchesLocaleVariant(token, new Set(values), locale), expected);
        });
    }
}
for (const [locale, cases] of localeEntries(ARRAY_CASES)) {
    for (const [tokens, expected, note] of cases) {
        test(`expandLocaleTokenVariantArray ${locale} ${note}`, () => {
            assert.deepEqual(expandLocaleTokenVariantArray([...tokens], locale), [...expected]);
        });
    }
}
for (const [locale, cases] of localeEntries(SPLIT_CASES)) {
    for (const [tokens, expected, note] of cases) {
        test(`splitCompoundTokensWithArtifact ${locale} ${note}`, () => {
            assert.deepEqual(splitCompoundTokensWithArtifact([...tokens], locale, NO_ARTIFACT), [...expected]);
        });
    }
}
for (const [tokens, splits, expected, note] of RECONSTRUCT_CASES) {
    test(`reconstructCompoundExpandedSurface ${note}`, () => {
        assert.deepEqual(reconstructCompoundExpandedSurface([...tokens], splits), expected);
    });
}
// --- cache and returned-array contract ---
test('expandLocaleTokenVariants returns a frozen array', () => {
    assert.equal(Object.isFrozen(expandLocaleTokenVariants('driver', 'en')), true);
});
test('expandLocaleTokenVariants returns the same array instance on a cache hit', () => {
    assert.equal(expandLocaleTokenVariants('cache-identity-probe', 'en'), expandLocaleTokenVariants('cache-identity-probe', 'en'));
});
test('expandLocaleTokenVariants keys the cache by locale as well as token', () => {
    assert.notDeepEqual([...expandLocaleTokenVariants('muncitoare', 'ro')], [...expandLocaleTokenVariants('muncitoare', 'en')]);
});
test('expandLocaleTokenVariants always includes the input token first', () => {
    for (const locale of ['en', 'ro', 'hu', 'et', 'unknown']) {
        assert.equal(expandLocaleTokenVariants('inspector', locale)[0], 'inspector');
    }
});
test('expandLocaleTokenVariantArray returns a mutable array', () => {
    const variants = expandLocaleTokenVariantArray(['driver'], 'en');
    variants.push('appended');
    assert.equal(variants.includes('appended'), true);
});
test('expandLocaleTokenVariantArray is unaffected by mutating a previous result', () => {
    expandLocaleTokenVariantArray(['driver'], 'en').push('appended');
    assert.equal(expandLocaleTokenVariantArray(['driver'], 'en').includes('appended'), false);
});
test('tokenMatchesLocaleVariant is symmetric across argument order', () => {
    const pairs = [
        ['drivers', 'driver', 'en'],
        ['ingineri', 'inginer', 'ro'],
        ['mernokok', 'mernok', 'hu'],
        ['insenerid', 'insener', 'et']
    ];
    for (const [left, right, locale] of pairs) {
        assert.equal(tokenMatchesLocaleVariant(left, new Set([right]), locale), tokenMatchesLocaleVariant(right, new Set([left]), locale));
    }
});
// --- known quirks, pinned deliberately ---
// Each row is almost certainly a bug. They are asserted so an optimization pass cannot change them
// by accident; fixing them is separate, deliberate work.
const KNOWN_QUIRK_CASES = [
    ['doctor', ['doctor', 'docter'], 'en or-to-er flip produces a non-word'],
    ['operator', ['operator', 'operater'], 'en or-to-er flip produces a non-word'],
    ['boss', ['boss', 'bosss'], 'en ss guard falls through to a triple-s plural'],
    ['glass', ['glass', 'glasss'], 'en ss guard falls through to a triple-s plural'],
    ['analysis', ['analysis', 'analysi'], 'en strips a stem-final s from a non-plural noun']
];
for (const [token, expected, note] of KNOWN_QUIRK_CASES) {
    test(`known quirk: ${note}: "${token}"`, () => {
        assert.deepEqual([...expandLocaleTokenVariants(token, 'en')], [...expected]);
    });
}
const KNOWN_QUIRK_CASES_BY_LOCALE = {
    ro: [
        ['manager', ['manager', 'manageri'], 'ro appends -i to any consonant-final token including English loanwords'],
        ['masiniste', ['masiniste', 'masinist', 'masinistt'], 'ro iste rule produces a doubled final t']
    ],
    hu: [
        ['orvos', ['orvos', 'orvosk'], 'hu appends -k to any token over four characters'],
        ['mernok', ['mernok', 'merno', 'mern'], 'hu k and vowel-k rules both fire, over-stripping the stem']
    ]
};
for (const [locale, cases] of localeEntries(KNOWN_QUIRK_CASES_BY_LOCALE)) {
    for (const [token, expected, note] of cases) {
        test(`known quirk: ${note}: "${token}"`, () => {
            assert.deepEqual([...expandLocaleTokenVariants(token, locale)], [...expected]);
        });
    }
}
