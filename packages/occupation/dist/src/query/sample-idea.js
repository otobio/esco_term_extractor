import { normalizeSearchSurfaceText } from './query-preparation.js';
const KNOWN_LANGUAGES = [
    'english',
    'german',
    'french',
    'italian',
    'spanish',
    'hungarian',
    'romanian'
];
const LANGUAGE_SOURCE = KNOWN_LANGUAGES.join('|');
const NOISE_RULES = {
    common: [
        'apply as',
        'hiring',
        'looking for',
        'seeking',
        'entry level',
        'm/f',
        'f/m',
        'm/w/d',
        'f m',
        'm f',
        'f m d',
        'm w d',
        'f m x',
        'm f x',
        'free accommodation',
        'day shift',
        'night shift',
        'rotating shift',
        'salary range',
        'salary',
        'bonus',
        'gross',
        'net',
        'lei',
        'eur',
        'ron',
        'ft',
        'huf',
        'pizza hut',
        'travel free',
        'delissima bakery',
        'delissima',
        // Parameterized common noise.
        '%d ore',
        '%d ora',
        '%d hours',
        '%d hour',
        '%d h',
        '%dh',
        '%d%s/%s%d',
        '%d%s%{shift|schimburi?|ture}',
        'full%stime',
        'part%stime',
        'full%stime%sjob',
        'part%stime%sjob',
        '%lang%srequired',
        '%lang%slanguage',
        '%lang%sspeaker',
        '%lang%sknowledge',
        '%d',
        'whc%d',
        'kh%s%d',
        '%w%d',
        '%d3',
        '%a%d'
    ],
    ro: [
        'cautam colegi',
        'perioada determinata',
        'perioada nedeterminata',
        'cazare asigurata',
        'program de lucru',
        'programul de lucru',
        'program flexibil',
        'program normal',
        'munca in ture',
        'munca în ture',
        'tura de zi',
        'tura de noapte',
        'ore pe zi',
        'ore/zi',
        'ore pe saptamana',
        'ore pe săptămână',
        'ore pe săptamana',
        '8 ore',
        '6 ore',
        '4 ore',
        '12 ore',
        '20 ore',
        '30 ore',
        'start date',
        'ianuarie',
        'februarie',
        'martie',
        'aprilie',
        'iunie',
        'iulie',
        'septembrie',
        'octombrie',
        'noiembrie',
        'decembrie',
        'salariu motivant',
        'cautam',
        'cauta',
        'angajam',
        'cauta colegi',
        'cautam colegi',
        '%{with|fluent|good|basic}%s%lang',
        '%lang%s%{required|knowledge|speaking|speaker}'
    ],
    hu: [
        'szures',
        'ertekeld munkahelyedet',
        'diakmunka',
        'reszmunkaido',
        'teljes munkaido',
        'munkaido',
        'részmunkaidő',
        'teljes munkaidő',
        'versenykepes fizetes',
        'alj hozzank',
        'jelentkezz',
        'marcius',
        'aprilis',
        'majus',
        'junius',
        'julius',
        'augusztus',
        'szeptember',
        'oktober',
        'november',
        'december',
        'heti 30 oras',
        'heti 20 oras',
        'heti 40 oras',
        '%{with|fluent|good|basic}%s%lang',
        '%lang%s%{required|knowledge|speaking|speaker}'
    ]
};
export function peelOccupationTitleNoiseV2(title, locale) {
    const normalizedLocale = normalizeNoiseLocale(locale);
    if (!normalizedLocale) {
        return String(title ?? '').trim();
    }
    let value = normalizeSearchSurfaceText(String(title ?? '').trim());
    if (!value) {
        return '';
    }
    for (const pattern of getNoisePatterns(normalizedLocale)) {
        value = value.replace(pattern, ' ');
    }
    return cleanupPeeledSurface(value);
}
function getNoisePatterns(locale) {
    return [
        ...NOISE_RULES.common,
        ...NOISE_RULES[locale]
    ].map(buildNoisePattern);
}
/**
 * Compiles the small noise-pattern DSL into a safe regex.
 *
 * Supported tokens:
 *
 *   %d       one or more digits
 *   %d3      three or more digits
 *   %w       1–4 ASCII letters
 *   %a       one ASCII letter
 *   %s       optional whitespace/separator
 *   %lang    known language
 *   %{a|b|c} explicit alternatives
 */
function buildNoisePattern(pattern) {
    const source = compileNoisePattern(pattern.trim());
    if (!source) {
        return /$a/u;
    }
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${source}(?=$|[^\\p{L}\\p{N}])`, 'giu');
}
function compileNoisePattern(pattern) {
    let source = '';
    let index = 0;
    while (index < pattern.length) {
        if (pattern[index] !== '%') {
            const nextToken = pattern.indexOf('%', index);
            const literal = nextToken === -1
                ? pattern.slice(index)
                : pattern.slice(index, nextToken);
            source += escapeRegExp(literal);
            index += literal.length;
            continue;
        }
        // %d3
        if (pattern.startsWith('%d3', index)) {
            source += '\\d{3,}';
            index += 3;
            continue;
        }
        // %lang
        if (pattern.startsWith('%lang', index)) {
            source += `(?:${LANGUAGE_SOURCE})`;
            index += 5;
            continue;
        }
        // %d
        if (pattern.startsWith('%d', index)) {
            source += '\\d+';
            index += 2;
            continue;
        }
        // %w
        if (pattern.startsWith('%w', index)) {
            source += '[a-z]{1,4}';
            index += 2;
            continue;
        }
        // %a
        if (pattern.startsWith('%a', index)) {
            source += '[a-z]';
            index += 2;
            continue;
        }
        // %s
        if (pattern.startsWith('%s', index)) {
            source += '[\\s_\\-/]*';
            index += 2;
            continue;
        }
        // %{foo|bar|baz}
        if (pattern.startsWith('%{', index)) {
            const end = pattern.indexOf('}', index + 2);
            if (end === -1) {
                // Treat malformed syntax literally rather than creating
                // an unexpected regex.
                source += escapeRegExp('%');
                index += 1;
                continue;
            }
            const alternatives = pattern
                .slice(index + 2, end)
                .split('|')
                .map(value => escapeRegExp(value.trim()))
                .filter(Boolean);
            if (alternatives.length > 0) {
                source += `(?:${alternatives.join('|')})`;
            }
            index = end + 1;
            continue;
        }
        // Unknown % token: treat % literally.
        source += '%';
        index += 1;
    }
    return source;
}
function cleanupPeeledSurface(value) {
    return value
        .replace(/[()[\]{}]+/gu, ' ')
        .replace(/\(\s*\)/gu, ' ')
        .replace(/\[\s*\]/gu, ' ')
        .replace(/\{\s*\}/gu, ' ')
        .replace(/\s+(\/|\||-+|–+|—+)\s+/gu, ' $1 ')
        .replace(/(?:^|\s)(\/|\|)(?=\s|$)/gu, ' ')
        .replace(/\s*,\s*/gu, ', ')
        .replace(/\s*!\s*/gu, ' ')
        .replace(/\s+/gu, ' ')
        .replace(/\s+,/gu, ',')
        .trim()
        .replace(/^[,\/|\-–—!\s]+|[,\/|\-–—!\s]+$/gu, '')
        .trim();
}
function normalizeNoiseLocale(locale) {
    const normalized = String(locale ?? '').trim().toLowerCase();
    if (normalized === 'ro' || normalized === 'hu') {
        return normalized;
    }
    return null;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
