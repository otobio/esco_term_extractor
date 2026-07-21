import { hashTokenSequence, hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, isStopQueryToken, prepareOccupationQueryInput, tokenizeNormalizedText } from './query-preparation.js';
const VOCABULARY_CACHE = new Map();
const MIN_MULTI_TOKEN_COVERAGE = 0.5;
const MIN_OCCUPATION_ANCHOR_COUNT = 10;
export async function cleanOccupationTitleSignals(options) {
    const prepared = prepareOccupationQueryInput(options.title, options.locale);
    const result = await cleanOccupationSignals({
        sourceName: options.sourceName,
        locale: options.locale,
        signals: prepared.signals
    });
    return preserveCommaKnownSingleTokenSignals(preserveFirstTitleSignal(result), options.title);
}
export async function cleanOccupationSignals(options) {
    const locale = normalizeCleanerLocale(options.locale);
    const vocabulary = await loadSignalVocabulary(options.sourceName);
    const signals = uniqueNonEmpty(options.signals);
    const decisions = signals.map((signal) => scoreSignal(signal, locale, vocabulary));
    const keptSignals = decisions.filter((decision) => decision.kept).map((decision) => decision.signal);
    return {
        sourceName: options.sourceName,
        locale,
        signals,
        keptSignals,
        decisions
    };
}
async function loadSignalVocabulary(sourceName) {
    const cacheKey = sourceName;
    let cached = VOCABULARY_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => ({
            sourceName,
            vocabulary: {
                artifact: entry.artifact,
                maxPhraseTokenCount: entry.artifact.maxPhraseTokenCount
            }
        }));
        VOCABULARY_CACHE.set(cacheKey, cached);
    }
    return (await cached).vocabulary;
}
function scoreSignal(signal, locale, vocabulary) {
    const tokens = tokenizeForVocabulary(signal, locale);
    const tokenCount = tokens.length;
    const knownTokenCount = tokens.filter((token) => vocabulary.artifact.tokenHashes.has(hashVocabularyText(token))).length;
    const tokenCoverage = tokenCount === 0 ? 0 : knownTokenCount / tokenCount;
    const longestPhraseLength = longestKnownPhraseLength(tokens, vocabulary);
    const hasOccupationAnchor = tokens.some((token) => occupationAnchorCount(token, vocabulary) >= MIN_OCCUPATION_ANCHOR_COUNT);
    const exactPhraseKnown = tokenCount > 0 && hasKnownPhrase(tokens, vocabulary);
    const score = scoreDecision(tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown);
    const kept = shouldKeepSignal(tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown);
    return {
        signal,
        kept,
        score,
        reason: reasonForDecision(kept, tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown),
        tokenCount,
        knownTokenCount,
        tokenCoverage,
        longestPhraseLength,
        hasOccupationAnchor
    };
}
function shouldKeepSignal(tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown) {
    if (tokenCount === 0) {
        return false;
    }
    if (tokenCount === 1) {
        return knownTokenCount === 1 && hasOccupationAnchor;
    }
    if (hasOccupationAnchor && (exactPhraseKnown || longestPhraseLength >= 2 || knownTokenCount >= 1)) {
        return true;
    }
    if (exactPhraseKnown || longestPhraseLength >= 2) {
        return knownTokenCount >= 2 && tokenCoverage >= MIN_MULTI_TOKEN_COVERAGE;
    }
    return false;
}
function scoreDecision(tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown) {
    if (tokenCount === 0) {
        return 0;
    }
    const phraseScore = exactPhraseKnown ? 1 : Math.min(longestPhraseLength / Math.max(tokenCount, 1), 1);
    const anchorScore = hasOccupationAnchor ? 0.2 : 0;
    const knownTokenFloor = knownTokenCount > 0 ? 0.1 : 0;
    return roundScore(Math.min(1, tokenCoverage * 0.55 + phraseScore * 0.35 + anchorScore + knownTokenFloor));
}
function reasonForDecision(kept, tokenCount, knownTokenCount, tokenCoverage, longestPhraseLength, hasOccupationAnchor, exactPhraseKnown) {
    if (tokenCount === 0) {
        return 'empty_signal';
    }
    if (!kept && tokenCount === 1) {
        return 'single_token_without_occupation_anchor';
    }
    if (exactPhraseKnown) {
        return 'exact_vocabulary_phrase';
    }
    if (longestPhraseLength >= 2) {
        return 'known_vocabulary_phrase';
    }
    if (hasOccupationAnchor) {
        return kept ? 'occupation_anchor' : 'weak_occupation_anchor';
    }
    if (knownTokenCount === 0) {
        return 'no_vocabulary_overlap';
    }
    return kept
        ? `token_coverage_${Math.round(tokenCoverage * 100)}`
        : `weak_token_coverage_${Math.round(tokenCoverage * 100)}`;
}
function preserveFirstTitleSignal(result) {
    const firstSignal = result.signals[0];
    if (!firstSignal || result.keptSignals.includes(firstSignal)) {
        return result;
    }
    const decisions = result.decisions.map((decision, index) => index === 0
        ? {
            ...decision,
            kept: true,
            reason: 'first_clause_preserved'
        }
        : decision);
    return {
        ...result,
        keptSignals: uniqueNonEmpty([firstSignal, ...result.keptSignals]),
        decisions
    };
}
function preserveCommaKnownSingleTokenSignals(result, title) {
    if (!title.includes(',')) {
        return result;
    }
    const decisions = result.decisions.map((decision) => !decision.kept &&
        decision.tokenCount === 1 &&
        decision.knownTokenCount === 1 &&
        decision.longestPhraseLength === 1
        ? {
            ...decision,
            kept: true,
            reason: 'comma_known_single_token'
        }
        : decision);
    const keptSignals = uniqueNonEmpty(decisions.filter((decision) => decision.kept).map((decision) => decision.signal));
    return {
        ...result,
        keptSignals,
        decisions
    };
}
function occupationAnchorCount(token, vocabulary) {
    const hash = hashVocabularyText(token);
    const index = vocabulary.artifact.anchorHashes.indexOf(hash);
    return index < 0 ? 0 : vocabulary.artifact.anchorCounts.get(index);
}
function hasKnownPhrase(tokens, vocabulary) {
    if (tokens.length === 1) {
        return vocabulary.artifact.tokenHashes.has(hashVocabularyText(tokens[0] ?? ''));
    }
    const phraseHashes = vocabulary.artifact.phraseHashesByTokenCount.get(tokens.length);
    return phraseHashes ? phraseHashes.has(hashTokenSequence(tokens)) : false;
}
function longestKnownPhraseLength(tokens, vocabulary) {
    const maxWindow = Math.min(tokens.length, vocabulary.maxPhraseTokenCount);
    for (let windowSize = maxWindow; windowSize >= 2; windowSize -= 1) {
        const phraseHashes = vocabulary.artifact.phraseHashesByTokenCount.get(windowSize);
        if (!phraseHashes) {
            continue;
        }
        for (let start = 0; start <= tokens.length - windowSize; start += 1) {
            if (phraseHashes.has(hashTokenSequence(tokens.slice(start, start + windowSize)))) {
                return windowSize;
            }
        }
    }
    return tokens.length === 1 && vocabulary.artifact.tokenHashes.has(hashVocabularyText(tokens[0] ?? '')) ? 1 : 0;
}
function tokenizeForVocabulary(value, locale) {
    return tokenizeNormalizedText(foldSearchText(value))
        .filter((token) => token.length >= 2 && !isStopQueryToken(token, locale));
}
function normalizeCleanerLocale(locale) {
    const normalized = locale?.trim().toLowerCase();
    if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et') {
        return normalized;
    }
    return 'unknown';
}
function uniqueNonEmpty(values) {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        const normalized = value.trim().replace(/\s+/gu, ' ');
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}
function roundScore(value) {
    return Math.round(value * 100000) / 100000;
}
