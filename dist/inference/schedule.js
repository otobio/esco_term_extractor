/**
 * Schedule inference (shifts, business hours, weekend, flexible, on-call, ...).
 * Idiom rules per locale (single-language regexes); shift-count and clock
 * time-range parsing loop over LOCALES. Negation-aware.
 */
import { inferFacetTerms } from './facets.js';
import { LOCALES } from './locales.js';
import { applyIdioms, collector, normalizeLoose, parseTimeRanges, } from './shared.js';
const EN = [
    { key: 'schedule:night_shift', score: 0.9, re: /\b(night shifts?|overnight shift|graveyard)\b/ },
    { key: 'schedule:day_shift', score: 0.85, re: /\b(day shifts?)\b/ },
    { key: 'schedule:swing_shift', score: 0.8, re: /\b(swing shift|afternoon shift)\b/ },
    { key: 'schedule:rotational_shift', score: 0.85, re: /\b(rotational|rotating shifts?)\b/ },
    { key: 'schedule:rotational_shift', score: 0.85, re: /\b([234])\s*shifts?\b/ },
    { key: 'schedule:split_shift', score: 0.8, re: /\b(split shift)\b/ },
    { key: 'schedule:flexible_hours', score: 0.85, re: /\b(flexible (hours|schedule)|flex hours)\b/ },
    { key: 'schedule:async', score: 0.9, re: /\b(asynchronous|async)\b/ },
    { key: 'schedule:on_call', score: 0.8, re: /\b(on[- ]?call)\b/ },
    { key: 'schedule:weekend_only', score: 0.85, re: /\b(weekends? only|only weekends?|weekend shift|weekend work)\b/ },
    {
        key: 'schedule:4x10_schedule',
        score: 0.8,
        re: /\b(4x10|four ten|4[ -]day (work )?week|compressed (work )?week)\b/,
    },
    { key: 'schedule:24_7_standby', score: 0.7, re: /\b(24[ /]?7|non[- ]?stop|around the clock|standby)\b/ },
    {
        key: 'schedule:9_to_5',
        score: 0.8,
        re: /\b(9 to 5|nine to five|business hours|office hours|mon(day)?[ -]fri(day)?)\b/,
    },
];
const RO = [
    { key: 'schedule:night_shift', score: 0.9, re: /\b(tura de noapte|schimb de noapte|tura 3|nocturn)\b/ },
    { key: 'schedule:day_shift', score: 0.85, re: /\b(tura de zi|schimb de zi|tura 1)\b/ },
    { key: 'schedule:swing_shift', score: 0.8, re: /\b(tura 2|dupa-amiaza)\b/ },
    {
        key: 'schedule:rotational_shift',
        score: 0.85,
        re: /\b(ture rotative|schimburi rotative|lucru in (ture|schimburi)|in (ture|schimburi))\b/,
    },
    { key: 'schedule:rotational_shift', score: 0.85, re: /\b([234])\s*(schimburi|ture)\b/ },
    { key: 'schedule:split_shift', score: 0.8, re: /\b(program fractionat|orar fractionat)\b/ },
    { key: 'schedule:flexible_hours', score: 0.85, re: /\b(program flexibil|orar flexibil)\b/ },
    { key: 'schedule:on_call', score: 0.8, re: /\b(de garda|garda permanenta)\b/ },
    { key: 'schedule:weekend_only', score: 0.85, re: /\b(doar (in )?weekend|numai (in )?weekend|doar in weekenduri)\b/ },
    { key: 'schedule:9_to_5', score: 0.8, re: /\b(program de birou|luni[ -]vineri|l[ -]v)\b/ },
];
const HU = [
    { key: 'schedule:night_shift', score: 0.9, re: /\b(ejszakai muszak|ejszakai)\b/ },
    { key: 'schedule:day_shift', score: 0.85, re: /\b(nappali muszak|nappali)\b/ },
    { key: 'schedule:swing_shift', score: 0.8, re: /\b(delutani muszak|delutani)\b/ },
    { key: 'schedule:fixed_shift', score: 0.8, re: /\b(kotott(?: munka(?:rend)?)?)\b/ },
    { key: 'schedule:rotational_shift', score: 0.85, re: /\b(tobb muszak|valto muszak|[23]\s*muszak(?:os)?|muszakos)\b/ },
    { key: 'schedule:flexible_hours', score: 0.85, re: /\b(rugalmas munkaido)\b/ },
    { key: 'schedule:weekend_only', score: 0.85, re: /\b(csak hetvegen|hetvegi munka)\b/ },
    { key: 'schedule:9_to_5', score: 0.8, re: /\b(hetfotol pentekig|hetfo[ -]pentek)\b/ },
];
const ET = [
    { key: 'schedule:night_shift', score: 0.9, re: /\b(oovahetus|oine)\b/ },
    { key: 'schedule:day_shift', score: 0.85, re: /\b(paevane vahetus|paevane)\b/ },
    { key: 'schedule:rotational_shift', score: 0.85, re: /\b(vahetustega|vahetustega too)\b/ },
    { key: 'schedule:flexible_hours', score: 0.85, re: /\b(paindlik (tooaeg|graafik))\b/ },
    { key: 'schedule:weekend_only', score: 0.85, re: /\b(ainult nadalavahetus|nadalavahetuseti)\b/ },
];
const RULES = [...EN, ...RO, ...HU, ...ET];
export function inferSchedule(clauses, languages) {
    const { add, terms } = collector();
    for (const facet of inferFacetTerms('schedule', clauses, languages))
        add(facet.canonicalKey, facet.score, facet.evidence);
    for (const c of clauses) {
        const loose = normalizeLoose(c.text);
        applyIdioms(loose, c.text, RULES, add);
        for (const L of LOCALES) {
            for (const { start, end } of parseTimeRanges(loose, L)) {
                const overnight = start >= 20 || (end <= 7 && end < start) || (start >= 18 && end <= 9);
                const daytime = start >= 6 && start <= 10 && end >= 15 && end <= 19;
                if (overnight)
                    add('schedule:night_shift', 0.85, c.text);
                else if (daytime)
                    add('schedule:9_to_5', 0.75, c.text);
            }
        }
    }
    return terms();
}
