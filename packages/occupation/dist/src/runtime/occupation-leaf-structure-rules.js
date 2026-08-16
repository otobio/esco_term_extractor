import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
export const LEAF_STRUCTURE_AUTHORITY_ORDER = [
    { token: 'chief', kind: 'chief' },
    { token: 'director', kind: 'director' },
    { token: 'manager', kind: 'manager' },
    { token: 'supervisor', kind: 'supervisor' },
    { token: 'lead', kind: 'lead' },
    { token: 'auditor', kind: 'auditor' }
];
export const LEAF_STRUCTURE_VENUE_TOKENS = new Set([
    'hotel',
    'hospital',
    'clinic',
    'school',
    'airport',
    'railway',
    'station',
    'restaurant',
    'shop',
    'store',
    'office',
    'mine',
    'laboratory',
    'lab'
]);
export const LEAF_STRUCTURE_CHANNEL_TOKENS = new Set([
    'chat',
    'online',
    'digital',
    'social',
    'media',
    'telephone',
    'call',
    'centre',
    'center',
    'broadcast',
    'helpdesk'
]);
export const LEAF_STRUCTURE_PRODUCT_TOKENS = new Set([
    'battery',
    'circuit',
    'hardware',
    'textile',
    'footwear',
    'furniture',
    'sensor',
    'satellite',
    'microelectronics',
    'games',
    'power',
    'device'
]);
export const LEAF_STRUCTURE_POPULATION_TOKENS = new Set([
    'customer',
    'client',
    'public',
    'student',
    'patient',
    'passenger',
    'visitor',
    'user'
]);
export const LEAF_STRUCTURE_TASK_FOCUS_TOKENS = new Set([
    'testing',
    'test',
    'maintenance',
    'repair',
    'repairer',
    'installation',
    'installer',
    'survey',
    'surveyor',
    'design',
    'designer',
    'simulation',
    'quality',
    'support',
    'operations',
    'operator',
    'analyst',
    'planner'
]);
export const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS = new Set([
    'electrical',
    'electronics',
    'electronic',
    'electromechanical',
    'telecommunications',
    'telecom',
    'aviation',
    'aircraft',
    'flight',
    'automotive',
    'mining',
    'construction',
    'manufacturing',
    'medical',
    'energy',
    'software',
    'database',
    'network',
    'marketing',
    'advertising'
]);
// Locale token sets are written once, in natural diacritic Romanian spelling; foldedLocaleSet() folds
// each entry through the same foldSearchText() used on query tokens (preparedQueryStructuralTokenSet
// below), so there is exactly one spelling per concept instead of hand-maintained diacritic/no-diacritic
// pairs that silently drift out of sync (e.g. a folded query token can never match an un-folded 'școală'
// entry, so keeping both forms only hid dead entries rather than adding coverage).
function foldedLocaleSet(words) {
    return new Set(words.map((word) => foldSearchText(word)));
}
// ro additions below 'depozit' and hu entries were mined from real listing samples
// (data/taxonomy-review/job-title-common-tokens.ejobs.csv for ro, ...profession.csv for hu) --
// each is a token that actually recurs across a meaningful share of real job titles in that
// locale, not a guessed translation.
const LEAF_STRUCTURE_VENUE_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'hotel',
        'spital',
        'clinică',
        'școală',
        'aeroport',
        'gară',
        'restaurant',
        'magazin',
        'birou',
        'mină',
        'laborator',
        'depozit',
        'șantier',
        'bancă',
        'campus',
        'mall',
        'fabrică',
        'ghișeu'
    ]),
    hu: foldedLocaleSet(['bolti', 'éttermi', 'gyorséttermi', 'üzem', 'üzemi', 'pékség', 'raktár', 'raktári'])
};
const LEAF_STRUCTURE_CHANNEL_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet(['chat', 'online', 'digitală', 'social', 'media', 'telefon', 'telefonic', 'apel', 'centru', 'difuzare']),
    hu: foldedLocaleSet(['telefonos', 'ügyfélszolgálati', 'digitális', 'online'])
};
const LEAF_STRUCTURE_PRODUCT_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'baterie',
        'circuit',
        'hardware',
        'textile',
        'încălțăminte',
        'mobilă',
        'senzor',
        'satelit',
        'microelectronică',
        'jocuri',
        'energie',
        'dispozitiv',
        'utilaje',
        'mașini',
        'echipamente'
    ]),
    hu: foldedLocaleSet(['alkatrész', 'karosszéria', 'tehergépjármű', 'tehergépkocsi', 'víz'])
};
const LEAF_STRUCTURE_POPULATION_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet(['client', 'clienți', 'public', 'student', 'studenți', 'pacient', 'pasager', 'vizitator', 'utilizator', 'persoane']),
    hu: foldedLocaleSet(['lakossági', 'vállalati', 'ügyfél', 'ügyfélszolgálati'])
};
const LEAF_STRUCTURE_TASK_FOCUS_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'testare',
        'întreținere',
        'reparații',
        'reparator',
        'instalare',
        'instalator',
        'sondaj',
        'topograf',
        'design',
        'proiectare',
        'proiectant',
        'simulare',
        'calitate',
        'suport',
        'operațiuni',
        'operator',
        'analist',
        'planificare',
        'planificator',
        'depozitare',
        'vânzare',
        'vânzări',
        'livrare',
        'asamblare',
        'mentenanță'
    ])
};
const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS_BY_LOCALE = {
    hu: foldedLocaleSet(['termelési', 'logisztikai', 'pénzügyi', 'kereskedelmi', 'műszaki']),
    ro: foldedLocaleSet([
        'electric',
        'electrică',
        'electronică',
        'electromecanic',
        'telecomunicații',
        'telecom',
        'aviație',
        'aeronavă',
        'zbor',
        'auto',
        'minerit',
        'construcții',
        'fabricație',
        'producție',
        'medical',
        'energie',
        'software',
        'bază de date',
        'rețea',
        'marketing',
        'publicitate',
        'logistică',
        'comercial',
        'sisteme',
        'automatizate',
        'termice',
        'tensiune'
    ])
};
function structuralTokensForLocale(base, byLocale, locale) {
    const localeTokens = byLocale[locale];
    if (!localeTokens || localeTokens.size === 0) {
        return base;
    }
    return new Set([...base, ...localeTokens]);
}
export function detectLeafAuthorityKind(tokens) {
    for (const entry of LEAF_STRUCTURE_AUTHORITY_ORDER) {
        if (tokens.includes(entry.token)) {
            return entry.kind;
        }
    }
    return 'none';
}
export function detectLeafSpecializationKinds(tokens) {
    const kinds = new Set();
    if (hasAny(tokens, LEAF_STRUCTURE_VENUE_TOKENS)) {
        kinds.add('venue');
    }
    if (hasAny(tokens, LEAF_STRUCTURE_CHANNEL_TOKENS)) {
        kinds.add('channel');
    }
    if (hasAny(tokens, LEAF_STRUCTURE_PRODUCT_TOKENS)) {
        kinds.add('product');
    }
    if (hasAny(tokens, LEAF_STRUCTURE_POPULATION_TOKENS)) {
        kinds.add('population');
    }
    if (hasAny(tokens, LEAF_STRUCTURE_TASK_FOCUS_TOKENS)) {
        kinds.add('task_focus');
    }
    if (hasAny(tokens, LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS)) {
        kinds.add('industry_context');
    }
    return Array.from(kinds).sort();
}
export function preparedQueryStructuralTokenSet(preparedQuery) {
    return new Set([
        ...preparedQuery.usefulFoldedTokens,
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.roleHeadTokens,
        ...preparedQuery.intent.domainTokens,
        ...preparedQuery.intent.venueTokens
    ].map((token) => foldSearchText(token)));
}
export function preparedQueryRequestsAuthority(preparedQuery, authorityKind) {
    if (authorityKind === 'none') {
        return true;
    }
    const tokens = preparedQueryStructuralTokenSet(preparedQuery);
    return Array.from(tokens).includes(authorityKind);
}
export function preparedQuerySupportsSpecializationKind(preparedQuery, kind) {
    const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);
    const locale = preparedQuery.locale;
    if (kind === 'venue') {
        return (preparedQuery.intent.venueTokens.length > 0 ||
            preparedQuery.intent.domainTokens.length > 0 ||
            hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_VENUE_TOKENS, LEAF_STRUCTURE_VENUE_TOKENS_BY_LOCALE, locale)));
    }
    if (kind === 'channel') {
        return hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_CHANNEL_TOKENS, LEAF_STRUCTURE_CHANNEL_TOKENS_BY_LOCALE, locale));
    }
    if (kind === 'product') {
        return hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_PRODUCT_TOKENS, LEAF_STRUCTURE_PRODUCT_TOKENS_BY_LOCALE, locale));
    }
    if (kind === 'population') {
        return hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_POPULATION_TOKENS, LEAF_STRUCTURE_POPULATION_TOKENS_BY_LOCALE, locale));
    }
    if (kind === 'task_focus') {
        return hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_TASK_FOCUS_TOKENS, LEAF_STRUCTURE_TASK_FOCUS_TOKENS_BY_LOCALE, locale));
    }
    return (preparedQuery.intent.domainTokens.length > 0 ||
        hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS, LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS_BY_LOCALE, locale)));
}
export function canonicalTokenSet(label) {
    return new Set(tokenizeNormalizedText(foldSearchText(label)));
}
function hasAny(tokens, candidates) {
    for (const token of tokens) {
        if (candidates.has(token)) {
            return true;
        }
    }
    return false;
}
