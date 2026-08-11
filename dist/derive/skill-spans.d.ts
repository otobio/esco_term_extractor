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
import type { SupportedLanguage } from '../types.js';
export type Locale = 'en' | 'ro' | 'hu';
export type RegexPatternGroup = 'linguistic' | 'ability' | 'verbObject' | 'experienceWithTech' | 'toolsSoftware' | 'certificationDomain' | 'softSkills';
/** `lexicalDirect` candidates come from a dictionary alias hit, not a regex trigger. */
export type PatternGroup = RegexPatternGroup | 'lexicalDirect';
/**
 * Where a candidate came from, independent of `patterns`/`matchType` scoring:
 * - `pattern`  — a trigger-phrase regex (linguistic/ability/verbObject/...).
 * - `lexical`  — a direct dictionary alias hit inside ordinary prose.
 * - `list`     — a direct alias hit inside a bullet/numbered line, or a bare
 *                line under a short "Skills:"/"Requirements:"-style heading.
 *                A plain list item is about as unambiguous as evidence gets
 *                ("- Python" isn't "incidentally" mentioning Python), so this
 *                is worth carrying even though it isn't scored today.
 */
export type CandidateSource = 'pattern' | 'lexical' | 'list';
export type EscoCandidate = {
    text: string;
    normalizedText: string;
    start: number;
    end: number;
    locale: Locale;
    /** Every extraction pass that independently landed on this same span/text —
     *  e.g. "project management" tripping both the `linguistic` trigger and the
     *  `softSkills` pattern is stronger evidence than either alone, so instead
     *  of keeping two separate candidates (and losing that corroboration) they
     *  merge into one candidate carrying both pattern names. */
    patterns: PatternGroup[];
    source: CandidateSource;
};
export type EscoMatchResult = EscoCandidate & {
    escoUri?: string;
    preferredLabel?: string;
    matchType?: 'exact' | 'fuzzy' | 'none';
    /** How much to trust this match, independent of `matchType`. A single-word
     *  alias matched as a sub-span inside a longer candidate (e.g. "management"
     *  found inside "strong project management skills") is much less reliable
     *  evidence than the candidate itself being exactly that alias, so it's
     *  scored low instead of being dropped outright. */
    confidence?: number;
};
export declare function extractSkillSpans(text: string, locale: Locale): EscoCandidate[];
/** Matches scored below this are dropped from the user-facing result set —
 *  see `processTextForEscoSkills`. */
export declare const MATCH_ACCEPT_THRESHOLD = 0.5;
export type CapabilityMatch = {
    escoUri?: string;
    preferredLabel?: string;
    matchType: 'exact' | 'fuzzy' | 'none';
    confidence: number;
};
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
export declare function searchCapability(normalizedText: string, locale: SupportedLanguage | undefined, lexical: LexicalIndex): CapabilityMatch;
/** The line containing character offset `pos` in `text`. */
export declare function lineAt(text: string, pos: number): string;
/**
 * A line reads as a section heading — short (<=4 words) and not itself a
 * sentence (doesn't end in a full stop/question/exclamation mark). A trailing
 * colon ("Skills:", "Requirements:") is the strongest signal but is NOT
 * required: real postings routinely use bare heading lines with no
 * punctuation at all ("Rolul tău", "Descrierea jobului", "Candidatul Ideal").
 * Detected structurally, not via a keyword list, so it isn't tied to English
 * wording.
 */
export declare function isHeadingLine(line: string): boolean;
/** Nearest non-blank line above `lineStart` (the start offset of a line),
 *  skipping blank lines in between — postings commonly put a blank line
 *  between a heading and the paragraph/list under it ("Rolul tău\n\n  Ai...").
 *  Checking only the line immediately above (no blank-skipping) misses that
 *  heading entirely. Returns undefined at the top of the text. */
export declare function previousNonBlankLine(text: string, lineStart: number): string | undefined;
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
export declare function processTextForEscoSkills(text: string, locale: Locale, lexical?: LexicalIndex, opts?: {
    debug?: boolean;
}): Promise<EscoMatchResult[]>;
