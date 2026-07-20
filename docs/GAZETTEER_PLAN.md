# Gazetteer Location Pipeline — Implementation Spec

Status: ready to implement. Goal: replace the embedding path for the `location`
bucket with a dedicated, self-contained gazetteer resolver that is exact,
hierarchy-aware, and precision-first.

## 1. Goals / non-goals

**Goals**
- Location matching by exact + fuzzy string match against a gazetteer, never embeddings.
- Admin-hierarchy expansion: a matched locality also yields its county + region.
- Kill common-word collisions ("Luna"=month, "Fața"=face) by **admin-level gating**.
- Disambiguate shared names ("Fața, Argeș" vs …) using in-text admin context.
- Same output contract (`ExtractedTerm[]` under `matchesByBucket.location`).
- Fully offline; drops ~21k location vectors from the dense index.

**Non-goals (v1)**
- Country-level resolution ("Anglia") — only if such terms exist in the taxonomy; otherwise a small optional country map in a later pass.
- Geocoding / lat-long.

## 2. Data facts (from `canonical_runtime_terms`)
- 21,498 location terms. `term_type`: locality (21,137), district (197), municipality (79), county (77), region (8). Mostly `language_code = ro`.
- `canonical_key`: `location:<type>:<slug>` e.g. `location:locality:cluj_napoca_cluj`, `location:county:cluj`, `location:region:bucuresti_ilfov`.
- `display_name` often embeds the county: `"Cluj-Napoca, Cluj"`, `"Fata, Arges"`. Aliases include the bare name (`"cluj napoca"`) and sometimes the county token.
- Hierarchy lives in `canonical_relationships` (`parent_canonical_key`, `child_canonical_key`, `relationship_type`) — NOT pulled today.
- Cheap fallback hierarchy: the county slug is the suffix of a locality canonical_key / display_name.

## 3. adminLevel model
Map `term_type → adminLevel` and an ordinal for "specificity":

| term_type | adminLevel | rank |
|---|---|---|
| region | region | 1 |
| county | county | 2 |
| district | district | 3 |
| municipality | municipality | 4 |
| locality | locality | 5 |

## 4. On-disk artifact — `data/gazetteer.json`
Compact; fuzzy structures derived at load to keep the file small.

```ts
interface GazetteerFile {
  schemaVersion: number;
  places: {                       // index-aligned
    canonicalKey: string;
    displayName: string;
    adminLevel: AdminLevel;
    languageCode: SupportedLanguage;
  }[];
  parents: number[][];            // placeIdx -> [parentIdx...] (county, region), most-specific-first
  surface: Record<string, number[]>;  // normalizedName -> [placeIdx] (exact, diacritic-folded)
  majorCities: number[];          // curated placeIdx allow-list (counties + top ~40 cities), always trusted
}
```

At load, build in memory:
- `Map<string, number[]>` from `surface`.
- Trigram index `Map<string, Set<number>>` over surface keys (fuzzy candidate generation).
- `Set<number>` of majorCities.

## 5. Snapshot additions
- New `scripts/snapshot-relationships.ts`: pull `canonical_relationships` where
  `parent_canonical_key`/`child_canonical_key` start with `location:` →
  `data/relationships.jsonl` (`{parentKey, childKey, type}`).
- `snapshot-dictionary.ts` unchanged (already carries location terms + aliases).

## 6. BUILD pipeline — `src/gazetteer/build.ts`
`GazetteerIndex.build(locationTerms, relationships) -> gazetteer.json`

1. Build `Place[]` from location terms (dedupe by canonicalKey across languages; keep display per lang but one place row per canonicalKey; store languageCode of the display).
2. `surface`: for every term, add `normalizeText(displayName|value|each alias)` → placeIdx.
   - Also add the "bare name" variant: strip a trailing `, <county>` from displayName before normalizing (so "Cluj-Napoca, Cluj" also indexes "cluj napoca").
   - Skip surfaces `< 3` chars or purely numeric.
3. `parents`: from relationships (`child -> parent`), transitively resolve locality→county→region. Fallback: parse county slug from canonical_key suffix when a relationship is missing.
4. `majorCities`: all county + region places, plus a curated list of ~40 largest RO cities (bundled constant `MAJOR_CITY_SLUGS`).
5. Write `gazetteer.json` (+ schemaVersion).

