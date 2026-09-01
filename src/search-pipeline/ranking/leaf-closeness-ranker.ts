import {
  acronymsExpandingToToken,
  expandAcronymToken,
  isGenericQueryToken,
  isStopQueryToken,
  type SupportedQueryLocale
} from '../../query/query-preparation.js';
import { tokenMatchesLocaleVariant } from '../../query/token-variants.js';
import { occupationRoleHeadSharesEquivalentClass } from '../../query/occupation-role-head-equivalence.js';
import { BoundedCache } from '../../utils/cache.js';
import { foldSearchText, normalizeSearchText, tokenizeNormalizedText } from '../../utils/texts.js';

// LEAF CLOSENESS RANKER
// =====================
//
// Purpose
// -------
// For one leaf occupation, pick the single best-matching label -- the canonical ESCO title or one of
// the leaf's aliases -- to represent that leaf against the query, and score how close that pick is.
// This is a per-leaf, label-selection step: it does NOT rank leaves against each other. It runs once
// per (leaf, query) pair; the caller (rank-family-leaves-core.ts / occupation-search-pipeline.ts)
// then uses the winning label's tokens as the basis for every other leaf-scoring signal (role-head
// match, family fit, specialization support, the noTokenRelationship penalty, etc). Whichever label
// wins here effectively becomes "the leaf's identity" for the rest of scoreLeaf -- so a bad pick here
// corrupts everything downstream for that leaf, which is why this file has been the source of some
// subtle bugs (see "Known failure modes" below).
//
// Why aliases are scored at all
// ------------------------------
// ESCO canonical labels are deliberately narrow/formal English strings (e.g. "shop manager"). Real
// queries are noisy, non-English, and phrased however a recruiter or jobseeker phrases them. Aliases
// are the leaf's crosswalk vocabulary -- localized synonyms, informal titles, ESCO's own alternative
// labels -- and are usually a MUCH better proxy for "does this leaf match the query" than the
// canonical label alone. So every alias is scored exactly like the canonical label (same `scoreLabel`
// function) and the single best-scoring one wins; `matchedLabelSource` records whether the winner was
// the canonical label or an alias, purely for downstream tie-breaking and debugging.
//
// The `query` shape (see LeafClosenessQuery below) carries two independent representations that matter
// a lot for correctness:
//   - `foldedTokens` / `usefulFoldedRecallTokens`: the query's own literal words, folded (lowercased,
//     diacritics stripped). This is "what the user actually typed."
//   - `normalized` / `folded`: usually the same literal query text, but the caller (see
//     preparedQueryRoleNormalized/preparedQueryRoleFolded in query-preparation.ts) can substitute a
//     CROSS-LINGUAL TRANSLATION of the query's role head here instead -- e.g. Estonian "poe juht"
//     arrives with `normalized`/`folded` overridden to the English "store manager" translation, while
//     `foldedTokens` still holds the literal Estonian tokens ["poe","juht"]. This lets a leaf whose
//     canonical label IS that English translation register as an exact match (see "Scoring formula"
//     below) even though the literal query text shares no characters with it. It is also exactly the
//     mechanism behind one of this file's past bugs -- see "Known failure modes".
//
// Scoring formula (per candidate label, in `scoreLabel`)
// --------------------------------------------------------
// Every candidate (canonical label or one alias) is scored independently against the query, using
// only its own tokens -- there is no cross-candidate comparison inside `scoreLabel` itself (that
// happens afterwards, in `compareLabelRanks`). The pieces, in the order they're computed:
//
//   1. `matchedUsefulTokens` / `missingUsefulTokens` -- for each of the query's "useful" tokens (i.e.
//      excluding generic role-head words like "developer" that carry no domain signal on their own,
//      see isGenericQueryToken), check whether the candidate label's own tokens satisfy it. "Satisfy"
//      is deliberately generous -- see `isUsefulQueryTokenSatisfied` -- it accepts an exact token, a
//      known locale spelling/gender/plural variant, or an acronym match in either direction (query has
//      the acronym and the label spells it out, or vice versa). This generosity exists because ESCO
//      labels and real-world query phrasing diverge constantly in exactly these superficial ways, and
//      being strict here would make the leaf-selection step reject good matches over spelling noise.
//
//   2. `extraTitleTokens` -- the candidate label's own tokens that are NOT in the query at all (not
//      even in the non-useful/full token set, and not a locale variant of one). These are the
//      "vocabulary the leaf is adding" that the query never asked for -- e.g. a product/venue
//      specialization word. Extras are checked against the FULL query token set (`foldedTokens`), not
//      just the useful subset, specifically so a label's use of the query's own generic role word
//      (e.g. the label restates "developer" back) isn't miscounted as an extra the label invented.
//      `extraGenericModifiers` is the subset of those extras that are themselves generic query
//      vocabulary (not domain-specific) -- kept separate because they're penalized much more lightly
//      below than a genuine unrelated domain word would be.
//
//   3. `exactNormalizedLabel` / `exactFoldedLabel` -- whether the candidate's normalized/folded text is
//      byte-for-byte identical to `query.normalized`/`query.folded`. Two exactness checks exist (not
//      one) because `normalizeSearchText` and `foldSearchText` differ in strictness (folding is more
//      aggressive), so a label can match one but not the other; either is treated as "exact" here.
//      IMPORTANT: because `query.normalized`/`query.folded` can be the cross-lingual role-head
//      translation described above, this can fire true for a candidate that shares literally zero
//      tokens with what the user typed. That is intentional (it's how a translated canonical label is
//      recognized as an exact hit) but it is also exactly the sharp edge exploited by the bug described
//      in "Known failure modes" -- which is why `compareLabelRanks` (not this function) is responsible
//      for making sure that possibility never beats a candidate with genuine token overlap.
//
//   4. `usefulQueryCoverage` -- fraction of the query's useful tokens this candidate's own tokens
//      satisfy (0 if the query has no useful tokens at all). `effectiveUsefulQueryCoverage` overrides
//      this to a flat 1 (100%) whenever exactNormalizedLabel/exactFoldedLabel fired, on the theory that
//      an exact string match is strictly stronger evidence than partial token coverage could ever be.
//
//   5. The final `score` (always clamped to [0, 1] by `clampScore` -- negative contributions can and do
//      drive the raw sum below 0, and NaN/-0 are also normalized away) is a hand-tuned weighted sum:
//        + effectiveUsefulQueryCoverage * 0.52   -- the dominant signal: how much of the query this
//                                                    candidate actually accounts for.
//        + 0.26 if exactNormalizedLabel, else 0.20 if exactFoldedLabel, else 0
//                                                 -- a flat bonus on top of (not instead of) the
//                                                    coverage term, rewarding an exact string match
//                                                    beyond what its coverage alone would earn. The two
//                                                    tiers exist because normalizeSearchText is a
//                                                    stricter/more exact-feeling match than
//                                                    foldSearchText, so it earns a bigger bonus.
//        - titleExtraTokenRatio * 0.14            -- penalizes labels that are mostly extra vocabulary
//                                                    relative to their own length (a short label with
//                                                    one extra word hurts more than a long one with the
//                                                    same single extra word).
//        - min(extraGenericModifierCount, 3) * 0.04
//                                                 -- a much smaller, capped penalty specifically for
//                                                    extras that are generic (not domain-specific)
//                                                    vocabulary -- e.g. a level/seniority word the
//                                                    label added that the query didn't ask for. Capped
//                                                    at 3 tokens' worth so a handful of generic filler
//                                                    words don't compound into a large penalty.
//        - missingUsefulTokens.length * 0.08      -- penalizes useful query tokens this candidate
//                                                    doesn't cover, UNLESS it already got the exact-
//                                                    match treatment above (an exact match is not
//                                                    second-guessed over "missing" tokens, since the
//                                                    coverage override already treats it as 100%).
//      None of these five weights are derived from data -- they're hand-tuned constants calibrated
//      against the golden test suite (src/search-pipeline/golden-suite.ts) by trial and error. Treat
//      them as load-bearing but not principled; changing any one of them requires re-running
//      `npm run rank:family-leaves:eval` and `npm run test:structural` end to end, not just reasoning
//      about the formula in isolation.
//
// Picking the winner across candidates (`compareLabelRanks`)
// -------------------------------------------------------------
// `TokenLeafClosenessRanker.rank` scores the canonical label plus every alias independently, then
// sorts by `compareLabelRanks` and takes the first result. The comparator is a tie-break CHAIN, each
// level only consulted when every earlier level is exactly equal:
//   1. Real token overlap beats none at all (`matchedUsefulTokens.length > 0`) -- added specifically to
//      close the "Known failure modes" bug below. This must stay the FIRST check: it exists to stop
//      the raw `score` field (level 2) from ever letting a same-leaf candidate with zero real query-
//      token overlap beat one that actually shares tokens with the query, no matter how large its
//      exact-match bonus is.
//   2. Higher raw `score` wins.
//   3. Prefer exactNormalizedLabel, then exactFoldedLabel (mostly redundant with `score` already
//      encoding these, but guards against float-rounding ties from `clampScore`).
//   4. Lower `titleExtraTokenRatio` -- among otherwise-tied candidates, prefer the one that introduced
//      less of its own unrelated vocabulary.
//   5. Prefer the canonical label over an alias (`sourceRank`) -- an alias winning is inherently less
//      trustworthy provenance than the leaf's own official title, so it's the deciding factor only once
//      every substantive signal above is tied.
//   6. Alphabetical by matchedLabel -- a last-resort, fully arbitrary tie-break purely so the result is
//      deterministic across runs (important for golden-suite reproducibility and for `?? scoreLabel(...)`
//      below to be unreachable in practice, since `labelRanks` always has at least the canonical entry).
//
// Known failure modes (fixed, kept here so the next bug in this area starts from the right mental model)
// ----------------------------------------------------------------------------------------------------
// Enabling the CLI's English-alias fallback (rank-family-leaves-core.ts's `includeEnglishFallback`)
// surfaced a case where an alias exactly matched a cross-lingual role-head translation
// (query.normalized) while sharing ZERO real tokens with the literal query -- e.g. Estonian "poe juht"
// translates to a role head of "store manager", and a leaf named "shop manager" happens to carry an
// English alias literally spelled "store manager". Before the fix, that alias's exact-match bonus
// (item 3/5 in "Scoring formula") gave it a high enough score to win the per-leaf pick over that same
// leaf's real Estonian alias "kaupluse juht" (which only partially matches, but shares an actual
// token). The leaf then inherited "store manager"'s zero-token-overlap identity for the rest of
// scoreLeaf, triggering the -30 noTokenRelationship penalty and losing to an unrelated, weaker leaf.
// The fix is tie-break level 1 in `compareLabelRanks` above: real overlap always wins over an exact
// but zero-overlap collision, for the SAME leaf's candidate labels -- while still letting a genuine
// cross-lingual exact match win when it's a leaf's only/best candidate (e.g. Hungarian "projekt
// menedzser" landing exactly on canonical label "project manager", which has no competing alias to
// lose to). See tests/structural/leaf-closeness-ranker.test.ts for both cases as executable regression
// tests, and the golden-suite cases `et-poe-juht` / `dev-hu-projekt-menedzser-management-family`.
//
// Complexity and known optimization opportunities (not yet acted on -- flagging for a deliberate,
// separately-reviewed pass rather than folding into documentation)
// ---------------------------------------------------------------------------------------------------
//   - Cost shape: `rank()` is O(1 + aliasCount) calls to `scoreLabel`, each of which is O(tokens) --
//     cheap per call, but this runs once per (leaf, query), and leaves can carry a large family-
//     supporting alias list (the caller already filters those out via leafSpecificAliasLabels before
//     calling in here, but the remaining locale-specific list can still be sizeable for some leaves).
//     There's no caching across leaves for the same query even though `queryAllTokenSet` and
//     `queryUsefulTokens` are identical every call -- they're rebuilt from `query.foldedTokens`/
//     `query.usefulFoldedRecallTokens` fresh inside every `scoreLabel` invocation. Hoisting those two
//     Set constructions to the caller (build once per query, pass down) would remove the only real
//     per-call redundant work here, at the cost of a slightly wider function signature.
//   - (Done.) `rank()` itself was uncached, but the same (query, leaf) pair is commonly ranked 2-4
//     times per request: the additive scoring pass and `maxLeafFitScore` both rank every leaf against
//     the same query, and debug/explain mode re-runs scoring again. `TokenLeafClosenessRanker` now
//     keeps a small `BoundedCache` (src/utils/cache.ts, sized to comfortably hold one query's full
//     leaf candidate set) keyed by query content + canonicalLabel + aliases, so repeat calls for the
//     same pair skip straight to the cached result instead of rescoring every candidate label again.
//   - (Done.) matchedUsefulTokens/missingUsefulTokens and extraTitleTokens/extraGenericModifiers used
//     to each be built with two separate `.filter()` passes over the same input, calling
//     `isUsefulQueryTokenSatisfied` (and the extra/generic membership checks) twice per token. Both
//     pairs are now built together in a single loop each, splitting into the two output arrays as they
//     go -- same results, half the calls.
//   - `isUsefulQueryTokenSatisfied` calls `expandAcronymToken`/`acronymsExpandingToToken` for every
//     query token against every candidate, even for tokens that plainly aren't acronym-shaped. If
//     those lookups are non-trivial (dictionary/regex work) rather than a cheap map lookup, an early
//     cheap-shape guard (e.g. length/case heuristic) before calling them would cut wasted calls; this
//     hasn't been profiled, so it's a hypothesis, not a measured win.
//   - (Done.) `extraGenericModifiers` used to only discount extras that are generic role vocabulary
//     (`isGenericQueryToken`) -- pure function/linker words (`isStopQueryToken`, e.g. ro "de", hu "és")
//     paid the FULL extraTitleTokens penalty, identical to an unrelated domain word, even though
//     they're grammatical noise with no bearing on match quality. The extras loop now discounts a
//     token into `extraGenericModifiers` if it's EITHER generic role vocabulary OR a stop/linker word,
//     for consistency with the query side (`isUsefulQueryToken` already excludes both from "useful").
//   - `compareLabelRanks`'s tie-break chain is now six levels deep with level 1 added as a targeted bug
//     fix rather than a redesign. It works and is covered by tests, but if another cross-lingual-
//     collision-shaped bug shows up here again, the chain is a candidate for consolidating into a
//     single documented "candidate quality" tuple compared lexicographically, rather than accumulating
//     more ad hoc `||` clauses.
//   - The five scoring weights in `scoreLabel` are untyped magic numbers with no named constants. That
//     makes the "Scoring formula" section above the only source of truth for what 0.52/0.26/0.20/0.14/
//     0.04/0.08 mean -- fine for now, but if calibration (the next piece of work) starts tuning these,
//     naming them (e.g. USEFUL_COVERAGE_WEIGHT) would make future diffs to this file self-documenting
//     instead of relying on comments staying in sync.
// These are observations, not recommendations to act on unprompted -- flag before touching any of them,
// since this file's scoring behavior is sensitive to the golden suite in ways that are easy to regress
// without a full eval run.

