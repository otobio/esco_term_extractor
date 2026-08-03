# Locale Title Bootstrap

Use this as the playbook when we receive a new locale sample such as 10k real job titles.

## Goals

- Improve family and leaf correctness from real market titles without adding heavy runtime models.
- Convert review findings into bounded runtime artifacts, not ad hoc score tuning.
- Preserve explainability: every improvement should map to a visible rule, phrase, alias, marker, or suppression.

## Artifact Priorities

1. Noise patterns
- Mine repeated recruiter/UI/location/schedule/salary/employer fragments.
- Promote only high-confidence non-occupational fragments into noise peeling.
- Keep occupation-safe exemptions for titles that contain the same tokens in real role context.

2. Curated role phrases
- Mine frequent title phrases that clearly map to one English market role phrase.
- Examples: sales advisor, customer service, call center agent, maintenance technician.
- Support locale linker variants like `de`, `si`, `cu` in matching.

3. Family aliases
- Mine low-risk broader phrases that should anchor family intent without forcing a leaf.
- Use when the market title is real but ESCO leaf specificity is weak or inconsistent.

4. Head equivalence and morphology
- Add locale head equivalents and inflection patterns for feminine/plural/case/compound forms.
- Prefer structural normalization over leaf-specific alias inflation.

5. Marker-to-family support
- Build a compact reviewed artifact for modern market markers that semantic embeddings would usually cover.
- Shape: `marker -> compatible_heads -> supporting_families -> confidence`.
- Examples: `ai`, `reddit`, `social media`, `growth`, `cisco`, `devops`, `seo`, `community`.
- This should support family ranking only, not direct leaf promotion.

6. Hazardous alias suppressions
- Record aliases that are valid in ESCO but harmful for live-title interpretation in a locale.
- Examples include overly broad educator/counsellor/linguist collisions.
- Use targeted suppression or discounting rather than global weight changes.

## Review Workflow

1. Sample 10k real titles.
2. Run noise peeling and pipeline resolution.
3. Bucket misses into:
- noise
- role phrase
- family alias
- morphology/head equivalence
- marker support
- hazardous alias
- dictionary gap
4. Review top-frequency buckets first.
5. Promote only reviewed patterns into runtime artifacts.
6. Re-run golden and sampled-title comparisons before shipping.

## Safety Rules

- Do not let OOV cleaning drop a clause just because the first clause looks known.
- Do not let market markers promote leaves without role-head/title grounding.
- Do not solve locale gaps by broad score tuning when a phrase, alias, or marker artifact would be clearer.
- Keep locale-specific artifacts small, explicit, and generated ahead of runtime.

## Immediate RO Follow-Ups

- Safer OOV handling for dual-head and hyphenated titles like `Educator-Puericultor`.
- Better modern media/marketing marker support for titles like `creator de continut social media`.
- Better legal/sales hazardous alias handling for titles like `Jurist` and `Consilier de vanzari`.
- Better exact leaf promotion for strong Romanian software-developer forms.
