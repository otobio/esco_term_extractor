import { DEFAULT_LOCAL_HASH_DIMENSIONS, LOCAL_HASH_MODEL_KEY } from './local-hash-provider.js';
import { DEFAULT_TRANSFORMERS_DIMENSIONS, DEFAULT_TRANSFORMERS_MODEL_NAME, TRANSFORMERS_MODEL_KEY } from './transformers-provider.js';
import type { EmbeddingProviderKind, EmbeddingVector, TextEmbeddingProvider } from './types.js';
export { DEFAULT_LOCAL_HASH_DIMENSIONS, DEFAULT_TRANSFORMERS_DIMENSIONS, DEFAULT_TRANSFORMERS_MODEL_NAME, LOCAL_HASH_MODEL_KEY, TRANSFORMERS_MODEL_KEY };
export type { EmbeddingProviderKind, EmbeddingVector, TextEmbeddingProvider };
export type CreateEmbeddingProviderOptions = {
    provider?: EmbeddingProviderKind;
    modelKey?: string;
    dimensions?: number;
    modelName?: string;
    cacheDir?: string;
};
export declare function createEmbeddingProvider(options?: CreateEmbeddingProviderOptions): Promise<TextEmbeddingProvider>;
