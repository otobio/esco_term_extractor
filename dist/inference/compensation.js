/**
 * Compensation inference — covers `performance_bonus` phrasings the dictionary's
 * exact alias match drops: the plural of "bonus" ("bonusuri de performanta",
 * "teljesitmeny bonuszok"), the "prima"/"premium" synonym RO/HU/ET use
 * interchangeably with "bonus" ("prima de performanta", "teljesitmeny premium",
 * "tulemuspreemia"), and the "sales bonus" framing in EN/HU/ET.
 *
 * Verified against real RO/EN gold-listing text; the HU/ET rules are the same
 * structural fix applied by direct translation, not individually confirmed
 * against real HU/ET listings.
 */
import { applyIdioms, collector, normalizeLoose } from './shared.js';
const RULES = [
    { key: 'compensation:performance_bonus', score: 0.85, re: /\bbonus(uri)? de performanta\b/ },
    { key: 'compensation:performance_bonus', score: 0.85, re: /\bprim[ae] de performanta\b/ },
    { key: 'compensation:performance_bonus', score: 0.8, re: /\bsales bonus\b/ },
    { key: 'compensation:performance_bonus', score: 0.85, re: /\bteljesitmeny bonuszok\b/ },
    { key: 'compensation:performance_bonus', score: 0.85, re: /\bteljesitmeny premium\b/ },
    { key: 'compensation:performance_bonus', score: 0.8, re: /\bertekesitesi bonusz\b/ },
    { key: 'compensation:performance_bonus', score: 0.85, re: /\btulemuspreemia(d)?\b/ },
    { key: 'compensation:performance_bonus', score: 0.8, re: /\bmuugiboonus\b/ },
];
export function inferCompensation(clauses) {
    const { add, terms } = collector();
    for (const c of clauses)
        applyIdioms(normalizeLoose(c.text), c.text, RULES, add);
    return terms();
}
