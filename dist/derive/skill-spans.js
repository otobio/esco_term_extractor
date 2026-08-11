/**
 * ============================================================================
 * ESCO capability/skill span extraction — en/ro/hu
 * ============================================================================
 *
 * WHAT THIS FILE DOES
 * --------------------
 * Given free text (a job description, a structured "skills" field, ...), find
 * every mention of an ESCO capability/skill and resolve it to a canonical
 * capability URI. Two independent extraction passes feed one shared scoring
 * engine:
 *
 *   1. Pattern extraction (`extractSkillSpans`) — locale-specific regexes
 *      keyed by trigger phrase ("experience with X", "manage X", "strong X
 *      skills", ...). Each locale's regexes live in `PATTERNS`, grouped by
 *      `RegexPatternGroup` (linguistic/ability/verbObject/...).
 *
 *   2. Direct lexical extraction (`extractLexicalCandidates`) — catches bare
 *      mentions with NO trigger phrase at all: bullet lists, "Required
 *      skills: Python, SQL, Docker", a bare line under a "Skills:" heading.
 *      Every pattern-group regex above requires a trigger phrase, so without
 *      this pass those extremely common job-ad shapes are missed entirely.
 *      This is a lookup against the known alias index, NOT a fuzzy scan over
 *      every word — see the function's own docstring.
 *
 * Both passes produce `EscoCandidate`s (a span of text + where it came from),
 * which are merged (`dedupeCandidates`) and then scored against the ESCO
 * alias dictionary (`escoSearch` / `searchCapability`) to produce
 * `EscoMatchResult`s. `processTextForEscoSkills` is the single public entry
 * point that runs this whole pipeline.
 *
 * `searchCapability` is ALSO called directly (not through the span pipeline)
 * by the structured `capabilities` field resolver in `src/ingest/index.ts` —
 * it is the one shared exact-first/fuzzy/ambiguity-scored engine for BOTH
 * unstructured free text and structured single-value fields. Do not fork a
 * second scoring implementation for structured resolve; if the scoring needs
 * to change, change it here.
 *
 * WHY LEXICAL, NOT OPENSEARCH
 * ----------------------------
 * The capabilities dictionary (data/lexical.lxb) already contains the full
 * ESCO alias set for this bucket, so there is no need to round-trip through
 * OpenSearch to resolve a capability — `LexicalIndex.lookup`/`lookupExact`
 * are enough. Do not reintroduce an OS call for capabilities matching; that
 * was deliberately removed.
 *
 * CANONICAL KEYS ARE LOCALE-INVARIANT
 * -------------------------------------
 * The same ESCO concept shares ONE `canonicalKey` across all of its locale
 * aliases in the dictionary (e.g. the Romanian alias "comunicare" and the
 * English alias "communication" resolve to the same canonical key). Matching
 * an ro/hu alias therefore already returns the correct (typically
 * English-style) canonical key with no extra locale-mapping step needed —
 * `best.entry.canonicalKey` is locale-agnostic by construction. See
 * `lexicalLanguagesFor` for which locales are searched per input locale
 * (en -> en+global; ro/hu -> locale+en+global).
 *
 * SCORING: EXACT -> FUZZY (RATIO-GATED) -> AMBIGUITY PENALTY
 * -------------------------------------------------------------
 * `searchCapability` (see its own docstring for full detail):
 *   - An exact whole-candidate alias hit scores confidently.
 *   - A fuzzy sub-span hit (the alias covers only part of a longer candidate)
 *     is trusted only if the alias covers a large-enough share of the
 *     candidate's words (`MIN_ALIAS_COVERAGE_RATIO`) — otherwise it's "shaky".
 *   - A single-word exact hit against a non-'knowledge' alias that has more
 *     than one distinct canonical meaning is also "shaky" (ambiguous).
 *   - Shaky matches get a low, locale-tuned confidence
 *     (`SHAKY_MATCH_CONFIDENCE`) instead of being silently dropped, so debug
 *     mode can still see them; `MATCH_ACCEPT_THRESHOLD` is what filters them
 *     out of normal (non-debug) output.
 * Do not "simplify" this into a single fuzzy-match call — the two shakiness
 * checks catch two genuinely different failure modes (see `searchCapability`
 * docstring) and collapsing them re-admits false positives that were
 * specifically fixed.
 *
 * EVIDENCE IS MERGED, NOT DISCARDED
 * ------------------------------------
 * A candidate can be independently found more than once — by two different
 * regex pattern groups within `extractSkillSpans`, or by both the pattern
 * pass and the direct-lexical pass. Instead of keeping duplicates (or
 * arbitrarily keeping only one), these merge into a single `EscoCandidate`
 * that accumulates every contributing pattern name in `patterns[]` and keeps
 * the strongest structural `source` (see `SOURCE_PRIORITY` /
 * `CandidateSource`). This is real evidence — do not collapse `patterns[]`
 * back down to a single field, and do not "dedupe by keeping the first hit"
 * in a way that throws away the others.
 *
 * `CandidateSource` ('pattern' | 'lexical' | 'list') is structural provenance
 * — was this found via a trigger regex, a bare dictionary hit in prose, or a
 * bare hit inside a bullet/numbered line or under a short heading like
 * "Skills:"? It is independent of match scoring (`matchType`/`confidence`)
 * and is not itself scored, but it is useful downstream evidence (e.g. a
 * single-token candidate under a "Skills:" heading is much less "incidental"
 * than the same token buried in a sentence).
 *
 * SPANS MUST ROUND-TRIP
 * -----------------------
 * Every `EscoCandidate.{start,end}` MUST satisfy
 * `text.slice(start, end) === candidate.text` for the original source text.
 * This is asserted in test/skill-spans.spec.ts ("candidate spans round-trip
 * to their own text") — do not change span computation
 * (`getCandidateSpan`/`extractLexicalCandidates`'s `text.indexOf`) without
 * keeping that invariant. Downstream consumers (highlighting, debug output)
 * depend on it.
 *
 * THE `verbObject` PATTERN NEEDS A STRONGER BOUNDARY THAN THE OTHERS
 * -----------------------------------------------------------------------
 * Patterns that capture up to `[^,.;\n]+` self-limit naturally. `verbObject`
 * instead captures a greedy repeat of bare word tokens
 * (`verbObjectWordGroup`), and prepositions like "with"/"cu"/"val" are
 * themselves valid word tokens — so without an extra guard, "manage customer
 * relationships with clients" over-captures the whole phrase instead of
 * stopping at "relationships". `VERB_OBJECT_STOP_WORDS` +
 * `verbObjectWordGroup` fix this by negative-lookahead-excluding
 * continuation words from each word *inside* the repeat, not just checking
 * the boundary after the fact. This fix is deliberately scoped to
 * `verbObject` only — do not blindly copy `verbObjectWordGroup` onto other
 * pattern groups that don't have this greedy-word-repeat shape.
 *
 * ROMANIAN/HUNGARIAN: "PATTERN FAMILIES", NOT ONE GIANT REGEX
 * ------------------------------------------------------------------
 * ro/hu `linguistic` and `verbObject` patterns are built from several small,
 * named regex constants (e.g. `RO_EXPERIENCE_WITH`, `RO_KNOWLEDGE_OF`,
 * `RO_VERB_OBJECT_A`, `HU_EXPERIENCE_IN`, ...) instead of one increasingly
 * unreadable mega-alternation. When adding a new phrasing/morphological
 * variant, add or extend a named constant — do not fold everything back into
 * a single regex "for simplicity".
 *
 * Hungarian is agglutinative (case suffixes like -ban/-ben/-val/-vel attach
 * directly to the noun stem: "projektmenedzsmentben", "adatbázisokkal"), so
 * the hu regexes here only cover the most common job-ad phrasings — they are
 * NOT a general Hungarian morphological analyzer and never will be via regex
 * alone. Real improvement here needs locale-aware normalization/stemming in
 * the lexical dictionary itself, not more regex. Don't treat gaps in hu
 * suffix coverage as bugs to regex away; that's a dictionary-side problem.
 *
 * TECHNICAL PUNCTUATION IS MEANINGFUL
 * ---------------------------------------
 * `cleanCandidateText` deliberately keeps a leading "." when followed by a
 * letter/digit (".NET") instead of trimming it as stray punctuation — a
 * plain edge-punctuation trim would silently turn ".NET" into "NET". Mid-word
 * punctuation (Node.js, C++, C#, ASP.NET) is untouched by trimming since it's
 * never at the string edge. If you touch this trim, keep a test for ".NET".
 *
 * WHAT NOT TO DO
 * -----------------
 * - Don't add an OpenSearch call to this file for capability resolution.
 * - Don't collapse `EscoCandidate.patterns` back to a single `pattern` field.
 * - Don't apply `verbObjectWordGroup`'s stop-word guard to non-verbObject
 *   patterns without checking they actually have the over-capture shape.
 * - Don't merge the two shakiness checks in `searchCapability` into one.
 * - Don't remove the `.NET`-style leading-dot handling in `cleanCandidateText`.
 * - Don't change span computation without preserving the round-trip
 *   invariant (and its test).
 * ============================================================================
 */