export type LeafClosenessQuery = {
  locale: SupportedQueryLocale;
  normalized: string;
  folded: string;
  foldedTokens: string[];
  usefulFoldedRecallTokens: string[];
  // roleHeadTokens/altRoleHeadTokens mirror OccupationQueryIntent's fields of the same name (see
  // query-intent.ts) -- altRoleHeadTokens is the safe English equivalent of roleHeadTokens, resolved
  // once at intent-build time from the curated role-head equivalence classes, and is only meaningful
  // for tokens that are actually role heads, hence the separate roleHeadTokens membership check below.
  roleHeadTokens?: string[];
  altRoleHeadTokens?: string[];
  // Same idea as roleHeadTokens/altRoleHeadTokens, but for the role tokens that were NOT selected as
  // the structural head (e.g. "vanzari" in ro "consultant vanzari", where "consultant" is the head) --
  // a modifier can carry the query's real occupational meaning even when the head is a generic filler
  // noun, so it deserves the same curated-equivalence generosity in isUsefulQueryTokenSatisfied.
  roleModifierTokens?: string[];
  altRoleModifierTokens?: string[];
};

export type LeafClosenessRankerInput = {
  query: LeafClosenessQuery;
  canonicalLabel: string;
  aliases?: string[];
};

export type LeafClosenessRank = {
  score: number;
  matchedLabel: string;
  matchedLabelSource: 'canonical' | 'alias';
  exactNormalizedLabel: boolean;
  exactFoldedLabel: boolean;
  usefulQueryCoverage: number;
  titleExtraTokenRatio: number;
  extraGenericModifierCount: number;
  matchedUsefulTokens: string[];
  missingUsefulTokens: string[];
  extraTitleTokens: string[];
  extraGenericModifiers: string[];
};

