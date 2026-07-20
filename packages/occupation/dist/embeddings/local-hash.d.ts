export type LocalHashEmbedding = {
    vector: number[];
    vectorNorm: number;
};
export declare function embedTextWithLocalHash(text: string, modelKey: string, dimensions: number): LocalHashEmbedding;
export declare function computeDotProduct(left: number[], right: number[]): number;
export declare function computeCosineSimilarity(left: number[], right: number[], leftNorm?: number, rightNorm?: number): number;
export declare function computeVectorNorm(vector: number[]): number;
export declare function sha256Hex(value: string): string;
