// TODO(future variants): US/UK spelling (-ize/-ise, -or/-our, -er/-re, -og/-ogue, -yze/-yse).
import { hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired, localeBitOrdinal } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { expandTokenVariants, normalizeQueryLocale } from './query-preparation.js';
import { foldSearchText } from '../utils/texts.js';
import { trimEdgeSymbols } from './occupation-noise-peeling.js';
const VOCABULARY_CACHE = new Map();
const FoldedExcludeJoinWords = {
    en: ['and', 'of', 'or', 'in'],
    ro: ['si', 'de', 'sau', 'ori', 'in'],
    hu: ['es', 'vagy', 'es', 'ben'],
    et: ['ja', 'ning', 'voi', 'sees']
};
export async function cleanOccupationTitleSignals(options) {
    const locale = normalizeQueryLocale(options.locale);
    const vocabulary = await loadSignalVocabulary(options.sourceName);
    const rawTokens = tokenizeRawOccupationSurface(options.title);
    const termTokens = rawTokens.filter((token) => token.kind === 'term');
    const resolvedTokens = termTokens.map((token) => resolveKnownToken(token.surface, locale, vocabulary.artifact));
    const rebuilt = rebuildKeptSurface(rawTokens, resolvedTokens);
    return trimDanglingJoinWords(rebuilt, locale);
}
function trimDanglingJoinWords(value, locale) {
    const joinWords = new Set(FoldedExcludeJoinWords[locale] ?? []);
    if (joinWords.size === 0) {
        return trimEdgeSymbols(value);
    }
    let current = trimEdgeSymbols(value);
    let previous = '';
    while (current !== previous) {
        previous = current;
        current = trimEdgeSymbols(stripEdgeJoinWord(current, joinWords, -1));
        current = trimEdgeSymbols(stripEdgeJoinWord(current, joinWords, 1));
    }
    return current;
}
function stripEdgeJoinWord(value, joinWords, side) {
    const words = value.split(' ').filter((word) => word.length > 0);
    if (words.length === 0) {
        return value;
    }
    const edgeIndex = side === -1 ? 0 : words.length - 1;
    const edgeWord = words[edgeIndex];
    if (!edgeWord || !joinWords.has(foldSearchText(edgeWord).toLocaleLowerCase('en-US'))) {
        return value;
    }
    words.splice(edgeIndex, 1);
    return words.join(' ');
}
async function loadSignalVocabulary(sourceName) {
    const cacheKey = sourceName;
    let cached = VOCABULARY_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => ({
            sourceName,
            vocabulary: {
                artifact: entry.artifact
            }
        }));
        VOCABULARY_CACHE.set(cacheKey, cached);
    }
    return (await cached).vocabulary;
}
function resolveKnownToken(surface, locale, artifact) {
    const folded = foldSearchText(surface);
    const foldedLower = folded.toLocaleLowerCase('en-US');
    const variants = uniqueVariants([folded, foldedLower, ...expandTokenVariants([foldedLower], locale)]);
    const foldedJoinerTokens = FoldedExcludeJoinWords[locale] || [];
    const matched = variants.some((variant) => variant.length > 0 && (artifact.tokenHashes.has(hashVocabularyText(variant)) || foldedJoinerTokens.includes(variant))) || matchHyphenSplitToken(surface, locale, artifact);
    if (matched) {
        return {
            surface,
            kept: true
        };
    }
    if (locale === 'hu' && isHungarianCompoundOfKnownParts(foldedLower, artifact)) {
        // Recognized as a real HU compound (e.g. "autószerelő" = "autó" + "szerelő"), so it's kept as a
        // signal word -- but left unsplit. Splitting it here would rewrite the surface before curated
        // phrase-atlas / exact-alias matching ever sees it; lang.ts's splitVocabularyCompoundToken (called
        // from query-preparation.ts's compound-split path) contributes the split tokens additively instead,
        // without touching the surface.
        return { surface, kept: true };
    }
    const rescuedSpelling = matchSingleEditSpellingRescue(foldedLower, locale, artifact);
    return {
        surface: rescuedSpelling ? applySurfaceCasePattern(surface, rescuedSpelling) : surface,
        kept: rescuedSpelling !== null
    };
}
// HU is a compounding language (e.g. "autószerelő" = "autó" + "szerelő", car + fitter), so a single
// surface token can carry a role head that only ever appears as a modifier prefix in ESCO's Hungarian
// aliases. This only decides whether such a token counts as a recognized signal word -- it must NOT
// rewrite the surface (see resolveKnownToken's caller comment for why that broke curated phrase
// matching). At least one split side must be tagged HU (the other may be English, ESCO's structural
// backbone locale) so a match can't succeed off two English-tagged fragments alone, which would be
// cross-locale contamination rather than evidence of Hungarian compounding.
function isHungarianCompoundOfKnownParts(foldedLower, artifact) {
    if (foldedLower.length < 8) {
        return false;
    }
    const huBit = localeBitOrdinal(artifact.locales, 'hu');
    const enBit = localeBitOrdinal(artifact.locales, 'en');
    const isHuToken = (folded) => {
        const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(folded));
        return tokenIndex >= 0 && huBit >= 0 && artifact.localeMask.has(tokenIndex, huBit);
    };
    const isHuOrEnglishToken = (folded) => {
        const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(folded));
        return (tokenIndex >= 0 &&
            ((huBit >= 0 && artifact.localeMask.has(tokenIndex, huBit)) || (enBit >= 0 && artifact.localeMask.has(tokenIndex, enBit))));
    };
    for (let splitAt = 4; splitAt <= foldedLower.length - 4; splitAt += 1) {
        const leftFolded = foldedLower.slice(0, splitAt);
        const rightFolded = foldedLower.slice(splitAt);
        if (isHuOrEnglishToken(leftFolded) && isHuOrEnglishToken(rightFolded) && (isHuToken(leftFolded) || isHuToken(rightFolded))) {
            return true;
        }
    }
    return false;
}
// Endings that mark a word as a plausible occupation agent noun (pharmacist, consultant, operator,
// technician, ...). Used only to gate the pricier substitution-edit rescue below -- keeps a typo like
// "pharmicist" reachable without turning cleaning into a general-purpose spellchecker for every OOV
// token. EN-only for now; other locales fall back to deletion/transposition rescue only, same as
// before, until real agent-noun endings for those locales are mined the same way as the venue/domain
// token sets in occupation-leaf-structure-rules.ts.
const AGENT_NOUN_SUFFIXES_BY_LOCALE = {
    en: ['ist', 'ician', 'ian', 'or', 'er', 'ant', 'ent']
};
function looksLikeAgentNounToken(value, locale) {
    const suffixes = AGENT_NOUN_SUFFIXES_BY_LOCALE[locale] ?? [];
    return suffixes.some((suffix) => value.length >= suffix.length + 3 && value.endsWith(suffix));
}
function matchSingleEditSpellingRescue(value, locale, artifact) {
    if (value.length < 5 || /\d/u.test(value)) {
        return null;
    }
    const includeSubstitutions = looksLikeAgentNounToken(value, locale);
    const rescued = new Set();
    for (const candidate of generateSingleEditCandidates(value, includeSubstitutions)) {
        if (artifact.tokenHashes.has(hashVocabularyText(candidate))) {
            rescued.add(candidate);
            if (rescued.size > 1) {
                return null;
            }
        }
    }
    return rescued.size === 1 ? (Array.from(rescued)[0] ?? null) : null;
}
const SUBSTITUTION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
function generateSingleEditCandidates(value, includeSubstitutions) {
    const candidates = new Set();
    // OOV single-edit spelling rescue stays intentionally cheap by default: only extra-letter deletion
    // and adjacent transposition are allowed at runtime. Single-character substitution is far pricier
    // (26x candidates per position) and more prone to false rescues, so it only runs when
    // looksLikeAgentNounToken already gives a reason to believe this token names a role.
    for (let index = 0; index < value.length; index += 1) {
        const deleted = `${value.slice(0, index)}${value.slice(index + 1)}`;
        if (deleted.length >= 3) {
            candidates.add(deleted);
        }
    }
    for (let index = 0; index < value.length - 1; index += 1) {
        const left = value[index];
        const right = value[index + 1];
        if (!left || !right || left === right) {
            continue;
        }
        candidates.add(`${value.slice(0, index)}${right}${left}${value.slice(index + 2)}`);
    }
    if (includeSubstitutions) {
        for (let index = 0; index < value.length; index += 1) {
            const original = value[index];
            for (const letter of SUBSTITUTION_ALPHABET) {
                if (letter === original) {
                    continue;
                }
                candidates.add(`${value.slice(0, index)}${letter}${value.slice(index + 1)}`);
            }
        }
    }
    return Array.from(candidates);
}
function applySurfaceCasePattern(originalSurface, rescued) {
    if (originalSurface === originalSurface.toLocaleUpperCase('en-US')) {
        return rescued.toLocaleUpperCase('en-US');
    }
    if (/^\p{Lu}/u.test(originalSurface)) {
        return rescued.charAt(0).toLocaleUpperCase('en-US') + rescued.slice(1);
    }
    return rescued;
}
function matchHyphenSplitToken(surface, locale, artifact) {
    if (!surface.includes('-')) {
        return false;
    }
    const parts = surface
        .split('-')
        .map((part) => foldSearchText(part).toLocaleLowerCase('en-US'))
        .filter((part) => part.length > 0);
    if (parts.length < 2) {
        return false;
    }
    if (parts.some((part) => part.length === 1)) {
        const joined = parts.join('');
        const variants = uniqueVariants([joined, ...expandTokenVariants([joined], locale)]);
        return (variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant))) ||
            parts.some((part) => part.length > 1 && artifact.tokenHashes.has(hashVocabularyText(part))));
    }
    return parts.every((part) => {
        const variants = uniqueVariants([part, ...expandTokenVariants([part], locale)]);
        return variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant)));
    });
}
function tokenizeRawOccupationSurface(value) {
    const tokens = [];
    const matches = value.matchAll(/[\p{L}\p{N}]+(?:[-+][\p{L}\p{N}]+)*|\/+|\|+|[-–—]+/gu);
    for (const match of matches) {
        const surface = match[0]?.trim();
        if (!surface) {
            continue;
        }
        if (/^(?:\/+|\|+|[-–—]+)$/u.test(surface)) {
            tokens.push({ kind: 'separator', surface });
            continue;
        }
        tokens.push({ kind: 'term', surface });
    }
    return tokens;
}
function rebuildKeptSurface(rawTokens, resolvedTokens) {
    const pieces = [];
    let termIndex = 0;
    for (let index = 0; index < rawTokens.length; index += 1) {
        const token = rawTokens[index];
        if (!token) {
            continue;
        }
        if (token.kind === 'separator') {
            const previousKept = findAdjacentKeptTerm(resolvedTokens, termIndex - 1, -1);
            const nextKept = findAdjacentKeptTerm(resolvedTokens, termIndex, 1);
            if (previousKept && nextKept && pieces[pieces.length - 1] !== token.surface) {
                pieces.push(token.surface);
            }
            continue;
        }
        const resolved = resolvedTokens[termIndex];
        termIndex += 1;
        if (!resolved?.kept) {
            continue;
        }
        pieces.push(resolved.surface);
    }
    return pieces
        .join(' ')
        .replace(/\s+(\/|\||-+|–+|—+)\s+/gu, ' $1 ')
        .replace(/\s+/gu, ' ')
        .trim();
}
function findAdjacentKeptTerm(tokens, startIndex, step) {
    for (let index = startIndex; index >= 0 && index < tokens.length; index += step) {
        const token = tokens[index];
        if (!token) {
            continue;
        }
        return token.kept;
    }
    return false;
}
function uniqueVariants(values) {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}