`GazetteerIndex.fromPlaces(...)` — in-memory variant for tests (no disk), mirroring `VectorStore.fromEntries`.

## 7. QUERY pipeline — `src/gazetteer/resolver.ts`
`resolve(clauses: Clause[], structuredLocation?: string, opts) -> ExtractedTerm[]`

```
candidates = []

# (A) structured field first — highest trust, bypasses gating
if structuredLocation:
    for span in spans(normalize(structuredLocation)):
        for placeIdx in exact(span): candidates.push({placeIdx, base:0.99, source:'structured'})

# (B) free text
for clause in clauses:
    toks = words(normalize(clause.text))
    # longest-first n-gram scan (n = 5..1); consume matched spans to avoid sub-span dupes
    i = 0
    while i < toks.length:
        matched = false
        for n in 5..1:
            span = toks[i..i+n]
            hits = exact(span)                      # surface map
            if hits:
                for placeIdx in hits:
                    candidates.push({placeIdx, span, base:0.95, spanWords:n, clause})
                i += n; matched = true; break
        if not matched:
            # fuzzy only for a single "wordy" token (len>=5), edit-distance<=1..2 via trigram cand set
            fz = fuzzy(toks[i])
            if fz: candidates.push({placeIdx:fz.idx, base:0.80, spanWords:1, fuzzy:true, clause})
            i += 1

# (C) ADMIN-LEVEL GATING  (the precision core)
accept = []
countyOrRegionInText = set of accepted county/region placeIdx (from B/A)
for c in candidates:
    p = places[c.placeIdx]
    if c.source == 'structured' or c.placeIdx in majorCities: accept.push(c); continue
    if c.spanWords >= 2: accept.push(c); continue          # multi-word name = specific
    if p.adminLevel in {region, county, municipality}: accept.push(c); continue
    # single-token LOCALITY: require corroboration
    if any(parent of p is in countyOrRegionInText): accept.push(c); continue
    # else DROP  (kills "Luna"/"Fața"/"Valea" etc.)

# (D) DISAMBIGUATE names mapping to many places
group accept by normalized name:
    if 1 place -> keep
    else prefer, in order:
        1. place whose county/region co-occurs in text
        2. higher adminLevel (county > municipality > locality)
        3. majorCities member
        4. if still tied among many small localities -> ABSTAIN (drop all) # precision-first

# (E) HIERARCHY EXPANSION
for a in accept (adminLevel = locality/municipality/district):
    for parentIdx in parents[a.placeIdx]:       # county, region
        add inferred candidate {placeIdx:parentIdx, base:0.75, inferred:true}

# (F) finalize
dedupe by canonicalKey (max score); sort desc; cap maxPerBucket
-> ExtractedTerm[]  (method:'gazetteer'; evidence carries span/clause/fuzzy/inferred)
```

### Scoring
| kind | score |
|---|---|
| structured exact | 0.99 |
| text exact (multi-word or county/major) | 0.95 |
| fuzzy | 0.80 |
| inferred parent (county/region) | 0.75 |

### Special patterns (pre-pass on clauses)
- `sector <1-6>` (Bucharest) → the sector place if it exists, else `location:county:bucuresti`.
- `jud(eț)?\.? <X>` / `county of X` → force X as a county lookup.
- Strip obvious non-locations already handled by noise-guard.

## 8. Integration — `src/extractor.ts` + `src/buckets.ts`
- `BucketConfig` gains `matchStrategy: 'hybrid' | 'semantic' | 'lexical' | 'gazetteer'`. Default `hybrid` for open buckets, `lexical` where already tuned, `gazetteer` for `location`.
- `extract()`:
  - `needEmbeddings = targetBuckets.some(b => cfg[b].strategy ∈ {semantic,hybrid})` → only embed clauses then. (Location-only extraction skips the model entirely.)
  - Dispatch per bucket: strategy `gazetteer` → `GazetteerResolver.resolve(clauses, input.structured?.location)`; else existing dense+lexical path.
