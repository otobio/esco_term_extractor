export const TRANSFORMERS_MODEL_KEY = 'hf-paraphrase-multilingual-minilm-l12-v2';
export const DEFAULT_TRANSFORMERS_MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const DEFAULT_TRANSFORMERS_DIMENSIONS = 384;
export async function createTransformersEmbeddingProvider(options) {
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
    const metadata = {
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
        async embed(text) {
            const output = await extractor(text, {
                pooling: 'mean',
                normalize: true
            });
            return tensorToEmbeddingVectors(output, options)[0] ?? emptyEmbedding(options.dimensions);
        },
        async embedBatch(texts) {
            if (texts.length === 0) {
                return [];
            }
            const output = await extractor(texts, {
                pooling: 'mean',
                normalize: true
            });
            return tensorToEmbeddingVectors(output, options);
        },
        async dispose() {
            await disposePipeline(extractor);
        }
    };
}
function computeVectorNorm(vector) {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
function tensorToEmbeddingVectors(output, options) {
    const dims = output.dims;
    const data = Array.from(output.data, (value) => Number(value));
    if (dims.length === 1) {
        return [buildEmbeddingVector(data.map(roundVectorValue), options)];
    }
    const batchSize = dims[0] ?? 0;
    const dimensions = dims[dims.length - 1] ?? 0;
    if (dimensions !== options.dimensions) {
        throw new Error(`Transformers model "${options.modelName}" returned ${dimensions} dimensions; expected ${options.dimensions}.`);
    }
    const vectors = [];
    for (let index = 0; index < batchSize; index += 1) {
        const start = index * dimensions;
        const vector = data.slice(start, start + dimensions).map(roundVectorValue);
        vectors.push(buildEmbeddingVector(vector, options));
    }
    return vectors;
}
function buildEmbeddingVector(vector, options) {
    if (vector.length !== options.dimensions) {
        throw new Error(`Transformers model "${options.modelName}" returned ${vector.length} dimensions; expected ${options.dimensions}.`);
    }
    return {
        vector,
        vectorNorm: roundVectorValue(computeVectorNorm(vector))
    };
}
function emptyEmbedding(dimensions) {
    return {
        vector: new Array(dimensions).fill(0),
        vectorNorm: 0
    };
}
function roundVectorValue(value) {
    const rounded = Number(value.toFixed(8));
    return Object.is(rounded, -0) ? 0 : rounded;
}
async function disposePipeline(extractor) {
    if (typeof extractor.dispose === 'function') {
        await extractor.dispose();
    }
}
async function loadTransformersModule() {
    try {
        const optionalImport = new Function('specifier', 'return import(specifier)');
        return await optionalImport('@huggingface/transformers');
    }
    catch (error) {
        throw new Error([
            'The optional Transformers embedding provider is not installed.',
            'Dense/semantic embedding generation is no longer part of the default package workflow.',
            'Install @huggingface/transformers manually if you need to run this experimental provider.'
        ].join(' '), { cause: error });
    }
}
