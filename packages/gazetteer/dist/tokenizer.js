const CLAUSE_SPLIT = /[\r\n\t.,;:•·▪‣◦•|/]+|\s+(?:and|or|și|si|sau|és|es|vagy|ja|või|voi)\s+/giu;
/** Split a block of text into trimmed, non-empty clauses. */
export function splitClauses(text, source) {
    if (!text)
        return [];
    const out = [];
    for (const raw of text.split(CLAUSE_SPLIT)) {
        const clause = raw.trim();
        if (clause.length < 2)
            continue;
        out.push({ text: clause.length > 160 ? clause.slice(0, 160) : clause, source });
    }
    return out;
}
