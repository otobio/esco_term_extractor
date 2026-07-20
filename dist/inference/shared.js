/**
 * Shared helpers for the rule-based inference layer (employment / schedule / level).
 *
 * These buckets are usually *implied* by numeric and idiomatic signals rather than
 * stated as clean aliases, so we parse them deterministically. All matching runs
 * on a "loose" normalization that folds diacritics + lowercases but KEEPS the
 * digits, ':', '/' and '-' that hours and time-ranges depend on.
 *
 * Numeric parsers take ONE {@link Locale} and build a single-language regex — the
 * caller loops over {@link LOCALES}. Idiom rules likewise live in per-locale blocks
 * inside each bucket module. No regex ever mixes languages.
 *
 * `FiniteInferOptions.titleMode` is a cross-cutting flag a caller threads into rule
 * inference via the `inferFiniteBucket` dispatcher (see inference/index.ts) — true
 * for the title profile (short, terse text), where it loosens gates that are
 * otherwise strict for noisier body/description text. Most inferers ignore it;
 * currently only `inferQualifications` reads it. It lives here rather than in
 * index.ts so bucket modules can import it without a circular dependency on the
 * dispatcher that imports them.
 *
 * `parseExperienceYears` requires the number+years token to sit directly next to
 * an experience word (either order) — this is what separates "5+ years
 * experience" from age ("peste 35 ani"), contract length ("contract pe 2 ani") or
 * company age ("firmă cu 15 ani pe piață").
 *
 * `parseTimeRanges` only accepts a bare (colon-less) range like "22-06" when one
 * of `L.scheduleCue` is also present, so "1-3 years" isn't mistaken for a
 * schedule; colon ranges ("09:00-17:00") need no such cue.
 */
import { isNegated } from '../negation.js';
import { alt } from './locales.js';
export function applyIdioms(loose, rawClause, rules, add) {
    for (const r of rules) {
        const m = r.re.exec(loose);
        if (m && !isNegated(rawClause, m[0]))
            add(r.key, r.score, rawClause);
    }
}
export function collector() {
    const found = new Map();
    const add = (key, score, evidence) => {
        const prev = found.get(key);
        if (!prev || score > prev.score)
            found.set(key, { canonicalKey: key, score, evidence });
    };
    return { add, terms: () => [...found.values()] };
}
export function normalizeLoose(text) {
    return text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[–—−]/g, '-')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}:/\-\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
export function parseWeeklyHours(loose, L) {
    const re = new RegExp(`(\\d{1,3})\\s*${alt(L.hour)}?\\s*(?:/|${alt(L.connect)})?\\s*${alt(L.week)}\\b`, 'i');
    const m = re.exec(loose);
    if (!m)
        return null;
    const n = Number(m[1]);
    return n >= 1 && n <= 90 ? n : null;
}
export function parseDailyHours(loose, L) {
    const perDay = new RegExp(`(\\d{1,2})\\s*${alt(L.hour)}\\s*(?:/|${alt(L.connect)})?\\s*${alt(L.day)}\\b`, 'i');
    const program = new RegExp(`(?:program|norma|orar|schedule)\\s*(?:de\\s*)?(\\d{1,2})\\s*${alt(L.hour)}\\b`, 'i');
    const m = perDay.exec(loose) ?? program.exec(loose);
    if (!m)
        return null;
    const n = Number(m[1]);
    return n >= 1 && n <= 24 ? n : null;
}
export function parseExperienceYears(loose, L) {
    const Y = alt(L.years);
    const E = alt(L.experience);
    const m = new RegExp(`(\\d{1,2})\\s*-\\s*\\d{1,2}\\s*\\+?\\s*${Y}\\b[^.]{0,15}?${E}`, 'i').exec(loose) ||
        new RegExp(`(\\d{1,2})\\s*\\+?\\s*${Y}\\b[^.]{0,15}?${E}`, 'i').exec(loose) ||
        new RegExp(`${E}[^.]{0,20}?(\\d{1,2})\\s*-\\s*\\d{1,2}\\s*\\+?\\s*${Y}\\b`, 'i').exec(loose) ||
        new RegExp(`${E}[^.]{0,20}?(\\d{1,2})\\s*\\+?\\s*${Y}\\b`, 'i').exec(loose);
    return m ? clampYears(m[1]) : null;
}
function clampYears(s) {
    const n = Number(s);
    return n >= 0 && n <= 50 ? n : null;
}
export function parseTimeRanges(loose, L) {
    const cue = new RegExp(`\\b${alt(L.scheduleCue)}\\b`).test(loose);
    const re = /(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/g;
    const out = [];
    for (const m of loose.matchAll(re)) {
        const hasColon = m[2] !== undefined || m[4] !== undefined;
        if (!hasColon && !cue)
            continue;
        const start = Number(m[1]);
        const end = Number(m[3]);
        if (start > 24 || end > 24)
            continue;
        out.push({ start, end });
    }
    return out;
}
