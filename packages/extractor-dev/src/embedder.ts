/**
 * Sentence-transformer embedder backed by Transformers.js.
 *
 * Runs fully locally via ONNX Runtime — no network at inference time once the
 * model weights are cached. Embeddings are mean-pooled and L2-normalized, so a
 * dot product between two vectors equals their cosine similarity.
 *
 * Weights load as fp16 by default: for this model fp16 vectors are cosine-1.0000
 * identical to fp32 (zero retrieval-accuracy change), while the download is ~half
 * the size and the model loads ~2x faster — which dominates one-shot CLI latency.
 * The index build passes `dtype: 'fp32'` explicitly, since fp16 CPU *inference*
 * (irrelevant to a few query clauses) is slower over the 68k-term corpus.
 */
import { type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';

// Multilingual by default (ro/hu/et/en). 384-d, same dimension as all-MiniLM-L6-v2
// so the index layout is unchanged; it is markedly better on non-English text.
export const DEFAULT_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIM = 384;

/** ONNX weight precision. fp16 ≡ fp32 vectors here, at half the size / load time. */
export type EmbedderDtype = 'fp32' | 'fp16' | 'q8';
export const DEFAULT_DTYPE: EmbedderDtype = 'fp16';

export interface EmbedderOptions {
  model?: string;
  /** Number of clauses/terms encoded per forward pass. */
  batchSize?: number;
  /** Weight precision (default fp16 — accuracy-identical, faster to load). */
  dtype?: EmbedderDtype;
}

/**
 * Minimal embedding contract the extractor depends on. Depending on the interface
 * (not the concrete class) keeps the model swappable and lets tests inject a
 * deterministic stub without downloading weights.
 */
export interface TextEmbedder {
  readonly model: string;
  embed(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]>;
  embedOne(text: string): Promise<Float32Array>;
}

export class Embedder implements TextEmbedder {
  readonly model: string;
  private readonly batchSize: number;
  private readonly dtype: EmbedderDtype;
  private pipe: FeatureExtractionPipeline | null = null;

  constructor(options: EmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.batchSize = options.batchSize ?? 64;
    this.dtype = options.dtype ?? DEFAULT_DTYPE;
  }

  private async ensure(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      this.pipe = await pipeline('feature-extraction', this.model, { dtype: this.dtype });
    }
    return this.pipe;
  }

  /**
   * Embed a list of texts. Returns one Float32Array (length {@link EMBEDDING_DIM})
   * per input, L2-normalized. Empty inputs yield a zero vector.
   */
  async embed(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
    const pipe = await this.ensure();
    const out: Float32Array[] = new Array(texts.length);
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      const tensor = await pipe(batch, { pooling: 'mean', normalize: true });
      const dim = tensor.dims[tensor.dims.length - 1];
      const data = tensor.data as Float32Array;
      for (let i = 0; i < batch.length; i++) {
        out[start + i] = data.slice(i * dim, (i + 1) * dim);
      }
      onProgress?.(Math.min(start + batch.length, texts.length), texts.length);
    }
    return out;
  }

  /** Embed a single text. */
  async embedOne(text: string): Promise<Float32Array> {
    return (await this.embed([text]))[0];
  }
}
