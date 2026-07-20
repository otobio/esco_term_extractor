/**
 * Company-size inference → the company_stage canonical terms (startup/scaleup/
 * enterprise). Signals: explicit stage words (startup, multinational, SME, …) and
 * employee counts ("50 employees", "peste 200 de angajați", "team of 20"). Counts
 * are context-gated (an employee word required, non-employee counts excluded), the
 * way salary is. Per-locale word lists; single-language regexes. Negation-aware.
 */
import { isNegated } from '../negation.js';
import { collector, normalizeLoose } from './shared.js';
const STARTUP = 'company_type:startup';
const SCALEUP = 'company_type:scaleup';
const ENTERPRISE = 'company_type:enterprise';
const LOCS = [
    {
        startup: ['startup', 'start-up', 'early stage', 'early-stage'],
        scaleup: ['scaleup', 'scale-up', 'growth company', 'scaling company', 'sme', 'small business'],
        enterprise: [
            'enterprise',
            'multinational',
            'corporation',
            'corporate group',
            'large company',
            'conglomerate',
            'fortune 500',
        ],
        employee: ['employees', 'employee', 'staff', 'people', 'team members', 'colleagues', 'headcount', 'workforce'],
        team: ['team of', 'a team of'],
        exclude: [
            'clients',
            'customers',
            'stores',
            'users',
            'products',
            'years',
            'countries',
            'projects',
            'branches',
            'locations',
            'markets',
        ],
    },
    {
        startup: ['startup', 'start-up'],
        scaleup: ['scaleup', 'scale-up', 'companie in crestere', 'imm'],
        enterprise: ['multinationala', 'multinational', 'corporatie', 'concern', 'companie mare', 'grup de firme'],
        employee: ['angajati', 'angajat', 'colegi', 'oameni', 'persoane', 'salariati', 'membri'],
        team: ['echipa de', 'o echipa de'],
        exclude: [
            'clienti',
            'magazine',
            'orase',
            'utilizatori',
            'produse',
            'ani',
            'tari',
            'proiecte',
            'sucursale',
            'piete',
        ],
    },
    {
        startup: ['startup'],
        scaleup: ['kkv'],
        enterprise: ['multinacionalis', 'nagyvallalat', 'vallalatcsoport'],
        employee: ['alkalmazott', 'munkatars', 'dolgozo'],
        team: ['csapat'],
        exclude: ['ugyfel', 'uzlet', 'termek', 'ev', 'orszag'],
    },
    {
        startup: ['startup'],
        scaleup: ['vke'],
        enterprise: ['rahvusvaheline', 'suurettevote', 'kontsern'],
        employee: ['tootajat', 'tootaja', 'inimest', 'kolleegi'],
        team: ['meeskond'],
        exclude: ['klient', 'kauplus', 'toode', 'aasta', 'riik'],
    },
];
const NUM = String.raw `\d[\d., ]*\d|\d`;
// Words shortly AFTER a stage word that mean it describes a product / customer /
// culture, not the hiring company's size ("enterprise software", "startup mindset",
// "small business segment", "enterprise clients").
const STAGE_DISQUALIFIER = /\b(software|architecture|account|accounts|client|clients|customer|customers|solution|solutions|application|applications|system|systems|segment|sector|sales|market|markets|mindset|culture|environment|vibe|spirit|mentality|resource|grade|level|agreement|deal|deals)\b/;
// Words shortly BEFORE a stage word that mean it's a customer/target segment, not
// the hiring company ("servicii pentru IMM", "segmentul Small Business").
const STAGE_PRE_DISQUALIFIER = /\b(segment\w*|adresat\w*|pentru|servicii|serving|targeting|clienti|clients|customers|catre)\b/;
const hasWord = (text, w) => 
// words are literals of letters/digits/space/hyphen — no regex metachars, no escaping.
w.length >= 3 && new RegExp(`(?:^|[^\\p{L}])${w}(?:$|[^\\p{L}])`, 'u').test(text);
const parseNum = (s) => Number(s.replace(/[.,\s]/g, ''));
function stageFromCount(n) {
    return n < 50 ? STARTUP : n < 250 ? SCALEUP : ENTERPRISE;
}
export function inferCompanySize(clauses) {
    const { add, terms } = collector();
    for (const c of clauses) {
        const loose = normalizeLoose(c.text);
        for (const L of LOCS) {
            // Explicit stage words — skipped when an immediately following word shows the
            // term describes a product/customer/culture rather than the company's size.
            for (const [key, words] of [
                [STARTUP, L.startup],
                [SCALEUP, L.scaleup],
                [ENTERPRISE, L.enterprise],
            ]) {
                for (const w of words) {
                    if (w.length < 3)
                        continue;
                    const re = new RegExp(`(?:^|[^\\p{L}])${w}(?=$|[^\\p{L}])`, 'giu');
                    for (const m of loose.matchAll(re)) {
                        const after = loose.slice(m.index + m[0].length, m.index + m[0].length + 22);
                        const before = loose.slice(Math.max(0, m.index - 18), m.index);
                        if (STAGE_DISQUALIFIER.test(after) || STAGE_PRE_DISQUALIFIER.test(before))
                            continue;
                        if (isNegated(c.text, w))
                            continue;
                        add(key, 0.9, c.text);
                        break;
                    }
                }
            }
            // Employee counts: "<n> employees" / "peste <n> angajați" / "team of <n>".
            const emp = `(?:${L.employee.join('|')})`;
            const team = `(?:${L.team.join('|')})`;
            const patterns = [
                // number, optional +/range, optional "de"/"of" connector, then employee word
                new RegExp(`(${NUM})\\s*(?:\\+)?\\s*(?:-\\s*(?:${NUM})\\s*)?(?:de\\s+|of\\s+)?${emp}`, 'gi'),
                new RegExp(`${team}\\s*(?:de\\s+|of\\s+)?(${NUM})`, 'gi'),
            ];
            for (const re of patterns) {
                for (const m of loose.matchAll(re)) {
                    const window = loose.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20);
                    if (L.exclude.some((w) => hasWord(window, w)))
                        continue;
                    const n = parseNum(m[1]);
                    if (n >= 1 && n <= 2_000_000)
                        add(stageFromCount(n), 0.8, c.text);
                }
            }
        }
    }
    return terms();
}
