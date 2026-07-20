/**
 * Qualification inference for the two BRITTLE subtypes where semantic/fuzzy
 * matching is unsafe and must be strictly context-gated:
 *
 *  - driving-license CLASS (b/c/ce/d) — the discriminator is a single letter, so
 *    embeddings can't tell B from C. We require a driving-license word in the
 *    clause AND take the class letter only when it qualifies a license word
 *    (so "category B products" / "plan B" never match).
 *  - language REQUIREMENT — a bare language name ("English CV") is not a
 *    requirement in body text, so we require a language-requirement cue nearby.
 *    In title mode ({@link FiniteInferOptions.titleMode}) that gate is loosened:
 *    a bare mention in a terse title ("(German)", "with German") is itself the
 *    signal, since titles rarely name a language incidentally the way body text does.
 *
 * The conceptual qualifications (degrees, certificates, registrations,
 * authorizations) stay on the hybrid semantic+lexical path; these two subtypes are
 * suppressed there and produced only here.
 *
 * Gender restriction is captured only when the ad explicitly limits the role to
 * one gender ("female only", "doar bărbați") — the neutral "(m/f)"/"(m/w/d)"
 * marker means either gender is fine, so it is deliberately NOT captured (an
 * `any` value is as good as absent and cannot be filtered on). Patterns run on
 * the folded `loose` text (lowercased, diacritics stripped: bărbați→barbati,
 * nők→nok); the non-binary/diverse value exists for symmetry with EU forms
 * ("(m/f/x)" / "(m/w/d)") even though it is rare in practice.
 */
