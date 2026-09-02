# Structural Resolution Contract

This classifier resolves titles by first building a query structure, then using retrieval only as candidate discovery. Family and leaf decisions must be justified by the structure in this package.

## Query Structure

`buildQueryStructuralProfile(...)` owns local title structure:

- `authority`: rank or management level from the visible title.
- `profile.role_head`: occupational heads such as `technician`, `consultant`, `handler`, `chef`, or rank heads such as `chief`.
- `profile.concepts`: committed specialization concepts with dimension and concept id.
- dimension arrays under `profile`: query-side concepts grouped by venue, channel, product, population, task, industry, knowledge domain, and work object.

For non-English titles, translation may expose English concepts that local aliases missed. Those translated concepts may enrich the query profile, but translated role heads may only fill the role-head slot when the local profile has no concrete non-rank role head. A local concrete role head remains authoritative.

Example: Romanian `Consilier de vanzari` can take translated `sales` or `business` concept evidence for family narrowing. Romanian `TEHNICIAN-ALPINIST TELECOMUNICATII` must keep local `technician` as the role head and must not let translated `steeplejack` become the primary exact leaf.

## Structural Role Inference

`inferRoleHeadsFromStructuralContext(...)` may infer role heads from family-structure bridge rules only when the query has no concrete non-rank role head. Rank-only titles may default toward non-management base roles when compatible concepts identify the work.

Example: `Sef tura patiserie` has authority plus pastry context but lacks a base culinary role head. The bridge can infer a culinary head such as `chef` or `cook`, then normal family and leaf gates decide whether `head pastry chef`, another culinary leaf, or a family gap is safe.

If the query already has a concrete role head, do not infer another one from context. `handler + pastry` should not become `chef` just because `pastry` exists.

## Family Authority

`assessFamilyStructureCompatibility(...)` is the default authority for family survival. Retrieval evidence can discover a family, but it must not override a structural reject.

Family compatibility uses the strong role-head set, not a single primary role head. Multiple concrete role heads are alternatives for grounding: a family or leaf may match any strong role head. Full exactness still depends on authority and modifier/concept coverage.

Direct leaf authority may upgrade a non-rejected family to accepted only when the candidate has trustworthy direct evidence:

- exact primary alias,
- folded alias,
- exact role canonical match with first-order interesting resemblance.

This upgrade cannot turn a rejected family into accepted. It only confirms a family that is already structurally compatible or partial.

## Early Leaf Decisions

Exact canonical leaf shortcuts must also pass family-structure validation. A generated exact key for a bare translated role head is not enough when the original query contains another concrete role head or additional structural context.

Example: `technician telecommunications steeplejack` must not return `steeplejack` before family validation. If the telecom technician family is compatible, that family and its leaves remain eligible; the construction-frame family is rejected.

## Dictionary Gaps

A dictionary-gap family answer must be structurally accepted, or partial with role grounding. Partial ungrounded support is discovery evidence only.

Example: a logistics term without a compatible role head should not produce a confident logistics family answer by domain alone.
