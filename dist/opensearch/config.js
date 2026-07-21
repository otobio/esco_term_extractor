import { readOptionalEnv } from '../config/env.js';
const DEFAULT_OPENSEARCH_NODE = 'http://127.0.0.1:9201';
const DEFAULT_OPENSEARCH_INDEX_OCCUPATIONS = 'ose_occupations_v1';
const DEFAULT_OPENSEARCH_INDEX_OCCUPATION_ALIASES = 'ose_occupation_aliases_v1';
const DEFAULT_OPENSEARCH_VECTOR_FIELD = 'dense_vector';
const DEFAULT_OPENSEARCH_VECTOR_DIMENSIONS = 384;
const DEFAULT_OPENSEARCH_REQUEST_TIMEOUT_MS = 30000;
export function getOpenSearchConfig() {
    return {
        node: normalizeNodeUrl(readOptionalEnv('OPENSEARCH_NODE') ?? DEFAULT_OPENSEARCH_NODE),
        username: readOptionalEnv('OPENSEARCH_USERNAME'),
        password: readOptionalEnv('OPENSEARCH_PASSWORD'),
        occupationsIndex: readOptionalEnv('OPENSEARCH_INDEX_OCCUPATIONS') ?? DEFAULT_OPENSEARCH_INDEX_OCCUPATIONS,
        occupationAliasesIndex: readOptionalEnv('OPENSEARCH_INDEX_OCCUPATION_ALIASES') ?? DEFAULT_OPENSEARCH_INDEX_OCCUPATION_ALIASES,
        vectorField: readOptionalEnv('OPENSEARCH_VECTOR_FIELD') ?? DEFAULT_OPENSEARCH_VECTOR_FIELD,
        vectorDimensions: readPositiveInteger('OPENSEARCH_VECTOR_DIMENSIONS', readOptionalEnv('OPENSEARCH_VECTOR_DIMENSIONS'), DEFAULT_OPENSEARCH_VECTOR_DIMENSIONS),
        requestTimeoutMs: readPositiveInteger('OPENSEARCH_REQUEST_TIMEOUT_MS', readOptionalEnv('OPENSEARCH_REQUEST_TIMEOUT_MS'), DEFAULT_OPENSEARCH_REQUEST_TIMEOUT_MS)
    };
}
export function defaultOpenSearchTemplateName(indexName) {
    return `${indexName}_template`;
}
function normalizeNodeUrl(value) {
    try {
        const url = new URL(value);
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString().replace(/\/$/, '');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid OPENSEARCH_NODE URL "${value}": ${message}`);
    }
}
function readPositiveInteger(key, value, fallback) {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${key} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
