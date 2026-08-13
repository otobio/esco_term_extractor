import { hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { expandTokenVariants, foldSearchText, normalizeQueryLocale } from './query-preparation.js';
const VOCABULARY_CACHE = new Map();
export async function cleanOccupationTitleSignals(options) {
    const locale = normalizeQueryLocale(options.locale);
    const vocabulary = await loadSignalVocabulary(options.sourceName);
    const rawTokens = tokenizeRawOccupationSurface(options.title);
    const termTokens = rawTokens.filter((token) => token.kind === 'term');
    const resolvedTokens = termTokens.map((token) => resolveKnownToken(token.surface, locale, vocabulary.artifact));
    return rebuildKeptSurface(rawTokens, resolvedTokens);
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
    const matched = variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant))) ||
        matchHyphenSplitToken(surface, locale, artifact);
    return {
        surface,
        kept: matched
    };
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
