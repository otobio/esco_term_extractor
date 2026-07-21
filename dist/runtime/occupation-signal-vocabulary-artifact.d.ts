export type PhraseHashFileManifest = {
    tokenCount: number;
    count: number;
    path: string;
};
export type OccupationSignalVocabularyManifest = {
    schemaVersion: 1;
    sourceName: string;
    generatedAt: string;
    hashAlgorithm: 'fnv1a64';
    maxPhraseTokenCount: number;
    tokenCount: number;
    anchorCount: number;
    tokensPath: string;
    anchorsPath: string;
    anchorCountsPath: string;
    phraseFiles: PhraseHashFileManifest[];
};
export type OccupationSignalVocabularyArtifact = OccupationSignalVocabularyManifest & {
    tokenHashes: SortedHashFile;
    phraseHashesByTokenCount: Map<number, SortedHashFile>;
    anchorHashes: SortedHashFile;
    anchorCounts: CountFile;
};
type ArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationSignalVocabularyArtifact;
};
export type SignalVocabularyHashSets = {
    tokenHashes: Set<bigint>;
    phraseHashesByTokenCount: Map<number, Set<bigint>>;
    anchorCounts: Map<bigint, number>;
};
export declare function defaultOccupationSignalVocabularyManifestPath(sourceName: string): string;
export declare function defaultOccupationSignalVocabularyTokensPath(sourceName: string): string;
export declare function defaultOccupationSignalVocabularyAnchorsPath(sourceName: string): string;
export declare function defaultOccupationSignalVocabularyAnchorCountsPath(sourceName: string): string;
export declare function defaultOccupationSignalVocabularyPhrasesPath(sourceName: string, tokenCount: number): string;
export declare function loadOccupationSignalVocabularyArtifactIfAvailable(sourceName: string): Promise<ArtifactCacheEntry | null>;
export declare function loadOccupationSignalVocabularyArtifactRequired(sourceName: string): Promise<ArtifactCacheEntry>;
export declare class SortedHashFile {
    private readonly buffer;
    readonly count: number;
    constructor(buffer: Buffer);
    has(hash: bigint): boolean;
    indexOf(hash: bigint): number;
}
export declare class CountFile {
    private readonly buffer;
    readonly count: number;
    constructor(buffer: Buffer);
    get(index: number): number;
}
export declare function hashVocabularyText(value: string): bigint;
export declare function hashTokenSequence(tokens: string[]): bigint;
export declare function sortedHashBuffer(values: Iterable<bigint>): Buffer;
export declare function sortedAnchorBuffers(anchorCounts: Map<bigint, number>): {
    hashes: Buffer;
    counts: Buffer;
    count: number;
};
export {};