import { LexicalIndex } from '../lexical-index.js';
import { splitClauses } from '../tokenizer.js';
const CLAUSE_BOUNDARY = {
    en: String.raw `(?=[,.;:\n]|\s+(?:and|or|with|using|for|to)\s+|$)`,
    ro: String.raw `(?=[,.;:\n]|\s+(?:și|si|sau|cu|folosind|pentru|să|sa)\s+|$)`,
    hu: String.raw `(?=[,.;:\n]|\s+(?:és|vagy|valamint|a|az)\s+|$)`,
};
/**
 * `verbObject` needs a stronger guard than `CLAUSE_BOUNDARY`: that lookahead
 * only checks the position AFTER the greedy word-repeat has already consumed
 * as much as it can, and since a preposition like "with" is itself a valid
 * word-class token, the greedy match happily swallows "with clients" too —
 * the boundary lookahead then succeeds trivially at end-of-string, so nothing
 * ever stops it. ("manage customer relationships with clients" -> captures
 * the whole phrase instead of stopping at "relationships".)
 *
 * These are the continuation words — prepositions/conjunctions that start a
 * NEW phrase — excluded from each word *inside* the repeat group itself (see
 * `verbObjectWordGroup`), not just checked after the fact. Deliberately
 * scoped to `verbObject` only: the other patterns either capture up to a
 * `[^,.;\n]+` boundary (no greedy word-class to over-consume) or are narrow
 * enough that this doesn't apply.
 */
