import { createLocalHashEmbeddingProvider, DEFAULT_LOCAL_HASH_DIMENSIONS, LOCAL_HASH_MODEL_KEY } from './local-hash-provider.js';
import {
  createTransformersEmbeddingProvider,
  DEFAULT_TRANSFORMERS_DIMENSIONS,
  DEFAULT_TRANSFORMERS_MODEL_NAME,
  TRANSFORMERS_MODEL_KEY
} from './transformers-provider.js';
import type { EmbeddingProviderKind, EmbeddingVector, TextEmbeddingProvider } from './types.js';

export {
  DEFAULT_LOCAL_HASH_DIMENSIONS,
  DEFAULT_TRANSFORMERS_DIMENSIONS,
  DEFAULT_TRANSFORMERS_MODEL_NAME,
  LOCAL_HASH_MODEL_KEY,
  TRANSFORMERS_MODEL_KEY
};
export type { EmbeddingProviderKind, EmbeddingVector, TextEmbeddingProvider };

export type CreateEmbeddingProviderOptions = {
  provider?: EmbeddingProviderKind;
  modelKey?: string;
  dimensions?: number;
  modelName?: string;
  cacheDir?: string;
};

export async function createEmbeddingProvider(options: CreateEmbeddingProviderOptions = {}): Promise<TextEmbeddingProvider> {
  const provider = normalizeProviderKind(options.provider, options.modelKey);

  if (provider === 'transformers') {
    return createTransformersEmbeddingProvider({
      modelKey: normalizeModelKey(options.modelKey, TRANSFORMERS_MODEL_KEY),
      modelName: normalizeModelName(options.modelName),
      dimensions: normalizeDimensions(options.dimensions, DEFAULT_TRANSFORMERS_DIMENSIONS),
      cacheDir: options.cacheDir
    });
  }

  const modelKey = normalizeModelKey(options.modelKey, LOCAL_HASH_MODEL_KEY);
  const dimensions = normalizeDimensions(options.dimensions, DEFAULT_LOCAL_HASH_DIMENSIONS);
  return createLocalHashEmbeddingProvider(modelKey, dimensions);
}

function normalizeProviderKind(
  provider: EmbeddingProviderKind | undefined,
  modelKey: string | undefined
): EmbeddingProviderKind {
  if (provider) {
    return provider;
  }

  if (!modelKey?.trim()) {
    return 'transformers';
  }

  if (modelKey?.trim() === TRANSFORMERS_MODEL_KEY) {
    return 'transformers';
  }

  return 'local-hash';
}

function normalizeModelKey(modelKey: string | undefined, fallback: string): string {
  const normalized = modelKey?.trim();
  return normalized || fallback;
}

function normalizeModelName(modelName: string | undefined): string {
  const normalized = modelName?.trim();
  return normalized || DEFAULT_TRANSFORMERS_MODEL_NAME;
}

function normalizeDimensions(dimensions: number | undefined, fallback: number): number {
  const resolved = dimensions ?? fallback;

  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 16384) {
    throw new Error(`Embedding dimensions must be a positive integer no greater than 16384. Received "${resolved}".`);
  }

  return resolved;
}
