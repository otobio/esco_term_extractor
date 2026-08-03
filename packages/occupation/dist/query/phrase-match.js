import { foldSearchText } from '../utils/texts.js';
const OPTIONAL_LINKER_TOKENS_BY_LOCALE = {
    en: new Set(['and', 'for', 'of', 'to']),
    ro: new Set(['cu', 'de', 'din', 'in', 'la', 'pe', 'si', 'în', 'și']),
    hu: new Set(['a', 'az', 'es', 'és']),
    et: new Set(['ja', 'ning', 'on', 'voi', 'või']),
    unknown: new Set()
};
const MAX_OPTIONAL_LINKER_TOKENS = 1;
export function compareTokenPhraseWithOptionalLinkers(candidateTokens, entryTokens, locale) {
    let approximate = false;
    let candidateIndex = 0;
    let skippedLinkers = 0;
    const linkerTokens = OPTIONAL_LINKER_TOKENS_BY_LOCALE[locale] ?? OPTIONAL_LINKER_TOKENS_BY_LOCALE.unknown;
    for (let index = 0; index < entryTokens.length; index += 1) {
        const expected = entryTokens[index] ?? '';
        let candidate = candidateTokens[candidateIndex] ?? '';
        while (candidate && linkerTokens.has(candidate) && skippedLinkers < MAX_OPTIONAL_LINKER_TOKENS) {
            skippedLinkers += 1;
            candidateIndex += 1;
            candidate = candidateTokens[candidateIndex] ?? '';
        }
        if (tokensEquivalent(candidate, expected)) {
            candidateIndex += 1;
            continue;
        }
        if (isEditDistanceAtMostOne(candidate, expected)) {
            approximate = true;
            candidateIndex += 1;
            continue;
        }
        return { ok: false, approximate: false };
    }
    for (; candidateIndex < candidateTokens.length; candidateIndex += 1) {
        if (!linkerTokens.has(candidateTokens[candidateIndex] ?? '') || skippedLinkers >= MAX_OPTIONAL_LINKER_TOKENS) {
            return { ok: false, approximate: false };
        }
        skippedLinkers += 1;
    }
    return { ok: true, approximate };
}
function tokensEquivalent(left, right) {
    if (left === right) {
        return true;
    }
    return foldSearchText(left) === foldSearchText(right);
}
function isEditDistanceAtMostOne(left, right) {
    if (left === right) {
        return true;
    }
    if (left.length < 4 || right.length < 4) {
        return false;
    }
    const a = foldSearchText(left);
    const b = foldSearchText(right);
    if (Math.abs(a.length - b.length) > 1) {
        return false;
    }
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if (edits > 1) {
            return false;
        }
        if (a.length > b.length) {
            i += 1;
            continue;
        }
        if (b.length > a.length) {
            j += 1;
            continue;
        }
        i += 1;
        j += 1;
    }
    edits += a.length - i + (b.length - j);
    return edits <= 1;
}
