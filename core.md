# Core decision flow: query → candidates → families/leaves → decision

This documents how a raw query becomes a final family/leaf decision, and — critically —
where a correct answer can be lost or a wrong one can win. Originally written to capture the
mechanism behind the "Sales Personnel" bug (§7, since fixed); extended in §8 to cover the
candidate channel-scoring rebalancing that followed, and the separate evidence-tier issue it
surfaced but did not fix.

## 1. Mental model

Retrieval is **channel-based, not ranked-fusion-based**: five signals (exact alias, folded
alias, ngram-alias/phrase, opensearch full-text, capability-task overlap) each score a leaf
occupation node, and those per-channel scores are combined into one `totalScore` per leaf
(see §3 for the current, corrected formula).

**Historical note (fixed, see §7/§8.1):** until this was fixed, that merged, weighted list
was sorted and **truncated to a flat `limit` (default 10) before anything hierarchical
happened** — before leaves were grouped into families/branches, before family-level scoring,
before any role-head/domain-token intent reasoning was applied. This meant a correct family
whose leaves didn't make the top 10 by raw weighted channel score was permanently invisible
to the rest of the pipeline, with no rescue path. **This flat cut has been removed** —
`buildCandidates` (`occupation-candidates.ts`) now returns the full per-channel-top-K union
(see §8.1 for why this is safe and what "per-channel top-K" means concretely). Retrieval is
still bounded — each channel independently caps its own fetch — but the merged union is no
longer re-truncated by blended score before branch expansion.

## 2. Stage-by-stage flow

Retrieval → branch expansion happen in `occupation-candidates.ts` / `occupation-candidate-branches.ts`.
Everything after that is `OccupationSearchPipeline.runPipelineAttempt` in
`src/search-pipeline/occupation-search-pipeline.ts`.

