import { tokenMatchesLocaleVariant } from './token-variants.js';
const VOCABULARY_LOOKUP_CACHE = new WeakMap();
export const BUILTIN_INTENT_VOCABULARY = {
    localeProfiles: [
        {
            localeCode: 'en',
            roleHeadTerms: [
                'accountant',
                'administrator',
                'advisor',
                'analyst',
                'architect',
                'assistant',
                'auditor',
                'baker',
                'carpenter',
                'clerk',
                'consultant',
                'coordinator',
                'cook',
                'counsellor',
                'designer',
                'developer',
                'driver',
                'electrician',
                'engineer',
                'examiner',
                'inspector',
                'installer',
                'instructor',
                'lawyer',
                'manager',
                'mechanic',
                'nurse',
                'officer',
                'operator',
                'planner',
                'programmer',
                'receptionist',
                'representative',
                'specialist',
                'supervisor',
                'teacher',
                'technician',
                'therapist',
                'trainer',
                'worker'
            ],
            roleModifierTerms: [
                'accounting',
                'aircraft',
                'application',
                'automotive',
                'backend',
                'business',
                'civil',
                'compliance',
                'construction',
                'data',
                'database',
                'electrical',
                'financial',
                'frontend',
                'fullstack',
                'health',
                'human',
                'industrial',
                'information',
                'maintenance',
                'marketing',
                'mechanical',
                'medical',
                'network',
                'occupational',
                'operations',
                'quality',
                'resources',
                'sales',
                'security',
                'software',
                'systems',
                'tax',
                'web'
            ],
            domainModifierTerms: [
                'airline',
                'bank',
                'banking',
                'education',
                'logistics',
                'manufacturing',
                'marine',
                'retail',
                'telecom',
                'transport'
            ],
            credentialModifierTerms: ['certified', 'chartered', 'licensed', 'registered'],
            ambiguousModifierTerms: [
                'administrative',
                'commercial',
                'customer',
                'digital',
                'environmental',
                'finance',
                'legal',
                'production',
                'technical'
            ],
            rolePhrases: [],
            domainPhrases: []
        },
        {
            localeCode: 'ro',
            roleHeadTerms: [
                'analist',
                'analista',
                'analistă',
                'arhitect',
                'asistent',
                'asistenta',
                'asistentă',
                'bucatar',
                'bucatară',
                'bucătăreasă',
                'bucătar',
                'contabil',
                'dezvoltator',
                'dezvoltatoare',
                'inginer',
                'manager',
                'profesor',
                'profesoara',
                'profesoară',
                'programator',
                'recepționer',
                'receptioner',
                'sofer',
                'șofer',
                'tehnician'
            ],
            roleModifierTerms: ['date', 'medical', 'medicala', 'medicală', 'primar', 'sef', 'șef', 'software'],
            domainModifierTerms: [],
            credentialModifierTerms: [],
            ambiguousModifierTerms: [],
            rolePhrases: [],
            domainPhrases: []
        },
        {
            localeCode: 'unknown',
            roleHeadTerms: [],
            roleModifierTerms: [],
            domainModifierTerms: [],
            credentialModifierTerms: [],
            ambiguousModifierTerms: [],
            rolePhrases: [],
            domainPhrases: []
        }
    ]
};
// Venue/context terms describe the place of work, not the occupation head.
// They should narrow generic-head disambiguation without becoming the role itself.
const VENUE_CONTEXT_TERMS_BY_LOCALE = {
    en: new Set([
        'airport',
        'branch',
        'clinic',
        'depot',
        'factory',
        'hospital',
        'hotel',
        'kitchen',
        'office',
        'plant',
        'restaurant',
        'school',
        'shop',
        'site',
        'store',
        'warehouse'
    ]),
    ro: new Set(),
    hu: new Set(),
    et: new Set(),
    unknown: new Set()
};
const ROLE_FRAME_MARKERS_BY_LOCALE = {
    en: [
        'assistant',
        'associate',
        'coordinator',
        'representative',
        'officer',
        'operator',
        'clerk',
        'worker',
        'technician',
        'specialist',
        'consultant',
        'analyst',
        'administrator',
        'manager',
        'supervisor'
    ],
    ro: [
        'asistent',
        'asociat',
        'coordonator',
        'reprezentant',
        'ofiter',
        'operator',
        'functionar',
        'lucrator',
        'tehnician',
        'specialist',
        'consilier',
        'analist',
        'administrator',
        'manager',
        'sef'
    ],
    hu: [
        'asszisztens',
        'munkatars',
        'koordinator',
        'kepviselo',
        'ugyintezo',
        'operator',
        'hivatalnok',
        'dolgozo',
        'technik',
        'szakerto',
        'tanacsado',
        'elemzo',
        'adminisztrator',
        'menedzser',
        'vezeto'
    ],
    et: [
        'assistent',
        'kaastootaja',
        'koordinaator',
        'esindaja',
        'ametnik',
        'operaator',
        'tootaja',
        'tehnik',
        'spetsialist',
        'konsultant',
        'analuutik',
        'administraator',
        'juht',
        'supervisor'
    ],
    unknown: []
};
const GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE = {
    en: -1,
    ro: 1,
    hu: 1,
    et: 1,
    unknown: -1
};
const ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE = {
    en: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.en),
    ro: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.ro),
    hu: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.hu),
    et: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.et),
    unknown: buildFrameMarkerPriorityIndex(ROLE_FRAME_MARKERS_BY_LOCALE.unknown)
};
export function classifyOccupationQueryIntent(input) {
    const vocabulary = vocabularyLookup(input.vocabulary ?? BUILTIN_INTENT_VOCABULARY, input.locale);
    const venueContextTerms = VENUE_CONTEXT_TERMS_BY_LOCALE[input.locale] ?? VENUE_CONTEXT_TERMS_BY_LOCALE.unknown;
    const stopTokens = new Set(input.stopTokens);
    const noiseTokens = new Set(input.noiseTokens);
    const seniorityTokens = new Set(input.modifierTokens);
    const usefulTokenSet = new Set(input.usefulFoldedTokens);
    const roleExpansionTokens = new Set(input.roleExpansionFoldedTokens?.map(normalizeIntentToken) ?? []);
    const termTokens = input.foldedTokens
        .map((token, index) => ({ token, normalizedToken: normalizeIntentToken(token), index }))
        .filter(({ token, normalizedToken }) => normalizedToken.length >= 3 &&
        !stopTokens.has(token) &&
        !noiseTokens.has(token) &&
        (usefulTokenSet.has(token) || seniorityTokens.has(token) || isKnownIntentVocabularyTerm(normalizedToken, vocabulary, input.locale)));
    if (termTokens.length === 0) {
        return emptyIntent();
    }
    const roleHead = findRoleHead(termTokens, vocabulary, input.locale);
    const roleIndexes = new Set();
    const phraseRoleIndexes = new Set();
    const phraseRoleReasons = new Map();
    const phraseRoleReasonLengths = new Map();
    const rolePhraseMatches = findIntentPhraseMatches(termTokens, vocabulary.rolePhrasesByFirstToken, vocabulary.maxRolePhraseLength);
    const venueTokens = [];
    const domainTokens = [];
    const seniority = [];
    const credentials = [];
    const ambiguous = [];
    const unresolved = [];
    const diagnostics = [];
    let selectedRoleHeadIndex = roleHead?.index ?? -1;
    let fallbackReason = 'rightmost useful token fallback';
    if (roleHead) {
        roleIndexes.add(roleHead.index);
        let hasAnchoredLeftRolePhrase = false;
        for (const match of rolePhraseMatches) {
            for (const term of match.terms) {
                const currentLength = phraseRoleReasonLengths.get(term.index) ?? 0;
                if (currentLength > match.phrase.tokens.length) {
                    continue;
                }
                phraseRoleIndexes.add(term.index);
                phraseRoleReasons.set(term.index, `matched generated role phrase "${match.phrase.key}"`);
                phraseRoleReasonLengths.set(term.index, match.phrase.tokens.length);
            }
        }
        for (let cursor = roleHead.termIndex - 1; cursor >= 0; cursor -= 1) {
            const term = termTokens[cursor];
            if (!term) {
                continue;
            }
            if (seniorityTokens.has(term.token) || tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
                continue;
            }
            if (phraseRoleIndexes.has(term.index)) {
                roleIndexes.add(term.index);
                hasAnchoredLeftRolePhrase = true;
                continue;
            }
            if (hasRoleModifierAuthority(term.normalizedToken, vocabulary, roleExpansionTokens, input.locale) ||
                tokenInSetOrVariant(term.normalizedToken, vocabulary.roleHeads, input.locale)) {
                roleIndexes.add(term.index);
                hasAnchoredLeftRolePhrase = true;
                continue;
            }
            if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
                break;
            }
            if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
                break;
            }
            if (tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)) {
                roleIndexes.add(term.index);
                ambiguous.push(term.token);
                continue;
            }
            if (hasAnchoredLeftRolePhrase) {
                break;
            }
            if (phraseRoleIndexes.has(term.index)) {
                roleIndexes.add(term.index);
                continue;
            }
            roleIndexes.add(term.index);
        }
        const scanDirection = GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE[input.locale] ?? GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE.unknown;
        if (scanDirection === 1) {
            for (let cursor = roleHead.termIndex + 1; cursor < termTokens.length; cursor += 1) {
                const term = termTokens[cursor];
                if (!term) {
                    continue;
                }
                if (seniorityTokens.has(term.token) || tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
                    continue;
                }
                if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
                    break;
                }
                if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
                    break;
                }
                roleIndexes.add(term.index);
            }
        }
    }
    else {
        // No known role head was found. English still prefers the rightmost useful token because its
        // generic fallback is usually a head-final noun phrase. Other locales use the leftmost useful
        // token so the fallback behaves more like the surface order of their titles.
        let fallback;
        const scanDirection = GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE[input.locale] ?? GENERIC_FALLBACK_SCAN_DIRECTION_BY_LOCALE.unknown;
        const startIndex = scanDirection === -1 ? termTokens.length - 1 : 0;
        const endIndex = scanDirection === -1 ? -1 : termTokens.length;
        fallbackReason = scanDirection === -1 ? 'rightmost useful token fallback' : 'leftmost useful token fallback';
        for (let cursor = startIndex; cursor !== endIndex; cursor += scanDirection) {
            const term = termTokens[cursor];
            if (!term) {
                continue;
            }
            if (seniorityTokens.has(term.token) ||
                tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale) ||
                tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale) ||
                tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)) {
                continue;
            }
            fallback = term;
            break;
        }
        if (fallback) {
            roleIndexes.add(fallback.index);
            selectedRoleHeadIndex = fallback.index;
        }
    }
    for (const term of termTokens) {
        if (seniorityTokens.has(term.token)) {
            seniority.push(term.token);
            diagnostics.push(decision(term, 'seniority_modifier', 'known job-level modifier'));
            continue;
        }
        if (tokenInSetOrVariant(term.normalizedToken, vocabulary.credentialModifiers, input.locale)) {
            credentials.push(term.token);
            diagnostics.push(decision(term, 'credential_modifier', 'known credential or license modifier'));
            continue;
        }
        if (roleIndexes.has(term.index)) {
            diagnostics.push(decision(term, term.index === selectedRoleHeadIndex ? 'role_head' : 'role_modifier', phraseRoleReasons.get(term.index) ??
                (term.index === roleHead?.index
                    ? 'rightmost known role anchor'
                    : term.index === selectedRoleHeadIndex
                        ? fallbackReason
                        : 'left role-specialty modifier')));
            continue;
        }
        if (tokenInSetOrVariant(term.normalizedToken, venueContextTerms, input.locale)) {
            venueTokens.push(term.token);
            diagnostics.push(decision(term, 'venue_context', 'known venue/context modifier outside role phrase'));
            continue;
        }
        if (tokenInSetOrVariant(term.normalizedToken, vocabulary.domainModifiers, input.locale)) {
            domainTokens.push(term.token);
            diagnostics.push(decision(term, 'domain_modifier', 'known domain/context modifier outside role phrase'));
            continue;
        }
        if (tokenInSetOrVariant(term.normalizedToken, vocabulary.ambiguousModifiers, input.locale)) {
            ambiguous.push(term.token);
            diagnostics.push(decision(term, 'ambiguous_modifier', 'known ambiguous modifier outside role phrase'));
            continue;
        }
        unresolved.push(term.token);
        diagnostics.push(decision(term, 'unresolved_modifier', 'useful token was not classified as role or domain'));
    }
    const sortedRoleTerms = termTokens.filter((term) => roleIndexes.has(term.index)).sort((left, right) => left.index - right.index);
    const roleTokens = sortedRoleTerms.map((term) => term.token);
    const roleHeadTokens = sortedRoleTerms.filter((term) => term.index === selectedRoleHeadIndex).map((term) => term.token);
    return {
        roleTokens: unique(roleTokens),
        roleHeadTokens: unique(roleHeadTokens),
        venueTokens: unique(venueTokens),
        domainTokens: unique(domainTokens),
        seniorityTokens: unique(seniority),
        credentialTokens: unique(credentials),
        ambiguousTokens: unique(ambiguous),
        unresolvedModifierTokens: unique(unresolved),
        confidence: confidenceScore(Boolean(roleHead), roleTokens.length, domainTokens.length, unresolved.length),
        diagnostics: diagnostics.sort((left, right) => left.index - right.index)
    };
}
function emptyIntent() {
    return {
        roleTokens: [],
        roleHeadTokens: [],
        venueTokens: [],
        domainTokens: [],
        seniorityTokens: [],
        credentialTokens: [],
        ambiguousTokens: [],
        unresolvedModifierTokens: [],
        confidence: 0,
        diagnostics: []
    };
}
function vocabularyLookup(vocabulary, locale) {
    const localeCache = VOCABULARY_LOOKUP_CACHE.get(vocabulary) ?? new Map();
    const cached = localeCache.get(locale);
    if (cached) {
        return cached;
    }
    const profiles = localeProfilesWithEnglishBackbone(vocabulary, locale);
    const builtinProfiles = localeProfilesWithEnglishBackbone(BUILTIN_INTENT_VOCABULARY, locale);
    const lookup = {
        roleHeads: setFromTerms([...flatProfileTerms(profiles, 'roleHeadTerms'), ...flatProfileTerms(builtinProfiles, 'roleHeadTerms')]),
        roleModifiers: setFromTerms([
            ...flatProfileTerms(profiles, 'roleModifierTerms'),
            ...flatProfileTerms(builtinProfiles, 'roleModifierTerms')
        ]),
        domainModifiers: setFromTerms([
            ...flatProfileTerms(profiles, 'domainModifierTerms'),
            ...flatProfileTerms(builtinProfiles, 'domainModifierTerms')
        ]),
        credentialModifiers: setFromTerms([
            ...flatProfileTerms(profiles, 'credentialModifierTerms'),
            ...flatProfileTerms(builtinProfiles, 'credentialModifierTerms')
        ]),
        ambiguousModifiers: setFromTerms([
            ...flatProfileTerms(profiles, 'ambiguousModifierTerms'),
            ...flatProfileTerms(builtinProfiles, 'ambiguousModifierTerms')
        ]),
        ...phraseLookup([...flatProfileTerms(profiles, 'rolePhrases'), ...flatProfileTerms(builtinProfiles, 'rolePhrases')], [...flatProfileTerms(profiles, 'domainPhrases'), ...flatProfileTerms(builtinProfiles, 'domainPhrases')])
    };
    localeCache.set(locale, lookup);
    VOCABULARY_LOOKUP_CACHE.set(vocabulary, localeCache);
    return lookup;
}
function localeProfilesWithEnglishBackbone(vocabulary, locale) {
    const profiles = [];
    const seen = new Set();
    for (const localeCode of [locale, 'en', 'unknown']) {
        if (seen.has(localeCode)) {
            continue;
        }
        const profile = vocabulary.resolveLocaleProfile?.(localeCode) ??
            vocabulary.localeProfiles.find((record) => record.localeCode === localeCode) ??
            null;
        if (profile) {
            profiles.push(profile);
            seen.add(localeCode);
        }
    }
    return profiles;
}
function flatProfileTerms(profiles, field) {
    return profiles.flatMap((profile) => profile[field]);
}
function findRoleHead(terms, vocabulary, locale) {
    const framePriorityByToken = ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE[locale] ?? ROLE_FRAME_MARKER_PRIORITY_BY_LOCALE.unknown;
    const headCandidates = [];
    for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
        const term = terms[termIndex];
        if (!term || !tokenInSetOrVariant(term.normalizedToken, vocabulary.roleHeads, locale)) {
            continue;
        }
        headCandidates.push({
            ...term,
            termIndex,
            framePriority: framePriorityByToken.get(term.normalizedToken) ?? -1
        });
    }
    if (headCandidates.length === 0) {
        return null;
    }
    const nonFrameCandidates = headCandidates.filter((candidate) => candidate.framePriority < 0);
    const preferredCandidates = nonFrameCandidates.length > 0 ? nonFrameCandidates : headCandidates;
    const bestCandidate = preferredCandidates.sort((left, right) => {
        return right.framePriority - left.framePriority || right.termIndex - left.termIndex || left.index - right.index;
    })[0];
    return bestCandidate ?? null;
}
function decision(term, kind, reason) {
    return {
        token: term.token,
        normalizedToken: term.normalizedToken,
        index: term.index,
        kind,
        reason
    };
}
function confidenceScore(hasKnownRoleHead, roleTokenCount, domainTokenCount, unresolvedCount) {
    const score = (hasKnownRoleHead ? 0.68 : 0.34) +
        Math.min(roleTokenCount, 3) * 0.08 +
        Math.min(domainTokenCount, 2) * 0.03 -
        Math.min(unresolvedCount, 3) * 0.08;
    return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}