const VERB_OBJECT_STOP_WORDS = {
    en: String.raw `with|using|for|from|on|in|through|via|while|and|or|to`,
    ro: String.raw `cu|pentru|prin|de|în|in|și|si|sau|folosind`,
    hu: String.raw `val|vel|ban|ben|terén|teren|területén|teruleten|és|es|vagy|valamint`,
};
/** Builds `word (word-not-a-stop-word){0,5}` — the object may only continue
 *  with words that aren't themselves the start of a new prepositional or
 *  conjunction phrase. */
function verbObjectWordGroup(locale, wordClass) {
    const stop = VERB_OBJECT_STOP_WORDS[locale];
    return String.raw `${wordClass}(?:\s+(?!(?:${stop})\b)${wordClass}){0,5}`;
}
/**
 * Delimiters that are safe to use for splitting candidate lists.
 *
 * We deliberately DO NOT split on "and/or" here because expressions such as:
 *
 *   research and development
 *   customer service and support
 *   planning and organisation
 *
 * can represent a single ESCO concept.
 */
const CANDIDATE_DELIMITER = /\s*(?:,|\/|\||;)\s*/;
/**
 * Romanian/Hungarian `linguistic` and `verbObject` groups are built from
 * several small, named regexes ("pattern families") instead of one
 * increasingly enormous alternation — easier to extend with one more phrasing
 * variant without having to re-read the whole thing.
 */
// -- Romanian pattern families -----------------------------------------------
const RO_EXPERIENCE_WITH = /\b(?:experiență|experienta)\s+(?:de\s+lucru\s+|practică\s+|practica\s+)?(?:în|in|cu|despre)\s+([^,.;\n]+)/gi;
const RO_KNOWLEDGE_OF = /\b(?:cunoștințe|cunostinte)\s+(?:de|în|in|despre)\s+([^,.;\n]+)/gi;
const RO_SKILLS_IN = /\b(?:competențe|competente|abilități|abilitati)\s+(?:în|in|de|despre)\s+([^,.;\n]+)/gi;
const RO_FAMILIAR_WITH = /\b(?:familiaritate|familiarizat|familiarizată|expertiză|expertiza)\s+(?:cu|în|in|despre)\s+([^,.;\n]+)/gi;
const RO_EXPERIENCED_ADJ = /\b(?:experimentat|experimentată|competent|competentă)\s+(?:cu|în|in)\s+([^,.;\n]+)/gi;
/** First-conjugation (-a) Romanian verbs share these endings across common
 *  job-ad phrasings: infinitive (gestiona), 3rd person (gestionează), the
 *  nominalized noun form used after "pentru"/"responsabil de" (gestionare/
 *  gestionarea), past participle (gestionat/gestionată), and the subjunctive
 *  (gestioneze, normally preceded by "să" — handled via the optional prefix
 *  below rather than baked into every stem). */
function roAVerbForms(stem) {
    return String.raw `${stem}(?:a|ez|ează|are|area|at|ată|eze)`;
}
const RO_A_VERB_STEMS = [
    'gestion',
    'dezvolt',
    'proiect',
    'cre',
    'analiz',
    'implement',
    'oper',
    'proces',
    'configur',
    'instal',
    'monitoriz',
    'test',
    'asist',
    'coordon',
    'organiz',
    'planific',
    'superviz',
    'efectu',
];
const RO_VERB_OBJECT_A = new RegExp(String.raw `\b(?:să\s+|sa\s+)?(?:${RO_A_VERB_STEMS.map(roAVerbForms).join('|')})\s+(?:un|o|unei|unui)?\s*(${verbObjectWordGroup('ro', String.raw `[a-zăâîșț][a-zăâîșț0-9-]*`)})${CLAUSE_BOUNDARY.ro}`, 'gi');
/** Irregular conjugations (construi/pregăti/întreține/conduce) that don't fit
 *  the -a template above — spelled out directly rather than forced through
 *  it. */
