import { readOptionalEnv } from '../config/env.js';
import { createBinaryRetrievalEngine } from './binary-retrieval-engine.js';
import { createOpenSearchRetrievalEngine } from './opensearch-retrieval-engine.js';
export function createRetrievalEngine(kind = configuredRetrievalBackend()) {
    if (kind === 'binary-cache') {
        return createBinaryRetrievalEngine();
    }
    return createOpenSearchRetrievalEngine();
}
export function configuredRetrievalBackend() {
    const value = readOptionalEnv('OSE_RETRIEVAL_BACKEND')?.trim().toLowerCase();
    if (value === 'binary-cache' || value === 'binary_cache' || value === 'binary') {
        return 'binary-cache';
    }
    return 'binary-cache';
}
export function parseRetrievalBackend(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'binary-cache' || normalized === 'binary_cache' || normalized === 'binary') {
        return 'binary-cache';
    }
    if (normalized === 'opensearch' || normalized === 'os') {
        return 'opensearch';
    }
    throw new Error(`Unknown retrieval backend "${value}". Expected "opensearch" or "binary-cache".`);
}
