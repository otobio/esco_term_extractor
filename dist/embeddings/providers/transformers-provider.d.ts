import type { TextEmbeddingProvider } from './types.js';
export declare const TRANSFORMERS_MODEL_KEY = "hf-paraphrase-multilingual-minilm-l12-v2";
export declare const DEFAULT_TRANSFORMERS_MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export declare const DEFAULT_TRANSFORMERS_DIMENSIONS = 384;
export type TransformersEmbeddingProviderOptions = {
    modelKey: string;
    modelName: string;
    dimensions: number;
    cacheDir?: string;
};
export declare function createTransformersEmbeddingProvider(options: TransformersEmbeddingProviderOptions): Promise<TextEmbeddingProvider>;