function tokenInSetOrVariant(token, values, locale) {
    return tokenMatchesLocaleVariant(token, values, locale);
}
function isKnownIntentVocabularyTerm(token, vocabulary, locale) {
    return (tokenInSetOrVariant(token, vocabulary.roleHeads, locale) ||
        tokenInSetOrVariant(token, vocabulary.roleModifiers, locale) ||
        tokenInSetOrVariant(token, VENUE_CONTEXT_TERMS_BY_LOCALE.en, locale) ||
        tokenInSetOrVariant(token, vocabulary.domainModifiers, locale) ||
        tokenInSetOrVariant(token, vocabulary.credentialModifiers, locale) ||
        tokenInSetOrVariant(token, vocabulary.ambiguousModifiers, locale));
}
function findIntentPhraseMatches(terms, phrasesByFirstToken, maxPhraseLength) {
    if (maxPhraseLength < 2 || terms.length < 2) {
        return [];
    }
    const matches = [];
    for (let start = 0; start < terms.length; start += 1) {
        const firstTerm = terms[start];
        if (!firstTerm) {
            continue;
        }
        const phraseCandidates = phrasesByFirstToken.get(firstTerm.normalizedToken);
        if (!phraseCandidates) {
            continue;
        }
        for (const phrase of phraseCandidates) {
            if (phrase.tokens.length > maxPhraseLength || start + phrase.tokens.length > terms.length) {
                continue;
            }
            const candidateTerms = terms.slice(start, start + phrase.tokens.length);
            if (phrase.tokens.every((token, offset) => phraseTokenMatches(candidateTerms[offset]?.normalizedToken ?? '', token))) {
                matches.push({ phrase, terms: candidateTerms });
            }
        }
    }
    return matches;
}
function phraseLookup(rolePhrases, domainPhrases) {
    const rolePhrasesByFirstToken = buildPhraseIndex(rolePhrases);
    const domainPhrasesByFirstToken = buildPhraseIndex(domainPhrases);
    return {
        rolePhrasesByFirstToken,
        domainPhrasesByFirstToken,
        maxRolePhraseLength: maxPhraseLength(rolePhrasesByFirstToken),
        maxDomainPhraseLength: maxPhraseLength(domainPhrasesByFirstToken)
    };
}
function buildPhraseIndex(phrases) {
    const byFirstToken = new Map();
    const seen = new Set();
    for (const phrase of phrases) {
        const parsed = parsePhrase(phrase);
        if (!parsed || seen.has(parsed.key)) {
            continue;
        }
        seen.add(parsed.key);
        const firstToken = parsed.tokens[0];
        const bucket = byFirstToken.get(firstToken) ?? [];
        bucket.push(parsed);
        byFirstToken.set(firstToken, bucket);
    }
    for (const bucket of byFirstToken.values()) {
        bucket.sort((left, right) => right.tokens.length - left.tokens.length || left.key.localeCompare(right.key));
    }
    return byFirstToken;
}
/**
 * Every locale lookup indexes its own phrases plus the English backbone, so the
 * same raw phrase is parsed once per locale. Memoising the parse keeps one copy
 * of each phrase record and its tokens, and — because the backbone dominates —
 * turns the repeat locales into map lookups instead of split/map/filter/join
 * over tens of thousands of phrases. `null` marks phrases that index to fewer
 * than two usable tokens, so they are rejected without re-splitting too.
 */
