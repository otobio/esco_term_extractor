import { type EmbeddingVector } from '../embeddings/providers/index.js';
import { type TimingMap } from '../utils/timing.js';
export type QueryEmbeddingRuntimeModel = {
    model_key: string;
    provider: string;
    dimensions: number;
};
export declare function embedRuntimeQuery(query: string, model: QueryEmbeddingRuntimeModel, timings: TimingMap, timingPrefix?: string): Promise<EmbeddingVector>;
