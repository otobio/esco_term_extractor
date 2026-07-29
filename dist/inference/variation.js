/**
 * Compositional head-noun + modifier matcher for `benefits`/`compensation`.
 *
 * Benefit and compensation phrases are almost always `[modifier]* HEAD_NOUN` —
 * "private health insurance", "annual leave", "night shift premium",
 * "performance bonus". `finiteLexicalStrategy` (see matchers/lexical.ts) is
 * exact/phrase-only by design for these buckets — a near-miss must never
 * resolve to the wrong discrete key — so it explicitly punts RECALL to this
 * inference layer. But a literal alias match breaks the moment a real posting
 * adds, drops, or reorders a modifier the alias didn't anticipate ("private
 * health insurance" vs. the dictionary's "Health Insurance"/"private medical
 * insurance" — neither is a phrase-subset of the other).
 *
 * Rather than one literal regex per phrasing (whack-a-mole that never
 * generalizes — see the old per-phrase rules this file replaces), each FAMILY
 * anchors on the HEAD noun (the concept: insurance/leave/bonus/allowance/…)
 * and a small locale-scoped set of MODIFIERS narrows it to the specific
 * canonical key, with a default key when the head fires but no modifier does.
 * New phrasing = one new synonym in an existing head/modifier word list, not a
 * new rule — coverage grows linearly with vocabulary, not with phrase count.
 *
 * `deriveBenefitVariations`/`deriveCompensationVariations` register into
 * `inference/index.ts`'s `REGISTRY` like any other bucket inferer — they
 * already match the `InferFn` shape `(clauses, languages?) => InferredTerm[]`
 * — but internally this module owns its own matching primitive (head+modifier
 * families) rather than the flat `IdiomRule[]` shape the other bucket modules
 * use, since a single literal regex per rule is exactly the whack-a-mole this
 * file replaces.
 *
 * Coverage note: EN and RO get full modifier decomposition (space-separated,
 * gold-listing-verified vocabulary carried over from the rules this file
 * replaces). HU gets decomposition where the dictionary's own aliases show
 * space-separated phrasing (e.g. "magan egeszsegugyi biztositas"). ET is kept
 * head-only or omitted per family where its aliases are single fused
 * compounds (e.g. "eratervisekindlustus") rather than combinable modifier+head
 * phrases — a word-boundary modifier regex can't isolate a prefix inside a
 * fused compound, and the compound forms are already exact dictionary aliases
 * with no recombination gap to close (same conclusion the file this replaces
 * documented locale-by-locale).
 */
