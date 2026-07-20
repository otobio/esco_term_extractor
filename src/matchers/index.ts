/**
 * Term matcher — self-contained surface → canonical-key resolution against the
 * canonical_runtime_terms OpenSearch index. Additive-hybrid (neural + lexical,
 * neither gating) for occupation/capabilities; lexical elsewhere.
 */

export { additiveHybridStrategy } from './additive-hybrid.js';
export { lexicalStrategy } from './lexical.js';
export type { OpenSearchClientOptions } from './os-client.js';
export { createOpenSearchClient } from './os-client.js';
export { buildFilters, resolveSurfaces, strategyForBucket } from './resolve.js';
export { foldSurface } from './strategy.js';
export type {
  MatchContext,
  OpenSearchClient,
  QueryFilters,
  SurfaceQuery,
  TermMatchStrategy,
  TermResolution,
} from './types.js';