const PHRASE_TOKEN_POOL = new Map();
const PARSED_PHRASE_BY_RAW = new Map();
function parsePhrase(phrase) {
    const memoized = PARSED_PHRASE_BY_RAW.get(phrase);
    if (memoized !== undefined) {
        return memoized;
    }
    const tokens = [];
    for (const rawToken of phrase.split(/\s+/u)) {
        const token = normalizeIntentToken(rawToken);
        if (token.length >= 3) {
            tokens.push(internPhraseToken(token));
        }
    }
    const parsed = tokens.length < 2 ? null : { key: tokens.join(' '), tokens };
    PARSED_PHRASE_BY_RAW.set(phrase, parsed);
    return parsed;
}
function internPhraseToken(token) {
    const pooled = PHRASE_TOKEN_POOL.get(token);
    if (pooled !== undefined) {
        return pooled;
    }
    PHRASE_TOKEN_POOL.set(token, token);
    return token;
}
function maxPhraseLength(index) {
    let max = 0;
    for (const phrases of index.values()) {
        for (const phrase of phrases) {
            max = Math.max(max, phrase.tokens.length);
        }
    }
    return max;
}
function phraseTokenMatches(candidateToken, phraseToken) {
    if (candidateToken === phraseToken) {
        return true;
    }
    return simpleEnglishVariants(candidateToken).includes(phraseToken);
}
function hasRoleModifierAuthority(token, vocabulary, roleExpansionTokens, locale) {
    return roleExpansionTokens.has(token) || tokenInSetOrVariant(token, vocabulary.roleModifiers, locale);
}
function simpleEnglishVariants(token) {
    if (token.endsWith('ies') && token.length > 4) {
        return [`${token.slice(0, -3)}y`];
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return [token.slice(0, -1)];
    }
    return [];
}
function setFromTerms(values) {
    return new Set(values.map(normalizeIntentToken).filter((value) => value.length >= 3));
}
function normalizeIntentToken(value) {
    return value.trim().toLocaleLowerCase('en-US');
}
function unique(values) {
    return Array.from(new Set(values));
}
function buildFrameMarkerPriorityIndex(markers) {
    const prioritized = new Map();
    for (let index = 0; index < markers.length; index += 1) {
        const marker = markers[index];
        if (!marker) {
            continue;
        }
        prioritized.set(marker, index);
    }
    return prioritized;
}