import { isNegated } from '../negation.js';
import { collector, normalizeLoose } from './shared.js';
const ALL_LANGS = ['en', 'ro', 'hu', 'et'];
/** Non-capturing alternation of literal words/phrases, boundary-anchored on both sides. */
function wordsRe(words, flags) {
    return new RegExp(`\\b(?:${words.join('|')})\\b`, flags);
}
function compileFamilies(families) {
    const out = {};
    for (const lang of ALL_LANGS) {
        const compiled = [];
        for (const family of families) {
            const headWords = family.head[lang];
            if (!headWords?.length)
                continue;
            const modifiers = [];
            for (const m of family.modifiers) {
                const words = m.words[lang];
                // 'g' so every occurrence of a modifier can be walked (matchAll), not
                // just whether it appears at all — needed for the nearest-pair
                // assignment below.
                if (words?.length)
                    modifiers.push({ key: m.key, score: m.score, re: wordsRe(words, 'gi') });
            }
            // 'g' so matchAll can walk every occurrence — a clause can mention the
            // same family twice (e.g. "servicii medicale ... si asigurare de viata"),
            // and each occurrence needs its own nearest-modifier assignment (see below).
            compiled.push({
                head: wordsRe(headWords, 'gi'),
                modifiers,
                defaultKey: family.defaultKey,
                defaultScore: family.defaultScore,
            });
        }
        if (compiled.length)
            out[lang] = compiled;
    }
    return out;
}
// A modifier is assigned to its NEAREST head occurrence, not to "the head" as
// if only one existed — a clause mentioning the same family twice ("private
// health insurance and life insurance") has two head occurrences, each with
// its own qualifying word close by. A simple containment window can't
// disambiguate this: "life" sits closer, in raw characters, to the FIRST
// "insurance" than "private" does once a second mention is appended, even
// though it clearly belongs to the second. So this does a greedy nearest-pair
// bipartite match over ALL (head, modifier) occurrence pairs, closest first,
// each head and each modifier occurrence consumed at most once — the same
// idea as assigning words to their nearest anchor rather than picking
// whichever modifier rule happens to be listed first.
const MAX_PAIR_DISTANCE = 30;
function deriveVariations(clauses, languages, compiled) {
    const { add, terms } = collector();
    const langs = languages ?? ALL_LANGS;
    for (const c of clauses) {
        const loose = normalizeLoose(c.text);
        for (const lang of langs) {
            for (const family of compiled[lang] ?? []) {
                const heads = [...loose.matchAll(family.head)];
                if (!heads.length)
                    continue;
                const modHits = [];
                for (const m of family.modifiers) {
                    for (const mm of loose.matchAll(m.re))
                        modHits.push({ index: mm.index, key: m.key, score: m.score });
                }
                const assignedMod = new Map(); // head array index -> its modifier
                if (modHits.length) {
                    const pairs = [];
                    heads.forEach((h, hi) => {
                        modHits.forEach((mh, mi) => {
                            const dist = Math.abs(mh.index - h.index);
                            if (dist <= MAX_PAIR_DISTANCE)
                                pairs.push({ h: hi, m: mi, dist });
                        });
                    });
                    pairs.sort((a, b) => a.dist - b.dist);
                    const usedMod = new Set();
                    for (const p of pairs) {
                        if (assignedMod.has(p.h) || usedMod.has(p.m))
                            continue;
                        assignedMod.set(p.h, modHits[p.m]);
                        usedMod.add(p.m);
                    }
                }
                heads.forEach((h, hi) => {
                    if (isNegated(c.text, h[0]))
                        return;
                    const hit = assignedMod.get(hi);
                    if (hit)
                        add(hit.key, hit.score, c.text);
                    else if (family.defaultKey)
                        add(family.defaultKey, family.defaultScore ?? 0.75, c.text);
                });
            }
        }
    }
    return terms();
}
// ---------------------------------------------------------------------------
// benefits
// ---------------------------------------------------------------------------
const BENEFIT_FAMILIES = [
    // private_medical / health_insurance / life_insurance / disability_insurance
    {
        head: {
            en: ['insurance', 'medical cover', 'health cover', 'medical aid'],
            ro: ['asigurare', 'asigurari', 'servicii medicala', 'servicii medicale'],
            // "biztositas" alone misses HU's fused compounds (no space, so no leading word
            // boundary) — the bare/unqualified forms are added as whole-phrase alternatives.
            hu: ['biztositas', 'egeszsegbiztositas', 'orvosi ellatas'],
            et: ['kindlustus'],
        },
        modifiers: [
            { key: 'benefits:life_insurance', score: 0.85, words: { en: ['life'], ro: ['viata'], hu: ['elet'] } },
            {
                key: 'benefits:disability_insurance',
                score: 0.85,
                words: { en: ['disability'], ro: ['invaliditate'], hu: ['rokkantsag'] },
            },
            {
                key: 'benefits:private_medical',
                score: 0.85,
                words: { en: ['private', 'healthcare', 'subscription'], ro: ['privat', 'privata', 'abonament'], hu: ['magan'] },
            },
        ],
        defaultKey: 'benefits:health_insurance',
        defaultScore: 0.75,
    },
    {
        head: { hu: ['egeszsegpenztar'] },
        modifiers: [],
        defaultKey: 'benefits:private_medical',
        defaultScore: 0.85,
    },
    {
        head: { hu: ['eletbiztositas', 'elet es balesetbiztositas', 'elet- es balesetbiztositas'] },
        modifiers: [],
        defaultKey: 'benefits:life_insurance',
        defaultScore: 0.85,
    },
    // paid_time_off / paid_sick_leave / parental_leave / extra_vacation_days
    {
        head: {
            en: ['leave', 'vacation', 'holiday', 'days off', 'time off', 'pto'],
            ro: ['concediu', 'zile libere'],
            hu: ['szabadsag'],
            et: ['puhkus'],
        },
        modifiers: [
            {
                key: 'benefits:paid_sick_leave',
                score: 0.85,
                words: { en: ['sick', 'medical'], ro: ['medical', 'boala'], hu: ['beteg'], et: ['haigus'] },
            },
            {
                key: 'benefits:parental_leave',
                score: 0.85,
                words: {
                    en: ['parental', 'maternity', 'paternity'],
                    ro: ['parental', 'maternitate', 'paternitate'],
                    hu: ['szuloi', 'anyasagi', 'apasagi'],
                    et: ['vanema', 'ema', 'isa'],
                },
            },
            {
                key: 'benefits:extra_vacation_days',
                score: 0.85,
                words: {
                    en: ['extra', 'additional'],
                    ro: ['suplimentar', 'suplimentare', 'in plus'],
                    hu: ['extra', 'tovabbi', 'plusz'],
                    et: ['lisa', 'taiendav'],
                },
            },
        ],
        defaultKey: 'benefits:paid_time_off',
        defaultScore: 0.75,
    },
    // transport_allowance / wellness_allowance / tool_allowance
    // (allowance itself is never a standalone key — the modifier decides everything)
    {
        head: {
            en: ['allowance', 'stipend', 'subsidy', 'reimbursement'],
            ro: ['indemnizatie', 'alocatie', 'decont', 'decontare'],
            hu: ['tamogatas', 'potlek', 'hozzajarulas'],
            // ET dictionary aliases for this family are mostly fused compounds
            // ("transpordihuvitis", "soidutoetus") that a word-boundary regex can't
            // decompose — "huvitis"/"toetus" here only catches the informal
            // SPACE-separated phrasing ("auto huvitis"), same scope as the old rule it replaces.
            et: ['huvitis', 'toetus'],
        },
        modifiers: [
            {
                key: 'benefits:transport_allowance',
                score: 0.85,
                words: {
                    en: ['transport', 'travel', 'mileage', 'fuel', 'car', 'parking', 'commute', 'commuting'],
                    ro: ['transport', 'naveta', 'combustibil', 'auto'],
                    hu: ['utazasi', 'bejarasi', 'munkaba jaras', 'uzemanyag', 'auto'],
                    et: ['auto'],
                },
            },
            {
                key: 'benefits:wellness_allowance',
                score: 0.85,
                words: {
                    en: ['wellness', 'wellbeing', 'gym', 'fitness', 'sports'],
                    ro: ['wellness', 'sala', 'fitness'],
                    hu: ['wellness', 'edzoterem', 'fitnesz', 'sport', 'sport tamogatas'],
                },
            },
            {
                key: 'benefits:tool_allowance',
                score: 0.8,
                words: {
                    en: ['tool', 'tools', 'equipment', 'ppe'],
                    ro: ['scule', 'unelte', 'echipament'],
                    hu: ['szerszam'],
                },
            },
        ],
    },
    // "eluasemetoetus"/"autohuvitis" (ET) and "autohozzajarulas" (HU) are fully
    // fused compounds with no separate head+modifier to decompose — same
    // treatment as the other whole-compound literals folded into the families above.
    {
        head: { et: ['eluasemetoetus'] },
        modifiers: [],
    },
    {
        head: { hu: ['autohozzajarulas'], et: ['autohuvitis'] },
        modifiers: [],
        defaultKey: 'benefits:transport_allowance',
        defaultScore: 0.8,
    },
    // transport_provided / uniform_provided / accommodation_provided / laptop_provided / phone_provided
    {
        head: {
            en: ['provided', 'included', 'company', 'staff', 'issued'],
            // "gratuit"/"ingyenes"/"tasuta" ("free X") is the other common phrasing for a
            // provided-in-kind benefit, alongside "asigurat"/"biztositott"/"tagatud".
            ro: ['asigurat', 'asigurata', 'oferit', 'oferita', 'inclus', 'inclusa', 'gratuit', 'gratuita'],
            hu: ['biztositott', 'ingyenes'],
            et: ['tagatud', 'tasuta'],
        },
        modifiers: [
            {
                key: 'benefits:transport_provided',
                score: 0.85,
                words: {
                    en: ['transport', 'shuttle', 'pickup', 'free transport', 'free travel'],
                    ro: ['transport', 'naveta', 'microbuz', 'gratuit'],
                    hu: ['szallitas', 'utazas', 'jarat', 'ingyenes'],
                    et: ['transport'],
                },
            },
            {
                key: 'benefits:accommodation_provided',
                score: 0.85,
                words: {
                    en: ['accommodation', 'housing', 'lodging'],
                    ro: ['cazare'],
                    hu: ['szallas', 'lakhatas', 'munkasszallo'],
                },
            },
            {
                key: 'benefits:uniform_provided',
                score: 0.85,
                words: {
                    en: ['uniform', 'workwear', 'protective clothing'],
                    ro: ['uniforma', 'echipament de lucru', 'imbracaminte de lucru'],
                    hu: ['egyenruha', 'munkaruha', 'vedoruha'],
                },
            },
            {
                key: 'benefits:laptop_provided',
                score: 0.8,
                words: { en: ['laptop'], ro: ['laptop'], hu: ['laptop'] },
            },
            {
                key: 'benefits:phone_provided',
                score: 0.8,
                words: { en: ['phone', 'mobile phone'], ro: ['telefon'], hu: ['telefon'] },
            },
        ],
    },
    {
        head: { hu: ['mobiltelefon'] },
        modifiers: [],
        defaultKey: 'benefits:phone_provided',
        defaultScore: 0.8,
    },
    // pension_scheme — bare-word gap (dictionary requires "scheme"/"retirement plan"/"occupational")
    {
        head: { en: ['pension', 'retirement'], hu: ['nyugdijpenztar'] },
        modifiers: [],
        defaultKey: 'benefits:pension_scheme',
        defaultScore: 0.7,
    },
    // paid_training — bare word is more ambiguous (can describe a duty, not a perk); lower score
    {
        head: {
            en: ['training'],
            ro: ['training', 'traininguri'],
            hu: ['kepzes', 'kepzesek', 'trening', 'treningek'],
            et: ['koolitus'],
        },
        modifiers: [],
        defaultKey: 'benefits:paid_training',
        defaultScore: 0.65,
    },
    {
        head: { hu: ['nyelvtanulas'] },
        modifiers: [
            {
                key: 'benefits:paid_training',
                score: 0.85,
                words: { hu: ['tamogatas', 'tamogatasa'] },
            },
        ],
    },
    // employee_discount
    {
        head: {
            en: ['discount', 'staff discount'],
            ro: ['discount angajati', 'reducere angajati'],
            hu: ['dolgozoi kedvezmeny'],
        },
        modifiers: [],
        defaultKey: 'benefits:employee_discount',
        defaultScore: 0.75,
    },
    // company_car / fuel_card (already tight bare-word aliases in the dictionary; carried
    // here mainly so a modifier-qualified variant like "company car allowance" still
    // resolves to the concrete perk rather than falling only to transport_allowance)
    {
        head: { en: ['company car', 'service vehicle'], ro: ['masina de serviciu'], hu: ['ceges auto', 'szolgalati auto'] },
        modifiers: [],
        defaultKey: 'benefits:company_car',
        defaultScore: 0.8,
    },
    {
        head: { en: ['fuel card', 'gas card'], ro: ['card combustibil'], hu: ['uzemanyagkartya', 'benzinkartya'] },
        modifiers: [],
        defaultKey: 'benefits:fuel_card',
        defaultScore: 0.8,
    },
    {
        head: { en: ['meal', 'lunch'], ro: ['masa', 'mese', 'tichete de masa', 'bonuri de masa'], hu: ['etkezesi'] },
        modifiers: [],
        defaultKey: 'benefits:meal_vouchers',
        defaultScore: 0.75,
    },
    {
        head: { en: ['relocation'], ro: ['relocare', 'mutare'], hu: ['relokacios', 'koltozesi'] },
        modifiers: [],
        defaultKey: 'benefits:relocation_support',
        defaultScore: 0.8,
    },
];
export function deriveBenefitVariations(clauses, languages) {
    return deriveVariations(clauses, languages, BENEFIT_FAMILIES_COMPILED);
}
const BENEFIT_FAMILIES_COMPILED = compileFamilies(BENEFIT_FAMILIES);
// ---------------------------------------------------------------------------
// compensation
// ---------------------------------------------------------------------------
const COMPENSATION_FAMILIES = [
    // annual_bonus / sign_on_bonus / performance_bonus / attendance_bonus / retention_bonus /
    // christmas_bonus / dispatch_bonus — "bonus" is the single most overloaded head noun in
    // this bucket, so it carries the most modifiers.
    {
        head: {
            en: ['bonus', 'premium', 'incentive'],
            ro: ['bonus', 'bonusuri', 'prima', 'prime'],
            hu: ['bonusz', 'bonuszok', 'premium'],
            // ET's other bonus compounds ("aastaboonus", "liitumisboonus", "tulemusboonus",
            // "pysivusboonus", "soiduboonus"/"koormaboonus", "jouluboonus", "muugiboonus",
            // "tulemuspreemia(d)") are fused (no space before "boonus"/"preemia"), so a
            // word-boundary head match can't reach them at all — they're handled as their
            // own literal-compound families below instead of decomposed here.
            et: ['boonus', 'preemia'],
        },
        modifiers: [
            {
                key: 'compensation:sign_on_bonus',
                score: 0.85,
                words: {
                    en: ['sign on', 'sign-on', 'joining'],
                    ro: ['semnare', 'angajare'],
                    hu: ['belepesi', 'alairasi'],
                },
            },
            {
                key: 'compensation:performance_bonus',
                score: 0.85,
                words: {
                    en: ['performance', 'productivity', 'sales'],
                    ro: ['performanta', 'productivitate'],
                    hu: ['teljesitmeny', 'termelesi', 'ertekesitesi'],
                },
            },
            {
                key: 'compensation:attendance_bonus',
                score: 0.85,
                words: {
                    en: ['attendance', 'perfect attendance'],
                    ro: ['prezenta'],
                    hu: ['jelenleti'],
                    et: ['kohaloleku'],
                },
            },
            {
                key: 'compensation:retention_bonus',
                score: 0.85,
                words: { en: ['retention', 'stay'], ro: ['retentie', 'fidelizare'], hu: ['megtartasi'] },
            },
            {
                key: 'compensation:christmas_bonus',
                score: 0.85,
                words: {
                    en: ['christmas', 'year end', 'year-end'],
                    ro: ['craciun', 'sarbatori'],
                    hu: ['karacsonyi', 'ev vegei', 'unnepi'],
                    et: ['puhade'],
                },
            },
            {
                key: 'compensation:dispatch_bonus',
                score: 0.8,
                words: {
                    en: ['route', 'load', 'dispatch'],
                    ro: ['cursa', 'ruta'],
                    hu: ['jarat', 'fuvar', 'rakomany'],
                },
            },
            {
                key: 'compensation:annual_bonus',
                score: 0.8,
                words: {
                    en: ['annual', 'yearly', '13th', 'thirteenth'],
                    ro: ['anual', '13 lea', '13-lea'],
                    hu: ['eves', '13 havi'],
                },
            },
        ],
    },
    // ET fused bonus/premium compounds — no space before the head, so they can't be
    // decomposed by the family above; each is its own literal-compound → key mapping.
    { head: { et: ['aastaboonus'] }, modifiers: [], defaultKey: 'compensation:annual_bonus', defaultScore: 0.85 },
    { head: { et: ['liitumisboonus'] }, modifiers: [], defaultKey: 'compensation:sign_on_bonus', defaultScore: 0.85 },
    {
        head: { et: ['tulemusboonus', 'tulemuspreemia', 'tulemuspreemiad', 'muugiboonus'] },
        modifiers: [],
        defaultKey: 'compensation:performance_bonus',
        defaultScore: 0.85,
    },
    { head: { et: ['pysivusboonus'] }, modifiers: [], defaultKey: 'compensation:retention_bonus', defaultScore: 0.85 },
    {
        head: { et: ['soiduboonus', 'koormaboonus'] },
        modifiers: [],
        defaultKey: 'compensation:dispatch_bonus',
        defaultScore: 0.8,
    },
    { head: { et: ['jouluboonus'] }, modifiers: [], defaultKey: 'compensation:christmas_bonus', defaultScore: 0.85 },
    // paid_time_off already owns bare "leave"/"vacation"; per_diem_pay / on_call_standby_pay /
    // call_out_pay / hazard_pay / holiday_pay / night_premium / weekend_premium / sunday_premium /
    // shift_differential — the "pay/premium/allowance for X circumstance" family.
    {
        head: {
            en: ['pay', 'premium', 'allowance', 'differential'],
            ro: ['spor', 'plata', 'indemnizatie'],
            hu: ['potlek', 'dij'],
            et: ['lisatasu', 'tasu', 'lisa'],
        },
        modifiers: [
            {
                key: 'compensation:night_premium',
                score: 0.85,
                words: { en: ['night'], ro: ['noapte'], hu: ['ejszakai'], et: ['oo', 'oovahetuse'] },
            },
            {
                key: 'compensation:weekend_premium',
                score: 0.85,
                words: { en: ['weekend'], ro: ['weekend'], hu: ['hetvegi'], et: ['nadalavahetuse'] },
            },
            {
                key: 'compensation:sunday_premium',
                score: 0.85,
                words: { en: ['sunday'], ro: ['duminica'], hu: ['vasarnapi'], et: ['puhapaeva'] },
            },
            {
                key: 'compensation:holiday_pay',
                score: 0.85,
                words: {
                    en: ['holiday', 'public holiday', 'bank holiday'],
                    ro: ['sarbatoare', 'sarbatori legale'],
                    hu: ['unnepnapi', 'munkaszuneti'],
                    et: ['puhade', 'riigipuha'],
                },
            },
            {
                key: 'compensation:hazard_pay',
                score: 0.85,
                words: {
                    en: ['hazard', 'danger', 'risk'],
                    ro: ['risc', 'pericol'],
                    hu: ['veszelyessegi', 'kockazati'],
                    et: ['riski', 'ohu'],
                },
            },
            {
                key: 'compensation:shift_differential',
                score: 0.8,
                words: { en: ['shift'], ro: ['tura'], hu: ['muszak'], et: ['vahetuse'] },
            },
            {
                key: 'compensation:on_call_standby_pay',
                score: 0.85,
                words: {
                    en: ['on call', 'on-call', 'standby'],
                    ro: ['garda', 'permanenta'],
                    hu: ['ugyeleti', 'keszenleti'],
                    et: ['valve', 'valmidus'],
                },
            },
            {
                key: 'compensation:call_out_pay',
                score: 0.85,
                words: {
                    en: ['call out', 'call-out', 'callback', 'emergency call'],
                    ro: ['interventie', 'chemare de urgenta'],
                    hu: ['riasztasi', 'kivonulasi', 'behivasi'],
                    et: ['valjakutse'],
                },
            },
            {
                key: 'compensation:per_diem_pay',
                score: 0.8,
                words: {
                    en: ['per diem', 'daily subsistence'],
                    ro: ['diurna', 'zilnica'],
                    hu: ['napidij', 'napi dij'],
                    et: ['paevaraha'],
                },
            },
        ],
    },
    // overtime_1_5x / overtime_2x
    {
        head: {
            en: ['overtime'],
            ro: ['ore suplimentare'],
            hu: ['tulora'],
            et: ['uletunnid', 'uletootasu'],
        },
        modifiers: [
            {
                key: 'compensation:overtime_2x',
                score: 0.85,
                words: {
                    en: ['double', '2x', 'two times'],
                    ro: ['dublu', 'dubla'],
                    hu: ['dupla', 'ketszeres'],
                    et: ['kahekordne'],
                },
            },
            {
                key: 'compensation:overtime_1_5x',
                score: 0.8,
                words: {
                    en: ['time and a half', '1.5x', '1 5x'],
                    ro: [],
                    hu: ['masfelszeres'],
                    et: ['poolteistkordne'],
                },
            },
        ],
        defaultKey: 'compensation:overtime_1_5x',
        defaultScore: 0.75,
    },
    // commission / profit_sharing — both single-key, but with real EN/RO/HU/ET phrasing spread
    {
        head: {
            en: ['commission', 'commission based', 'commission-based'],
            ro: ['comision'],
            hu: ['jutalek'],
            et: ['komisjonitasu', 'muugikomisjon'],
        },
        modifiers: [],
        defaultKey: 'compensation:commission',
        defaultScore: 0.8,
    },
    {
        head: {
            en: ['profit sharing', 'share of profits'],
            ro: ['participare la profit', 'procent din profit'],
            hu: ['nyeresegreszesedes'],
            et: ['kasumiosalus'],
        },
        modifiers: [],
        defaultKey: 'compensation:profit_sharing',
        defaultScore: 0.8,
    },
    {
        head: {
            en: ['tips', 'gratuities', 'cash tips'],
            ro: ['bacsis', 'ciubuc'],
            hu: ['borravalo', 'tippek'],
            et: ['jootraha'],
        },
        modifiers: [
            {
                key: 'compensation:pooled_tips',
                score: 0.85,
                words: { en: ['pool', 'shared', 'pooled'], ro: ['comun'], hu: ['kozos'], et: ['jagamine', 'fond'] },
            },
        ],
        defaultKey: 'compensation:cash_tips',
        defaultScore: 0.75,
    },
    {
        head: {
            en: ['piece rate', 'paid per piece', 'paid per item'],
            ro: ['plata la bucata', 'plata la piesa'],
            hu: ['darabber'],
            et: ['tukitasu'],
        },
        modifiers: [],
        defaultKey: 'compensation:piece_rate',
        defaultScore: 0.8,
    },
    {
        head: {
            en: ['daily pay', 'daily payout', 'paid daily', 'same day pay'],
            ro: ['plata zilnica', 'plata la zi'],
            hu: ['napi fizetes'],
            et: ['paevapalk'],
        },
        modifiers: [],
        defaultKey: 'compensation:daily_payout',
        defaultScore: 0.8,
    },
    {
        head: { en: ['equity', 'ownership stake'] },
        modifiers: [],
        defaultKey: 'compensation:equity',
        defaultScore: 0.75,
    },
    {
        head: { en: ['stock options'], ro: ['optiuni pe actiuni'] },
        modifiers: [],
        defaultKey: 'compensation:stock_options',
        defaultScore: 0.8,
    },
    {
        head: { en: ['rsu', 'rsus', 'restricted stock'] },
        modifiers: [],
        defaultKey: 'compensation:rsus',
        defaultScore: 0.8,
    },
    {
        head: { en: ['ote', 'on target earnings'] },
        modifiers: [],
        defaultKey: 'compensation:ote',
        defaultScore: 0.8,
    },
    {
        head: {
            en: ['14th salary', 'fourteenth salary', '14th month salary'],
            ro: ['al 14 lea salariu', 'al 14-lea salariu'],
            hu: ['14 havi fizetes'],
            et: ['14 palk'],
        },
        modifiers: [],
        defaultKey: 'compensation:fourteenth_salary',
        defaultScore: 0.8,
    },
];
export function deriveCompensationVariations(clauses, languages) {
    return deriveVariations(clauses, languages, COMPENSATION_FAMILIES_COMPILED);
}
const COMPENSATION_FAMILIES_COMPILED = compileFamilies(COMPENSATION_FAMILIES);
