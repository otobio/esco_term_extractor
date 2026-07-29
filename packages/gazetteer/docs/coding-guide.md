# Gazetteer Coding Guide

This guide is for changes inside `packages/gazetteer`. The package is a
precision-first place matcher, so the right fix is usually the one that improves
the place tree or the surface set without widening the matcher itself.

## How To Think About A Change

Before editing code, classify the problem:

- wrong canonical place
- missing alternate surface
- bad tree shape
- bad country gate
- false positive from a common word
- stale generated artifact
- incorrect build input

Then change the layer that owns that problem. Do not push a DB issue into the
resolver, and do not push a resolver issue into generated data.

## Preferred Change Order

1. Check whether the canonical node already exists.
2. Check whether the missing behavior is just a surface.
3. Fix the DB/import data if the source of truth is wrong.
4. Rebuild the dataset and runtime binary.
5. Add regression tests.

If the same node is already present, prefer adding a surface to that node over
creating a duplicate node.

## DB-First Rule

The database is the durable edit point. Generated files are outputs, not the
place to encode the business decision.

Use a migration or importer update when:

- a new surface must be persisted
- a canonical node needs enrichment
- a locale-specific spelling variant must survive rebuilds
- a debug-friendly audit trail is required

Use a source edit only when the build logic itself is wrong.

## What Counts As A Location

The gazetteer should contain places and place containers.

Do not add:

- workplace-only cues
- inference-only cues
- administrative type words on their own
- generic country labels that duplicate the existing canonical node
- data that belongs in another matcher layer

For HU, `megye` and `county` are type words. They can appear as surfaces when
they help identify a known county node, but they should not become standalone
places.

## Canonical Versus Variant

When a user requests a location name, the target is the canonical node. The
surface is only the lookup key.

Rules of thumb:

- Add exonyms as surfaces on the existing country node.
- Add historical or local spellings only when they point to the same canonical
  place.
- Do not add a new node for a spelling variant.
- Do not flatten the tree to make a surface easy to match.

`Magyarország` belongs on the Hungary node. `Külföld` does not belong in the
location tree at all.

## Safe Migration Rules

Migrations should be:

- idempotent
- explicit about what they add
- easy to inspect in dry-run mode
- safe to rerun
- limited to the intended canonical node

If a migration touches multiple surfaces, make it obvious which surface belongs
to which canonical place. If possible, print a dry-run plan before applying.

## Build And Verify

For data changes, the normal loop is:

1. Apply the DB migration.
2. Rebuild the dataset export.
3. Repack the runtime binary.
4. Run the focused tests.
5. Inspect the generated diff only after the source change is known.

If the build output changes but the DB does not, treat that as a smell unless
the change is intentionally in build logic.

## Test Strategy

Write tests for the decision, not just the code path.

Add:

- a positive test for the intended canonical place
- a negative test for the nearest false positive
- a data-integrity test when the stored surfaces matter
- a rebuild/pack test if the runtime binary is part of the change

Prefer the smallest focused test file that exercises the affected layer.

## Common Mistakes

- adding a new node when a surface would do
- moving a type word into the tree
- fixing the runtime artifact without fixing the DB
- widening fuzzy matching to cover a single missing alias
- letting workplace or inference terms masquerade as locations
- forgetting to rebuild the packed binary after the dataset changes

## Review Checklist

Before merging, confirm:

- the canonical node already existed or was added intentionally
- the surface set is minimal and correct
- the tree shape did not regress
- the locale gate still works
- the DB and packed runtime artifact agree
- the tests cover both the new match and the nearest false positive

## Files You Will Usually Touch

- [`src/location-store.ts`](../src/location-store.ts)
- [`src/resolver.ts`](../src/resolver.ts)
- [`src/gazetteer-bin.ts`](../src/gazetteer-bin.ts)
- [`scripts/migrate-hu.ts`](../scripts/migrate-hu.ts)
- [`tests/gazetteer.spec.ts`](../tests/gazetteer.spec.ts)
- [`tests/location-store.spec.ts`](../tests/location-store.spec.ts)

