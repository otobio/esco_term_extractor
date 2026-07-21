import { embedTextWithLocalHash } from '../local-hash.js';
export const LOCAL_HASH_MODEL_KEY = 'local-hash-v1';
export const DEFAULT_LOCAL_HASH_DIMENSIONS = 384;
export function createLocalHashEmbeddingProvider(modelKey, dimensions) {
    const metadata = {
        modelKey,
        modelFamily: 'local_hash_token_vector',
        provider: 'local-deterministic',
        dimensions,
        poolingStrategy: 'hashed_token_sum',
        normalizationStrategy: 'l2',
        isMultilingual: false,
        notes: [
            'Deterministic local hashed-token vector for exploration and verification only.',
            'Not a production semantic, transformer, or ONNX embedding model.',
            'Uses no network access and downloads no model files.'
        ].join(' ')
    };
    return {
        metadata,
        async embed(text) {
            return embedTextWithLocalHash(text, modelKey, dimensions);
        },
        async embedBatch(texts) {
            return texts.map((text) => embedTextWithLocalHash(text, modelKey, dimensions));
        }
    };
}
