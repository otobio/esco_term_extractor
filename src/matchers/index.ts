/**
 * Term matcher — self-contained surface → canonical-key resolution against the
 * canonical_runtime_terms OpenSearch index. Additive-hybrid (neural + lexical,
 * neither gating) for occupation/capabilities; lexical elsewhere.
 */

export { additiveHybridStrategy } from './additive-hybrid.ts';
export { lexicalStrategy } from './lexical.ts';
export type { OpenSearchClientOptions } from './os-client.ts';
export { createOpenSearchClient } from './os-client.ts';
export { buildFilters, resolveSurfaces, strategyForBucket } from './resolve.ts';
export { foldSurface } from './strategy.ts';
export type {
  MatchContext,
  OpenSearchClient,
  QueryFilters,
  SurfaceQuery,
  TermMatchStrategy,
  TermResolution,
} from './types.ts';