export interface LeafClosenessRanker {
  rank(input: LeafClosenessRankerInput): LeafClosenessRank;
}

// Same-leaf, same-query calls into `rank()` are common within a single search: the additive scoring
// pass and `maxLeafFitScore` (occupation-search-pipeline.ts) each rank every leaf against the same
// query, and debug/explain mode re-runs the whole scoring pass again -- so a given (query, leaf) pair
// can hit `rank()` 2-4 times per request for identical inputs. `BoundedCache` (src/utils/cache.ts, the
// same LRU cache token-variants.ts uses) is sized to comfortably hold every leaf candidate the
// pipeline considers for one query at once, so within a request it's effectively a full cache; it's
// bounded so a long-lived ranker instance can't grow unbounded across many requests.
const RANK_CACHE_SIZE = 64;

export class TokenLeafClosenessRanker implements LeafClosenessRanker {
  private readonly cache = new BoundedCache<string, LeafClosenessRank>(RANK_CACHE_SIZE);

  public rank(input: LeafClosenessRankerInput): LeafClosenessRank {
    const aliases = input.aliases ?? [];
    const cacheKey = buildRankCacheKey(input.query, input.canonicalLabel, aliases);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const labelRanks = [
      scoreLabel(input.query, input.canonicalLabel, 'canonical' as const),
      ...aliases.map((alias) => scoreLabel(input.query, alias, 'alias' as const))
    ];

    const winner = labelRanks.sort(compareLabelRanks)[0] ?? scoreLabel(input.query, input.canonicalLabel, 'canonical');

    this.cache.set(cacheKey, winner);

    return winner;
  }
}

