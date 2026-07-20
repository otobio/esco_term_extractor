export type EmbeddingProviderKind = 'local-hash' | 'transformers';
export type EmbeddingVector = {
    vector: number[];
    vectorNorm: number;
};
export type EmbeddingModelMetadata = {
    modelKey: string;
    modelFamily: string;
    provider: string;
    dimensions: number;
    poolingStrategy: string;
    normalizationStrategy: string;
    isMultilingual: boolean;
    notes: string;
};
export type TextEmbeddingProvider = {
    metadata: EmbeddingModelMetadata;
    embed(text: string): Promise<EmbeddingVector>;
    embedBatch?(texts: string[]): Promise<EmbeddingVector[]>;
    dispose?(): Promise<void>;
};
