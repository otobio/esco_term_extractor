# Session State

Current objective: Add optional `company_type` support to the occupation pipeline as a conservative ESCO family prior.

User direction:
- Do not weaken business logic to save memory or improve speed.
- `company_type` is passed as a finite slug from `/Users/otobio/repo/term-extractor/src/inference/facets.ts`.
- The company type should help disambiguate family selection, especially short titles such as `Builder`.
- The mapping can live in code for now because the ESCO family set is fixed and small.
- No runtime LLM. LLM output, if used later, should only seed a reviewed deterministic map.

Facts verified:
- Runtime family profile artifact currently has 125 ESCO family profiles.
- Runtime search meta has 3,045 leaf occupation records and 125 family leaf posting keys.
- Unique company type slugs extracted from term-extractor:
  - `company_type:agency`
  - `company_type:agriculture_agri_business`
  - `company_type:automotive`
  - `company_type:aviation`
  - `company_type:banking_financial_services`
  - `company_type:cleaning_facilities`
  - `company_type:construction`
  - `company_type:education`
  - `company_type:energy`
  - `company_type:food_beverage`
  - `company_type:government`
  - `company_type:hospital_healthcare`
  - `company_type:hospitality`
  - `company_type:industrial_services`
  - `company_type:information_technology`
  - `company_type:insurance`
  - `company_type:manufacturing`
  - `company_type:media_advertising`
  - `company_type:nonprofit`
  - `company_type:outsourcing_shared_services`
  - `company_type:pharma_biotech`
  - `company_type:professional_services`
  - `company_type:real_estate_property`
  - `company_type:retailer`
  - `company_type:security`
  - `company_type:telecom`
  - `company_type:transportation`
  - `company_type:utility_provider`
  - `company_type:warehouse_logistics`

Implemented:
- Added `companyType?: string` to `OccupationSearchPipelineOptions`.
- `GetCanonicalTermInput` accepts `companyType`, then passes the value into the pipeline.
- CLI accepts `--company-type=company_type:construction`.
- Company type values normalize to a `company_type:<slug>` key; callers may pass either the full key or just the slug.
- Added deterministic `src/search-pipeline/company-type-family-priors.ts` with all 29 extracted company type slugs and reviewed first-pass ESCO family priors.
- Added `company_type_family_prior` as a separate pipeline evidence channel.
- Prior is applied before top-family trimming, after normal retrieval/family-profile evidence is collected.
- Prior is gated by existing role evidence/family grounding so company type cannot select an occupation family by itself.
- Prior contributes a bounded family score boost and participates in post-recovery family authority ordering.
- Query context and CLI/JSON output expose the normalized company type.
- Added structural tests for:
  - `Builder` + `company_type:construction` selecting `Building frame and related trades workers`.
  - `Airline Compliance Auditors` + `company_type:aviation` not drifting to aircraft/pilot families.

Second pass:
- Removed the extra `company_type` API input alias; the API accepts `companyType` only.
- Kept CLI flag as `--company-type=...`.
- Rechecked logic flow:
  - Prior is not loaded from runtime artifacts and does not add meaningful memory pressure.
  - Prior only applies to existing candidate families, so it cannot introduce a family that retrieval/profile evidence never surfaced.
  - Prior requires title role grounding before it contributes evidence.
  - Prior participates before top-family trimming and again in post-recovery authority ordering.

Verification:
- `npm run build`: passed.
- `npm run test:structural`: passed, 27/27.
- `git diff --check`: passed.
- `npm run runtime:check`: passed.
- `npm run evaluation:golden:pipeline:developing`: passed command, `33/54`, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable`: exited 1 with known baseline `21/24`, `blocking_failures=3`.
- `npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache`: passed command, `33/54`, `blocking_failures=0`.
- `npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache`: exited 1 with known baseline `21/24`, `blocking_failures=3`.
- Known stable failures unchanged:
  - `Fullstack developer` confidence `58%` vs expected `60%`.
  - `electrical wiring installer` promotes `electrician`, expected family.
  - `dezvoltatori software` confidence `81%` vs expected `85%`.
- CLI check:
  - `npm run resolution:pipeline -- --query="Builder" --locale=en --company-type=company_type:construction --retrieval-backend=binary-cache --debug --no-color`
  - Selected leaf `house builder` under family `Building frame and related trades workers`.
  - Top family evidence includes `company_type_family_prior:1`.
- Guardrail CLI check:
  - `npm run resolution:pipeline -- --query="Airline Compliance Auditors" --locale=en --company-type=company_type:aviation --retrieval-backend=binary-cache --debug --no-color`
  - Remained unresolved/dictionary-gap and did not select aircraft/pilot families.

Current uncommitted work:
- `AGENTS.md` has a docs-only memory guideline change from the prior request.
- Company-type prior implementation is uncommitted across `src`, `dist`, tests, and this `SESSION_STATE.md`.
