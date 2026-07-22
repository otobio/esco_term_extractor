/**
 * Benefits inference — covers common phrasings that miss the dictionary's exact
 * alias match because they drop a qualifier the dictionary requires ("asigurare
 * medicala" without "privata", "egeszsegbiztositas" without "magan"), use a
 * different lead word ("transport gratuit"/"ingyenes szallitas"/"tasuta
 * transport" instead of the "asigurat"/"biztositott"/"tagatud" the dictionary
 * has), use a bare word the alias index only stores in inflected/qualified
 * forms ("training"/"kepzes"/"koolitus" alone), or reorder words the dictionary
 * only has in one fixed sequence ("zile de concediu suplimentare" vs. the
 * dictionary's "zile suplimentare de concediu" — alias matching is exact n-gram
 * order, so a reordering is otherwise invisible to it).
 *
 * The bare medical-mention rules (RO "asigurare/servicii medicala", HU
 * "egeszsegbiztositas"/"orvosi ellatas") resolve to `health_insurance`, not
 * `private_medical`: the dictionary already has an exact bare alias for
 * `health_insurance` in both locales ("asigurare medicala", "egeszsegbiztositas"),
 * so a `private_medical` rule on the same bare phrase would double-fire two
 * distinct canonical keys for one mention. `private_medical` itself stays exact
 * dictionary-alias-only (requires "privata"/"magan"/"abonament").
 *
 * ET has no bare-form medical rule at all: the dictionary alias
 * ("tervisekindlustus") is already unqualified there, so there's no gap to cover.
 *
 * EN "medical aid" is the same bare-synonym gap as RO/HU: the South
 * African/Nigerian term for health cover, not currently an alias of either
 * `health_insurance` or `private_medical` — routed to `health_insurance` for the
 * same double-fire reason as the RO/HU bare mentions above. Bare "pension" is
 * the same bare-word gap as "training": the dictionary only has "pension
 * scheme"/"retirement plan"/"occupational pension", not the bare word alone,
 * which is how EN/NG listings commonly list it in a benefits bullet (e.g.
 * "Other benefits – HMO, Pension"). "HMO" itself is deliberately NOT covered
 * here: mined from real jbng-local-listings-1 text, most "HMO" mentions are the
 * employer's own industry/line of business ("HMO Desk Officer", "our HMO
 * Company"), not the candidate's benefit — a bare-word rule would false-fire on
 * those far more often than it would correctly fire on a benefits-list mention.
 * "leave allowance" maps to `paid_time_off` rather than a distinct new key —
 * the ESCO taxonomy this dictionary is built from doesn't split out a separate
 * cash-leave-payout concept, so it folds into the existing PTO key by design,
 * not because the phrasing is a synonym of "paid time off". "car allowance"
 * is the same kind of fold: `transport_allowance` already carries "travel
 * allowance"/"mileage reimbursement" as aliases — the same cash-stipend
 * concept, just missing this exact phrasing — so no new key is needed. The
 * RO/HU/ET car-allowance and housing-allowance phrasings are direct
 * translations, not individually confirmed against real RO/HU/ET listing
 * text (same caveat as the rest of the HU/ET rules in this file).
 *
 * `housing_allowance` has no dictionary key at all (confirmed against both
 * the local snapshot and the live `canonical_runtime_terms` index) and zero
 * occurrences in the mined RO/EN corpora — it's added here as an
 * inference-only canonical key, resolved purely by this regex with no
 * dictionary backing, the same precedented pattern the `company_size` bucket
 * already uses (see `finalizeFinite` in `src/matchers/finite.ts`).
 *
 * Verified against real RO gold-listing text and real listings pulled from the
 * live `ejobs-local-listings-1` (RO) and `jbng-local-listings-1` (EN/NG) indices;
 * the HU/ET rules are the same structural fix applied by direct translation, not
 * individually confirmed against real HU/ET listings.
 *
 * `paid_training` rules score lower than the others: a bare training mention is
 * genuinely more ambiguous (can describe a job duty, not a benefit) than a
 * medical/transport offer, which is essentially always stated as a perk.
 */
import { applyIdioms, collector, normalizeLoose } from './shared.js';
const RO = [
    { key: 'benefits:health_insurance', score: 0.8, re: /\b(asigurare|servicii) medical[ae]?\b/ },
    { key: 'benefits:transport_provided', score: 0.85, re: /\btransport gratuit\b/ },
    { key: 'benefits:paid_training', score: 0.7, re: /\btraining(uri)?\b/ },
    { key: 'benefits:extra_vacation_days', score: 0.85, re: /\bzile de concediu suplimentare\b/ },
    { key: 'benefits:transport_allowance', score: 0.8, re: /\bindemniza[tț]ie auto\b/ },
    { key: 'benefits:housing_allowance', score: 0.75, re: /\b(indemniza[tț]ie|aloca[tț]ie) de cazare\b/ },
];
const HU = [
    { key: 'benefits:health_insurance', score: 0.8, re: /\b(egeszsegbiztositas|orvosi ellatas)\b/ },
    { key: 'benefits:transport_provided', score: 0.85, re: /\bingyenes (szallitas|utazas)\b/ },
    { key: 'benefits:paid_training', score: 0.7, re: /\b(kepzes|trening)\b/ },
    { key: 'benefits:transport_allowance', score: 0.8, re: /\bauto ?hozzajarulas\b/ },
    { key: 'benefits:housing_allowance', score: 0.75, re: /\blakhatasi tamogatas\b/ },
];
const ET = [
    { key: 'benefits:transport_provided', score: 0.85, re: /\btasuta transport\b/ },
    { key: 'benefits:paid_training', score: 0.7, re: /\bkoolitus\b/ },
    { key: 'benefits:transport_allowance', score: 0.8, re: /\bauto ?huvitis\b/ },
    { key: 'benefits:housing_allowance', score: 0.75, re: /\beluasemetoetus\b/ },
];
const EN = [
    { key: 'benefits:health_insurance', score: 0.8, re: /\bmedical aid\b/ },
    { key: 'benefits:pension_scheme', score: 0.75, re: /\bpension\b/ },
    { key: 'benefits:paid_time_off', score: 0.75, re: /\bleave allowance\b/ },
    { key: 'benefits:transport_allowance', score: 0.8, re: /\bcar allowance\b/ },
    { key: 'benefits:housing_allowance', score: 0.75, re: /\bhousing allowance\b/ },
];
const RULES = [...RO, ...HU, ...ET, ...EN];
export function inferBenefits(clauses) {
    const { add, terms } = collector();
    for (const c of clauses)
        applyIdioms(normalizeLoose(c.text), c.text, RULES, add);
    return terms();
}
