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
