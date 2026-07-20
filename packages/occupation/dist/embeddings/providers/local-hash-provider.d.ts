import type { TextEmbeddingProvider } from './types.js';
export declare const LOCAL_HASH_MODEL_KEY = "local-hash-v1";
export declare const DEFAULT_LOCAL_HASH_DIMENSIONS = 384;
export declare function createLocalHashEmbeddingProvider(modelKey: string, dimensions: number): TextEmbeddingProvider;
