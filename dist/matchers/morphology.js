/**
 * Number (plural ↔ singular) expansion for query surfaces.
 *
 * Input is an already-normalized token/phrase (lowercased, diacritics folded —
 * see normalizeText / foldSurface). Returns unique variant forms including the
 * original, so exact matching becomes number-agnostic: a plural surface also
 * tries its singular (to hit a singular alias) and vice-versa.
 *
 * SAFE BY CONSTRUCTION: variants feed EXACT match only, so a wrong guess matches
 * no alias and does nothing — it can never create a false positive.
 *
 * The rules are PER-LOCALE (en/ro/hu/et) — plural is a language-specific pattern,
 * not one hardcoded ruleset. These are light starter patterns meant to be
 * refined per language; because of the safety property, partial rules are fine.
 */
/** Don't mangle very short tokens (avoid turning 2–3 letter words into noise). */
const MIN_STEM = 3;
// Starter, refine-me rules. Keyed by locale; `default` used when locale unknown.
const RULES = {
    en: { strip: ['s', 'es'], add: ['s'] },
    ro: { strip: ['i', 'e', 'uri'], add: ['i', 'e'] },
    hu: { strip: ['k', 'ok', 'ek', 'ak'], add: ['k'] },
    et: { strip: ['d', 'id'], add: ['d'] },
    default: { strip: ['i', 's'], add: ['i', 's'] },
};
const rulesFor = (locale) => RULES[locale ?? ''] ?? RULES.default;
const mapTokens = (phrase, f) => phrase.split(' ').map(f).join(' ');
export function numberVariants(normalized, locale) {
    const base = normalized.trim();
    if (!base)
        return [];
    const { strip, add } = rulesFor(locale);
    const out = new Set([base]);
    for (const suf of strip) {
        out.add(mapTokens(base, (t) => (t.endsWith(suf) && t.length - suf.length >= MIN_STEM ? t.slice(0, -suf.length) : t)));
    }
    for (const suf of add) {
        out.add(mapTokens(base, (t) => (t.length >= MIN_STEM ? t + suf : t)));
    }
    return [...out].filter(Boolean);
}
