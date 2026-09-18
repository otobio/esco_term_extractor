import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tokenMatchesLocaleVariant, expandLocaleTokenVariants } from '../../../src/query/token-variants.js';
import { parseCsvRecords } from '../../../src/utils/csv/parse-csv.js';
import { foldSearchText, tokenizeNormalizedText } from '../../../src/utils/texts.js';
// Differential oracle for tokenMatchesLocaleVariant.
//
// The reduction rules below are an INDEPENDENT transcription of the implementation as it stands
// today. They exist so that a rewrite of the matching path (e.g. replacing the O(values) reverse
// loop with rule inversion) can be proved equivalent against real RO/HU vocabulary rather than
// against a handful of hand-picked cases.
//
// Because the reference must currently agree with the implementation exactly, a transcription
// mistake shows up as a failing test right now -- it cannot hide.
//
// Do not "fix" the reference to make a future implementation pass. If the two diverge, either the
// rewrite changed behaviour or the reference is wrong; decide which, deliberately.
const SCHEMA_DIR = path.join(process.cwd(), 'src', 'occupation-classifier', 'specialization', 'specialization-schema');
const ROMANIAN_TOKEN_VARIANT_MAP = new Map([
    ['achizitor', ['buyer']],
    ['agenti', ['agent']],
    ['agenți', ['agent']],
    ['asistenta', ['asistent']],
    ['asistente', ['asistent']],
    ['contabila', ['contabil']],
    ['contabile', ['contabil']],
    ['contabili', ['contabil']],
    ['dezvoltatoare', ['dezvoltator']],
    ['dezvoltatori', ['dezvoltator']],
    ['electricieni', ['electrician']],
    ['gestionara', ['gestionar']],
    ['instalatori', ['instalator']],
    ['lucratoare', ['lucrator']],
    ['lucratori', ['lucrator']],
    ['mecanici', ['mecanic']],
    ['medic', ['doctor', 'physician']],
    ['medici', ['medic', 'doctor', 'physician']],
    ['operatori', ['operator']],
    ['programatoare', ['programator']],
    ['programatori', ['programator']],
    ['profesoara', ['profesor']],
    ['profesoară', ['profesor']],
    ['profesoare', ['profesor']],
    ['receptionera', ['receptioner', 'receptionist']],
    ['receptionere', ['receptioner']],
    ['receptioer', ['receptioner']],
    ['registrator', ['records', 'registrar']],
    ['registratoare', ['records', 'registrar']],
    ['registratori', ['registrator', 'records', 'registrar']],
    ['responsabila', ['responsabil']],
    ['responsabile', ['responsabil']],
    ['sefi', ['sef']],
    ['șefi', ['șef']],
    ['soferi', ['sofer', 'driver']],
    ['șoferi', ['șofer', 'driver']],
    ['specialisti', ['specialist']],
    ['specialiști', ['specialist']],
    ['stivuitorist', ['forklift']],
    ['stivuitoristi', ['stivuitorist', 'forklift']],
    ['stivuitoriști', ['stivuitorist', 'forklift']],
    ['strungar', ['lathe']],
    ['strungari', ['strungar', 'lathe']],
    ['tehnicieni', ['tehnician']],
    ['vanzatoare', ['vanzator']],
    ['vanzatori', ['vanzator']],
    ['vanzatoarei', ['vanzator']],
    ['vânzătoare', ['vânzător']],
    ['vânzători', ['vânzător']]
]);
function referenceEnglishReductions(token) {
    const variants = new Set();
    if (token.endsWith('ies') && token.length > 4) {
        variants.add(`${token.slice(0, -3)}y`);
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        variants.add(token.slice(0, -1));
    }
    if (token.endsWith('er') && token.length > 3) {
        variants.add(`${token.slice(0, -2)}or`);
    }
    if (token.endsWith('or') && token.length > 3) {
        variants.add(`${token.slice(0, -2)}er`);
    }
    return Array.from(variants);
}
function referenceRomanianReductions(token) {
    const variants = new Set(ROMANIAN_TOKEN_VARIANT_MAP.get(token) ?? []);
    if (token.endsWith('i') && token.length > 4) {
        variants.add(token.replace(/i$/u, ''));
    }
    if (token.endsWith('e') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    if ((token.endsWith('a') || token.endsWith('ă')) && token.length > 5) {
        variants.add(token.slice(0, -1));
    }
    if (token.endsWith('oare') && token.length > 7) {
        variants.add(`${token.slice(0, -4)}or`);
    }
    if (token.endsWith('oarea') && token.length > 8) {
        variants.add(`${token.slice(0, -5)}or`);
    }
    if (token.endsWith('toare') && token.length > 7) {
        variants.add(`${token.slice(0, -5)}tor`);
    }
    if (token.endsWith('toarea') && token.length > 8) {
        variants.add(`${token.slice(0, -6)}tor`);
    }
    if (token.endsWith('ori') && token.length > 5) {
        variants.add(token.slice(0, -1));
    }
    if (token.endsWith('iste') && token.length > 6) {
        variants.add(`${token.slice(0, -1)}t`);
    }
    if (token.endsWith('istei') && token.length > 7) {
        variants.add(`${token.slice(0, -2)}t`);
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function referenceHungarianReductions(token) {
    const variants = new Set();
    if (token.endsWith('k') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    if ((token.endsWith('ok') || token.endsWith('ek') || token.endsWith('ak') || token.endsWith('ök')) && token.length > 5) {
        variants.add(token.slice(0, -2));
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function referenceEstonianReductions(token) {
    const variants = new Set();
    if (token.endsWith('id') && token.length > 5) {
        variants.add(token.slice(0, -2));
    }
    if (token.endsWith('d') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}
function referenceLocaleMatchVariants(token, locale) {
    const variants = new Set([token]);
    const reductions = locale === 'en'
        ? referenceEnglishReductions(token)
        : locale === 'ro'
            ? referenceRomanianReductions(token)
            : locale === 'hu'
                ? referenceHungarianReductions(token)
                : locale === 'et'
                    ? referenceEstonianReductions(token)
                    : [];
    for (const variant of reductions) {
        variants.add(variant);
    }
    return Array.from(variants);
}
function referenceTokenMatches(token, values, locale) {
    for (const variant of referenceLocaleMatchVariants(token, locale)) {
        if (values.has(variant)) {
            return true;
        }
    }
    for (const value of values) {
        if (referenceLocaleMatchVariants(value, locale).includes(token)) {
            return true;
        }
    }
    return false;
}
function readAliasTokens(files) {
    const tokens = new Set();
    for (const file of files) {
        let csv;
        try {
            csv = readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
        }
        catch {
            continue;
        }
        for (const row of parseCsvRecords(csv)) {
            const alias = typeof row.alias === 'string' ? row.alias : '';
            for (const token of tokenizeNormalizedText(foldSearchText(alias))) {
                if (token.length >= 2) {
                    tokens.add(token);
                }
            }
        }
    }
    return Array.from(tokens).sort();
}
const CORPUS_FILES = {
    en: ['specialization-concept-aliases.csv', 'specialization-role-head-aliases.csv'],
    ro: [
        'specialization-concept-aliases.ro.csv',
        'specialization-role-head-aliases.ro.csv',
        'specialization-role-head-alias-alternates.ro.csv'
    ],
    hu: [
        'specialization-concept-aliases.hu.csv',
        'specialization-role-head-aliases.hu.csv',
        'specialization-role-head-alias-alternates.hu.csv'
    ]
};
const CORPUS = {
    en: readAliasTokens(CORPUS_FILES.en),
    ro: readAliasTokens(CORPUS_FILES.ro),
    hu: readAliasTokens(CORPUS_FILES.hu)
};
// The corpora drive every differential assertion below, so an empty or truncated read would turn
// the whole file into a silent no-op. Fail loudly instead.
for (const [locale, tokens] of Object.entries(CORPUS)) {
    test(`differential corpus for ${locale} is non-trivial`, () => {
        assert.ok(tokens.length > 200, `expected a real ${locale} corpus, got ${tokens.length} tokens`);
    });
}
// ET has no locale CSV of its own; its rules are still exercised by running the other corpora
// through the 'et' ruleset, which is what a mixed-locale query would do anyway.
const DIFFERENTIAL_LOCALES = ['en', 'ro', 'hu', 'et'];
function corpusFor(locale) {
    if (locale === 'ro' || locale === 'hu' || locale === 'en') {
        return CORPUS[locale];
    }
    return CORPUS.en;
}
// --- exhaustive: every corpus token against a small, targeted value set ---
//
// The value set deliberately contains the token's own expansions, so the REVERSE direction (a value
// that reduces to the token) is exercised on every single token rather than incidentally.
for (const locale of DIFFERENTIAL_LOCALES) {
    test(`differential ${locale}: every corpus token against its own variant neighbourhood`, () => {
        const tokens = corpusFor(locale);
        let checked = 0;
        let reverseOnly = 0;
        for (const token of tokens) {
            const values = new Set(expandLocaleTokenVariants(token, locale));
            values.delete(token);
            values.add('unrelated-sentinel');
            const expected = referenceTokenMatches(token, values, locale);
            const actual = tokenMatchesLocaleVariant(token, values, locale);
            assert.equal(actual, expected, `${locale} token "${token}" values=${JSON.stringify([...values])}`);
            checked += 1;
            if (expected && !values.has(token)) {
                reverseOnly += 1;
            }
        }
        assert.ok(checked > 200, `expected a meaningful ${locale} sample, checked ${checked}`);
        assert.ok(reverseOnly > 0, `${locale} sample never exercised a non-identity match`);
    });
}
// --- exhaustive: every corpus token against its own reductions ---
for (const locale of DIFFERENTIAL_LOCALES) {
    test(`differential ${locale}: every corpus token against its reduction targets`, () => {
        for (const token of corpusFor(locale)) {
            const values = new Set(referenceLocaleMatchVariants(token, locale));
            values.delete(token);
            if (values.size === 0) {
                continue;
            }
            assert.equal(tokenMatchesLocaleVariant(token, values, locale), referenceTokenMatches(token, values, locale), `${locale} token "${token}"`);
        }
    });
}
// --- production shape: sampled tokens against the whole corpus as one large value set ---
//
// Real call sites pass sets of roughly 500-3800 entries, which is the shape that makes the reverse
// loop expensive; this is the case a rewrite is most likely to get wrong.
for (const locale of DIFFERENTIAL_LOCALES) {
    test(`differential ${locale}: sampled tokens against the full corpus value set`, () => {
        const tokens = corpusFor(locale);
        const values = new Set(tokens);
        const stride = Math.max(1, Math.floor(tokens.length / 300));
        let checked = 0;
        for (let index = 0; index < tokens.length; index += stride) {
            const token = tokens[index];
            assert.equal(tokenMatchesLocaleVariant(token, values, locale), referenceTokenMatches(token, values, locale), `${locale} token "${token}" against ${values.size}-entry set`);
            checked += 1;
        }
        assert.ok(values.size > 200, `expected a production-shaped value set, got ${values.size}`);
        assert.ok(checked > 50, `expected a meaningful sample, checked ${checked}`);
    });
}
// --- cross-token: tokens that are NOT in the value set, to pin negative results ---
for (const locale of DIFFERENTIAL_LOCALES) {
    test(`differential ${locale}: absent tokens against the full corpus value set`, () => {
        const tokens = corpusFor(locale);
        const values = new Set(tokens);
        const stride = Math.max(1, Math.floor(tokens.length / 150));
        let negatives = 0;
        for (let index = 0; index < tokens.length; index += stride) {
            const token = `${tokens[index]}zzq`;
            const expected = referenceTokenMatches(token, values, locale);
            assert.equal(tokenMatchesLocaleVariant(token, values, locale), expected, `${locale} token "${token}"`);
            if (!expected) {
                negatives += 1;
            }
        }
        assert.ok(negatives > 0, `${locale} absent-token sample produced no negative results`);
    });
}
// --- reverse direction, stated explicitly ---
//
// These are the cases the forward loop alone cannot resolve: the query token is the SHORT form and
// the value carries the inflection. Any rewrite that drops the reverse check fails here.
const REVERSE_DIRECTION_CASES = [
    ['driver', 'drivers', 'en'],
    ['company', 'companies', 'en'],
    ['operator', 'operators', 'en'],
    ['inginer', 'ingineri', 'ro'],
    ['sofer', 'soferi', 'ro'],
    ['dezvoltator', 'dezvoltatoare', 'ro'],
    ['muncitor', 'muncitoare', 'ro'],
    ['contabil', 'contabili', 'ro'],
    ['specialist', 'specialisti', 'ro'],
    ['vanzator', 'vanzatori', 'ro'],
    ['mernok', 'mernokok', 'hu'],
    ['könyvelő', 'könyvelők', 'hu'],
    ['alap', 'alapok', 'hu'],
    ['anyag', 'anyagok', 'hu'],
    ['alkatrész', 'alkatrészek', 'hu'],
    ['insener', 'insenerid', 'et']
];
for (const [shortForm, inflected, locale] of REVERSE_DIRECTION_CASES) {
    test(`reverse direction ${locale}: "${shortForm}" matches a set holding only "${inflected}"`, () => {
        assert.equal(tokenMatchesLocaleVariant(shortForm, new Set([inflected]), locale), true);
    });
    test(`reverse direction ${locale}: "${shortForm}" agrees with the reference for "${inflected}"`, () => {
        const values = new Set([inflected]);
        assert.equal(tokenMatchesLocaleVariant(shortForm, values, locale), referenceTokenMatches(shortForm, values, locale));
    });
    test(`reverse direction ${locale}: "${shortForm}" still matches inside a large value set`, () => {
        const values = new Set([...corpusFor(locale).slice(0, 500), inflected]);
        assert.equal(tokenMatchesLocaleVariant(shortForm, values, locale), true);
    });
}
// --- curated RO map, exhaustively, in both directions ---
//
// The corpora only graze the 49 curated entries, so a rewrite that mishandled the map would slip
// past the corpus-driven checks above. These iterate every entry instead. The map is many-to-many
// ('medici' -> ['medic', 'doctor', 'physician']), which is exactly what a naive inversion drops.
for (const [key, mapped] of ROMANIAN_TOKEN_VARIANT_MAP) {
    test(`curated ro map forward: "${key}" against each mapped value`, () => {
        for (const value of mapped) {
            const values = new Set([value]);
            assert.equal(tokenMatchesLocaleVariant(key, values, 'ro'), referenceTokenMatches(key, values, 'ro'), `"${key}" -> "${value}"`);
        }
    });
    test(`curated ro map reverse: each mapped value against a set holding "${key}"`, () => {
        for (const value of mapped) {
            const values = new Set([key]);
            assert.equal(tokenMatchesLocaleVariant(value, values, 'ro'), referenceTokenMatches(value, values, 'ro'), `"${value}" <- "${key}"`);
        }
    });
    test(`curated ro map: "${key}" against all mapped values at once`, () => {
        const values = new Set(mapped);
        assert.equal(tokenMatchesLocaleVariant(key, values, 'ro'), referenceTokenMatches(key, values, 'ro'));
    });
    test(`curated ro map: "${key}" inside a production-shaped value set`, () => {
        const values = new Set([...CORPUS.ro, ...mapped]);
        assert.equal(tokenMatchesLocaleVariant(key, values, 'ro'), referenceTokenMatches(key, values, 'ro'));
    });
}
// --- diacritic-carrying tokens ---
//
// The corpora are folded, which strips diacritics and makes the hu 'ök' branch and the ro 'ă'
// branch unreachable from corpus-driven checks. Call sites do not always fold, so pin them here.
const DIACRITIC_CASES = [
    ['főnökök', 'hu'],
    ['főnök', 'hu'],
    ['könyvelők', 'hu'],
    ['könyvelő', 'hu'],
    ['vezetők', 'hu'],
    ['mérnökök', 'hu'],
    ['szerelők', 'hu'],
    ['bucătară', 'ro'],
    ['bucătar', 'ro'],
    ['vânzători', 'ro'],
    ['vânzătoare', 'ro'],
    ['șoferi', 'ro'],
    ['profesoară', 'ro'],
    ['specialiști', 'ro'],
    ['agenți', 'ro'],
    ['șefi', 'ro']
];
for (const [token, locale] of DIACRITIC_CASES) {
    test(`diacritic ${locale}: "${token}" against its own variant neighbourhood`, () => {
        const values = new Set(expandLocaleTokenVariants(token, locale));
        assert.equal(tokenMatchesLocaleVariant(token, values, locale), referenceTokenMatches(token, values, locale));
    });
    test(`diacritic ${locale}: "${token}" against its reduction targets`, () => {
        const values = new Set(referenceLocaleMatchVariants(token, locale));
        values.delete(token);
        assert.equal(tokenMatchesLocaleVariant(token, values, locale), referenceTokenMatches(token, values, locale));
    });
    test(`diacritic ${locale}: every other diacritic token as the value set for "${token}"`, () => {
        const values = new Set(DIACRITIC_CASES.filter(([other]) => other !== token).map(([other]) => other));
        assert.equal(tokenMatchesLocaleVariant(token, values, locale), referenceTokenMatches(token, values, locale));
    });
}
