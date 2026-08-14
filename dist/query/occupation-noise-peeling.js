import { normalizeSearchSurfaceText } from './query-preparation.js';
const NOISE_VARIABLES = {
    lang: [
        'english',
        'german',
        'french',
        'italian',
        'spanish',
        'hungarian',
        'romanian',
        'polish',
        'czech',
        'dutch',
        'engleza',
        'germana',
        'franceza',
        'italiana',
        'spaniola',
        'maghiara',
        'romana',
        'română',
        'poloneza',
        'ceha'
    ],
    currency: ['lei', 'eur', 'ron', 'huf'],
    shift: ['shift', 'schimburi', 'schimb', 'ture', 'tura'],
    years: ['ani', 'an', 'year', 'years', 'yr', 'yrs'],
    workplace: ['hybrid', 'remote', 'on-site', 'onsite'],
    level: ['mediu', 'avansat', 'incepator', 'începător', 'conversational'],
    locationAdmin: [
        'jud.',
        'jud',
        'județ',
        'judet',
        'județul',
        'judetul',
        'mun.',
        'municipiu',
        'municipiul',
        'oras',
        'oraș',
        'comuna',
        'sat',
        'sector',
        'sectorul',
        'megye',
        'kerület',
        'kerulet',
        'város',
        'varos'
    ]
};
const VARIABLE_TOKENS = Object.keys(NOISE_VARIABLES)
    .sort((left, right) => right.length - left.length)
    .map((name) => `%${name}`);
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
        'f/m/d',
        'm/f/d',
        'f/m/x',
        'm/f/x',
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
        'ft',
        '%currency',
        'pizza hut',
        'travel free',
        'delissima bakery',
        'delissima',
        'tichete masa',
        '%number ore',
        '%number ora',
        '%number hours',
        '%number hour',
        '%number h',
        '%numberh',
        '%number%currency',
        '%number%currency%spacenet',
        '%number%currency%spacegross',
        '%number%space/%space%number',
        '%number%space%shift',
        'full%spacetime',
        'part%spacetime',
        'full%spacetime%spacejob',
        'part%spacetime%spacejob',
        '(%lang)',
        '%lang%spacerequired',
        '%lang%spacelanguage',
        '%lang%spacespeaker',
        '%lang%spaceknowledge',
        '%{with|fluent|good|basic}%space%lang',
        '%{with|fluent|good|basic}%space%lang%space&%space%lang',
        '%{with|fluent|good|basic}%space%lang%space/%space%lang',
        '%lang%space%{required|knowledge|speaking|speaker}',
        '%lang%space%level',
        '%workplace',
        'experienta%spacemin.%space%number%space%years',
        'experienta%spacemin%space%number%space%years',
        'experiență%spacemin.%space%number%space%years',
        'experiență%spacemin%space%number%space%years',
        '%hashtag',
        '%number',
        'whc%number',
        'kh%space%number',
        '%word%number',
        '%number3',
        '%letter%number'
    ],
    ro: [
        'cautam colegi',
        'perioada determinata',
        'perioada nedeterminata',
        'cazare asigurata',
        'cazare asigurată',
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
        '%number%spacezile%spacelucrate%space/%space%number%spacelibere',
        'sect.%space%number',
        'sect%space%number'
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
        'heti%space%number%spaceoras'
    ],
    en: [],
    et: [],
    unknown: []
};
export function peelOccupationTitleNoise(title, locale) {
    const normalizedLocale = normalizeOccupationNoiseLocale(locale);
    let value = normalizeSearchSurfaceText(String(title ?? '').trim());
    if (!value) {
        return '';
    }
    for (const pattern of getNoisePatterns(normalizedLocale)) {
        value = value.replace(pattern, '$1');
    }
    return cleanupPeeledSurface(value);
}
function normalizeOccupationNoiseLocale(locale) {
    const normalized = String(locale ?? '').trim().toLowerCase();
    if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et') {
        return normalized;
    }
    return 'unknown';
}
function getNoisePatterns(locale) {
    return [...NOISE_RULES.common, ...NOISE_RULES[locale]]
        .slice()
        // Longer patterns must run before their shorter prefixes.
        .sort((left, right) => right.length - left.length)
        .map(buildNoisePattern);
}
function buildNoisePattern(pattern) {
    const source = compileNoisePattern(pattern.trim());
    if (!source) {
        return /$a/u;
    }
    return new RegExp(`(^|[^\\p{L}\\p{N}])(${source})(?=$|[^\\p{L}\\p{N}])`, 'giu');
}
function compileNoisePattern(pattern) {
    let source = '';
    let index = 0;
    while (index < pattern.length) {
        if (pattern[index] !== '%') {
            const nextToken = pattern.indexOf('%', index);
            const literal = nextToken === -1 ? pattern.slice(index) : pattern.slice(index, nextToken);
            source += escapeRegExp(literal);
            index += literal.length;
            continue;
        }
        if (pattern.startsWith('%number3', index)) {
            source += '\\d{3,}';
            index += '%number3'.length;
            continue;
        }
        if (pattern.startsWith('%number', index)) {
            source += '\\d+';
            index += '%number'.length;
            continue;
        }
        if (pattern.startsWith('%word', index)) {
            source += '[a-z]{1,4}';
            index += '%word'.length;
            continue;
        }
        if (pattern.startsWith('%letter', index)) {
            source += '[a-z]';
            index += '%letter'.length;
            continue;
        }
        if (pattern.startsWith('%space', index)) {
            source += '[\\s_\\-/]*';
            index += '%space'.length;
            continue;
        }
        const variable = matchNoiseVariable(pattern, index);
        if (variable) {
            source += buildVariableSource(variable.name);
            index += variable.length;
            continue;
        }
        if (pattern.startsWith('%hashtag', index)) {
            source += '#[\\p{L}\\p{N}_]+';
            index += '%hashtag'.length;
            continue;
        }
        if (pattern.startsWith('%{', index)) {
            const end = pattern.indexOf('}', index + 2);
            if (end === -1) {
                source += escapeRegExp('%');
                index += 1;
                continue;
            }
            const alternatives = pattern
                .slice(index + 2, end)
                .split('|')
                .map((value) => escapeRegExp(value.trim()))
                .filter(Boolean);
            if (alternatives.length > 0) {
                source += `(?:${alternatives.join('|')})`;
            }
            index = end + 1;
            continue;
        }
        throw new Error(`Unknown noise pattern token in "${pattern}" at position ${index}.`);
    }
    return source;
}
function cleanupPeeledSurface(value) {
    let cleaned = protectMeaningfulPlusJoins(value)
        .replace(/[ \t\r\f\v]+/gu, ' ')
        .replace(/\n+/gu, ' ')
        .replace(/\s*,\s*/gu, ', ')
        .replace(/\s+/gu, ' ')
        .replace(/\s+,/gu, ',')
        .trim();
    cleaned = cleaned.replace(/(^|[\s,;:!\/|\-–—])\+(?=$|[\s,;:!\/|\-–—])/gu, '$1');
    cleaned = cleaned.replace(/(^|[\s,;:\/|\-–—])[!#]+(?=$|[\s,;:\/|\-–—])/gu, '$1');
    cleaned = cleaned.replace(/([)\]\}\p{L}\p{N}])\s*[-–—]+\s*(?=[,;:]|$)/gu, '$1');
    cleaned = cleaned.replace(/(^|[\s,;:\/|])[-–—]+(?=\p{L})/gu, '$1');
    cleaned = cleaned.replace(buildParentheticalLocationPattern(), ' ');
    cleaned = cleaned.replace(/\s+,/gu, ',').replace(/\s+/gu, ' ').trim();
    cleaned = trimEdgeSymbols(cleaned);
    let previous = '';
    while (cleaned !== previous) {
        previous = cleaned;
        cleaned = cleaned
            .replace(/\(\s*\)/gu, ' ')
            .replace(/\[\s*\]/gu, ' ')
            .replace(/\{\s*\}/gu, ' ')
            .replace(/^\(\s*\)\s*/u, '')
            .replace(/^\[\s*\]\s*/u, '')
            .replace(/^\{\s*\}\s*/u, '')
            .replace(/\s*\(\s*\)$/u, '')
            .replace(/\s*\[\s*\]$/u, '')
            .replace(/\s*\{\s*\}$/u, '')
            .replace(/\s+/gu, ' ')
            .trim();
        cleaned = trimEdgeSymbols(cleaned);
    }
    return restoreMeaningfulPlusJoins(trimEdgeSymbols(cleaned));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
function buildVariableSource(name) {
    const values = NOISE_VARIABLES[name].map((value) => escapeRegExp(value));
    return `(?:${values.join('|')})`;
}
function matchNoiseVariable(pattern, index) {
    for (const token of VARIABLE_TOKENS) {
        if (pattern.startsWith(token, index)) {
            return {
                name: token.slice(1),
                length: token.length
            };
        }
    }
    return null;
}
function trimEdgeSymbols(value) {
    return value
        .replace(/^(?:[_\/|!,:;\-–—]+)\s*/u, '')
        .replace(/\s*(?:[_\/|!,:;\-–—]+)$/u, '')
        .replace(/[,\s]+$/u, '')
        .trim();
}
function buildParentheticalLocationPattern() {
    const locationAdmin = buildVariableSource('locationAdmin');
    return new RegExp(`\\(\\s*[^)]*${locationAdmin}[^)]*\\)`, 'giu');
}
function protectMeaningfulPlusJoins(value) {
    return value.replace(/([\p{L}\p{N}])\s*\+\s*([\p{L}\p{N}])/gu, '$1__PLUS__$2');
}
function restoreMeaningfulPlusJoins(value) {
    return value.replace(/__PLUS__/gu, ' + ');
}
