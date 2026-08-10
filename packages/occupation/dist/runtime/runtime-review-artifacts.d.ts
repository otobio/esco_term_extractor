export declare function defaultRuntimeReviewDir(): string;
export declare function defaultRuntimeReviewJsonPath(baseName: string): string;
export declare function defaultRuntimeReviewJsonlPath(baseName: string): string;
export declare function runtimeReviewArtifactBaseName(name: string, sourceName?: string): string;
export declare function defaultOccupationAliasNgramReviewJsonlPath(sourceName: string, locale: string, includeFamilySupportingAliases: boolean): string;
export declare function writeRuntimeReviewJson(reviewPath: string, value: unknown): Promise<void>;
export declare function writeRuntimeReviewJsonl(reviewPath: string, records: Iterable<unknown>): Promise<void>;
