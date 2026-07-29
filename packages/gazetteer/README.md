# @term-extractor/gazetteer

Standalone, Jobs-focused **location** gazetteer: resolve place names in job titles /
descriptions (and structured location fields) to canonical location terms. Pure
string + admin-hierarchy logic — **no embeddings, no OpenSearch at query time**. Owns
its whole lifecycle (import → enrich → store → pack → resolve) and imports nothing
from the host app.

Deliberately **not** modeling POIs, streets, neighborhoods, or physical features.
Markets (starter set): **Romania `ro`, Nigeria `ng`, Hungary `hu`, Estonia `et`**.
Locale ≈ country code; the resolver gates matches to one country.

---

## Docs

- [`docs/gazetteer.md`](docs/gazetteer.md) — how the gazetteer works, from DB to
  runtime binary.
- [`docs/coding-guide.md`](docs/coding-guide.md) — how to think about future code
  changes in this package.

---

## Package layout

```
packages/gazetteer/
├── package.json  tsconfig.json  vitest.config.ts
├── src/
│   ├── index.ts          # public API (barrel)
│   ├── resolver.ts       # the engine (reads a GazetteerReader)
│   ├── gazetteer-index.ts# legacy JSON index + GazetteerReader interface
│   ├── gazetteer-bin.ts  # runtime binary: pack() + GazetteerBin + openGazetteer[Sync] + DATA_DIR
│   ├── location-store.ts # build-time: GeoNames import + enrichment + MySQL/JSONL store
│   ├── patterns.ts       # per-locale query-time config (stop-names, type-words, exonym langs)
│   ├── place.ts          # GazetteerPlace + depth model
│   ├── normalize.ts  tokenizer.ts  types.ts   # package-owned primitives (self-contained)
├── tests/  gazetteer.spec.ts  gazetteer-bin.spec.ts
├── scripts/  resolve-location.ts  download-geonames.sh
└── data/
    ├── gazetteer.gzb          # shipped runtime artifact (packed)
    ├── gazetteer.json         # legacy JSON index
    ├── location/*.jsonl       # enriched dataset export (from build:dataset)
    └── geonames/              # build inputs (RO/NG/HU/EE.txt + alternateNamesV2.txt, gitignored)
```

`normalize` / `tokenizer` / `types` are small copies so the package is fully
self-contained; TS structural typing bridges them to the host's identical types.

---

## The pipeline

```
BUILD TIME (offline, re-runnable)                         │  RUNTIME
 data/geonames/  ──location-store──▶ MySQL location_search_engine
   RO/NG/HU/EE.txt  (import→enrich)     (place/place_surface/build_run, editable base)
   alternateNamesV2 ──▶ ─────┐               │                        │
                             ▼               ▼                        │
                    data/location/*.jsonl ──gazetteer-bin.pack──▶ data/gazetteer.gzb ─┼─▶ GazetteerBin.load
                    (export/intermediate)      359 KB binary        │        │
                                                                    │        ▼
                                                                    │  GazetteerResolver
                                                                    │   ├─ free-text (titles/descriptions)
                                                                    │   └─ structured location field
```

- **MySQL is the curated, re-updatable source-of-truth**; locations change rarely, so
  a point-in-time snapshot is fine.
- **`data/gazetteer.gzb` is the shipped runtime artifact** — memory-lean, zero-parse.
- The engine reads a `GazetteerReader`, satisfied by both the binary and the JSON index.

---

## The resolver engine

Precision-first: **route when there's evidence, abstain when there isn't.**

- **Leaf vs container** (country-agnostic): a place is a *leaf* at its country's
  deepest tier; coarser tiers are *containers*, trusted bare. A bare leaf needs
  **corroboration** (an ancestor container in the text) unless it's a capital, a
  first-order seat, or **dominant** (clearly the biggest of its same-name group).
- **Disambiguation & abstention**: several same-named places → prefer major →
  corroborated → seat → coarser; if none is distinguished, **return nothing**.
- **Stop-names**: common-word place names (e.g. NG `delta`/`plateau`/`niger`) are
  dropped at scan.
- **Hierarchy expansion**: a match also yields its ancestor containers (inferred).
- **Fuzzy**: off for free text, on for the structured field (typo tolerance).

---

## The runtime binary — `GZB1`

One little-endian buffer of **columnar typed-array sections + UTF-8 blobs**, loaded as
`ArrayBuffer` views (no JSON parse, no per-place objects). `flags` precompute
`isLeaf`/`isMajor` (`isMajor = container | capital | seat | dominant`), so the
population tiebreak is realized *in data* and the runtime needs no `patterns.ts`.
`exact()` = byte-compare binary search; fuzzy trigrams build lazily.

Measured vs the JSON index (same 3,017 places): **359 KB** artifact, **~0.7 ms** load,
**~33 KB** resident (~150× less), ~1 µs/lookup.

---

## Runtime integration

The host calls `openGazetteer()` / `openGazetteerSync()` (no args → the package's own
`DATA_DIR`, i.e. `packages/gazetteer/data`; `GAZETTEER_DIR` env overrides). Both wire
the binary's `stopSurfaces()` into the resolver's `stopNames` and fall back to the JSON
index if the binary is absent. One resolver backs both free-text and structured
location resolution.

---

## Commands (run inside the package, or from repo root)

```bash
# rebuild the dataset from GeoNames → MySQL + JSONL export
npm run build:dataset          # (needs MySQL; env MYSQL_* , defaults root/root@localhost)
npm run stats                  # inspect the stored dataset

# pack the shipped runtime binary from the dataset export
npm run pack                   # → data/gazetteer.gzb

# quick manual resolve (also available from repo root: `npm run resolve:location -- …`)
npm run resolve:location -- "Cluj-Napoca" --locale ro
npm run resolve:location -- "Cluj Napca" --structured --locale ro   # structured + fuzzy
npm run resolve:location -- "delta" --locale ng --debug             # gating flags

npm test                       # package tests (standalone)
```

**Offline rebuild**: build inputs live in `data/geonames/`. The ~742 MB
`alternateNamesV2.txt` is git-ignored (present on disk for offline use); re-fetch the
whole set with `bash scripts/download-geonames.sh`.

---

## Tests

- `tests/gazetteer.spec.ts` — the engine, standardized (synthetic countries + injected
  patterns) + a data-integrity block over the real patterns.
- `tests/gazetteer-bin.spec.ts` — lossless binary round-trip + the real resolver driven
  over it.

(The extractor↔location dispatch test lives in the **host** repo — `test/extractor-location.spec.ts` — since it exercises `TermExtractor`.)

---

## Known caveats / roadmap

- **`SUBDIVISIONS` keys are stale** — `patterns.ts` still references pre-GeoNames keys
  (`location:depth2:bucuresti`), so `"Sector 2" → Bucharest` is a no-op (Bucharest still
  resolves via its exonym surface). Update the subdivision parent keys.
- **Same-name recall**: where GeoNames population is sparse (parts of NG/ET) there's no
  dominant winner, so the resolver abstains.
- **NG alternates are English-only** (no Yoruba `Eko` etc.); add languages to
  `ALT_LANGS_BY_COUNTRY.ng` if needed.
- **Stop-names are a seed list** — derive from a per-locale frequency list to scale.
- Adding a market = add a GeoNames country + its `ALT_LANGS`/type-words, rebuild. No
  engine change.
