# Retrieval Engine Contract

The occupation pipeline uses `OccupationRetrievalEngine` from `src/retrieval/retrieval-engine.ts` as its retrieval boundary. `binary-cache` is the default runtime implementation, and OpenSearch remains available as an explicit comparison/index-backed backend.

## Engine Shape

An engine is a pair of retrievers:

```ts
type OccupationRetrievalEngine = {
  aliases: AliasRetrievalEngine;
  occupations: OccupationTextRetrievalEngine;
};
```

Use `OccupationSearchPipeline.withEngine(engine)` or `OccupationCandidateRetriever.withEngine(connection, engine)` to run the pipeline with a non-default backend. CLI commands that use the factory accept:

```bash
--retrieval-backend=opensearch
--retrieval-backend=runtime-cache
--retrieval-backend=binary-cache
```

The default binary-cache engine factory lives in `src/retrieval/binary-retrieval-engine.ts`. The OpenSearch engine factory lives in `src/retrieval/opensearch-retrieval-engine.ts` and is selected only when requested explicitly.

Prefer `OccupationRuntimeContext.load(...)` for application and CLI startup:

```ts
const runtime = await OccupationRuntimeContext.load({ retrievalBackend: 'binary-cache' });
const pipeline = OccupationSearchPipeline.withRuntime(runtime);
```

The runtime context validates the generated artifacts once, warms loader caches,
and owns the retrieval engine instance. Low-level artifact loaders still exist,
but they should be treated as utilities used by the boot layer and artifact
builders, not as ad hoc startup logic inside new runtime entrypoints.

## Runtime Backends

`opensearch`

- Uses the OpenSearch alias and occupation indexes for exact/folded/subphrase, lexical, capability, and family-constrained retrieval.
- Requires a populated OpenSearch cluster at query time.
- Available for development, comparison runs, and index-backed experiments when selected explicitly.

`runtime-cache`

- Loads runtime search-meta artifacts and builds in-process lookup maps/postings on first use.
- Useful as a correctness bridge and comparison target.
- Avoids OpenSearch at query time, but its cold path constructs indexes in memory and is slower than the generated binary index.

`binary-cache`

- Loads generated binary retrieval artifacts from `artifacts/runtime`.
- Uses sorted string tables, fixed-width rows, sorted lookup indexes, and postings lists for exact alias, folded alias, canonical label, lexical, and family-constrained retrieval.
- Avoids MySQL, OpenSearch, dense model inference, and network access at query time when runtime artifacts are already built.
- Keeps the same retrieval evidence contract as OpenSearch: exact alias, folded alias, subphrase alias, canonical label, lexical, and family-constrained rows stay distinct.
- Is the default runtime backend. Missing required binary retrieval artifacts are startup errors, not fallback conditions.

Build all runtime artifacts needed by the portable path with:

```bash
npm run runtime:artifacts-build
npm run runtime:check
```

Run the pipeline through the portable backend with:

```bash
npm run resolution:pipeline -- --query="software developer" --locale=en --retrieval-backend=binary-cache
```

Alias-ngram retrieval is separate from the retrieval engine boundary but participates in candidate evidence. It is enabled by default and prefers the binary alias-ngram artifact, falling back to JSON only when the binary manifest is unavailable. Disable it with `OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL=1`.

## Alias Retrieval

`AliasRetrievalEngine.retrieve()` returns:

```ts
type AliasRetrievalResult = {
  exactRows: AliasEvidenceRow[];
  foldedRows: AliasEvidenceRow[];
  subphraseRows: AliasEvidenceRow[];
  scannedAliasHitCount: number;
};
```

Required behavior:

- Apply `sourceName` and `locale` filters.
- Keep exact, folded, and subphrase rows separate. Candidate scoring weights these evidence channels differently.
- Preserve alias authority fields: `alias_role_rank`, `weight`, `alias_authority_score`, and `alias_token_count`.
- `scannedAliasHitCount` must equal the number of rows considered across the returned alias channels.

## Occupation Text Retrieval

`OccupationTextRetrievalEngine` has three methods:

- `retrieve()` returns global lexical occupation hits.
- `retrieveCanonicalLabels()` returns exact normalized canonical-label matches.
- `retrieveWithinFamily()` returns lexical occupation hits constrained to one `familyNodeId`.

All occupation text hits use:

```ts
type OccupationTextHit = {
  graphNodeId: number;
  canonicalLabel: string;
  score: number;
  rawScore: number;
  normalizedRawScore: number;
  lexicalSignalScore: number;
  matchedQueries: string[];
  matchedFields: string[];
  fieldSignals: OccupationTextFieldSignal[];
  matchedTokens: string[];
  phraseMatch: boolean;
  maxUsefulTokenCoverage: number;
  queryTokenCount: number;
  usefulQueryTokenCount: number;
};
```

Required behavior:

- Apply `sourceName`, `locale`, and occupation-level filtering.
- Return hits sorted by descending `score`, with deterministic tie-breaking.
- Keep scores comparable within a single retrieval call. They do not need to be comparable across different backends.
- For `retrieveWithinFamily()`, never return hits outside the requested `familyNodeId`.
- Populate field and token signal fields because downstream scoring uses them for evidence quality, not just display.

## Canonical Label Retrieval

`retrieveCanonicalLabels()` returns:

```ts
type CanonicalLabelHit = {
  graphNodeId: number;
  canonicalLabel: string;
  normalizedLabel: string;
};
```

Required behavior:

- Match only against the supplied `foldedQueries`.
- Apply `sourceName`, `locale`, and occupation-level filtering.
- Return deterministic ordering for stable tests.

## Regression Expectations

A retrieval backend must pass the existing golden pipeline suite before being used as a runtime default. `binary-cache` is the runtime default; OpenSearch and runtime-cache are explicit alternatives for comparison and debugging.

Required checks before switching defaults:

```bash
npm run build
npm run runtime:check
npm run test:structural
npm run evaluation:golden:pipeline:developing -- --retrieval-backend=binary-cache
npm run evaluation:golden:pipeline -- --suite=stable --retrieval-backend=binary-cache
```
