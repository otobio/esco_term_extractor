import { preparedQueryFoldedRecallSurfaces, preparedQueryFoldedRecallTokenSequences, preparedQueryUsefulFoldedRecallTokenSequences } from '../query/query-preparation.js';
export function buildAuthorityQueryPreparation(rawQuery, preparedQuery) {
    const foldedRecallTokenSequences = preparedQueryFoldedRecallTokenSequences(preparedQuery);
    const usefulFoldedRecallTokenSequences = preparedQueryUsefulFoldedRecallTokenSequences(preparedQuery);
    return {
        queryTokens: uniqueTokens(foldedRecallTokenSequences),
        preparedQueries: uniqueJoinedQueries(usefulFoldedRecallTokenSequences),
        preparedPhraseWindows: buildPreparedPhraseWindows(usefulFoldedRecallTokenSequences),
        rawQueries: Array.from(new Set([rawQuery.trim(), preparedQuery.normalized, ...preparedQueryFoldedRecallSurfaces(preparedQuery)].filter(Boolean)))
    };
}
export function buildPreparedPhraseWindows(foldedRecallTokenSequences) {
    const windows = [];
    const seen = new Set();
    for (const tokens of foldedRecallTokenSequences) {
        appendPreparedPhraseWindows(windows, seen, tokens);
    }
    return windows;
}
function appendPreparedPhraseWindows(windows, seen, tokens) {
    const minimumWindowSize = tokens.length > 1 ? 2 : 1;
    for (let windowSize = tokens.length; windowSize >= minimumWindowSize; windowSize -= 1) {
        for (let start = 0; start <= tokens.length - windowSize; start += 1) {
            const query = tokens
                .slice(start, start + windowSize)
                .join(' ')
                .trim();
            if (!query || seen.has(query)) {
                continue;
            }
            seen.add(query);
            windows.push({ query, tokenCount: windowSize });
        }
    }
}
function uniqueTokens(tokenSequences) {
    return Array.from(new Set(tokenSequences.flat()));
}
function uniqueJoinedQueries(tokenSequences) {
    return Array.from(new Set(tokenSequences.map((tokens) => tokens.join(' ').trim()).filter(Boolean)));
}
