# Gazetteer Internals

This package owns location resolution for job text. It is intentionally narrow:
it resolves place names, place hierarchies, and a small set of administrative
variants. It does not try to model jobs, skills, salaries, or general semantic
matching.

## What The Package Owns

- A country-gated gazetteer for supported locales.
- A build pipeline that imports GeoNames data, enriches it, stores it in MySQL,
  and then packs a runtime binary.
- A resolver that works from exact surfaces and admin hierarchy, not embeddings.
- A compatibility JSON index for legacy callers.

The package is designed for precision. If a surface is not clearly a place, it
should be excluded or handled by the caller's inference layer.

## Source Of Truth

The curated source of truth is the MySQL database named
`location_search_engine`.

The database stores the canonical place tree and the surfaces attached to each
place. The runtime binary is generated from that database. That means the
correct workflow for data fixes is:

1. Change the database through an idempotent migration or importer update.
2. Rebuild the exported dataset.
3. Repack the runtime binary.
4. Verify the resolver behavior.

Do not hand-edit generated artifacts when the durable change belongs in the DB.

## Build Flow

The build is intentionally staged.

1. `src/location-store.ts` reads GeoNames inputs.
2. The importer creates canonical place rows and surfaces.
3. The dataset is written to MySQL and exported as JSONL.
4. `src/gazetteer-bin.ts` packs the JSONL export into `data/gazetteer.gzb`.
5. Query-time code loads the binary or falls back to the legacy JSON index.

The build-time DB snapshot is the place where durable changes should be
observable and debuggable.

## Tree Model

The gazetteer is hierarchical.

- `country`
- `admin1`
- `admin2`
- `admin3`
- `settlement`

The runtime resolver uses the tree to distinguish trusted containers from
specific leaves. A place can also yield its ancestors when a leaf match is
accepted.

For HU, this matters because the admin spelling may change while the tree node
does not. The canonical place remains the same node; the surface can vary.

## Canonical Place Versus Surface

Each place has:

- a canonical key
- a canonical name
- zero or more alternate surfaces
- a parent place
- a country gate

The resolver should return the canonical place, not the surface that happened to
match. Surfaces are just lookup inputs.

Examples:

- `Hungary` is the canonical country.
- `Magyarország` is a surface for that same country.
- `Csongrád-Csanád megye` is a surface for the existing county node.
- `Külföld` is not a location node and should stay out of the gazetteer tree.

## Hungarian Handling

The HU updates should preserve the existing tree and add surfaces only where they
support better resolution.

Important conventions:

- `Budapest` is a direct child of `Hungary`.
- Counties stay on the same canonical county nodes.
- `megye` and `county` are type words, not standalone places.
- `Magyarország` should resolve to `Hungary`.
- `Külföld` belongs to workplace/inference handling, not the location tree.

If a term is a type label or a generic geopolitical word, prefer attaching it as
a surface only when it helps identify an existing canonical node. Do not create a
new node for the label itself.

## Matching Pipeline

The resolver should behave like a hierarchy-aware place matcher:

- exact surfaces first
- structured location fields with controlled fuzziness
- container corroboration for weak leaves
- abstention when the place cannot be distinguished safely

This package is not a semantic search engine. It should not guess place names
from vector similarity.

## Precision Rules

Use these rules when extending coverage:

- Prefer exact alias additions over generic fuzzy rules.
- Add surfaces for canonical nodes rather than new nodes for spelling variants.
- Keep type words out of the tree.
- Keep country gating intact.
- Abstain instead of inventing a confident answer for ambiguous short names.
- Add parent/admin evidence when a leaf is too weak on its own.

## Build Inputs

The normal input path is GeoNames, plus controlled enrichment for known local
variants.

Typical input classes:

- country names
- admin subdivision names
- settlement names
- administrative type words where they help a canonical node

Do not treat arbitrary text as an input source. Free text is only a query signal,
not a source of truth.

## Adding Coverage

When adding a new location or locale variant:

1. Check whether the canonical place already exists.
2. Add a surface to the existing node if possible.
3. Add or update a DB migration if the data must be written into the source of
   truth.
4. Rebuild the exported dataset.
5. Repack the runtime binary.
6. Add a resolver test that proves the intended match.
7. Add a negative test for the nearest false positive.

If the requested text is really a workplace or inference clue, do not force it
into the gazetteer.

## Debugging Checklist

When a location fails to resolve:

- Check the DB row in `location_search_engine`.
- Confirm the surface exists on the intended canonical node.
- Confirm the country gate matches the locale.
- Confirm the packed binary was regenerated from the updated export.
- Confirm the resolver test uses the same normalization path as runtime.

When a location resolves too broadly:

- Check whether a type word was accidentally promoted to a node.
- Check whether a common word was left in the tree.
- Check whether a leaf should require parent corroboration.

## Files To Read First

- [`src/location-store.ts`](../src/location-store.ts)
- [`src/resolver.ts`](../src/resolver.ts)
- [`src/gazetteer-bin.ts`](../src/gazetteer-bin.ts)
- [`src/gazetteer-index.ts`](../src/gazetteer-index.ts)
- [`scripts/migrate-hu.ts`](../scripts/migrate-hu.ts)
- [`tests/gazetteer.spec.ts`](../tests/gazetteer.spec.ts)
- [`tests/location-store.spec.ts`](../tests/location-store.spec.ts)

