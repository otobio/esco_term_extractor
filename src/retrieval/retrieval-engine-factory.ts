import { readOptionalEnv } from '../config/env.js';
import { createBinaryRetrievalEngine } from './binary-retrieval-engine.js';
import { createOpenSearchRetrievalEngine } from './opensearch-retrieval-engine.js';
import type { OccupationRetrievalEngine } from './retrieval-engine.js';

export type RetrievalBackendKind = 'opensearch' | 'binary-cache';

export function createRetrievalEngine(kind: RetrievalBackendKind = configuredRetrievalBackend()): OccupationRetrievalEngine {
  if (kind === 'binary-cache') {
    return createBinaryRetrievalEngine();
  }

  return createOpenSearchRetrievalEngine();
}

export function configuredRetrievalBackend(): RetrievalBackendKind {
  const _value = readOptionalEnv('OSE_RETRIEVAL_BACKEND')?.trim().toLowerCase();

  return 'binary-cache';
}

export function parseRetrievalBackend(value: string): RetrievalBackendKind {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'binary-cache' || normalized === 'binary_cache' || normalized === 'binary') {
    return 'binary-cache';
  }

  if (normalized === 'opensearch' || normalized === 'os') {
    return 'opensearch';
  }

  throw new Error(`Unknown retrieval backend "${value}". Expected "opensearch" or "binary-cache".`);
}
