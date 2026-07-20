import { hashTokenSequence, hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, isGenericQueryToken, isSafeJobLevelModifierToken, isStopQueryToken, normalizeQueryLocale, normalizeSearchSurfaceText, tokenizeNormalizedText } from './query-preparation.js';
const VOCABULARY_CACHE = new Map();
const MAX_ROLE_SPAN_TOKENS = 6;
const MIN_ROLE_SPAN_SCORE = 1.25;
export async function selectOccupationRoleSpan(options) {
    const locale = normalizeQueryLocale(options.locale);
    const vocabulary = await loadSignalVocabulary(options.sourceName);
    const cleanedQuery = options.querySpans.join(' ').trim() || options.originalQuery.trim();
    const surfaceTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(cleanedQuery));
    const foldedTokens = surfaceTokens.map((token) => foldSearchText(token));
    if (foldedTokens.length === 0) {
        return emptySelection(options.originalQuery, cleanedQuery);
    }
    const candidates = buildSpanCandidates(surfaceTokens, foldedTokens, locale, vocabulary);
    const selectedSpan = selectBestCandidate(candidates, foldedTokens.length);
    const roleQuery = selectedSpan?.text ?? cleanedQuery;
    const contextQuery = selectedSpan ? contextForSelection(surfaceTokens, selectedSpan) : '';
    return {
        originalQuery: options.originalQuery,
        cleanedQuery,
        roleQuery,
        contextQuery,
        selectedSpan,
        candidates: candidates.slice(0, 20)
    };
}
async function loadSignalVocabulary(sourceName) {
    let cached = VOCABULARY_CACHE.get(sourceName);
    if (!cached) {
        cached = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => ({
            artifact: entry.artifact,
            maxPhraseTokenCount: entry.artifact.maxPhraseTokenCount
        }));
        VOCABULARY_CACHE.set(sourceName, cached);
    }
    return cached;
}
function buildSpanCandidates(surfaceTokens, foldedTokens, locale, vocabulary) {
    const candidates = [];
    const maxWindow = Math.min(MAX_ROLE_SPAN_TOKENS, foldedTokens.length);
    for (let start = 0; start < foldedTokens.length; start += 1) {
        for (let windowSize = 1; windowSize <= maxWindow && start + windowSize <= foldedTokens.length; windowSize += 1) {
            candidates.push(scoreSpan(surfaceTokens, foldedTokens, start, start + windowSize, locale, vocabulary));
        }
    }
    return candidates.sort(compareSpanCandidates);
}
function scoreSpan(surfaceTokens, foldedTokens, startToken, endToken, locale, vocabulary) {
    const spanSurfaceTokens = surfaceTokens.slice(startToken, endToken);
    const spanFoldedTokens = foldedTokens.slice(startToken, endToken);
    const tokenCount = spanFoldedTokens.length;
    const knownTokenCount = spanFoldedTokens.filter((token) => vocabulary.artifact.tokenHashes.has(hashVocabularyText(token))).length;
    const tokenCoverage = tokenCount === 0 ? 0 : knownTokenCount / tokenCount;
    const longestPhraseLength = longestKnownPhraseLength(spanFoldedTokens, vocabulary);
    const exactPhraseKnown = hasKnownPhrase(spanFoldedTokens, vocabulary);
    const anchorCounts = spanFoldedTokens.map((token) => occupationAnchorCount(token, vocabulary.artifact));
    const maxAnchorCount = Math.max(0, ...anchorCounts);
    const codeTokenCount = spanFoldedTokens.filter(isCodeLikeToken).length;
    const genericTokenCount = spanFoldedTokens.filter((token) => isLowRoleSignalToken(token, locale)).length;
    const evidence = [];
    if (exactPhraseKnown) {
        evidence.push('exact_signal_phrase');
    }
    if (longestPhraseLength >= 2) {
        evidence.push(`known_signal_phrase_${longestPhraseLength}`);
    }
    if (knownTokenCount > 0) {
        evidence.push(`known_tokens_${knownTokenCount}`);
    }
    if (maxAnchorCount > 0) {
        evidence.push(`anchor_count_${maxAnchorCount}`);
    }
    if (codeTokenCount > 0) {
        evidence.push(`code_tokens_${codeTokenCount}`);
    }
    if (genericTokenCount === tokenCount && tokenCount > 0) {
        evidence.push('generic_only');
    }
    const phraseScore = exactPhraseKnown ? 3.2 : longestPhraseLength * 0.55;
    const coverageScore = tokenCoverage * 1.4;
    const anchorScore = Math.min(maxAnchorCount / 25, 1.1);
    const lengthScore = Math.min(tokenCount, 4) * 0.12;
    const codePenalty = codeTokenCount * 1.2;
    const genericPenalty = genericTokenCount === tokenCount ? 0.75 : Math.max(0, genericTokenCount - 1) * 0.15;
    const score = roundScore(phraseScore + coverageScore + anchorScore + lengthScore - codePenalty - genericPenalty);
    return {
        text: spanSurfaceTokens.join(' '),
        foldedText: spanFoldedTokens.join(' '),
        startToken,
        endToken,
        tokenCount,
        knownTokenCount,
        tokenCoverage: roundScore(tokenCoverage),
        longestPhraseLength,
        exactPhraseKnown,
        maxAnchorCount,
        codeTokenCount,
        genericTokenCount,
        score,
        evidence
    };
}
function selectBestCandidate(candidates, totalTokenCount) {
    const fullSpan = candidates.find((candidate) => candidate.startToken === 0 && candidate.endToken === totalTokenCount) ?? null;
    const best = candidates[0] ?? null;
    if (!best) {
        return null;
    }
    if (!fullSpan) {
        return best.score >= MIN_ROLE_SPAN_SCORE ? best : null;
    }
    if (fullSpan.codeTokenCount === 0 && fullSpan.score > 0) {
        return fullSpan;
    }
    if (best.score < MIN_ROLE_SPAN_SCORE) {
        return fullSpan.score > 0 ? fullSpan : null;
    }
    return best;
}
function compareSpanCandidates(left, right) {
    return (right.score - left.score ||
        Number(right.exactPhraseKnown) - Number(left.exactPhraseKnown) ||
        right.longestPhraseLength - left.longestPhraseLength ||
        right.knownTokenCount - left.knownTokenCount ||
        right.tokenCount - left.tokenCount ||
        left.startToken - right.startToken);
}
function contextForSelection(surfaceTokens, selectedSpan) {
    return [
        ...surfaceTokens.slice(0, selectedSpan.startToken),
        ...surfaceTokens.slice(selectedSpan.endToken)
    ].join(' ').trim();
}
function hasKnownPhrase(tokens, vocabulary) {
    if (tokens.length === 0) {
        return false;
    }
    if (tokens.length === 1) {
        return vocabulary.artifact.tokenHashes.has(hashVocabularyText(tokens[0] ?? ''));
    }
    return vocabulary.artifact.phraseHashesByTokenCount.get(tokens.length)?.has(hashTokenSequence(tokens)) ?? false;
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
function occupationAnchorCount(token, artifact) {
    const index = artifact.anchorHashes.indexOf(hashVocabularyText(token));
    return index < 0 ? 0 : artifact.anchorCounts.get(index);
}
function isLowRoleSignalToken(token, locale) {
    return isGenericQueryToken(token, locale) || isStopQueryToken(token, locale) || isSafeJobLevelModifierToken(token, locale);
}
function isCodeLikeToken(token) {
    return /^(?:id|cod|cor)?\d{2,}$/iu.test(token) || /^[a-z]{1,4}\d{2,}$/iu.test(token);
}
function emptySelection(originalQuery, cleanedQuery) {
    return {
        originalQuery,
        cleanedQuery,
        roleQuery: cleanedQuery,
        contextQuery: '',
        selectedSpan: null,
        candidates: []
    };
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