function buildRankCacheKey(query: LeafClosenessQuery, canonicalLabel: string, aliases: string[]): string {
  return `${query.locale} ${query.normalized} ${query.folded} ${query.foldedTokens.join(',')} ${query.usefulFoldedRecallTokens.join(',')} ${canonicalLabel} ${aliases.join(',')}`;
}

function scoreLabel(query: LeafClosenessQuery, label: string, source: LeafClosenessRank['matchedLabelSource']): LeafClosenessRank {
  const normalizedLabel = normalizeSearchText(label);
  const foldedLabel = foldSearchText(label);
  const titleTokens = tokenizeNormalizedText(foldedLabel);
  const queryUsefulTokens = query.usefulFoldedRecallTokens;
  const titleTokenSet = new Set(titleTokens);
  // "useful" tokens deliberately exclude generic role-head words (e.g. "developer(s)") -- they carry
  // no domain signal on their own. But that means a title token which is just a restatement of the
  // query's own role-head word (plural/gender variant included) isn't extra vocabulary the leaf
  // adds -- it's the query's own word echoed back -- so extras must be judged against the FULL
  // query token set, not only the useful subset.
  const queryAllTokenSet = new Set(query.foldedTokens);
  const matchedUsefulTokens: string[] = [];
  const missingUsefulTokens: string[] = [];

  for (const token of queryUsefulTokens) {
    (isUsefulQueryTokenSatisfied(token, titleTokenSet, query) ? matchedUsefulTokens : missingUsefulTokens).push(token);
  }

  const extraTitleTokens: string[] = [];
  const extraGenericModifiers: string[] = [];

  for (const token of titleTokens) {
    if (queryAllTokenSet.has(token) || tokenMatchesLocaleVariant(token, queryAllTokenSet, query.locale)) {
      continue;
    }

    extraTitleTokens.push(token);

    if (isGenericQueryToken(token, query.locale) || isStopQueryToken(token, query.locale)) {
      extraGenericModifiers.push(token);
    }
  }
  const exactNormalizedLabel = normalizedLabel === query.normalized;
  const exactFoldedLabel = foldedLabel === query.folded;
  const usefulQueryCoverage = queryUsefulTokens.length > 0 ? matchedUsefulTokens.length / queryUsefulTokens.length : 0;
  const effectiveUsefulQueryCoverage = exactNormalizedLabel || exactFoldedLabel ? 1 : usefulQueryCoverage;
  const titleExtraTokenRatio = titleTokens.length > 0 ? extraTitleTokens.length / titleTokens.length : 0;
  const score = clampScore(
    effectiveUsefulQueryCoverage * 0.52 +
      (exactNormalizedLabel ? 0.26 : exactFoldedLabel ? 0.2 : 0) -
      titleExtraTokenRatio * 0.14 -
      Math.min(extraGenericModifiers.length, 3) * 0.04 -
      (exactNormalizedLabel || exactFoldedLabel ? 0 : missingUsefulTokens.length * 0.08)
  );

  return {
    score,
    matchedLabel: label,
    matchedLabelSource: source,
    exactNormalizedLabel,
    exactFoldedLabel,
    usefulQueryCoverage: effectiveUsefulQueryCoverage,
    titleExtraTokenRatio,
    extraGenericModifierCount: extraGenericModifiers.length,
    matchedUsefulTokens,
    missingUsefulTokens,
    extraTitleTokens,
    extraGenericModifiers
  };
}

