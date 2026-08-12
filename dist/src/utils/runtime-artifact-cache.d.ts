export type RuntimeArtifactCacheEntry<T> = {
    version: string;
    promise: Promise<T | null>;
};
export declare function getCachedRuntimeArtifact<T>(cache: Map<string, RuntimeArtifactCacheEntry<T>>, cacheKey: string, manifestPath: string, options: {
    maxSize: number;
    load: () => Promise<T | null>;
    dispose?: (value: T) => void;
}): Promise<T | null>;
export declare function configuredRuntimeArtifactCacheSize(specificEnvKey: string, defaultSize: number, fallbackEnvKey?: string): number;
export declare function trimRuntimeArtifactCache<T>(cache: Map<string, RuntimeArtifactCacheEntry<T>>, maxSize: number, dispose?: (value: T) => void): void;
