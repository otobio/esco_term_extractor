const ENGLISH_IRREGULAR_VERBS = new Set([
    "be", "have", "do", "go", "say", "get", "make", "know", "think", "take",
    "see", "come", "want", "use", "find", "give", "tell", "work", "call",
    "try", "ask", "need", "feel", "become", "leave", "put", "mean", "keep",
    "let", "begin", "seem", "help", "talk", "turn", "start", "show", "hear",
    "play", "run", "move", "like", "live", "believe", "bring", "happen",
    "write", "provide", "sit", "stand", "lose", "pay", "meet", "include",
    "continue", "set", "learn", "change", "lead", "understand", "watch",
    "follow", "stop", "create", "speak", "read", "allow", "add", "spend",
    "grow", "open", "walk", "win", "offer", "remember", "love", "consider",
    "appear", "buy", "wait", "serve", "die", "send", "expect", "build",
    "stay", "fall", "cut", "reach", "kill", "remain", "suggest", "raise",
    "pass", "sell", "require", "report", "decide", "pull", "drive", "eat",
]);
const ENGLISH_NON_VERB_SUFFIXES = /(ness|ship|ity|ance|ence|ment|tion|sion|ology|ography|ism|ful|ous|ive|ary|able|ible|less)$/i;
const ENGLISH_NON_VERB_TOKENS = new Set([
    "and", "or", "the", "a", "an", "of", "to", "in", "on", "at", "by",
    "with", "for", "as", "is", "was", "were", "not", "no", "yes",
]);
/**
 * Heuristic check for whether a single word could plausibly be an English verb.
 * There is no dictionary/POS dependency in this repo, so this rejects obvious
 * non-verbs (stopwords, noun/adjective suffixes, non-alphabetic tokens) rather
 * than validating against a full lexicon.
 */
export function isLikelyEnglishVerb(word) {
    const normalized = word.trim().toLowerCase();
    if (!normalized || normalized.length < 2)
        return false;
    if (!/^[a-z]+(?:[- ][a-z]+)*$/.test(normalized))
        return false;
    const headWord = normalized.split(/[- ]/)[0];
    if (ENGLISH_NON_VERB_TOKENS.has(headWord))
        return false;
    if (ENGLISH_IRREGULAR_VERBS.has(headWord))
        return true;
    if (ENGLISH_NON_VERB_SUFFIXES.test(headWord))
        return false;
    return true;
}
const SILENT_E_CONSONANTS = new Set(["v", "c", "g", "z", "s"]);
/**
 * Reduces an inflected English verb form to its root/base form
 * (analysing -> analyse, applies -> apply, stopped -> stop). Heuristic only —
 * there's no dictionary/lemmatizer in this repo — so ambiguous cases
 * (e.g. words that keep a final consonant without a silent e) may not
 * round-trip perfectly.
 */
export function toEnglishVerbRootForm(word) {
    const normalized = word.trim().toLowerCase();
    if (!normalized)
        return normalized;
    if (/[^aeiou]ies$/.test(normalized))
        return normalized.replace(/ies$/, "y");
    if (/[^aeiou]ied$/.test(normalized))
        return normalized.replace(/ied$/, "y");
    if (/(ss|sh|ch|x|z|o)es$/.test(normalized))
        return normalized.replace(/es$/, "");
    if (/[a-z]s$/.test(normalized) && !/(ss|us)$/.test(normalized))
        return normalized.replace(/s$/, "");
    for (const suffix of ["ing", "ed"]) {
        if (!normalized.endsWith(suffix))
            continue;
        const stem = normalized.slice(0, -suffix.length);
        const last = stem[stem.length - 1] ?? "";
        const secondLast = stem[stem.length - 2] ?? "";
        if (stem.length >= 3 && last === secondLast && !/[aeiou]/.test(last)) {
            return stem.slice(0, -1);
        }
        return SILENT_E_CONSONANTS.has(last) ? `${stem}e` : stem;
    }
    return normalized;
}
export function americanToBritishOrthography(text) {
    const rules = [
        // -----------------------------
        // -yze -> -yse
        // -----------------------------
        {
            pattern: /([a-z]+)yze\b/gi,
            replace: "$1yse",
        },
        // -----------------------------
        // -ization -> -isation
        // -----------------------------
        {
            pattern: /([a-z]+)ization\b/gi,
            replace: "$1isation",
        },
        // -----------------------------
        // -izing -> -ising
        // -ized  -> -ised
        // -izes  -> -ises
        // -ize   -> -ise
        // -----------------------------
        {
            pattern: /([a-z]+)izing\b/gi,
            replace: "$1ising",
        },
        {
            pattern: /([a-z]+)ized\b/gi,
            replace: "$1ised",
        },
        {
            pattern: /([a-z]+)izes\b/gi,
            replace: "$1ises",
        },
        {
            pattern: /([a-z]+)ize\b/gi,
            replace: "$1ise",
        },
        // -----------------------------
        // -or -> -our
        // -----------------------------
        {
            pattern: /([a-z]+)(color|favor|flavor|honor|labor|neighbor|rumor|savor)\b/gi,
            replace: "$1$2our",
        },
        // -----------------------------
        // -er -> -re
        // Only common geographical/
        // measurement patterns.
        // -----------------------------
        {
            pattern: /\b(center|meter|liter|theater|fiber)\b/gi,
            replace: (word) => {
                return word
                    .replace(/er$/i, "re");
            },
        },
        // -----------------------------
        // Double consonant before
        // suffixes (-ed, -ing, etc.)
        //
        // US:
        // traveled
        // traveling
        //
        // UK:
        // travelled
        // travelling
        // -----------------------------
        {
            pattern: /\b([a-z]+)([bcdfghjklmnpqrstvwxyz])ed\b/gi,
            replace: "$1$2$2ed",
        },
        {
            pattern: /\b([a-z]+)([bcdfghjklmnpqrstvwxyz])ing\b/gi,
            replace: "$1$2$2ing",
        },
        // -----------------------------
        // -ense -> -ence
        // -----------------------------
        {
            pattern: /\b(defense|offense|pretense)\b/gi,
            replace: (word) => word.replace(/se$/i, "ce"),
        },
    ];
    return text.replace(/\b[A-Za-z]+\b/g, (word) => {
        return rules.reduce((result, rule) => result.replace(rule.pattern, rule.replace), word);
    });
}