function isUsefulQueryTokenSatisfied(token: string, titleTokenSet: Set<string>, query: LeafClosenessQuery): boolean {
  if (titleTokenSet.has(token)) {
    return true;
  }

  if (tokenMatchesLocaleVariant(token, titleTokenSet, query.locale)) {
    return true;
  }

  const expansionTokens = expandAcronymToken(token, query.locale).map((expansionToken) => foldSearchText(expansionToken));

  if (expansionTokens.length > 0 && expansionTokens.every((expansionToken) => titleTokenSet.has(expansionToken))) {
    return true;
  }

  // token itself may be one word of an acronym's expansion (e.g. "computer" from CNC) -- a title
  // using the abbreviated form (e.g. "CNC machine operator") satisfies it just as well.
  if (acronymsExpandingToToken(token, query.locale).some((acronym) => titleTokenSet.has(acronym))) {
    return true;
  }

  // // Curated role-head equivalence classes (e.g. ro "consilier" <-> en "advisor" for a specific leaf)
  // // are just as viable a match as a locale spelling variant -- without this, a token the equivalence
  // // artifact already knows is the same role still counts as "missing" here, tanking usefulQueryCoverage
  // // and the label's score even though nothing about the mismatch is real. Curated coverage is
  // // necessarily sparse (a leaf may only carry one curated term per locale), so this must be treated as
  // // "no data either way", not as a penalty -- the same generosity already given to acronyms/variants.
  // if (occupationRoleHeadSharesEquivalentClass(token, query.locale, titleTokenSet)) {
  //   return true;
  // }

  // Canonical labels (and many aliases) are English regardless of query locale. altRoleHeadTokens is
  // the safe English equivalent of query.roleHeadTokens, resolved once at intent-build time
  // (query-intent.ts) -- only meaningful when `token` is actually one of the query's role-head
  // tokens, so gate on that membership rather than calling the equivalence artifact directly here.
  if (
    (query.roleHeadTokens ?? []).some((headToken) => foldSearchText(headToken) === token) &&
    (query.altRoleHeadTokens ?? []).some((term) => titleTokenSet.has(term))
  ) {
    return true;
  }

  return (
    (query.roleModifierTokens ?? []).some((modifierToken) => foldSearchText(modifierToken) === token) &&
    (query.altRoleModifierTokens ?? []).some((term) => titleTokenSet.has(term))
  );
}

