// TODO(future variants): US/UK spelling (-ize/-ise, -or/-our, -er/-re, -og/-ogue, -yze/-yse).
import { hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired } from '../runtime/occupation-signal-vocabulary-artifact.js';
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
    const rescuedSpelling = matchSingleEditSpellingRescue(foldedLower, artifact);
    return {
        surface: rescuedSpelling ? applySurfaceCasePattern(surface, rescuedSpelling) : surface,
        kept: rescuedSpelling !== null
    };
}
function matchSingleEditSpellingRescue(value, artifact) {
    if (value.length < 5 || /\d/u.test(value)) {
        return null;
    }
    const rescued = new Set();
    for (const candidate of generateSingleEditCandidates(value)) {
        if (artifact.tokenHashes.has(hashVocabularyText(candidate))) {
            rescued.add(candidate);
            if (rescued.size > 1) {
                return null;
            }
        }
    }
    return rescued.size === 1 ? (Array.from(rescued)[0] ?? null) : null;
}
function generateSingleEditCandidates(value) {
    const candidates = new Set();
    // OOV single-edit spelling rescue stays intentionally cheap: only extra-letter deletion and
    // adjacent transposition are allowed at runtime. Broader substitution/insertion is left out to
    // avoid turning signal cleaning into a general spellchecker.
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
        return variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant)));
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