| # | Stage | File:line | What it does | Can it recover leaves lost earlier? |
|---|-------|-----------|--------------|--------------------------------------|
| 0a | `OccupationCandidateRetriever.run` | `occupation-candidates.ts:~150-425` | Queries 5 channels (`exact_alias`, `folded_alias`, `ngram_alias`, `opensearch_lexical`, `capability_task`) per surface/locale — each independently capped at the source (see §8.1 table) — merges by `graphNodeId`, computes weighted `totalScore`, sorts. **No longer slices to `limit`** (fixed, §7/§8.1) — the full per-channel-top-K union is returned. | N/A — nothing is cut here anymore |
| 0b | `OccupationCandidateBranchExpander.run` | `occupation-candidate-branches.ts` | Groups the surviving candidates into branches by `family_node_id` → `group_node_id` → evidence-derived family → `node:${id}` fallback. No further truncation. | No — operates only on survivors |
| 1 | `accumulateCurrentRetrievalEvidenceStage` | `occupation-search-pipeline.ts:1119` (approx, see grep) | For each branch, creates/gets a `PipelineFamilyCandidate`, pushes `graph_support` evidence (score = branch's share of total candidate score) and per-candidate evidence (leaf + family level) | No — only families with a surviving branch exist here at all |
| 2 | `retrieveFamilyProfileEvidenceStage` | `:499` | Independent retrieval against a family-profile artifact (`FAMILY_PROFILE_RETRIEVER`), limit `max(topFamilyLimit*3, 12)`. Skipped if disabled via env or if `hasAuthoritativeAliasEvidence` is true. | **Partial** — this is the one channel that can surface a family the leaf-retrieval cut, by matching the query against family-level text directly. But it's gated off whenever there's *any* authoritative exact-alias hit anywhere in the branch set (`hasAuthoritativeAliasEvidence`, :698) — so a strong exact alias for the *wrong* family suppresses this rescue for the *right* family too. |
| 3 | `applyJobFunctionFamilyPriorStage` | `:532` | Looks up static job-function → family priors, applies only to families that already exist in `candidateFamilies` (from stages 1-2) and pass a role-token gate | No — priors only reweight existing families |
| 4 | `applyGenericHeadFamilyPriorStage` | `:567` | Same idea for generic-head-token → family priors (e.g. bare "manager", "officer"), venue-aware override path | No — same constraint |
| 5 | `consolidateFamiliesStage` | `:1196` | Scores every family via `scoreFamilyCandidate`, sorts via `compareFamilies`, **slices to `topFamilyLimit` (default 3, hard-capped to 3 unless debug)** | No — second flat cut, now over families instead of leaves |
| 6 | `recoverLeavesInsideTopFamiliesStage` | `:1215` | For the (≤3) surviving families only, pulls **every** leaf in those families from the search-meta artifact (`getLeafCoreRecordsForFamilies`), attaches lexical hits (`retrieveLexicalFamilyHits`, family-constrained opensearch query). This is real leaf recovery — but strictly *inside* families that already survived step 5. | **Leaf-level yes, family-level no** — this is why a correct family that did survive can still surface its correct leaf even if that leaf wasn't in the original top-10; but a family that didn't survive step 5 gets nothing. |
| 7 | `narrowLeavesWithinFamiliesStage` | `:1390` | Scores every leaf via `scoreLeafCandidate`, sorts, slices to `topLeavesPerFamily` per family, re-ranks families via `rankFamiliesForSelectionAuthority` | No |
| 8 | `selectPipelineDecisionStage` | `:1508` | Applies the final decision gate (§6) | No |

**Key structural fact:** stage 6 (leaf recovery) is the *only* place the pipeline looks beyond
the initial flat candidate cut, and it only operates within families that already made it
through **two** prior flat cuts (candidate `limit`, then `topFamilyLimit`). There is no
symmetric "family recovery" stage — a family that never got a branch in step 0a/0b, and never
matched via family-profile retrieval (step 2, itself gate-able), is permanently invisible to
the rest of the pipeline for that query.

## 3. Channel-scoring breakdown (candidate retrieval, stage 0a)

Per-leaf, per-channel raw scores (all in `occupation-candidates.ts`):

- **`exact_alias`**: alias weight, or `1` for a bare exact match.
- **`folded_alias`**: alias weight × `FOLDED_EXACT_DISCOUNT` (0.85), or a subphrase score.
- **`ngram_alias`**: score from `retrieveBinaryAliasNgramHits` — cosine/coverage/phrase-bonus/authority based, now also multiplied by the family-token-relevance discount (see `familyTokenRelevanceMultiplier` in `occupation-family-token-relevance.ts`, wired into `alias-ngram-retriever.ts`). Confirmed live via A/B (artifact present/absent), but doesn't change which leaves make the top 10 for "Sales Personnel" — see §7.
- **`opensearch_lexical`**: `row.score` from the text retrieval engine per `OPENSEARCH_LEXICAL_SIGNAL_POLICY` — rewards loose vocabulary/field overlap, not phrase precision.
- **`capability_task`**: `row.score * min(1, BASE_ALIGNMENT(0.35) + maxUsefulTokenCoverage * COVERAGE_ALIGNMENT_WEIGHT(0.65))`, gated on `usefulQueryTokenCount >= 2` and at least one capability-class field signal.

These are combined with **fixed weights** (`RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT`,
`src/scoring/scoring-policy.ts:38`):

```
EXACT_ALIAS:        10
FOLDED_ALIAS:         7
NGRAM_ALIAS:          5
OPENSEARCH_LEXICAL:   4
CAPABILITY_TASK:      2   (folded into OPENSEARCH_LEXICAL's term, see fix below — constant kept for the tiebreak sort key only)
DENSE_EMBEDDING:      2   (unused in current candidate path)
```

**Current (corrected) formula**, `finalizeCandidate` (`occupation-candidates.ts`):

```
totalScore = exact_alias × 10 + folded_alias × 7 + ngram_alias × 5
           + max(opensearch_lexical, capability_task) × 4
```

**Fixed: `capability_task` was double-counting `opensearch_lexical` evidence, not adding an
independent signal.** `buildCapabilityTaskEvidence(row)` derives its evidence directly from
the *same* `opensearch_lexical` row (`details.source_channel` is hardcoded to
`'opensearch_lexical'`), with `score = row.score × min(1, 0.35 + coverage × 0.65)` — a factor
always ≤ 1. That means `capability_task`'s score can never exceed the `opensearch_lexical`
score it was derived from, for any given row, and (since `finalizeCandidate` takes the max
per channel across all rows) `channelScores.capability_task ≤ channelScores.opensearch_lexical`
always holds. The old formula summed both with separate weights
(`opensearch_lexical × 4 + capability_task × 2`), effectively giving one opensearch retrieval
hit a combined weight of up to 6 — more than `ngram_alias`'s weight of 5 — purely because the
same hit was counted twice under two channel names. Fixed by taking `max(opensearch_lexical,
capability_task) × 4` instead of summing both terms; `capability_task` still exists as its own
evidence/channel score everywhere else (tiebreak sort key here, and independently in family/leaf
`capabilitySupport` scoring in `occupation-search-pipeline.ts`, which is a separate formula
untouched by this fix).

Validated non-regressive: `npm run evaluation:golden:pipeline` byte-identical 19/24 (same 5
pre-existing failures). The 12-query Personnel/Staff probe (§8.2) also came back byte-identical
— for every query checked, `max(opensearch_lexical, capability_task)` was already achieved by
`opensearch_lexical` alone, so this fix, while a genuine correctness fix, did not change any of
those specific decisions. See §8 for what *did* turn out to be driving the anomalies the probe
surfaced.

**Remaining, not-yet-addressed imbalance:** a leaf with no `ngram_alias` hit at all can still
win on `opensearch_lexical` alone — e.g. `0.35 × 4 = 1.4` — against a leaf whose only signal is
a precise `ngram_alias` phrase match at weight 5 but a raw score of only ~0.2-0.28
(`0.25 × 5 = 1.25`). Removing the double-count narrows this gap but doesn't close it; the two
channels' raw scores still live on different natural scales that were never calibrated against
each other (see §8.3 for why this specific lever turned out not to be what was driving the
probe's new failures, and what actually was).

## 4. Family scoring (`scoreFamilyCandidate`, `:1860`)

```
confidence = clamp(max(
  authorityFloor,   // 0.95 if a primary, fully-useful exact alias matched — see PRIMARY_USEFUL_EXACT_ALIAS_FLOOR
  branchStrength   * 0.24   (HYBRID_BRANCH_STRENGTH_WEIGHT)
  + supportBreadth * 0.10   (HYBRID_SUPPORT_BREADTH_WEIGHT)
  + exactAliasContribution  ( = exactAliasScore * (0.06 + leafFitScore * 0.12) )
  + lexicalEvidenceScore * 0.12   (LEXICAL_EVIDENCE_WEIGHT — max of folded/ngram/opensearch/capability/family_profile)
  + jobFunctionPriorScore * 0.04  (DOMAIN_SUPPORT_WEIGHT)
  + (hasVenueContext ? genericHeadPriorScore : 0)
  + roleCoverage   * 0.16   (ROLE_COVERAGE_WEIGHT)
  + domainCoverage * 0.04   (DOMAIN_SUPPORT_WEIGHT)
  + capabilitySupport * 0.10 (CAPABILITY_SUPPORT_WEIGHT)
  + leafFitScore   * 0.20   (LEAF_FIT_WEIGHT)
  - genericPenalty * 0.08   (GENERIC_PENALTY_WEIGHT)
))
```

`branchStrength = max(branchShare, ratioToScore(branchMarginRatio, WEAK_RATIO=1.5, STRONG_RATIO=5))`
— i.e. either "this branch dominated the merged candidate score" or "this branch clearly beat
the next branch by margin."

**Evidence tiers** (`familyEvidenceTier`, `:2859`) rank families by evidence *kind* before
score, in `compareFamilies` (`:2404`, `evidenceTierRank` first, then `confidence`, then
`branchShare`):

```
1. local_exact          — has exact_alias evidence
2. cross_locale_backbone — has cross_locale_english_backbone evidence
3. folded_alias          — has folded_alias evidence
4. strong_phrase         — has generic_head_family_prior, OR ngram_alias, OR a prepared phrase-window match
5. family_profile        — has family_profile evidence only
6. graph_only            — none of the above (pure graph_support / branch presence)
```

So evidence *kind* trumps raw confidence in family ranking — a family with a weak exact-alias
hit outranks a family with a strong opensearch/capability-only score. This tiering happens
**after** stage 0a's flat cut, though, so it can only rank families that already have a
surviving branch.

## 5. Leaf scoring (`scoreLeafCandidate`, `:1965`) + selectability (`isLeafSelectable`, `:2061`)

```
confidence = clamp(
    directEvidenceScore * 0.34   (DIRECT_EVIDENCE_WEIGHT — max of exact/folded/ngram/opensearch/capability)
  + closeness.score      * 0.22  (CLOSENESS_WEIGHT)
  + roleCoverage          * 0.12  (ROLE_COVERAGE_WEIGHT)
  + domainSupport         * 0.03  (DOMAIN_SUPPORT_WEIGHT)
  + familySupport         * 0.16  (FAMILY_SUPPORT_WEIGHT — = parent family's confidence)
  + hierarchySupport      * 0.08  (0.9 if hasHierarchy else 0.35)
  + capabilitySupport     * 0.10  (1 if hasCapabilitySupport else 0.35)
  - closeness.titleExtraTokenRatio * 0.14  (EXTRA_TOKEN_RATIO_PENALTY_WEIGHT)
)
```

A leaf is only *selectable* as the final decision (not just ranked) if it clears one of three
gates in `isLeafSelectable`, all requiring role grounding first (`hasLeafRoleGrounding`) and a
selection-evidence promotion check:

- **Standard gate**: `confidence ≥ 0.72` AND `directEvidenceScore ≥ 0.55` AND `family.confidence ≥ 0.58`
- **Exact-useful-token gate**: `confidence ≥ 0.80` AND `directEvidenceScore ≥ 0.55` AND `family.confidence ≥ 0.50` AND full useful-query-token coverage AND `titleExtraTokenRatio ≤ 0.2`
- **Controlled acronym-expansion gate**: query has acronym tokens, `family.confidence ≥ 0.5`, leaf confidence ≥ family confidence, full useful-token coverage, no missing useful tokens

## 6. Final decision gate (`selectPipelineDecisionStage`, `:1508`)

Evaluated in this exact order — first match wins:

1. **Broader-family rescue** (`selectBroaderFamilyRescue`): if any ranked family's *label*
   directly grounds the query's role-head tokens better than the top leaf's family, decide
   `family`/`group` on that broader family outright, skipping leaf logic entirely.
2. **Leaf**: if the top leaf is selectable (§5) and not caught in an ambiguous-alias tie or
   unsafe-specialized-leaf tie with a sibling → decide `leaf`.
3. **Family-first confidence gate**: if no leaf qualifies but `topFamily.confidence ≥ 0.5`
   (`PIPELINE_DECISION_GATE.FAMILY_CONFIDENCE`) and the family has role grounding → decide
   `family`/`group`.
4. **Phrase-window fallback**: if the top family has role grounding and the top leaf has a
   prepared multi-token phrase-window anchor → decide `family`/`group` anyway (leaf evidence
   too weak to promote, but the phrase match is trusted at the family level).
5. **Unresolved**: none of the above cleared → `decisionType: 'unresolved'`.

If the decision is weak (`unresolved`, or `family`/`group` under 0.55 confidence, or a leaf
under 0.72 confidence — `SYNONYM_FALLBACK_*` thresholds), the pipeline can retry with a
synonym-expanded query (`shouldAttemptSynonymFallback`), though `planSynonymFallbackAttempt`
is currently a deliberate no-op (`:734-738`) pending synonym-lookup implementation.

## 7. Root cause (FIXED): "Sales Personnel" and the pre-consolidation truncation

Query "Sales Personnel" parses with `debug.signals` showing `roleHeadTokens: []`,
`domainTokens: ["sales", "personnel"]` — **no role head identified at all**. With no role
head, stage 0a's channel scoring structurally favors the two loosest, most-generic channels
(`opensearch_lexical`, `capability_task`), since neither "sales" nor "personnel" alone gives
`ngram_alias`/`exact_alias` anything precise to phrase-match against.

Concretely, for this query the merged, `totalScore`-sorted candidate list (before the
`limit=10` cut) has:

- Rank 1-10: all generic administrative/management leaves with `ngram_alias = 0`,
  `totalScore` 1.4-2.1 (pure `opensearch_lexical`×4 + `capability_task`×2 stacking on loose
  "sales"/"personnel" vocabulary overlap across unrelated leaf titles).
- The first leaf with any real `ngram_alias` signal ("human resources officer",
  `totalScore = 1.386`) ranks **~25th of 50** in the untruncated list — nowhere near the top 10.

Because the cut happens in `buildCandidates` (stage 0a) **before** branch expansion or
`accumulateCurrentRetrievalEvidenceStage` ever runs, the correct families (sales-role families
carrying real `ngram_alias` evidence) never get a `PipelineFamilyCandidate` created for them
at all. Stage 2 (family-profile retrieval) is the only channel that could have rescued this
independently of the leaf cut — but per §2, it also requires either being enabled and not
finding `hasAuthoritativeAliasEvidence` elsewhere in the (wrong) top-10, which is a coin flip
depending on what junk exact-aliased into the generic leaves. Stage 6 (leaf recovery) never
gets a chance to run for the correct family because the correct family was never in
`state.candidateFamilies` after consolidation (stage 5) to begin with.

**This was a channel-imbalance problem compounded by a truncation-order problem.** Two
options were on the table: raise `DEFAULT_CANDIDATE_LIMIT` (buys headroom but doesn't fix the
scale mismatch), or stop re-truncating the merged candidate set at all, since each channel
already caps its own fetch upstream (§8.1). **Fixed by the second option** — see §8.1.

## 8. Fix: top-K-per-channel union, and the channel-rebalancing that followed

### 8.1 The fix: remove the redundant post-merge truncation

**Key realization that simplified the fix:** each of the 5 channels was *already* bounded to
its own top-K at the source before ever reaching the merge step — the old `.slice(0, limit)`
in `buildCandidates` wasn't the thing providing that bound, it was a *second*, redundant cut
applied on top of an already-bounded, already-diverse union. Concretely, at the pipeline's
default `limit=10`:

| Channel | Per-fetch cap | Note |
|---|---|---|
| `exact_alias` | `limit` = 10 | `aliasRetriever.retrieve({ limit })` |
| `folded_alias` | `limit` = 10 | same call, `foldedRows` |
| `ngram_alias` | `max(limit×3, 25)` = **30** | deliberately wider — this is the fuzzy/typo-tolerant channel |
| `opensearch_lexical` | `limit` = 10 | `occupationRetriever.retrieve({ limit })` |
| `capability_task` | not a separate fetch | derived from the same `opensearch_lexical` rows, see §3 |

(These are per `surface` — the retrieval loop iterates locale-expanded query surfaces, so a
query that expands to 2 surfaces effectively doubles these caps before dedup.)

The fix (`occupation-candidates.ts`, `buildCandidates`): removed the final
`.slice(0, limit)` (and its now-dead `limit` parameter) after the per-`graphNodeId` merge.
The full deduped union — up to ~10+10+30+10 per surface, merged — now survives into branch
expansion instead of being re-cut down to 10 by blended `totalScore`. Nothing about the
per-channel caps above changed; only the *redundant second cut* was removed.

Validated: `tsc`/`biome`/`npm run build` clean. `npm run evaluation:golden:pipeline`
byte-identical 19/24 (same 5 pre-existing failures, unrelated to this change). Flagship repro
"Sales Personnel": wrong-but-confident family (`Administrative and specialised secretaries`,
0.5904) → `unresolved` (0.31) — the correct-ish `ngram_alias`-backed families (14903 "Sales
and purchasing agents and brokers", 14682 "Sales, marketing and development managers") became
visible in `ranked_families` for the first time; previously invisible because their leaves
never made the old top-10 cut.

### 8.2 Broader probe: wins and two new anomalies

12-query manual probe (Sales/Media/Warehouse/Security/Office/General Personnel, Support/
Medical/Kitchen Staff, Sales Support, Personnel Manager/Officer), compared against the
documented pre-union-fix baseline:

- **Wins**: "Media Personnel" stays correct (family 14796 "Sales, marketing and public
  relations professionals", 0.83→0.76). "Office Personnel" improves (same correct family,
  confidence 0.67→0.84).
- **New anomaly — "Security Personnel"**: flipped from "Protective services workers" (0.72,
  plausible) to **"Database and network professionals"** (0.60). Many ICT-security leaf
  aliases ("security architect", "ICT security engineer", "cyber incident responder"...) each
  phrase-match the single token "security" via `ngram_alias`; that family's evidence includes
  `ngram_alias`, so it earns `strong_phrase` evidence tier (§4), which **outranks** the
  higher-raw-scored "Administration professionals" family (0.71, tier `family_profile`)
  regardless of score, per `compareFamilies`'s tier-before-confidence ordering. Previously the
  old top-10 candidate cut happened to remove most of these ICT-security leaves before they
  ever reached family consolidation; the union fix made them (and this pre-existing ambiguity)
  visible for the first time.
- **New anomaly — "General Personnel"**: escalated from family-level (`Administration
  professionals`, 0.5) to a specific leaf, **"operations manager" (0.73)** — driven mostly by a
  generic `opensearch_lexical` match on "general," now surfaced by the same mechanism.

### 8.3 What actually caused the anomalies (and what didn't)

The initial hypothesis was that this was the same "raw channel scores on different scales"
imbalance described in §3 — i.e. that rebalancing `RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT` would
fix it. Two things were checked and changed that read:

1. **The `capability_task` double-count (§3) was fixed and re-tested — it changed nothing for
   these queries.** `max(opensearch_lexical, capability_task)` was already equal to
   `opensearch_lexical` alone in every case checked, so removing the double-count, while a
   real correctness fix, had zero observable effect on "Security Personnel" or "General
   Personnel."
2. **A naive minimum-score floor for `strong_phrase` promotion would have been backwards.**
   Pulled the actual raw `ngram_alias` evidence scores: "Security Personnel"'s wrong family
   (14808) has `ngram_alias` scores in the 0.45–0.53 range (single-token "security" matches).
   But "Sales Personnel"'s *correct* families (14903, 14682) — which the §8.1 fix was
   specifically trying to surface — have `ngram_alias` scores of only 0.19–0.28 (single-token
   "sales"/"personnel" matches). A score floor high enough to block 14808's promotion would
   also have blocked the very families §8.1 was meant to rescue. The raw-score magnitude
   difference here isn't about match precision (both cases are single-token matches against
   multi-word aliases) — it traces to `ngram_alias`'s own cosine/IDF weighting scoring the
   token "security" higher than "sales"/"personnel" in this corpus, for reasons independent of
   whether the resulting family assignment is correct for a given query.

**Actual mechanism**: `familyEvidenceTier` (§4) promotes a family to `strong_phrase` on the
mere *presence* of `ngram_alias` evidence (`hasEvidenceChannel`, a boolean check), with no
regard for how strong, how numerous, or how single-token-vs-phrase that evidence is. Once
promoted, `compareFamilies` ranks that family above any `family_profile`-tier family
regardless of raw confidence. This is a **deliberate, pre-existing design choice** ("evidence
kind trumps raw confidence," documented in §4 before any of this session's fixes) — not
something introduced by the §8.1 union fix. The union fix didn't create this ambiguity; it
just stopped an accidental, arbitrary truncation from hiding it. "Security Personnel" is
genuinely ambiguous between physical security and ICT/cyber security in this taxonomy, and the
tier system currently has no way to prefer one reading over the other beyond "did any
`ngram_alias` evidence exist at all" — it can't distinguish "this family owns this concept" from
"this family happens to have several leaves that share one ambiguous word with the query."

**Left open at the time this section was written**: giving `familyEvidenceTier`'s `strong_phrase`
promotion (and/or `ngram_alias` scoring itself) a way to distinguish a genuine multi-token
phrase match from a single ambiguous-token match spread across many leaves in one family. Any
fix here needs to be validated against *both* directions of failure shown above (don't
re-break "Sales Personnel," don't leave "Security Personnel"/"General Personnel" wrong) —
which likely means the fix belongs in how `ngram_alias` scores/labels a match's phrase
strength (e.g. penalizing single-token matches against multi-word aliases, or weighting tier
promotion by *how many distinct tokens* matched rather than by presence), not in the candidate
channel-weight table this section otherwise covers.

**Update (next session): "Security Personnel" fixed, but by a different, narrower lever than
predicted above** — see §8.4. The general `ngram_alias`/`strong_phrase` design issue described
here was *not* touched and remains the live root cause behind "Sales Personnel" and "General
Personnel" — see §8.5.

## 8.4 Fix A (this session): alias-retrieval phrase-window head-token fallback

**This fix lives in a different code path from the `ngram_alias` channel discussed in §8.3.**
There are two structurally distinct retrievers that can both contribute alias-derived evidence,
and it's easy to conflate them:

1. `BinaryAliasRetriever` (`binary-retrieval-engine.ts`) / `OpenSearchAliasRetriever`
   (`opensearch-alias-retriever.ts`) — exact/folded/subphrase alias search. Their subphrase
   windows are now built by the shared `src/retrieval/alias-phrase-windows.ts` module (this
   session's refactor target). Subphrase hits become `folded_alias` or `opensearch_lexical`
   evidence in `buildCandidates` (`occupation-candidates.ts:347-364`) — **not** `ngram_alias`.
2. `alias-ngram-retriever.ts`'s `retrieveBinaryAliasNgramHits` — a separate character-n-gram,
   globally-IDF-weighted feature matcher, wired in `occupation-candidates.ts:227-231` and gated
   behind `!hasWholeAlias` (it only runs when no exact/folded/canonical alias evidence was found
   anywhere). Its hits become the `ngram_alias` evidence discussed in §8.2/8.3.

**The bug (fix A addresses only mechanism 1)**: a multi-token alias query only ever searched
its full-width phrase window (e.g. the single window `"security personnel"`), which matches
zero existing aliases — no alias is literally "security personnel" — so the query got **zero**
`folded_alias`/`opensearch_lexical` evidence, even though the head word "security" alone would
have matched broadly (148 alias hits observed for "security" alone vs. 0 for "security
personnel"). This is user-hypothesis **A** from this session's kickoff prompt, confirmed
directly.

**The fix**: when the primary phrase-window search returns zero rows, fall back to single-token
windows restricted to the query's classified role-head token(s)
(`preparedQuery.intent.roleHeadTokens`) — not every useful token. Restricting to the role head
specifically avoids the self-caught regression where a generic occupational wrapper that happens
to be long enough to pass the single-token length gate (e.g. "personnel", 9 chars) would
otherwise hijack the fallback and pull in unrelated evidence ("Media Personnel" → wrongly
matching HR/"personnel officer" leaves via "personnel" instead of matching "media").
Implementation: `buildAliasPhraseWindows` / `buildAliasHeadTokenFallbackWindows` in
`src/retrieval/alias-phrase-windows.ts`, called from both retrievers'
`retrieve()`/`resolveAliasSubphraseRowsWithFallback()`.

**Confirmed effect**: "Security Personnel" now resolves to `family "Protective services
workers"` at 66% confidence (was previously flipped to "Database and network professionals" per
§8.2's anomaly — restoring real `folded_alias`-tier evidence for "security" alone gives the
correct family authoritative-tier evidence that now outranks the `ngram_alias`-only competitors,
without any change to `familyEvidenceTier`/`compareFamilies` itself). Regression-guarded by the
golden case `ambiguous-wrapper-security-personnel` (stable suite) and by
`src/tests/structural/alias-phrase-windows.test.ts` (5 unit tests) and two new pipeline tests in
`runtime-contract.test.ts` (Security Personnel fix + Media Personnel non-regression).

**What this fix did *not* touch**: mechanism 2 above (`ngram_alias`/`alias-ngram-retriever.ts`)
is untouched. Because it's a separate code path with its own globally-scoped IDF, fixing
mechanism 1 does nothing for queries whose bad evidence comes from mechanism 2 — which is
exactly the case for "Sales Personnel" and "General Personnel" below.

## 8.5 Still open: hypotheses B/C/D and the `ngram_alias` family-crediting problem

At kickoff this session, four hypotheses (A/B/C/D) were raised together for why "personnel"
drags wrong families into results. **Only A is fixed** (§8.4). B, C, and D remain open:

- **B — "why does OpenSearch stop returning Protective Services for the two-word query?"**
  Not independently re-verified after fix A. Fix A's effect on the Security Personnel golden
  case is fully explained by the `folded_alias`-channel restoration alone (mechanism 1), so B is
  neither confirmed nor ruled out for the `opensearch_lexical` lexical retriever
  (`this.occupationRetriever.retrieve`) specifically — that retriever was not touched this
  session.
- **C — "should personnel/staff/worker(s)/employee(s)/crew/team be generic wrappers, not domain
  modifiers?"** The classification half of this was already fixed in an earlier part of this
  session, before fix A: `classifyOccupationQueryIntent`'s null-role-head fallback used to
  blindly take the rightmost surviving token as role head with no check against its existing
  classification, so an all-domain-modifier query like "sales personnel" got a wrongly-forced
  role head (`roleHeadTokens: ["personnel"]`). Fixed by skipping tokens already classified as
  seniority/credential/domain-modifier/ambiguous during the fallback scan. Confirmed still live
  today: `prepareQuery('sales personnel', 'en', ...)` → `roleHeadTokens: []`,
  `domainTokens: ["sales", "personnel"]`. This is why fix A's own `buildAliasHeadTokenFallbackWindows`
  returns `[]` (no fallback windows at all) for "sales personnel" rather than re-amplifying
  "personnel" — the two fixes compose correctly. Also already built and **wired into
  production** (both `retrieveAliasNgramHits` and `retrieveBinaryAliasNgramHits` in
  `alias-ngram-retriever.ts`, via `familyTokenRelevanceMultiplier`/
  `tryLoadOccupationFamilyTokenRelevanceLookup` in `src/query/occupation-family-token-relevance.ts`):
  a per-`(family, token)` relevance artifact (`artifacts/runtime/occupation-family-token-relevance.esco_1_2_1.json`,
  `tf-ratio × family-conditioned-idf`, not global IDF) that discounts a token's `ngram_alias`
  score for families that don't actually own it. **This does not fix "Sales Personnel"**: family
  14791 "Administration professionals" is at/near the per-token max relevance *for* "personnel"
  — it genuinely is the family that owns that token the most in the corpus — so the relevance
  multiplier is correctly ~1 for it, not a discount. Family-conditioning has no leverage on a
  case where the generic-looking word really is that family's word. The live issue is D below.
- **D — "penalize alias matches that only match the head token; the second token should
  matter." Still open, and now the most likely remaining lever.** Confirmed live today for
  "Sales Personnel" (`--query="Sales Personnel" --locale=en --source-name=esco_1_2_1
  --format=json`): decision is `unresolved` (31% confidence — safer than a confidently-wrong
  pick, but still not the correct sales-domain answer). The top `ngram_alias` evidence for
  family 14791 comes entirely from `matched_tokens: ["personnel"]` (aliases like "personnel
  manager"/"personnel director"); the query token "sales" contributes nothing to that family's
  winning evidence at all. The correct sales-domain families (14903 "Sales and purchasing
  agents and brokers", 14682 "Sales, marketing and development managers") are visible in
  `ranked_families` — thanks to §8.1's union fix — but don't clear the confidence gates on their
  own weaker "sales"-token `ngram_alias` evidence. Neither half of C (the classification fix
  nor the relevance-conditioning artifact) touches this: both correctly agree "personnel" legitimately
  belongs to family 14791, so nothing in the pipeline currently requires or rewards a family
  matching *more* of the query's tokens over a family matching only one, however legitimately.
  That coverage-vs-presence gap is `ngram_alias`'s own scoring, independent of family-relevance
  weighting — likely the next concrete lever (e.g. requiring/boosting on `token_coverage`, not
  just per-token relevance).
  - Note: a probe earlier this session (before the §8.1 union fix landed) observed a *different*
    family, 14677 "Business services and administration managers", winning this same "personnel
    manager"/"personnel director" evidence for the same query. Not contradictory — both
    genuinely carry "personnel"-heavy aliases (`tf("personnel")` concentrates in Administration
    professionals (367), Professional services managers (102), Administrative secretaries (24),
    Business services managers (4)); which one surfaces as the top wrong-ish candidate shifted
    as other, unrelated changes landed. The underlying gap (D) is unchanged either way.

Tracked as a non-blocking developing golden case,
`dev-en-sales-personnel-generic-wrapper-pollution`, encoding the desired future outcome (`family
"Sales and purchasing agents and brokers"`, ≥50% confidence) so this stays visible without
blocking the stable suite.

**Separately observed, not triaged**: "General Personnel" resolves to leaf "operations manager"
at 73% confidence, driven by a generic `opensearch_lexical` match on "general" (§8.2). No golden
case was added for this — there isn't yet a confident view of what the "correct" expected answer
should be, so encoding an expectation would just assert an unverified guess.
