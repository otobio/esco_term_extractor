# Leaf-Selection Hardening — 2026-08-14

Standalone record of the work done this session on `src/search-pipeline/occupation-search-pipeline.ts`
leaf selection, in response to the external code review (see `audit_2026-08-14.md` for the
pre-existing state and the review's own text). Covers: what changed, why, where the new logic lives
(including a placement question raised during review), the test coverage added to lock it in before
the planned simplification pass, and a concrete plan for that simplification pass.

Scope note: per explicit instruction, the review's "essential #1" (canonical-match invariants) was
**skipped** this session and is not addressed here.

---

## 1. What was broken

The external review proposed a simple decision tree for leaf selection (§12 of the review):

```
invalid lexical fit          -> reject (family)
insufficient direct evidence -> reject (family)
family materially weaker     -> reject (family)
competing leaf too close     -> reject (family)
otherwise                    -> LEAF
```

Before this session, the codebase implemented boxes 1–3 but **box 4 ("competing leaf too close")
only existed in two narrow, special-cased shapes**:

- `hasAmbiguousAliasLeafTie` — leaves tied on the *same alias*.
- `hasUnsafeSpecializedLeafTie` — a specialized leaf tied against a generic one.

Neither shape covers a plain near-tie between two otherwise-unrelated leaves in the same family
(e.g. "security consultant" 0.753 vs "security guard" 0.714 for the query "Security Personnel").
That gap let the pipeline promote a specific leaf the query never actually distinguished.

Separately, a **second, distinct failure mode** was found during verification, not covered by any
existing tie check because the two leaves involved were never close to each other in score at all:
queries like "Sales Personnel" or "Medical Personnel" name a *category* of occupations, not one
occupation, but nothing stopped the pipeline from picking whichever single leaf happened to score
highest (e.g. "Sales Personnel" → "call centre analyst" — the flagship bug from the original
`audit.md`). This is a distinct problem from a near-tie: there was no close competitor at all, just
one leaf confidently winning a contest the query never asked to run.

## 2. What changed

### 2.1 General leaf-separation guard (fixes box 4 in general form)

New gate, `PIPELINE_DECISION_GATE.LEAF_SEPARATION_MARGIN = 0.05` in `src/scoring/scoring-policy.ts`,
and `hasInsufficientLeafSeparation(topLeaf, family, preparedQuery)` in
`occupation-search-pipeline.ts`:

- Exempts raw exact canonical / primary-alias / controlled-acronym matches (a query that names the
  leaf exactly should never be second-guessed by a same-family neighbor).
- Otherwise computes the best "credible" sibling leaf's confidence — credible meaning
  role-compatible, specialization-supported, and role-grounded, so noisy/unrelated retrieval hits
  can't force an artificial abstention — and rejects the top leaf if the gap is under the margin.
- Wired into all three leaf-decision call sites: `resolveLeafFirstStage`'s selectable-leaf filter,
  `selectPipelineDecisionStage`'s top-family gate, and `firstSelectableLeafInFamily`.

### 2.2 Collective-occupational-noun guard (a category query is not one occupation)

New detector, `isCollectiveOccupationalQuery(preparedQuery)`, and its vocabulary,
`COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE` (English-only: `personnel`, `staff`, `workers`,
`professionals`, `employees`, `team`), both in `occupation-search-pipeline.ts`. A query is
collective if it has ≥2 folded tokens and the **last** token is one of these nouns — so
"personnel manager" or "staff nurse" (the collective word is not the head) are correctly excluded.

This is deliberately **not** the same mechanism as the pre-existing `isBroadRoleQuery` /
`hasBroadRoleLeafAuthority` bare-generic-head guard, for two reasons:

- `isBroadRoleQuery` only fires when the *entire* query is low-signal
  (`isGenericQueryShape` requires every token to be generic/stop/safe-modifier). A real domain word
  like "security" or "sales" is never low-signal, so "security personnel" never reaches that check.
- `hasBroadRoleLeafAuthority`'s bypass is a token-*count* heuristic ("winning leaf's canonical token
  count ≤ query's useful-token count"). It doesn't help here because a wrong same-length leaf
  ("security consultant") passes it exactly as trivially as a correct one would.

So the new guard is enforced the same way the review's §12 tree implies a category query should be
treated: gated on the strictest existing bypass, `hasAuthoritativeLeafPromotionAuthority` (raw exact
match only) — i.e. a collective-noun query can only resolve to a leaf on a genuine exact match,
otherwise it stays at family level.

### 2.3 Bug found and fixed while wiring 2.2: a second, parallel promotion path

`isLeafSelectable` is not the only place a leaf gets promoted.
`selectExactLeafCanonicalOrAliasFullStringRescue` (in `selectPipelineDecisionStage`) is an
independent rescue path over `rankedLeaves` that already re-implements the `isBroadRoleQuery` guard
inline (see its own comment: "this rescue must not manufacture a specific occupation any more than
`isLeafSelectable`'s own gate does") — but it had **not** been updated with the new collective-noun
guard. Result: "Security Personnel" correctly abstained via `isLeafSelectable`, but "bar staff"
slipped through this second path straight to "bartender" (its alias `"bar staff"` is a
non-primary exact alias, so `hasAuthoritativeLeafPromotionAuthority` is false and the rescue's
existing `isBroadRoleQuery` check doesn't apply — but the rescue never checked the new collective
guard at all). Fixed by mirroring the same guard in the rescue's candidate filter.

**This is itself a symptom of the complexity problem the review flagged**: the same piece of
domain logic ("is this leaf allowed to win here?") is implemented in two places that must be kept
in sync by hand. See §4 below.

## 3. Where does the collective-noun guard belong? (open placement question)

Raised directly: **it currently does not live where the analogous vocabulary lives, and that's a
deliberate short-term compromise, not a design decision.**

- The natural home for locale-keyed query vocabulary is `src/query/query-preparation.ts`, which
  already owns `GENERIC_ROLE_TERMS_BY_LOCALE` (the bare-generic-head word lists for en/ro/hu/et) and
  the `isGenericQueryShape`/`PreparedQuery` classification that `isBroadRoleQuery` reads from.
  `COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE` is the same *kind* of thing — a locale-keyed set of
  low-semantic-value nouns — and conceptually belongs there, likely as a field precomputed onto
  `PreparedQuery` (e.g. `isCollectiveOccupationalQuery: boolean`) the same way `isGenericShape` is,
  rather than as a pipeline-local helper that re-derives it from `foldedTokens`/`locale` every call.
- It was placed directly in `occupation-search-pipeline.ts` instead, specifically to avoid touching
  shared query classification during a targeted fix — `query-preparation.ts` is read by more than
  just the leaf-selection path, and changing its output shape mid-fix would have widened the blast
  radius beyond what the review asked for this round.
- Net effect: there are now **two separate locale-vocabulary tables that classify a query's tokens
  for a similar purpose** (`GENERIC_ROLE_TERMS_BY_LOCALE` in query-preparation.ts,
  `COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE` in occupation-search-pipeline.ts), living in two
  different files, with no shared abstraction between them. That's exactly the kind of incidental
  complexity the review was pointing at.

**Recommendation for the simplification pass**: move `COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE` into
`query-preparation.ts` alongside `GENERIC_ROLE_TERMS_BY_LOCALE`, compute `isCollectiveOccupationalQuery`
once as part of `prepareQuery` (mirroring `isGenericShape`), and have the pipeline just read the
field off `PreparedQuery` like it already does for the broad-role check. This is a pure move, not a
behavior change, and the new test suite (§4 below) will catch any drift during the move.

## 4. Test coverage added (before any simplification)

New file: `tests/structural/leaf-selection-safety-guards.test.ts`, 29 tests, all passing. Added
specifically so the upcoming simplification pass has a safety net that pins today's *behavior*
(not today's implementation), so the guards can be consolidated/moved without silently changing what
the pipeline actually decides. Groups:

1. **Collective-noun queries abstain to family** — Security/Media/Medical/Sales Personnel, Kitchen
   Staff, plus the literal flagship regression ("Sales Personnel" ≠ "call centre analyst").
2. **The guard covers both promotion paths** — explicit "bar staff" test targeting the rescue-path
   bug fixed in §2.3, so a future refactor that reintroduces a second unsynced path gets caught.
3. **Negative controls** — "personnel manager"/"staff nurse" (collective word isn't the query head,
   so must still resolve normally), "bartender" (clear single-occupation query, unaffected).
4. **General leaf-separation margin** — near-tie in-family leaves abstain ("hospital technician"),
   a clear winner with no close rival still resolves ("computer technician"), raw-exact-canonical
   match is exempt even with a close sibling ("bus driver").
5. **Regression sanity** — exact-canonical, cross-family-strength, and ro-localized behavior
   unchanged from before this session.
6. **Multi-locale coverage** (added after initial en/ro-only pass, per explicit request) —
   raw-exact-canonical exemption confirmed directly in hu and et (not just inferred from ro); a real
   hu multi-candidate query ("ügyfélszolgálati munkatárs") correctly abstaining; the bare
   generic-head guard exercised against ro/hu/et vocabulary, not just English.
7. **One explicitly labeled KNOWN GAP test** — `personal medical` (ro), the literal Romanian
   equivalent of "Medical Personnel", still resolves to the wrong leaf ("medical transcriptionist")
   today, because the collective-noun guard is English-only (§2.2, §3). The test asserts today's
   real (incorrect) behavior on purpose, with a comment stating that if it starts failing because the
   query now abstains to family, that failure means the guard was correctly extended to ro — not a
   regression. This exists so the gap is tracked by an executable test instead of only prose.

Full structural suite after all changes: **224/228 passing**, same 4 pre-existing failures as before
this session (builder job-function prior, ro/hu executive-group `selectionAuthority` drift ×2,
factory-worker venue-context `generic_head_family_prior`) — zero new regressions.

## 5. Known gaps (not fixed this session, intentionally)

- **Collective-noun guard is English-only.** ro/hu/et equivalents ("personal medical", "orvosi
  szemelyzet", "meditsiinipersonal", etc.) are not covered. Locked in as an executable gap by the
  KNOWN GAP test in §4.7. Extending it requires per-locale vocabulary (the review's own guidance was
  not to over-engineer untested translations) — do this only with verified real examples per locale,
  the same way `GENERIC_ROLE_TERMS_BY_LOCALE` was built up.
- **Canonical-match invariants** (review's "essential #1") — explicitly out of scope this session.
- The rescue-path duplication itself (§2.3) is not resolved, only patched to stay in sync. See §6.

## 6. Simplification plan

The review's core complaint was structural: multiple overlapping mechanisms doing similar-sounding
jobs (broad-role vs. collective-noun vs. two separate tie checks vs. a family-strength margin vs. a
family-scoped leaf-separation margin), split across two independent promotion paths
(`isLeafSelectable` and `selectExactLeafCanonicalOrAliasFullStringRescue`). The goal of simplifying
is to **collapse duplicated decision logic into the §12 shape the review proposed, without changing
what any already-tested query resolves to.** Concretely, in order:

1. **Consolidate the two promotion paths first.** `isLeafSelectable` and
   `selectExactLeafCanonicalOrAliasFullStringRescue` independently re-implement overlapping guards
   (`isBroadRoleQuery` today, `isCollectiveOccupationalQuery` after this session, and historically
   they've drifted once already — see §2.3). Before touching guard logic itself, make the rescue
   path call into (or fully defer to) `isLeafSelectable`'s gate chain, or extract the shared
   "is this leaf allowed to win" predicate into one function both paths call. This removes an entire
   class of future bugs (a new guard added to one path and forgotten in the other) rather than just
   fixing today's instance of it.
2. **Reshape the gate chain inside `isLeafSelectable` to mirror the review's §12 tree literally**,
   as a single ordered sequence of named checks returning a reason, instead of a chain of
   independent boolean early-returns accumulated over multiple sessions:
   `invalidLexicalFit → insufficientDirectEvidence → familyMateriallyWeaker → competingLeafTooClose
   → LEAF`. Today's `isLeafPromotableByRoleCompatibility` / `leafSpecializationSupport` /
   `hasLeafRoleGrounding` map to box 1; `isLeafSelectionEvidencePromotable` + the confidence gates map
   to box 2; `LEAF_FIRST_FAMILY_STRENGTH_MARGIN` (checked separately in `resolveLeafFirstStage`, not
   inside `isLeafSelectable` at all today) maps to box 3; `hasAmbiguousAliasLeafTie` /
   `hasUnsafeSpecializedLeafTie` / `hasInsufficientLeafSeparation` all map to box 4 and are strong
   candidates to merge into one function, since separation-margin already subsumes the alias-tie
   case (same alias ⇒ same confidence ⇒ zero margin) and likely subsumes the specialized-tie case
   too — verify this against the test suite in §4 rather than assuming it.
3. **Move family-strength-margin (box 3) into `isLeafSelectable` itself**, alongside the other three
   boxes, instead of leaving it as a separate filter only applied in `resolveLeafFirstStage`. Today a
   leaf could theoretically pass `isLeafSelectable` via `firstSelectableLeafInFamily` or the rescue
   path without ever being checked against family strength, since that check currently only runs in
   one of the three call sites. Confirm with the test suite whether this is a live bug or coincidentally
   safe today before changing it — either way, having one call site enforce all four boxes is the
   correct end state.
4. **Move `COLLECTIVE_OCCUPATIONAL_NOUNS_BY_LOCALE` into `query-preparation.ts`** as described in §3,
   once the guard consolidation above is stable, so it's no longer a second ad hoc vocabulary table
   living next to the pipeline logic.
5. **Confidence-field naming consistency and gate-constant consolidation** (both raised in the
   original review as secondary items) — do these last, only after the structural consolidation
   above, since renames/moves are easiest to verify safe once the decision logic itself is a single
   well-named sequence rather than scattered across two paths.

At every step: rebuild, run `npm run test:structural` (not `test:slow` — that suite is reserved for
exact-canonical-only verification per standing instruction), and diff the specific query outputs in
`tests/structural/leaf-selection-safety-guards.test.ts` against their current expected values before
and after each consolidation step. A step that changes any assertion other than the KNOWN GAP test
(§4.7, which is expected to eventually flip) needs to be justified as an intentional behavior change,
not accepted as refactor noise.