- `resolveStructured('location', value)` → route to resolver with `structuredLocation = value` (bypasses gating, high trust).
- `TermExtractor.load()` also loads the gazetteer (when any bucket uses it); `fromComponents` accepts an optional `gazetteer`.

## 9. Config knobs — `GAZETTEER_CONFIG`
```ts
{
  maxPerBucket: 8,
  fuzzyMinLen: 5,
  fuzzyMaxDistance: 1,        // 2 for len>=8
  requireCorroborationForLocality: true,
  enableHierarchyExpansion: true,
  scores: { structured:0.99, exact:0.95, fuzzy:0.80, inferred:0.75 },
}
```

## 10. Build wiring
- `scripts/build-embeddings.ts`: add `--exclude-buckets location` (default) so ~21k location vectors are omitted from `vectors.bin`; then invoke gazetteer build.
- New `scripts/build-gazetteer.ts` (or fold into build-embeddings): dictionary(location) + relationships → `data/gazetteer.json`.
- `package.json`: `build:gazetteer`, `snapshot:relationships`.

## 11. Files
```
src/gazetteer/
  place.ts        AdminLevel, Place, term_type→adminLevel + rank
  build.ts        GazetteerIndex.build() / .save()
  index.ts        GazetteerIndex.load()/.fromPlaces(); exact(), fuzzy(), parents(), majorCities
  resolver.ts     GazetteerResolver.resolve()  (pipeline §7)
  patterns.ts     sector / county regexes, MAJOR_CITY_SLUGS
src/buckets.ts    + matchStrategy
src/extractor.ts  dispatch + skip-embeddings + resolveStructured routing
src/index.ts      exports
scripts/snapshot-relationships.ts
scripts/build-gazetteer.ts
data/gazetteer.json           (generated)
data/relationships.jsonl      (generated)
```

## 12. Tests (`test/gazetteer.spec.ts`, deterministic, no OS)
Build a tiny in-memory gazetteer via `fromPlaces`:
- exact multi-word match ("Cluj-Napoca" → locality).
- county single-token accepted ("Cluj" → county).
- **locality single-token common word gated**: "Luna" alone → dropped; "Luna, Cluj" or "Luna" + "Cluj" in text → accepted.
- disambiguation: name in two counties → picks the one whose county co-occurs.
- hierarchy expansion: locality → +county +region emitted at 0.75.
- fuzzy: "Cluj-Napca" (typo) → Cluj-Napoca at 0.80.
- sector pattern: "Sector 2" → Bucharest.
- structured field bypasses gating.
- abstain: ambiguous small localities, no context → empty.
Plus: `matchStrategy` dispatch test; `needEmbeddings=false` path (extract location-only with a stub that throws if embed() is called → proves the model is skipped).

## 13. Eval
- Re-run `scripts/eval-listings.ts`; expect location precision ≈ exact, "Luna, Satu Mare"-type false positives gone, and hierarchy tags (county/region) appearing.
- Add a `scripts/eval-locations.ts` focused dump: title/desc → matched places + inferred parents, for manual precision read on ~50 listings.

## 14. Rollout / migration
- Bump index/gazetteer `schemaVersion`; `load()` errors clearly if `gazetteer.json` missing while a bucket uses `gazetteer`.
- Backward compatible output contract; existing tests unaffected (other buckets unchanged).

## 15. Risks & fallbacks
- **Relationships missing/incomplete** → fallback to canonical_key suffix parsing for county; region via county→region map (small).
- **Fuzzy over-matching** → keep it single-token, short edit distance, and never fuzzy-match a token that exactly matches a common word.
- **Major-city list staleness** → it only *boosts* trust; correctness doesn't depend on completeness.

## 16. Milestones (execution order)
1. snapshot-relationships + Place/adminLevel + build.ts (exact surface + hierarchy) + gazetteer.json.
2. resolver: exact + admin-gating + disambiguation + hierarchy expansion; wire `matchStrategy` dispatch + skip-embeddings; location → gazetteer.
3. fuzzy + sector/county patterns + major-city list + resolveStructured routing.
4. tests + eval + exclude location from vectors.bin + README.
