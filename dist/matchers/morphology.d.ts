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
export declare function numberVariants(normalized: string, locale?: string): string[];