function compareLabelRanks(left: LeafClosenessRank, right: LeafClosenessRank): number {
  return (
    // query.normalized/query.folded can be a cross-lingual translation of the query's role head (e.g.
    // Estonian "poe juht" carries a translated role head of "store manager"), so an exact match
    // against them can be a pure string collision against a label sharing zero real tokens with the
    // query. Among this leaf's own candidate labels, one with genuine token overlap must always be
    // preferred over that kind of collision -- but the collision candidate can still win when it's
    // the leaf's only (or best) candidate at all, since a real cross-lingual canonical translation
    // (e.g. hu "projekt menedzser" exactly landing on canonical "project manager") has no other
    // same-leaf alias to lose to.
    Number(right.matchedUsefulTokens.length > 0) - Number(left.matchedUsefulTokens.length > 0) ||
    right.score - left.score ||
    Number(right.exactNormalizedLabel) - Number(left.exactNormalizedLabel) ||
    Number(right.exactFoldedLabel) - Number(left.exactFoldedLabel) ||
    left.titleExtraTokenRatio - right.titleExtraTokenRatio ||
    sourceRank(left.matchedLabelSource) - sourceRank(right.matchedLabelSource) ||
    left.matchedLabel.localeCompare(right.matchedLabel)
  );
}

function sourceRank(source: LeafClosenessRank['matchedLabelSource']): number {
  return source === 'canonical' ? 0 : 1;
}

function clampScore(value: number): number {
  const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
