import { embedTextWithLocalHash } from '../embeddings/local-hash.js';
import { createEmbeddingProvider } from '../embeddings/providers/index.js';
import { timed } from '../utils/timing.js';
const QUERY_EMBEDDING_PROVIDER_CACHE = new Map();
export async function embedRuntimeQuery(query, model, timings, timingPrefix = 'embedding_provider') {
    if (model.provider === 'local-deterministic') {
        return embedTextWithLocalHash(query, model.model_key, model.dimensions);
    }
    const provider = await timed(() => getRuntimeQueryEmbeddingProvider(model), `${timingPrefix}.get`, timings);
    return timed(() => provider.embed(query), `${timingPrefix}.embed`, timings);
}
async function getRuntimeQueryEmbeddingProvider(model) {
    const cacheKey = `${model.provider}:${model.model_key}:${model.dimensions}`;
    let providerPromise = QUERY_EMBEDDING_PROVIDER_CACHE.get(cacheKey);
    if (!providerPromise) {
        providerPromise = createEmbeddingProvider({
            provider: toEmbeddingProviderKind(model.provider),
            modelKey: model.model_key,
            dimensions: model.dimensions
        });
        QUERY_EMBEDDING_PROVIDER_CACHE.set(cacheKey, providerPromise);
    }
    return providerPromise;
}
function toEmbeddingProviderKind(provider) {
    if (provider === 'local-deterministic') {
        return 'local-hash';
    }
    if (provider === 'huggingface-transformers-js') {
        return 'transformers';
    }
    throw new Error(`Unsupported embedding provider "${provider}" for dense query embedding.`);
}
