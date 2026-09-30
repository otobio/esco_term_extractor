# ESCO API Classifier

Third occupation classifier. It resolves a free-text job title to an ESCO leaf occupation and its
family using only the public ESCO REST API. When no leaf is safe it returns the family. It always
returns alternative leaves and alternative families.

It is independent from `src/occupation-classifier/` and `src/search-pipeline/`: no shared types,
runtime artifacts, query cleaning, vocabularies or ranking. Only generic `src/utils/*` helpers are
imported.

## API facts this design depends on

Probed live on 2026-09-28 against `https://ec.europa.eu/esco/api` (API doc v1.1.3).

| Fact | Consequence |
|---|---|
| No auth, no rate-limit headers | Plain `fetch`, one retry, bounded concurrency is enough |
| `selectedVersion` defaults to latest | Always send `selectedVersion=v1.2.1` to match the repo's ESCO 1.2.1 data |
| `offset` is a page number, not a row offset | Never page by row count; one page of `limit=50` is used |
| `limit` 20 vs 50 has the same latency (~0.5-1.2 s) | Use 50 for both `/search` and `/terms` |
| Unknown `language` silently falls back to English | Validate the locale before calling |
| Search is scoped to one language (`nurse` in `hu` -> 0 hits) | English-only search for English spans; gated English retry when the local-language pass is unresolved |
| Diacritics are folded server-side (`sofor` finds `sofőr`) | No client-side diacritic expansion needed for recall |
| `/search` matches preferred, alternative, hidden labels **and description** | `searchHit` can be a description sentence; it is never used as label evidence |
| `/search` quick mode returns `uri`, `title` (local preferred label), `preferredLabel` (all languages), `code`, optional `broaderIscoGroup` / `broaderOccupation` | Leaf labels and family come from the search hit, no hydration call |
| `/search?full=true` takes 10-21 s and ~1 MB, and drops `searchHit` | Not used |
| `/resource/occupation?uris=` bulk takes ~5.6 s for 3 records | Not used in the classification path |
| `/terms` returns individual labels: `literalForm`, `hasLabelType` (pref/alt/hidden), `concept` URI | Typed label evidence (exact preferred vs alternative vs hidden) |
| `/terms?type=occupation` also returns **skills** and **ISCO groups** | Keep only `/occupation/` and `/isco/` concepts; ISCO hits are family-label evidence |
| Only ~1 in 18 `/terms` occupations is missing from `/search` top 50 | Candidates known only from `/terms` are dropped (they have no code, so no family) |
| Sub-occupations have `broaderOccupation` instead of `broaderIscoGroup`, but every hit has `code` | Family = ISCO 3-digit group from the first 3 digits of `code` (`2411.1.7` -> `C241`, `0310.3` -> `C031`) |
| The repo's family list (`data/taxonomy-review/esco-family-list.esco_1_2_1.csv`, 125 rows) is ISCO 3-digit groups | Families line up with the other two classifiers |
| `/resource/concept?uris=isco/C241&uris=...` bulk takes ~0.6 s and returns local `title` plus `preferredLabel.en` | One cached bulk call per request resolves family labels |
| Labels are gendered pairs (`auditor financiar/auditoare financiară`) | Labels are split on `/` into variants before comparison |

## Pipeline

1. `preparation.ts`: validate the locale, normalize the title, split independent spans
   (`;`, `|`, newline, bullets, spaced ` / `), build folded comparison tokens.
2. Multi-span: each span is classified independently; the top level returns `multi_span`.
3. `core.ts` runs `/search` and `/terms` in parallel for the span, through `client.ts`.
4. `evidence.ts`: one candidate per occupation URI. Its labels are the local `title`, the local
   `preferredLabel`, and the typed `/terms` labels for that URI. Each label gets a token-set relation to the
   query: `equal`, `query_contains_label`, `label_contains_query`, `partial`. ISCO `/terms` hits
   become family-label candidates.
5. `decision.ts`, in this order:
   - exact family label (ISCO group with code of 3+ digits, label tokens equal the query) -> family;
   - `equal` label -> leaf, when one candidate holds the best label type (preferred > alternative > hidden);
     a tie at the best label type becomes a family decision with the tied leaves as alternatives;
   - containment labels vote for their family by Jaccard overlap -> family
     (`family_dictionary_gap` when the query has extra terms, `family_leaf_ambiguity` otherwise);
   - only partial overlap -> `unresolved_weak_evidence`; nothing -> `unresolved_no_candidates`;
   - alternative leaves come from containment labels only; partial overlaps appear only as unresolved hints.
   - confidence: selected leaf/family carry the decision confidence; alternative leaves get label overlap x 0.8,
     alternative families their vote share x 0.8.
6. Span language: a span whose tokens are all attested English in the signal-vocabulary artifact
   (`isEnglishQuery`) is searched in English only. Otherwise the locale is searched first, and English is
   retried only when that result is unresolved.
7. `core.ts` makes one bulk `/resource/concept` call for the selected and alternative families, cached per
   family URI and language.

## Known ceilings

- No noise-word cleaning (company names, shift info, `(m/f/d)`): the API ranks on raw text.
- Function words come from a small EN/RO/HU list in `config.ts`; other locales drop none.
- English plural folding is a naive trailing-`s` strip; RO/HU inflection is not folded.
- The public endpoint has no SLA. For production latency, point `baseUrl` at the ESCO local-install API.