import { isNegated } from '../negation.js';
import { collector, normalizeLoose } from './shared.js';
const DRIVING_KEYS = {
    b: 'qualification:license:driving_license_b',
    c: 'qualification:license:driving_license_c',
    ce: 'qualification:license:driving_license_ce',
    d: 'qualification:license:driving_license_d',
};
const DRIVING = [
    {
        language: 'en',
        strong: /\b(driving licen[cs]e|driving permit|licen[cs]e)\b/,
        qualifier: '(?:driving licen[cs]e|licen[cs]e|category|class|cat)',
    },
    { language: 'ro', strong: /\b(permis|carnet)\b/, qualifier: '(?:permis(?: de conducere)?|categoria|cat)' },
    { language: 'hu', strong: /\b(jogositvany|vezetoi engedely)\b/, qualifier: '(?:jogositvany|kategoria|kat)' },
    { language: 'et', strong: /\b(juhiluba|juhilubade)\b/, qualifier: '(?:juhiluba|kategooria|kat)' },
];
const LANG_NAMES = [
    [/\b(engleza|english|angol|inglise)\b/, 'qualification:language_requirement:english'],
    [/\b(franceza|french|francia|prantsuse)\b/, 'qualification:language_requirement:french'],
    [/\b(maghiara|hungarian|magyar|ungari)\b/, 'qualification:language_requirement:hungarian'],
    [/\b(romana|romanian|romaneste|rumeenia)\b/, 'qualification:language_requirement:romanian'],
    [/\b(germana|german|nemet|saksa)\b/, 'qualification:language_requirement:german'],
];
const LANG_CTX = [
    [
        'language',
        'fluent',
        'fluency',
        'proficiency',
        'proficient',
        'native',
        'knowledge',
        'spoken',
        'written',
        'level',
        'advanced',
        'intermediate',
        'mother tongue',
        'b1',
        'b2',
        'c1',
        'c2',
        'a2',
    ],
    ['limba', 'nivel', 'cunostinte', 'fluent', 'vorbit', 'scris', 'avansat', 'materna'],
    ['nyelv', 'nyelvtudas', 'szint', 'folyekonyan', 'anyanyelv'],
    ['keel', 'keeleoskus', 'tase', 'valdab', 'emakeel'],
];
const CLASS_TOKEN = '(c\\s*\\+?\\s*e|b\\s*\\+?\\s*e|ce|be|[abcd])';
const GENDER_RESTRICTION = [
    [
        /\b(?:(?:female|women|woman|ladies)[\s-]+only|only[\s-]+(?:female|women|woman)|(?:doar|numai|exclusiv)[\s-]+femei|femei[\s-]+(?:doar|numai)|csak[\s-]+nok|ainult[\s-]+naised)\b/,
        'qualification:gender_requirement:female_only',
    ],
    [
        /\b(?:(?:male|men|man|gentlemen)[\s-]+only|only[\s-]+(?:male|men|man)|(?:doar|numai|exclusiv)[\s-]+barbati|barbati[\s-]+(?:doar|numai)|csak[\s-]+ferfiak|ainult[\s-]+mehed)\b/,
        'qualification:gender_requirement:male_only',
    ],
    [
        /\b(?:(?:non[\s-]?binary|genderqueer|diverse|divers|nichtbinar|nonbinar|enby)[\s-]+(?:only|nur|doar|numai|exclusiv)|(?:only|nur|doar|numai|exclusiv)[\s-]+(?:non[\s-]?binary|genderqueer|diverse|divers|nichtbinar|nonbinar|enby))\b/,
        'qualification:gender_requirement:x_only',
    ],
];
const PHRASE_RULES = [
    [
        /\b(high school diploma|secondary school diploma|diploma de bacalaureat|liceu absolvit|studii medii|erettsegi|kozepiskolai vegzettseg|keskharidus)\b/,
        'qualification:education_requirement:high_school_diploma',
    ],
    [
        /\b(vocational diploma|trade school diploma|technical diploma|diploma profesionala|studii profesionale|scoala profesionala|szakmai vegzettseg|szakkepesites|kutseharidus)\b/,
        'qualification:education_requirement:vocational_diploma',
    ],
    [
        /\b(bachelor'?s? degree|undergraduate degree|diploma de licenta|studii superioare|licenta|alapdiploma|egyetemi diploma|bakalaureusekraad)\b/,
        'qualification:education_requirement:bachelors_degree',
    ],
    [
        /\b(master'?s? degree|postgraduate degree|diploma de master|studii de master|mesterkepzes|mesterfokozat|magistrikraad)\b/,
        'qualification:education_requirement:masters_degree',
    ],
    [
        /\b(forklift (certificate|licen[cs]e|permit)|reach truck certificate|atestat stivuitorist|autorizatie stivuitorist|permis stivuitor|targonca engedely|tostuki luba)\b/,
        'qualification:certificate:forklift_certificate',
    ],
    [
        /\b(welding certificate|welder certification|certificat sudor|autorizatie sudor|atestat sudor|hegesztoi bizonyitvany|keevitaja sertifikaat)\b/,
        'qualification:certificate:welding_certificate',
    ],
    [
        /\b(adr certificate|adr cert|atestat adr|certificat adr|adr bizonyitvany|adr tunnistus)\b/,
        'qualification:certificate:adr_certificate',
    ],
    [
        /\b(driver cpc|cpc card|certificate of professional competence|atestat cpc|cpc sofer|gki kartya)\b/,
        'qualification:certificate:driver_cpc',
    ],
    [
        /\b(first aid (certificate|certification)|certificat prim ajutor|curs prim ajutor|elsosegely bizonyitvany|esmaabi sertifikaat)\b/,
        'qualification:certificate:first_aid_certificate',
    ],
    [
        /\b(food (safety|hygiene|handling) certificate|certificat siguranta alimentara|certificat igiena alimentara|toiduohutuse sertifikaat)\b/,
        'qualification:certificate:food_safety_certificate',
    ],
    [
        /\b(electrician (licen[cs]e|authorization)|electrical authorization|autorizatie electrician|autorizatie electrica|autorizatie anre)\b/,
        'qualification:license:electrician_authorization',
    ],
];
function hasCtx(window) {
    for (const words of LANG_CTX) {
        for (const w of words) {
            if (w.length < 2)
                continue;
            if (new RegExp(`(?:^|[^a-z])${w}(?:$|[^a-z])`).test(window))
                return true;
        }
    }
    return false;
}
export function inferQualifications(clauses, _languages, options) {
    const { add, terms } = collector();
    for (const c of clauses) {
        const loose = normalizeLoose(c.text);
        for (const [re, key] of GENDER_RESTRICTION) {
            const m = re.exec(loose);
            if (m && !isNegated(c.text, m[0]))
                add(key, 0.9, c.text);
        }
        for (const L of DRIVING) {
            if (!L.strong.test(loose))
                continue;
            const re = new RegExp(`${L.qualifier}\\s*\\.?\\s*${CLASS_TOKEN}\\b`, 'gi');
            for (const m of loose.matchAll(re)) {
                const cls = m[1].replace(/[\s+]/g, '');
                const key = DRIVING_KEYS[cls];
                if (key && !isNegated(c.text, m[0]))
                    add(key, 0.9, c.text);
            }
        }
        for (const [nameRe, key] of LANG_NAMES) {
            const g = new RegExp(nameRe.source, 'gi');
            let m;
            while ((m = g.exec(loose))) {
                const window = loose.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25);
                if ((options?.titleMode || hasCtx(window)) && !isNegated(c.text, m[0]))
                    add(key, 0.85, c.text);
            }
        }
        for (const [re, key] of PHRASE_RULES) {
            const m = re.exec(loose);
            if (m && !isNegated(c.text, m[0]))
                add(key, 0.85, c.text);
        }
    }
    return terms();
}
