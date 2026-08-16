# Ranking stability review — phase 2

Working notes for stabilizing the ranking/retrieval pipeline. Branch: `ranking-quality-stabilization-phase-2`, worktree at `occupation-search-engine-ranking-phase-2` (separate from the main checkout so other work isn't blocked).

## 1. Done: asymmetric coverage credit (committed ec63819)

Root cause of the "Jurist" (ro) → "linguist" misresolution, verified via `--debug`:

- `src/retrieval/alias-ngram-retriever.ts`: `usefulTokenCoverage` was query-only coverage (did every query token match somewhere in the alias?). A single-token query got 100% coverage against a 2-token compound alias like "jurist lingvist" (a distinct legal-linguist occupation), with the alias's own unmatched token never penalized. Fixed by taking `Math.min(queryCoverage, aliasCoverage)` in both the in-memory and binary-cache paths.
- `src/retrieval/binary-retrieval-engine.ts` / `opensearch-occupation-retriever.ts`: the lexical phrase-match bonus credited "field text contains query" with no length floor — trivially true for any short query against a longer field. Gated on `queryTokens.length >= 2`.

Verified no regressions: `test:structural` and `evaluation:golden:pipeline` show identical pre-existing baseline failures before/after (4 structural: job-function-prior/Builder, Romanian-manager, Hungarian-professional, venue-worker; 3 golden: modifier-senior-data-analyst, ro-asistent-social, ro-feminine-contabila — all pre-date this branch).

**Still open:** "Jurist" (ro) itself still resolves to "linguist," not "Legal professionals." The fix reduced every candidate's score by removing the unwarranted bonus, but didn't flip the ranking because "jurist lingvist" is a `locale_primary` alias (weight 1) for its leaf, so its `ngram_alias` score (cosine + authority boost) still outweighs "legal consultant"'s much weaker alias evidence (0.073). This is a deeper issue than pure coverage: a single query token matching a `locale_primary` alias of an unrelated compound occupation is being treated with too much authority relative to broad family-supporting lexical evidence for the correct family. Needs its own investigation — likely either (a) discounting `locale_primary` alias authority boost when alias-side coverage is low, or (b) a family-selection-comparator-level check for "does the winning leaf's matched alias have unaccounted tokens" (mirrors the `roleCoverage` majority-gate work from the previous branch).

## 2. User's open theory: cross-locale exact-alias rescue

Theory: "Jurist" is *certainly* an exact primary-alias match in the DB, just pointing at a different locale's leaf/context than expected. Proposed fix shape: on finding a genuinely exact (not partial/ngram) primary-alias match anywhere globally, use its *characteristics* (family, capability signature) to steer ranking for the current locale — but restrict this strictly to primary-alias exact matches to avoid false direction. Not yet investigated whether the current pipeline does any cross-locale exact lookup at all, or whether "jurist" is actually an exact primary alias for a Legal-professionals leaf in another locale. Needs: grep for existing cross-locale fallback logic (`cross_locale` appears in the coverage-status debug output already — investigate what triggers it today) before designing anything new.

## 3. User's stated goal: leaf-selection order stability

Order should be: base leaf is default; only promote to a specialized leaf if the query *explicitly* asks for that specialization. "Always better to fail wrongly (abstain) than pass wrongly (confidently wrong)." Previous branch already added several guards in this direction (leaf-separation margin, collective-noun guard, roleCoverage majority gate). Needs a fresh audit specifically asking: for a good family match, is base-vs-specialized leaf choice using a *classifier-style yes/no* signal (do we have explicit specialization evidence?) rather than a fuzzy score comparison? Where the data already exists (specialization keywords, capability tags) but isn't being fed into the classifier cleanly, prefer adding data over statistical tuning.

## 4. User's stated goal: phase-split ranking into strong vs. weak tiers

Current comparator (`compareRecoveredFamilySelectionAuthority`) is one long tie-break chain mixing curated/deliberate signals (group agreement, job-function prior, reviewed signal — "perfect as is") with heuristic/statistical signals (roleCoverage, capability fit, etc.) that can be shaky for broad occupations. User's suggestion: explicitly split into a "strong-evidence phase" (exact canonical, exact alias, curated priors — decide immediately, no downstream heuristic can override) and a "weak/heuristic phase" (only engaged when strong phase is inconclusive), so weak signals structurally cannot contaminate a strong-phase decision. This may already be *implicitly* true given the comparator's existing early-tier ordering, but should be made explicit and audited — in particular check whether weak signals ever get to run before a strong signal is even checked (e.g. does ngram_alias/lexical evidence retrieval happen and get scored before any exact-alias check has a chance to short-circuit?).

## 5. User's stated goal: per-channel evidence-collection review

Explicit ask to review each ranking evidence channel for reliability, not just tune weights:
- **Capability fit**: noted as "particularly useful for specific occupations, not helpful for broader ones" — confirm whether capability-fit scoring degrades gracefully (contributes ~0 / neutral) for broad-role queries, or whether it can actively mislead when capability data is sparse/generic for a broad family.
- **ngram_alias / lexical**: the coverage-asymmetry bug just fixed is exactly this kind of "is this channel collected well" issue — there may be siblings elsewhere (e.g. does `graph_support` or `family_profile` evidence have any similar directionality assumption baked in?).
- General method: for each channel, ask "what does a *minority/partial* match from this channel mean, and is it currently weighted as if it were a majority/complete match?" — that was the shape of both bugs found so far (roleCoverage in the previous branch, coverage/phraseMatch in this one).

## 2026-08-16: ejobs-test-run.csv sweep (7 "no" rows)

Ran all 7 unique "no"-labeled titles through `--debug`. They did **not** share one root cause.

**Fixed (general bug, committed 42e95eb):** `PreparedQuery.usefulFoldedTokens` only carries acronym
expansion. The locale plural/inflection variant map (`token-variants.ts`, e.g. ro "electricieni" ->
"electrician") is expanded separately into `expandedFoldedTokens`, but until now **nothing in
retrieval ever consumed that field** -- only the `--debug` CLI printed it. Every alias-ngram coverage
computation (both the in-memory and binary-cache retrieval paths) therefore never credited a query's
inflected/plural form against an alias stored in its base form. Fixed by building the useful-token
set from `expandedFoldedTokens` instead of `usefulFoldedTokens` in both `retrieveAliasNgramHits` and
`retrieveBinaryAliasNgramHits`. This is a structural fix affecting any query in any locale that hits
an entry in `TOKEN_VARIANT_RULES_BY_LOCALE` -- not specific to row #1's "electricieni".

**Not fixed — binary/opensearch lexical channels have the same gap.** `binary-retrieval-engine.ts`
and `opensearch-occupation-retriever.ts` still build their token sets from raw `foldedTokens`, so the
lexical channel (as opposed to ngram_alias) still gets no variant-expansion credit. Wiring this in
safely is more invasive than the alias-ngram fix: `phraseMatch` relies on token *order* (phrase
concatenation), so blindly swapping in `expandedFoldedTokens` (order-scrambled, superset) would corrupt
phrase-containment checks rather than just improve token-set matching. Candidate-discovery
(`candidateTextRecordIds`) would also need the expanded token ids added for recall, not just the
scoring-side token sets. Left open for a follow-up that threads a separate `matchTokens` (for
membership checks) alongside the existing order-sensitive `queryTokens` (for phrase checks).

Row-by-row outcome after the fix above:

1. **"ELECTRICIENI MEDIE SI INALTA TENSIUNE SI ELECTROMECANICI"** -- still abstains (unresolved,
   confidence unchanged at the top), but "Electrical equipment installers and repairers" (the correct
   family) moved from rank 3 (25%) to rank 2 (26%), directly from the fix above. Doesn't fully resolve
   because the lexical-channel gap (above) still limits how much the correct family's evidence can grow.
   Separately noticed and **not chased**: the token "MEDIE" ("medium," as in medium-voltage) is silently
   absent from `effective_query`/`prepared.token_buckets` despite `dropped_signals=0` claiming nothing
   was dropped -- looks like a distinct bug somewhere upstream of query preparation, flagged for a
   dedicated investigation.
2. **"ȘEF DE ȘANTIER REABILITARE REȚELE TERMICE"** -- now abstains (21% confidence) instead of the
   previous wildly-wrong "germination operator." A large improvement, consistent with "abstain over
   confidently wrong." No further action; a from-scratch construction-site-supervisor alias/signal
   would be needed to actually resolve this one, which is a data-coverage gap, not a ranking bug.
3. **"Reprezentant Tehnic si Receptioner Tura de Noapte"** -- abstains (49% confidence, top leaf
   "receptionist"). This is a genuinely dual-role title ("technical representative and night-shift
   receptionist"); abstaining is arguably the correct behavior for a title describing two distinct
   occupations. Documenting as **debatable "no" label**, not chasing further.
4. **"Specialist management deplasări, secretariat, registratură"** -- abstains (45% confidence, top
   leaf "EU funds manager"). No longer confidently wrong. The title itself is a compound of several
   admin/logistics duties with no single clean occupation match in ESCO; abstaining is reasonable.
   Documenting as narrow/data-coverage, not a ranking bug.
5. **"QUALITY PLANNING ENGINER"** -- still resolves to family "Engineering professionals" only
   (leaf evidence stays below the promotion threshold, so "agricultural equipment design engineer" is
   shown as top_leaf but is *not* the actual decision). The typo "ENGINER" (for "ENGINEER") likely
   prevents matching quality-engineering aliases directly. Narrow, typo-tolerance issue --
   documenting for future triage rather than fixing now.
6. **"Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI"** -- previously landed on "procurement
   category specialist" (plausibly correct -- this was flagged as a possibly-debatable "no" label even
   before this sweep). After the fix, it now abstains (37% confidence) instead. Whether this is better
   or worse depends on whether the original "no" label was actually correct; given the uncertainty,
   treating this as a wash and flagging for manual re-labeling rather than as a regression.
7. **"Tehnician pe teren zona Harghita"** -- fixed. Previously landed on the unrelated "chemistry
   technician." Now resolves to family-level "Physical and engineering science technicians" (54%
   confidence, leaf promotion correctly held back) -- the right outcome for a generic field-technician
   title with a place name attached. The place-name token "Harghita" correctly lands in the "useful"
   bucket per the new `prepared.token_buckets` debug line (not treated as noise), and correctly doesn't
   drag the result toward an unrelated specialty.

