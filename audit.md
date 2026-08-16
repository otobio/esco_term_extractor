# Report: is "exact match = clean gate" true, and is family-first/leaf-second the right order?

## 1. Is exact canonical/primary-alias match a clean express gate today?

No. Confirmed empirically, not just in theory.

**Family exact-match** (`tests/slow/exact-name-resolution.test.ts`, every family canonical label queried verbatim):
- 1 failure out of all families: `"Secretaries (general)"` → resolves to `"Legislators and senior officials"` instead of itself.

**Leaf exact-match** — the slow test only fails-fast on the first mismatch (`"assistant clinical psychologist"` → `"clinical psychologist"`). I ran the full non-fail-fast sweep over all 3039 leaf canonical labels to see the true scope:

```
total=3039 fails=28
```

Categorized:

| Pattern | Count | Example |
|---|---|---|
| Modifier-stripping to a shorter existing leaf (`X supervisor` → `X`, `assistant X` → `X`, `X representative in <domain>` → generic `X`) | ~20 | `concrete finisher supervisor` → `concrete finisher`; `rental service representative in trucks` → `customer service representative` |
| Compound "X/Y" gendered-pair labels not parsed as a single span at all | 4 | `head waiter/head waitress` → `null` (multi_span) |
| Substring/token collision picking a different, wrong leaf entirely | ~4 | `ship assistant engineer` → `shop assistant`; `e-learning architect` → `architect` |

This directly falsifies the "only exact match is a clean gate, everything else needs role+specialization evidence" claim as currently implemented. If that claim held as designed, an exact verbatim label query should short-circuit to itself before any role/specialization/family-authority heuristics even run. Instead, ~1% of leaves and a family both get outvoted by heuristics that are supposed to only matter for *non-exact* queries. This means the "exact match gate" is not actually a gate that dominates — it's one signal among several that can still lose a tie or be overridden downstream (e.g. by `roleCompatibility`/specialization penalties treating `"X supervisor"` as an authority-bearing variant that gets demoted toward base `"X"`, or by family-selection heuristics like `jobFunctionPrior`/`branchShare` outweighing an exact family-label match).

This is architecturally important: it means the pipeline has no privileged "if verbatim canonical/alias match exists, stop here" short-circuit stage at all — canonical-match evidence is just folded in as one scoring input alongside role coverage, specialization, and family priors, and can be outvoted by them. Your intuition was right.

## 2. Is family-first/leaf-scoped-within-family the right order?

Traced the actual code path:

- `narrowLeavesWithinFamiliesStage` calls `rankFamiliesForSelectionAuthority` — families are fully ranked (via `recoveredFamilySelectionAuthority` + `compareRecoveredFamilySelectionAuthority`/`compareLegacyRecoveredFamilySelectionAuthority`) **before** any leaf is finally selected.
- `selectPipelineDecisionStage` sets `topFamily = state.rankedFamilies[0]` and then calls `firstSelectableLeafInFamily(topFamily, ...)` — leaf selection is **strictly scoped inside whichever family won**. A leaf belonging to family #2 is never considered, no matter how much better it structurally matches the query, if family #1 won the family round.

This is a real structural bottleneck, and the "Sales Personnel" case from earlier in this session is a worked example of exactly the failure mode you're worried about:
- Leaf-level gate (`roleCompatibility`/`hasUnsafeStructuralLeafPromotion`) correctly flags `"sales manager"` as incompatible/unsupported for the query `"Sales Personnel"`.
- But that correctness is wasted, because the family round (tied confidence 0.61 between "Sales, marketing and development managers" and "Sales and purchasing agents and brokers") picks the manager-heavy family first, for reasons unrelated to leaf-level authority compatibility (branch-share/prior-based tie-breaking). Once that family wins, the correct leaf (in the *other* family) is architecturally unreachable, even though it would have passed every leaf-level check.

So: family-first-then-leaf-scoped is not just theoretically suboptimal, it's already demonstrated to produce a wrong-but-defensible-looking answer in a real flagship case, and it's the same mechanism implicated in most of the 28 leaf exact-match failures above (family/branch priors and coverage heuristics outvoting a literal exact match).

## 3. Assessment of "independent, cross-validating family + leaf tracks"

The idea: resolve leaf candidates directly across the whole leaf population (not pre-filtered by a already-decided family), resolve family candidates independently, and let the two check each other, rather than family gating leaf.

Feasibility given current code:
- `scoreLeafCandidate`/leaf structural scoring already operates leaf-by-leaf and doesn't strictly require a pre-selected family to run — it's *called* within a family loop today, but the scoring function itself is family-agnostic per leaf.
- `recoveredFamilySelectionAuthority` already aggregates a `bestLeafStructuralPreference`/`structuralAlignment` per family via `maxOf(family.leaves, ...)` — i.e., leaf-level structural signal is already flowing upward into family scoring. The infrastructure for "leaf signal informs family" partially exists; what's missing is the reverse or symmetric direction — family and leaf resolved as siblings, then reconciled, rather than family strictly gating which leaves are even visible.

Two ways to make this real without a full rewrite:
1. **Minimal-risk**: keep family ranking as-is for `topFamily`, but also compute the single best leaf across *all* families independently (best global leaf by role-compatibility + structural-alignment + exact-match). If the best global leaf's family disagrees with `topFamily`, that's a cross-validation signal — either it overrides `topFamily` (if global-leaf confidence is high, e.g. canonical/exact match) or it's surfaced in the explanation trace as a conflict for review. This is additive, testable in isolation, and low regression risk since it only changes behavior when the two tracks disagree.
2. **Structural rewrite**: make leaf ranking family-agnostic globally (rank all leaves by role/structural fit across the whole taxonomy), derive family from whichever leaf(s) win, and only fall back to family-level reasoning when leaf-level evidence is ambiguous/weak (e.g. broad-role queries like "sales professional" with no single dominant leaf). This matches your intuition ("leaf is primary, family is a natural consequence") and would also directly fix the exact-match leaf failures, since an exact leaf-label match would just win outright regardless of which family currently has selection authority. It's the more correct fix but touches `narrowLeavesWithinFamiliesStage`, `selectPipelineDecisionStage`, and the decision/explanation trace shape, so it's a bigger, riskier change — best proven out via option 1 first as an instrument to measure how often the two tracks disagree and why, before committing to a full inversion.

**Recommendation**: implement option 1 first (independent global-leaf check + explicit disagreement surfaced in the explanation trace), measure disagreement rate/cause across the golden suite and the exact-match sweep, then decide whether the data supports the fuller structural inversion (option 2) or whether option 1's override rule is sufficient on its own.

## Open items not yet root-caused
- Why `structuralAlignment` doesn't override the family tie in "Sales Personnel" — candidate causes noted previously (the `bothHaveExactAlias && exactBranchShareDifference > 0.2` early short-circuit, or prior keys like `jobFunctionPrior`/`genericHeadPrior`/`roleGrounded`, or legacy-comparator routing) — still needs confirmation once we decide on an approach above.
- Full compound "X/Y" gendered-pair span parsing (4 of the 28 leaf failures) is a tokenization/span issue, separate from ranking order — worth a small fix regardless of which architecture direction is chosen.
