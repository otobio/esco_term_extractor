import type { EmbeddingModelMetadata, EmbeddingVector, TextEmbeddingProvider } from './types.js';

export const TRANSFORMERS_MODEL_KEY = 'hf-paraphrase-multilingual-minilm-l12-v2';
export const DEFAULT_TRANSFORMERS_MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const DEFAULT_TRANSFORMERS_DIMENSIONS = 384;

export type TransformersEmbeddingProviderOptions = {
  modelKey: string;
  modelName: string;
  dimensions: number;
  cacheDir?: string;
};

export async function createTransformersEmbeddingProvider(
  options: TransformersEmbeddingProviderOptions
): Promise<TextEmbeddingProvider> {
  const transformers = await loadTransformersModule();
  const cacheDir = options.cacheDir?.trim() || process.env.OSE_MODEL_CACHE_DIR?.trim();

  if (cacheDir) {
    transformers.env.cacheDir = cacheDir;
  }

  transformers.env.allowRemoteModels = true;
  transformers.env.allowLocalModels = true;

  const extractor = await transformers.pipeline('feature-extraction', options.modelName, {
    cache_dir: cacheDir || undefined,
    dtype: 'fp32'
  });

  const metadata: EmbeddingModelMetadata = {
    modelKey: options.modelKey,
    modelFamily: 'sentence_transformer_feature_extraction',
    provider: 'huggingface-transformers-js',
    dimensions: options.dimensions,
    poolingStrategy: 'mean',
    normalizationStrategy: 'l2',
    isMultilingual: true,
    notes: [
      `Transformers.js feature-extraction embedding generated from ${options.modelName}.`,
      'Uses mean pooling and L2 normalization via the feature extraction pipeline.',
      cacheDir ? `Model artifacts are cached under ${cacheDir}.` : 'Model artifacts use the Transformers.js default cache.'
    ].join(' ')
  };

  return {
    metadata,
    async embed(text: string): Promise<EmbeddingVector> {
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: true
      });
      return tensorToEmbeddingVectors(output, options)[0] ?? emptyEmbedding(options.dimensions);
    },
    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
      if (texts.length === 0) {
        return [];
      }

      const output = await extractor(texts, {
        pooling: 'mean',
        normalize: true
      });
      return tensorToEmbeddingVectors(output, options);
    },
    async dispose(): Promise<void> {
      await disposePipeline(extractor);
    }
  };
}

function computeVectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function tensorToEmbeddingVectors(
  output: TransformersTensorOutput,
  options: TransformersEmbeddingProviderOptions
): EmbeddingVector[] {
  const dims = output.dims;
  const data = Array.from(output.data, (value) => Number(value));

  if (dims.length === 1) {
    return [buildEmbeddingVector(data.map(roundVectorValue), options)];
  }

  const batchSize = dims[0] ?? 0;
  const dimensions = dims[dims.length - 1] ?? 0;

  if (dimensions !== options.dimensions) {
    throw new Error(
      `Transformers model "${options.modelName}" returned ${dimensions} dimensions; expected ${options.dimensions}.`
    );
  }

  const vectors: EmbeddingVector[] = [];

  for (let index = 0; index < batchSize; index += 1) {
    const start = index * dimensions;
    const vector = data.slice(start, start + dimensions).map(roundVectorValue);
    vectors.push(buildEmbeddingVector(vector, options));
  }

  return vectors;
}

function buildEmbeddingVector(vector: number[], options: TransformersEmbeddingProviderOptions): EmbeddingVector {
  if (vector.length !== options.dimensions) {
    throw new Error(
      `Transformers model "${options.modelName}" returned ${vector.length} dimensions; expected ${options.dimensions}.`
    );
  }

  return {
    vector,
    vectorNorm: roundVectorValue(computeVectorNorm(vector))
  };
}

function emptyEmbedding(dimensions: number): EmbeddingVector {
  return {
    vector: new Array<number>(dimensions).fill(0),
    vectorNorm: 0
  };
}

function roundVectorValue(value: number): number {
  const rounded = Number(value.toFixed(8));
  return Object.is(rounded, -0) ? 0 : rounded;
}

async function disposePipeline(extractor: TransformersFeatureExtractor): Promise<void> {
  if (typeof extractor.dispose === 'function') {
    await extractor.dispose();
  }
}

type TransformersModule = {
  env: {
    cacheDir?: string;
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
  };
  pipeline: (
    task: 'feature-extraction',
    model: string,
    options: { cache_dir?: string; dtype: 'fp32' }
  ) => Promise<TransformersFeatureExtractor>;
};

type TransformersFeatureExtractor = {
  (text: string | string[], options: { pooling: 'mean'; normalize: true }): Promise<TransformersTensorOutput>;
  dispose?: () => Promise<void> | void;
};

type TransformersTensorOutput = {
  dims: number[];
  data: ArrayLike<number>;
};

async function loadTransformersModule(): Promise<TransformersModule> {
  try {
    const optionalImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<unknown>;
    return await optionalImport('@huggingface/transformers') as TransformersModule;
  } catch (error) {
    throw new Error(
      [
        'The optional Transformers embedding provider is not installed.',
        'Dense/semantic embedding generation is no longer part of the default package workflow.',
        'Install @huggingface/transformers manually if you need to run this experimental provider.'
      ].join(' '),
      { cause: error }
    );
  }
}