**Also observed, not acted on:** `prepared.token_buckets` shows conjunctions like "si"/"și" ("and")
landing in the "useful" bucket rather than "stop" for Romanian queries (e.g. row #1's two "SI" tokens).
Worth checking whether the Romanian stop-token list is missing common conjunctions, but out of scope
for this sweep.

**Debug tooling added (committed c966a3f):** per explicit ask, added `--debug`-only diagnostics that
were repeatedly hand-derived during this sweep: query-side/alias-side coverage numbers for `ngram_alias`
evidence (the two inputs to the existing `min()` blend from §1 above), which direction a `phraseMatch`
fired in (field-contains-query vs query-contains-field) for lexical hits, a `capability_fit=...:labels=N`
count to distinguish "no capability data" from "data present but no match," and a new
`prepared.token_buckets` line classifying every raw token into its noise/stop/generic/modifier/useful
bucket. Purely additive -- verified no scoring/ranking change via `test:structural` and
`evaluation:golden:pipeline`.

## 2026-08-16: the CSV "yes" column is SELECTED, not CORRECT

Critical methodology correction, confirmed directly: `ejobs-test-run.csv`'s yes/no column
records whether the pipeline **committed to a result** (didn't abstain) -- not whether that
result is the right occupation. Proof: all 3 "Jurist" rows are labeled "yes" with
`top_leaf="linguist"`, a result this doc had already established as wrong in §1.

A full manual re-read of all 37 unique deduplicated rows (judging each `job_title` against its
actual Romanian meaning, ignoring the label entirely) found **9 of the 30 non-"no" rows are
actually wrong or highly suspicious** -- a materially bigger and different failure set than the
7 "no"-labeled rows swept on 2026-08-16 earlier in this doc. The dominant shape: a **generic,
unspecialized query term resolves confidently to a bizarrely specific, unrequested specialized
leaf** ("Tehnician constructor" -> "battery manufacturing technician", "Tehnician Mentenanta
(Electrician)" -> "airport maintenance technician", etc.) -- directly the §3 base-vs-specialized
leaf-order concern, but shown by this audit to be far more widespread than previously known.
Any future correctness pass on this CSV (or a similar pipeline-comparison report) must
independently judge correctness per row; the selected/not-selected label is not a proxy for it.

### Fixed (general bug, committed da63570): family-selection tie-break rewarded a family for
containing an irrelevant, untagged leaf

Root-caused via a temporary `DEBUG_FAMILY_AUTHORITY=1` console dump of
`compareRecoveredFamilySelectionAuthority`'s per-family authority record (added and removed
during this investigation, not left in the tree).

For "Tehnician constructor" (ro), the decisive tie-break field sending the result to the wrong
family ("Machinery mechanics and repairers", leaf "construction equipment technician") over the
correct one ("Physical and engineering science technicians") was `structuralAlignment`: 1 vs 0.
`leafStructuralAlignmentScore`/`leafStructuralPreferenceScore` were computed as a max over
**every** leaf in the family, including leaves recovered purely via `graph_family_recovery` --
i.e. pulled in only because they belong to the family, with zero actual query evidence (e.g.
"coachbuilder", "greaser" -- completely unrelated to "Tehnician constructor"). Such an untagged
leaf trivially scores `structuralAlignment = 1` (no `specializationKinds` to disagree with), so a
family could win this tie-break purely by coincidentally containing some irrelevant, unclassified
leaf, never because anything in it actually matched the query.

Fix: added `hasGenuineLeafEvidence` (a leaf counts only if it has at least one evidence channel
other than `graph_family_recovery`) and scoped both `maxOf` calls in
`recoveredFamilySelectionAuthority` to leaves passing that check. This is a structural fix, not
specific to "Tehnician constructor" -- it applies to every family/query pair where the tie-break
reaches `structuralAlignment` or `bestLeafStructuralPreference`.

Verified: `test:structural` (231/236 pass, same 4 pre-existing + 1 unrelated failures as every
prior baseline in this doc) and `evaluation:golden:pipeline` (same 3 pre-existing failures) --
zero new regressions.

Re-verified all 9 flagged CSV rows after the fix:

1. **"Tehnician constructor"** -- fixed at the family level. Now abstains to family "Physical and
   engineering science technicians" (72% confidence) instead of the wrong "Machinery mechanics and
   repairers"/"construction equipment technician". top_leaf display still shows an unpromoted
   specific leaf ("construction safety inspector"), but the actual *decision* is family-only --
   the safer failure mode.
2. **"Tehnician Mentenanta (Electrician)"** -- still shows leaf "airport maintenance technician"
   as top_leaf, decision remains family-level ("Physical and engineering science technicians",
   80%). Same shape as #1: the wrong-looking leaf is a display artifact of an unpromoted
   candidate, not a selected decision. No further action needed for this row specifically.
3. **"Tehnician Service"** -- same pattern: family-only decision at 55% confidence, wrong-looking
   leaf displayed but not selected.
4. **"Electrician întreţinere şi reparaţii - Acăţari,jud.Mures"** -- genuinely improved: now
   resolves to family "Electrical equipment installers and repairers" (69%) with top_leaf
   correctly showing generic "electrician" (previously "mining electrician"). The place-name
   qualifier ("Acăţari,jud.Mures") no longer drags the leaf toward an unrelated specialization.
5. **"Mecanic utilaje industriale - Acăţari,jud.Mures"** -- **FIXED (commits `ea07891`,
   `a55177d`).** Originally landed on "industrial machinery assembler" in family "Assemblers"
   instead of the correct "Machinery mechanics and repairers" (which has an actual `exact_alias`
   match "mecanic utilaj industrial" -- near-identical to the query -- and a higher raw
   confidence, 94% vs 90%). Root cause was two-layered: (a) a curation error where "mecanic" was
   listed in `roleHeadsAny` for the `ro_mechanical_assembly_*` rules, contradicting those rules'
   own stated intent to exclude repair/maintenance role heads (fixed in `ea07891`); and (b), the
   deeper structural bug, once "mecanic" was removed the query's other token "industriale" was
   still falsely matching the Assemblers rule via a bogus auto-generated role-head-equivalence
   class that conflated it with "electrician" (see §6 below; fixed in `a55177d`). With both fixes
   applied, the query now resolves to the correct family "Machinery mechanics and repairers" with
   leaf promotion correctly held back rather than confidently landing on the wrong leaf.
6. **"Specialist planificare/ logistica"** -- still wrong (family "Sales, marketing and public
   relations professionals", top_leaf "advertising specialist"). Not investigated further this
   round; a distinct root cause from #5, unrelated to the structural-alignment fix.
7. **"Consilier de vânzări (m/f)"** -- still wrong (family "Sales and purchasing agents and
   brokers", top_leaf "insurance broker"). Not investigated further this round.
8. **"Asistent Manager Flotă & Administrativ"** -- still wrong (family "Sales, marketing and
   development managers", top_leaf "clothing development manager"). Not investigated further this
   round.
9. **"Jurist" (ro) -> "linguist"** -- **unchanged, still open.** Confirmed still resolving to
   family "Authors, journalists and linguists" / leaf "linguist" after this fix. This is the
   already-documented §1 `locale_primary`-alias-authority-vs-coverage gap; the structural-alignment
   fix in this section doesn't touch that mechanism at all.

**Honest summary:** 4 of the 9 flagged rows (#1-4) are meaningfully improved by the general fix in
this section (confidently-wrong leaf -> safe family-only abstain, or in #4's case a fully correct
generic leaf). Row #5 was root-caused to two distinct issues -- a curation error and a deeper
structural bug in the role-head equivalence generator -- and both are now fixed (see above and §6
below). 4 rows (#6, #7, #8, #9) remain unfixed and were not investigated deeply enough this round
to identify their root cause -- each likely has its own distinct mechanism, consistent with this
doc's running finding that "generic query drifts to unrequested specific leaf" is not one bug but
a family of related failure shapes.

## Suggested next steps (not yet started)

1. Investigate whether `locale_primary` alias authority boost should be conditioned on alias-side coverage (finish the "Jurist" case, item #9 above).
2. ~~Fix the auto-generated role-head equivalence classes (§6)~~ -- done, commit `a55177d`.
3. Root-cause rows #6, #7, #8 above (each on its own -- likely distinct mechanisms; row #5 is now fixed by §6, item 2 above).
4. Audit existing cross-locale fallback logic (grep `cross_locale`) before designing the exact-alias-rescue theory in §2.
5. Audit `capability_fit` scoring specifically for broad-role degradation (§5).
6. Verify the `hu`/`et` head-position assumption in §6 (`last`) once real `hu`/`et` `locale_primary` alias data exists -- currently unverified since the dataset only has `en`/`ro` locale_primary aliases.

## 2026-08-16: §6 -- auto-generated role-head equivalence classes conflate role heads with modifiers (FIXED, commit a55177d)

While re-verifying row #5 ("Mecanic utilaje industriale" -> wrong leaf "industrial machinery
assembler") after removing "mecanic" from the two `ro_mechanical_assembly_*` rules' `roleHeadsAny`
(committed `ea07891`), the wrong result persisted. Traced with a direct Node repro
(`findReviewedFamilySignalMatches` called on the real prepared query) to a much bigger, structurally
general bug in `src/cli/export-occupation-role-head-equivalence-artifact.ts`'s `addHeadCandidates`:

For every ESCO leaf's canonical label and every `locale_primary` alias, the generator tokenizes the
phrase and, for any non-English locale with 2+ tokens, adds **both the last token and the first
token** into the *same* equivalence class (`esco_leaf_<graphNodeId>`) -- intended to handle
noun-first vs. adjective-first word order across a leaf's different aliases, but instead it
conflates the genuine role head with an unrelated modifier/domain word *from a single phrase*.
Concretely: the ro locale-primary alias "electrician industrial" (for some industrial-electrician
leaf, graphNodeId 16451) produces class `esco_leaf_16451: {en: [electrician], ro: [electrician,
industriale]}` -- meaning `occupationRoleHeadSharesEquivalentClass` now treats "industriale" as
interchangeable with "electrician" *everywhere this check is used* (confirmed: `matchRule` in
`occupation-reviewed-family-signals.ts`, plus direct uses in `occupation-resolver.ts` and
`occupation-search-pipeline.ts`).

This is why "Mecanic utilaje industriale" still triggers `ro_mechanical_assembly_support`
(roleHeadsAny=[electrician, lacatus, montator]) even with "mecanic" removed: the query's token
"industriale" matches "electrician" via this bogus shared class, `matchedRoleHeads=[industriale]`,
and the rule fires anyway.

Manually sampling `artifacts/runtime/occupation-role-head-equivalents.json`'s ~29k auto-generated
classes turned up dozens more obviously-wrong pairs of the same shape --
`['agricole','mecanic']`, `['montator','sprinklere']`, `['montator','rezistente']`,
`['mecanic','rotative']`, `['mecanic','textile']`, `['mecanic','pneumatice']`,
`['montator','tavane']`, etc. -- domain nouns and adjectives bucketed as "equivalent role heads"
to whatever the other token in that one alias happened to be. This is not a one-off data error;
it's the generator's normal behavior for every multi-word non-English leaf label/alias, so the
equivalence artifact is systematically polluted at scale, not just for the "mecanic"/"electrician"
case caught here.

**Fixed (commit `a55177d`):** sampled real `ro` `locale_primary` aliases against their `en`
canonical labels (`regizor tehnic` <- "technical director", `tehnician siguranță trafic aerian`
<- "air traffic safety technician", etc.) and confirmed Romanian occupation phrases are
consistently noun-first (head first, modifier after) -- the opposite of English's modifier-first
pattern. Replaced the "grab both ends" heuristic in `addHeadCandidates` with a single per-locale
head position (`ro`: first token; `en`/`hu`/`et`: last token, `hu`/`et` unverified against real
data since the current dataset has no `hu`/`et` `locale_primary` aliases -- only `en`/`ro`, 3039
each). Only one token per phrase is now ever added as a head candidate, so a modifier can never
land in the same equivalence class as the real role head.

Effect: class count dropped from ~29k to 2303 (the vast majority of the old classes were
single-alias artifacts of this exact bug, not genuine synonym sets). Verified via direct repro
that `findReviewedFamilySignalMatches` on "Mecanic utilaje industriale" (ro) now only matches the
correct `ro_machinery_mechanic_agricultural_support` rule -- the bogus
`ro_mechanical_assembly_support` match via "industriale"≡"electrician" is gone. Full pipeline now
resolves this query to family "Machinery mechanics and repairers" with leaf promotion correctly
held back (`final_decision_gate=... leaf evidence stayed below safe promotion threshold`) --
row #5 from the earlier flagged-9 list is now fixed alongside #1-4. Spot-checked the remaining
open rows ("Jurist", "Tehnician Mentenanta", "Tehnician Service", "Specialist planificare/logistica",
"Consilier de vânzări", "Asistent Manager Flotă") -- all unchanged, no new regressions from this
fix. `test:structural` and `evaluation:golden:pipeline` both show identical pre-existing baseline
failures before/after.

## 2026-08-16: item #6 "Specialist planificare/logistica" -- 3 distinct root causes found and fixed (commits `5796a2e`, `b9faa94`)

Root-caused by testing 3 different word-orderings of the same 3 query tokens
(planificare/logistica/specialist), which exposed that `intent.roleTokens` classification is
**order-sensitive**: the same token set can get bucketed differently (or silently dropped, not
reclassified) depending on left-to-right/adjacency scanning in the underlying phrase-anchor
detection, while `preparedQuery.usefulFoldedTokens` stayed stable across all 3 orderings. This
was empirically confirmed via direct repro scripts, not assumed.

Three distinct, stacked bugs were found this way, each partially masking the next:

1. **Alias-ngram retrieval scoring-query token drop** (`occupation-candidates.ts`,
   `retrieveAliasNgramMatches`): the scoring query was built from `intent.roleTokens` alone, so
   depending on word order the query's most discriminating token ("logistica") could be silently
   dropped from candidate generation entirely -- "logistics analyst" never even entered the
   evidence pool for some orderings. **Fixed:** union `roleTokens` with `usefulFoldedTokens`.
2. **`roleCoverage` family-selection tie-break token drop** (`occupation-search-pipeline.ts`,
   `maxFullRoleTokenEvidenceCoverage`): same underlying issue, one layer up -- the tie-break field
   used to rank families (`compareRecoveredFamilySelectionAuthority`) computed coverage from
   `intent.roleTokens` alone, understating the correct family's actual match quality. **Fixed:**
   same union pattern.
3. **English-only structural-specialization vocabulary** (`occupation-leaf-structure-rules.ts`):
   `preparedQuerySupportsSpecializationKind` checks the *query's* tokens against
   `LEAF_STRUCTURE_*_TOKENS` sets that are built from ESCO's *English* canonical leaf labels only
   (via `detectLeafSpecializationKinds`, which correctly only ever parses English text at
   artifact-build time). This meant a non-English query could never register structural-
   specialization support for the correct leaf, across all 6 categories
   (venue/channel/product/population/task_focus/industry_context) -- systemic, not specific to
   this query. **Fixed:** added locale-aware token sets (`LEAF_STRUCTURE_*_TOKENS_BY_LOCALE`),
   additive to the English base. Romanian filled in for all 6 categories per explicit instruction;
   Hungarian/Estonian intentionally left empty (adds coverage later without changing current
   behavior for those locales).

**Result:** 2 of 3 tested word-orderings now correctly resolve to family "Administration
professionals" / leaf "logistics analyst". Verified zero regressions: `test:structural`
(231 pass / 5 fail) and `evaluation:golden:pipeline` (24/27) both show the exact same
pre-existing failures before and after all 3 fixes.

**Not fixed, deliberately deferred as a separate item:** the original slash-formatted query
("Specialist planificare/logistica", with the literal `/`) still misresolves even with all 3
fixes applied, while a reordered non-slash form of the same tokens now resolves correctly.
Traced far enough to rule out the 3 fixes above as the cause (the merged query text used for
scoring is textually identical to the working reordering -- confirmed via direct repro comparing
`usefulFoldedTokens`/`intent.roleTokens`/`normalized` between the two forms, which came back
identical). Working hypothesis, not yet confirmed: splitting the query into separate
`querySignals` on `/` prevents some alias-matching channel from detecting a multi-word alias
phrase that spans both signal groups (e.g. "specialist în logistică"), since that channel likely
evaluates per-signal rather than against the merged query text. Left open for a future session.

## 2026-08-16: item #7 "Consilier de vânzări" -- curated atlas mapping pointed at a non-existent leaf term (FIXED, commit `7bde9af`)

Root-caused via `--debug` trace: the curated `common-role-phrase-atlas.ts` entry
(`common('ro', 'consilier vanzari', 'sales advisor', 'sales_advisor', 95)`) overrode the whole
query with the English canonical phrase `"sales advisor"` -- but no ESCO leaf is actually titled
"sales advisor"; it only exists as a substring inside many families' domain-qualified aliases
(`"insurance sales advisor"`, `"solar sales advisor"`, `"specialised sales advisor"`, etc.).

Both `insurance broker` (family "Sales and purchasing agents and brokers") and the actually-correct
`specialised seller` (family "Shop salespersons", alias `"specialised sales advisor"` -- a near-
verbatim match) got essentially the same `ngram_alias` cosine similarity (0.747 vs 0.708). But
`insurance broker` scored 2.4x higher overall (5.635 vs 4.0) because of `familyTokenRelevanceMultiplier`
(`occupation-family-token-relevance.ts`), which weights a hit by how characteristic the matched
tokens are of that family relative to whichever family scores highest for that token. "Sales and
purchasing agents and brokers" -- stuffed with dozens of "insurance sales X advisor/agent/rep"
aliases -- has the highest per-token relevance for "advisor" in the whole taxonomy, so it won the
family contest purely on vocabulary statistics rather than which leaf textually fit best. This
mechanism is not itself a bug (it's working as designed to reward family-characteristic
vocabulary); the real problem was mapping to an under-specified phrase that forced a statistical
tie-break to decide instead of an exact match.

**Fixed:** repointed the atlas entry to the exact leaf alias text, `"specialised sales advisor"`,
so the query now lands via a strong `exact_alias`/`cross_locale_english_backbone` match (94%
confidence) instead of competing on family vocabulary statistics. Updated the one structural test
(`query-preparation.test.ts`) asserting the old canonical phrase/role tokens for this exact query.
Verified zero regressions: `test:structural` (231/236, same 5 pre-existing failures) and
`evaluation:golden:pipeline` (24/27, same 3 pre-existing failures) both unchanged before/after.

**Not investigated further, flagged as a possible recurring shape:** other curated atlas entries
may point at similarly under-specified English phrases that aren't real leaf titles, which would
reproduce this same family-vocabulary-statistics tie-break for other queries. Worth an audit pass
if more rows in this doc turn out to share this root cause.