const RO_VERB_OBJECT_IRREGULAR = new RegExp(String.raw `\b(?:să\s+|sa\s+)?(?:construi(?:e[sș]te|re|rea|t|tă|ască)?|preg(?:ă|a)t(?:i|e[sș]te|ire|irea|it|ită)|întreț(?:ine|inere|inerea|inut|inută)|intret(?:ine|inere|inerea|inut|inuta)|conduc(?:e|erea|ere)|condus[ăa]?)\s+(?:un|o|unei|unui)?\s*(${verbObjectWordGroup('ro', String.raw `[a-zăâîșț][a-zăâîșț0-9-]*`)})${CLAUSE_BOUNDARY.ro}`, 'gi');
// -- Hungarian pattern families -----------------------------------------------
// Hungarian's agglutinative case suffixes (-ban/-ben/-val/-vel/...) attach
// directly to the noun, so a fully general treatment would need real
// morphological analysis; these add the most common job-ad phrasings without
// claiming exhaustive coverage.
const HU_EXPERIENCE_IN = /\b(?:tapasztalat|gyakorlati tapasztalat|munkatapasztalat)\s+(?:[a-záéíóöőúüű]+\s+)?(?:terén|teren|területén|teruleten|ben|ban)\s+([^,.;\n]+)/gi;
const HU_KNOWLEDGE_OF = /\b(?:ismeret|szaktudás|szaktudas|szakértelem|szakertelem)\s+(?:[a-záéíóöőúüű]+\s+)?(?:terén|teren|területén|teruleten|ben|ban|vel|val)\s+([^,.;\n]+)/gi;
const HU_SKILLS_IN = /\b(?:jártasság|jartassag|készség|keszseg)\s+(?:[a-záéíóöőúüű]+\s+)?(?:terén|teren|területén|teruleten|ben|ban|vel|val)\s+([^,.;\n]+)/gi;
const HU_EXPERIENCED_ADJ = /\b(?:tapasztalt|jártas|jartas|képzett|kepzett)\s+(?:a|az|ben|ban)\s+([^,.;\n]+)/gi;
const HU_VERB_OBJECT = new RegExp(String.raw `\b(?:kezelni|fejleszteni|tervezni|létrehozni|letrehozni|építeni|epiteni|elemezni|megvalósítani|megvalositani|karbantartani|üzemeltetni|uzemeltetni|előkészíteni|elokesziteni|feldolgozni|konfigurálni|konfiguralni|telepíteni|telepiteni|figyelni|tesztelni|támogatni|tamogatni|koordinálni|koordinalni|szervezni|vezetni|felügyelni|felugyelni|végrehajtani|vegrehajtani)\s+(${verbObjectWordGroup('hu', String.raw `[a-záéíóöőúüű][a-záéíóöőúüű0-9-]*`)})${CLAUSE_BOUNDARY.hu}`, 'gi');
const PATTERNS = {
    en: {
        linguistic: [
            new RegExp(String.raw `\b(?:experience|knowledge|proficiency|expertise|skills?|understanding|familiarity)\s+(?:in|with|of)\s+(.+?)${CLAUSE_BOUNDARY.en}`, 'gi'),
            new RegExp(String.raw `\b(?:experienced|proficient|skilled|familiar)\s+(?:in|with|at)\s+(.+?)${CLAUSE_BOUNDARY.en}`, 'gi'),
        ],
        ability: [
            /\bability\s+to\s+([^,.;\n]+)/gi,
            /\bable\s+to\s+([^,.;\n]+)/gi,
            /\bcapable\s+of\s+([^,.;\n]+)/gi,
        ],
        verbObject: [
            new RegExp(String.raw `\b(?:manage|develop|design|create|build|analyse|analyze|implement|maintain|operate|prepare|process|configure|install|monitor|test|support|coordinate|organise|organize|plan|lead|supervise|perform)\s+(?:the\s+)?(${verbObjectWordGroup('en', String.raw `[A-Za-z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*`)})${CLAUSE_BOUNDARY.en}`, 'gi'),
        ],
        experienceWithTech: [
            /\b(?:experience|experienced|proficiency|proficient|hands[-\s]?on experience|working knowledge)\s+(?:with|in|using)\s+([^,.;\n]+)/gi,
            /\b(?:worked|working)\s+(?:with|on)\s+([^,.;\n]+)/gi,
        ],
        toolsSoftware: [
            /\b(?:using|use of|knowledge of|experience with|proficiency in|familiarity with)\s+([A-Za-z][A-Za-z0-9.+#_-]*(?:\s+[A-Za-z][A-Za-z0-9.+#_-]*){0,3})/gi,
        ],
        certificationDomain: [
            /\b(?:certified in|certification in|certification for|qualified in)\s+([^,.;\n]+)/gi,
            /\b(?:understanding of)\s+([^,.;\n]+)/gi,
        ],
        softSkills: [
            /\b(?:excellent|strong|good|solid|effective)\s+([a-z]+(?:\s+[a-z-]+){0,4})\s+(?:skills?|abilities|capabilities)\b/gi,
            /\b(?:strong|excellent|good)\s+(communication|leadership|teamwork|problem[-\s]?solving|organisation|organization|interpersonal|analytical|negotiation)\s+(?:skills?)?\b/gi,
            /\b(?:team player|problem solver|works well independently|works well under pressure)\b/gi,
        ],
    },
    ro: {
        linguistic: [RO_EXPERIENCE_WITH, RO_KNOWLEDGE_OF, RO_SKILLS_IN, RO_FAMILIAR_WITH, RO_EXPERIENCED_ADJ],
        ability: [
            /\b(?:abilitatea|capacitatea)\s+(?:de\s+a|de)\s+([^,.;\n]+)/gi,
            /\b(?:capabil|capabilă|capabili|capabile)\s+(?:să|sa|de)\s+([^,.;\n]+)/gi,
        ],
        verbObject: [RO_VERB_OBJECT_A, RO_VERB_OBJECT_IRREGULAR],
        experienceWithTech: [
            /\b(?:experiență|experienta|experiență practică|experienta practica)\s+(?:cu|în|in|utilizarea)\s+([^,.;\n]+)/gi,
            /\b(?:experiență de lucru|experienta de lucru)\s+(?:cu|în|in)\s+([^,.;\n]+)/gi,
        ],
        toolsSoftware: [
            /\b(?:utilizarea|folosirea|experiență cu|experienta cu|cunoștințe despre|cunostinte despre|competențe în|competente in)\s+([^,.;\n]+)/gi,
        ],
        certificationDomain: [
            /\b(?:certificat|certificată|certificare|calificat|calificată|atestat|atestată)\s+(?:în|in|pentru|în domeniul|in domeniul)\s+([^,.;\n]+)/gi,
        ],
        softSkills: [
            /\b(?:abilități|abilitati|competențe|competente)\s+(?:excelente|foarte bune|bune|solide)\s+(?:de|în|in)?\s*([^,.;\n]+)/gi,
            /\b(?:lucru în echipă|lucru in echipa|rezolvarea problemelor|comunicare|leadership|gândire analitică|gandire analitica)\b/gi,
        ],
    },
    hu: {
        linguistic: [HU_EXPERIENCE_IN, HU_KNOWLEDGE_OF, HU_SKILLS_IN, HU_EXPERIENCED_ADJ],
        ability: [
            /\b(?:képes|kepes)\s+(?:arra,?\s+hogy\s+|hogy\s+)?([^,.;\n]+)/gi,
            /\b(?:képesség|kepesseg)\s+(?:arra,?\s+hogy\s+|hogy\s+)?([^,.;\n]+)/gi,
        ],
        verbObject: [HU_VERB_OBJECT],
        experienceWithTech: [
            /\b(?:tapasztalat|gyakorlati tapasztalat|munkatapasztalat)\s+(?:a|az|[a-záéíóöőúüű]+\s+)?(?:használatában|hasznalataban|terén|teren|területén|teruleten)\s+([^,.;\n]+)/gi,
        ],
        toolsSoftware: [/\b(?:használata|hasznalata|ismerete|tapasztalat|jártasság|jartassag)\s+(?:a|az)?\s*([^,.;\n]+)/gi],
        certificationDomain: [
            /\b(?:tanúsítvány|tanusitvany|tanúsított|tanusitott|képesítés|kepesites|szakképesítés|szakkepesites)\s+(?:[a-záéíóöőúüű]+\s+)?(?:a|az|terén|teren|területén|teruleten)?\s*([^,.;\n]+)/gi,
        ],
        softSkills: [
            /\b(?:kiváló|kivalo|erős|eros|jó|jo|kiemelkedő|kiemelkedo)\s+([a-záéíóöőúüű]+(?:\s+[a-záéíóöőúüű-]+){0,4})\s+(?:készségek|keszsegek|képességek|kepessegek)\b/gi,
            /\b(?:csapatmunka|problémamegoldás|problemamegoldas|kommunikáció|kommunikacio|vezetői készségek|vezetoi keszsegek|analitikus gondolkodás|analitikus gondolkodas)\b/gi,
        ],
    },
};
/**
 * Split only on strong structural delimiters.
 *
 * We deliberately do not split on:
 *   and / or / și / sau / és / vagy
 *
 * because those can be part of legitimate ESCO concepts.
 */
function splitCandidateList(candidate) {
    return candidate
        .split(CANDIDATE_DELIMITER)
        .map((part) => part.trim())
        .filter(Boolean);
}
/**
 * Basic normalization only.
 *
 * No stop-word removal and no semantic transformations. The leading-edge trim
 * skips a "." immediately followed by a letter/digit so tech terms like
 * ".NET" don't lose the dot that makes them recognizable — everywhere else a
 * leading/trailing ".,;:-" is stray punctuation from the surrounding sentence.
 */
function cleanCandidateText(raw) {
    return raw
        .normalize('NFC')
        .replace(/['"_]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^(?!\.[A-Za-z0-9])[\s,;:.-]+/, '')
        .replace(/[\s,;:.-]+$/, '')
        .trim();
}
/**
 * Finds the exact position of a split candidate inside the regex match.
 *
 * Example:
 *
 *   fullMatch = "experience with Python, Java"
 *   candidate = "Python"
 *
 * Returns the candidate's absolute position in the original text.
 */
function getCandidateSpan(fullMatch, fullMatchStart, candidate, searchFrom = 0) {
    const offset = fullMatch.indexOf(candidate, searchFrom);
    if (offset === -1) {
        return null;
    }
    return {
        start: fullMatchStart + offset,
        end: fullMatchStart + offset + candidate.length,
    };
}
export function extractSkillSpans(text, locale) {
    /**
     * Merge candidates that land on the exact same normalized text + span from
     * different pattern groups — e.g. "project management" tripping both
     * `linguistic` and `softSkills` — into one candidate carrying every pattern
     * that found it, instead of two separate (and duplicate-scored) candidates.
     */
    const byKey = new Map();
    const localePatterns = PATTERNS[locale];
    for (const [patternType, regexes] of Object.entries(localePatterns)) {
        for (const regex of regexes) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const fullMatch = match[0];
                /**
                 * If the regex has a capture group, use it.
                 * Otherwise use the complete match.
                 */
                const rawCandidate = match[1]?.trim() || fullMatch.trim();
                if (!rawCandidate) {
                    continue;
                }
                const splitItems = splitCandidateList(rawCandidate);
                let searchFrom = 0;
                for (const rawItem of splitItems) {
                    const normalizedText = cleanCandidateText(rawItem);
                    if (!normalizedText || normalizedText.length < 2) {
                        continue;
                    }
                    /**
                     * Locate the individual candidate inside the
                     * original regex match.
                     */
                    const span = getCandidateSpan(fullMatch, match.index, rawItem, searchFrom);
                    if (!span) {
                        continue;
                    }
                    searchFrom = span.end - match.index;
                    const pattern = patternType;
                    const key = [normalizedText, span.start, span.end].join(':');
                    const existing = byKey.get(key);
                    if (existing) {
                        if (!existing.patterns.includes(pattern))
                            existing.patterns.push(pattern);
                        continue;
                    }
                    byKey.set(key, {
                        text: rawItem,
                        normalizedText,
                        start: span.start,
                        end: span.end,
                        locale,
                        patterns: [pattern],
                        source: 'pattern',
                    });
                }
            }
        }
    }
    return [...byKey.values()];
}
let lexicalIndexPromise;
/** Shared, lazily-loaded lexical index over data/lexical.lxb (built from the
 *  canonical_runtime_terms dictionary — same artifact resolveCapabilityTerms
 *  uses for the 'capabilities' bucket). */
function getLexicalIndex(dataDir = 'data') {
    lexicalIndexPromise ??= LexicalIndex.load(dataDir);
    return lexicalIndexPromise;
}
/** A locale's candidates also match against english + locale-agnostic aliases. */
function lexicalLanguagesFor(locale) {
    if (!locale || locale === 'en')
        return ['en', 'global'];
    return [...new Set([locale, 'en', 'global'])];
}
/**
 * Resolve a candidate span against the ESCO capabilities alias index.
 *
 * The index matches on exact normalized n-grams, so a candidate resolves
 * as 'exact' when the whole normalized phrase is itself a known alias, and
 * as 'fuzzy' when only part of it (a sub-span) matched — e.g. "advanced
 * Python scripting" matching the alias "Python" inside it.
 *
 * Two independent shakiness checks, since they catch different failure modes:
 *
 * 1. Sub-span (fuzzy) single-word alias hits are only trusted when the alias
 *    covers a large-enough share of the candidate ("compliance standards" ->
 *    "compliance" is half the phrase; "a high level of accuracy" -> "accuracy"
 *    is a fifth of it and reads as much more incidental). Below
 *    `MIN_ALIAS_COVERAGE_RATIO` the sub-span is treated as shaky.
 *
 * 2. A single-word CANDIDATE that exactly equals a single-word alias is its
 *    own risk when that alias (a) isn't a 'knowledge' term — knowledge terms
 *    tend to be specific nouns (Python, SQL); other term types skew toward
 *    generic verbs/nouns (management, support, development) — and (b) is
 *    ambiguous, i.e. the same surface word resolves to more than one distinct
 *    canonical capability. A generic one-word candidate matching one of
 *    several possible meanings is exactly the "which one did they mean" case
 *    that needs corroboration we don't have here.
 *
 * The shaky penalty is per-locale: hu/ro regexes lean on looser, more general
 * clause-boundary patterns than en (see PATTERNS above), which pulls in more
 * incidental hits, so their shaky matches are trusted even less. Tune
 * independently as real postings surface false positives.
 */
const SHAKY_MATCH_CONFIDENCE = {
    en: 0.4,
    ro: 0.35,
    hu: 0.3,
};
/** A sub-span alias hit must cover at least this fraction of the candidate's
 *  word count to be trusted; below it, it's too small a piece of a much
 *  longer phrase to be confident evidence. */
const MIN_ALIAS_COVERAGE_RATIO = 1 / 3;
/** Matches scored below this are dropped from the user-facing result set —
 *  see `processTextForEscoSkills`. */
export const MATCH_ACCEPT_THRESHOLD = 0.5;
/** Fallback shaky penalty for locales outside en/ro/hu (et, ng, ...) — no
 *  regex-derived data for these yet, so default to the most conservative
 *  (en) penalty rather than guessing at a locale-specific one. */
function shakyConfidenceFor(locale) {
    return SHAKY_MATCH_CONFIDENCE[locale] ?? SHAKY_MATCH_CONFIDENCE.en;
}
/**
 * Resolve free text against the ESCO capabilities alias index — the single
 * shared engine behind both the unstructured span pipeline (`escoSearch`
 * below) and the structured `capabilities` field resolver
 * (`derive`/`deriveMany` in `src/ingest/index.ts`). Lexical-only: the
 * dictionary in data/lexical.lxb is the full capabilities term set, so there's
 * no need to also round-trip through OpenSearch for this bucket.
 *
 * Same exact-first, ratio-gated-fuzzy, ambiguity-penalized scoring described
 * on `escoSearch`'s docstring — see there for the rationale.
 */
export function searchCapability(normalizedText, locale, lexical) {
    const langs = lexicalLanguagesFor(locale);
    const hits = lexical.lookup(normalizedText, 'capabilities', langs);
    if (!hits.length) {
        return { matchType: 'none', confidence: 0 };
    }
    const words = normalizedText.split(/\s+/).filter(Boolean).length;
    const best = hits.reduce((a, b) => (b.words > a.words ? b : a));
    const isExact = best.words >= words;
    const isLowCoverageFuzzy = !isExact && best.words < 2 && best.words / words < MIN_ALIAS_COVERAGE_RATIO;
    const isAmbiguousSingleToken = isExact &&
        words === 1 &&
        best.entry.termType !== 'knowledge' &&
        hits.filter((h) => h.words === best.words).length > 1;
    const isShaky = isLowCoverageFuzzy || isAmbiguousSingleToken;
    return {
        escoUri: best.entry.canonicalKey,
        preferredLabel: best.entry.displayName,
        matchType: isExact ? 'exact' : 'fuzzy',
        confidence: isShaky ? shakyConfidenceFor(locale) : 1,
    };
}
async function escoSearch(candidate, lexical) {
    const match = searchCapability(candidate.normalizedText, candidate.locale, lexical);
    return { ...candidate, ...match };
}
const BULLET_LINE = /^[ \t]*(?:[-*•·▪‣◦]|\d+[.)])\s+/;
/** The line containing character offset `pos` in `text`. */
export function lineAt(text, pos) {
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1)
        lineEnd = text.length;
    return text.slice(lineStart, lineEnd);
}
/**
 * A line reads as a section heading — short (<=4 words) and not itself a
 * sentence (doesn't end in a full stop/question/exclamation mark). A trailing
 * colon ("Skills:", "Requirements:") is the strongest signal but is NOT
 * required: real postings routinely use bare heading lines with no
 * punctuation at all ("Rolul tău", "Descrierea jobului", "Candidatul Ideal").
 * Detected structurally, not via a keyword list, so it isn't tied to English
 * wording.
 */
export function isHeadingLine(line) {
    const t = line.trim();
    if (!t)
        return false;
    if (/[.!?]$/.test(t))
        return false;
    return t.split(/\s+/).length <= 4;
}
/** Nearest non-blank line above `lineStart` (the start offset of a line),
 *  skipping blank lines in between — postings commonly put a blank line
 *  between a heading and the paragraph/list under it ("Rolul tău\n\n  Ai...").
 *  Checking only the line immediately above (no blank-skipping) misses that
 *  heading entirely. Returns undefined at the top of the text. */
export function previousNonBlankLine(text, lineStart) {
    let end = lineStart - 1; // position of the '\n' terminating the previous line, or -1
    while (end >= 0) {
        const start = text.lastIndexOf('\n', end - 1) + 1;
        const line = text.slice(start, end);
        if (line.trim())
            return line;
        end = start - 1;
    }
    return undefined;
}
/**
 * A clause reads as a list item — either it's on a bullet/numbered line, or
 * it's under a heading-like line (see `isHeadingLine`), skipping any blank
 * lines in between. Bullet markers are punctuation `splitClauses` doesn't
 * treat as delimiters, so they survive into the clause text.
 */
function looksLikeListItem(text, clauseStart) {
    const line = lineAt(text, clauseStart);
    if (BULLET_LINE.test(line))
        return true;
    const lineStart = text.lastIndexOf('\n', clauseStart - 1) + 1;
    const prevLine = previousNonBlankLine(text, lineStart);
    return prevLine !== undefined && isHeadingLine(prevLine);
}
/**
 * Direct lexical extraction: bare skill mentions with no linguistic trigger
 * ("Required skills: Python, SQL, Docker" or a plain bullet list) are common
 * in job postings, and every pattern group above requires a trigger phrase
 * (experience with/knowledge of/ability to/...), so they're missed entirely.
 * The capabilities dictionary already knows these terms — scan each clause
 * directly against it instead of only reacting to trigger phrases.
 *
 * This is NOT a fuzzy scan over every word: `lexical.lookup` only returns the
 * alias index's own exact n-gram hits (the same engine `searchCapability`
 * and the production `resolveCapabilityTerms` clause-lookup already use for
 * this bucket), so a candidate only exists here because it's already a known
 * alias. Ambiguity/coverage shakiness is still scored downstream in
 * `escoSearch`, same as any pattern-extracted candidate.
 */
function extractLexicalCandidates(text, locale, lexical) {
    const langs = lexicalLanguagesFor(locale);
    const candidates = [];
    let cursor = 0;
    for (const clause of splitClauses(text, 'lexical')) {
        const found = text.indexOf(clause.text, cursor);
        const start = found === -1 ? cursor : found;
        if (found !== -1)
            cursor = found + clause.text.length;
        // Cheap gate: only promote a clause to a candidate when the alias index
        // already recognizes something inside it — this is not a fuzzy scan over
        // every word, just a check against the known alias set. The clause itself
        // (not just the matched gram) becomes the candidate so the usual
        // coverage-ratio shakiness check in `escoSearch` still applies: "Python"
        // as its own clause is full-coverage (exact), but "accuracy" inside an
        // 11-word sentence clause is exactly the low-coverage case that check
        // exists to catch.
        if (!lexical.lookup(clause.text, 'capabilities', langs).length)
            continue;
        const normalizedText = cleanCandidateText(clause.text);
        if (!normalizedText || normalizedText.length < 2)
            continue;
        candidates.push({
            text: clause.text,
            normalizedText,
            start,
            end: start + clause.text.length,
            locale,
            patterns: ['lexicalDirect'],
            source: looksLikeListItem(text, start) ? 'list' : 'lexical',
        });
    }
    return candidates;
}
/** `list` is the strongest, unambiguous evidence — a bare bullet mention
 *  isn't "incidental" the way a word buried in prose can be — so it wins the
 *  merge over `lexical`, which in turn wins over a plain `pattern` trigger. */
const SOURCE_PRIORITY = { list: 2, lexical: 1, pattern: 0 };
/** Merge candidates from the pattern and direct-lexical passes that resolved
 *  to the same normalized surface — same evidence-preserving merge as
 *  `extractSkillSpans`, just across the two extraction passes instead of
 *  within one. First occurrence's span/text wins; every pattern that found
 *  this surface is kept. */
function dedupeCandidates(candidates) {
    const byKey = new Map();
    for (const candidate of candidates) {
        const key = candidate.normalizedText.toLowerCase();
        const existing = byKey.get(key);
        if (existing) {
            for (const p of candidate.patterns)
                if (!existing.patterns.includes(p))
                    existing.patterns.push(p);
            if (SOURCE_PRIORITY[candidate.source] > SOURCE_PRIORITY[existing.source])
                existing.source = candidate.source;
            continue;
        }
        byKey.set(key, { ...candidate, patterns: [...candidate.patterns] });
    }
    return [...byKey.values()];
}
/**
 * Main entry point.
 *
 * 1. Extract candidate spans using locale-specific regexes.
 * 2. Normalize candidates.
 * 3. Send candidates to ESCO search.
 * 4. Drop unmatched ('none') and shaky (below `MATCH_ACCEPT_THRESHOLD`)
 *    candidates — those are noise, not results, and callers should never see
 *    them as if they were real matches.
 *
 * `lexical` defaults to the shared data/lexical.lxb index; tests inject an
 * in-memory one (see test/support/lexical.ts) instead of hitting disk.
 *
 * Pass `{ debug: true }` to skip the drop step and get every resolved
 * candidate back, including 'none' and shaky ones, for inspecting/tuning the
 * regex patterns above (see `npm run analyze -- --debug-skills`). Leave it
 * off in any production/runtime call path — there's no reason to carry the
 * dropped candidates through a real request.
 */
export async function processTextForEscoSkills(text, locale, lexical, opts) {
    const index = lexical ?? (await getLexicalIndex());
    const candidates = dedupeCandidates([...extractSkillSpans(text, locale), ...extractLexicalCandidates(text, locale, index)]);
    if (candidates.length === 0) {
        return [];
    }
    const results = await Promise.all(candidates.map((candidate) => escoSearch(candidate, index)));
    if (opts?.debug) {
        return results;
    }
    return results.filter((r) => r.matchType !== 'none' && (r.confidence ?? 1) >= MATCH_ACCEPT_THRESHOLD);
}
