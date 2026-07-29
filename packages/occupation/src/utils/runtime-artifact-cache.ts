import { stat } from 'node:fs/promises';
import { readOptionalEnv } from '../config/env.js';

export type RuntimeArtifactCacheEntry<T> = {
  version: string;
  promise: Promise<T | null>;
};

export async function getCachedRuntimeArtifact<T>(
  cache: Map<string, RuntimeArtifactCacheEntry<T>>,
  cacheKey: string,
  manifestPath: string,
  options: {
    maxSize: number;
    load: () => Promise<T | null>;
    dispose?: (value: T) => void;
  }
): Promise<T | null> {
  const version = await artifactFileVersion(manifestPath);
  const cached = cache.get(cacheKey);

  if (cached && cached.version === version) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached.promise;
  }

  if (cached) {
    disposeRuntimeArtifactCacheEntry(cached, options.dispose);
  }

  const entry: RuntimeArtifactCacheEntry<T> = {
    version,
    promise: options.load()
  };

  entry.promise = entry.promise.catch((error) => {
    if (cache.get(cacheKey) === entry) {
      cache.delete(cacheKey);
    }

    throw error;
  });

  cache.set(cacheKey, entry);
  trimRuntimeArtifactCache(cache, options.maxSize, options.dispose);

  return entry.promise;
}

export function configuredRuntimeArtifactCacheSize(
  specificEnvKey: string,
  defaultSize: number,
  fallbackEnvKey = 'OSE_RUNTIME_ARTIFACT_CACHE_SIZE'
): number {
  return readPositiveIntegerEnv(specificEnvKey, readPositiveIntegerEnv(fallbackEnvKey, defaultSize));
}

export function trimRuntimeArtifactCache<T>(
  cache: Map<string, RuntimeArtifactCacheEntry<T>>,
  maxSize: number,
  dispose?: (value: T) => void
): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value as string | undefined;

    if (!oldestKey) {
      return;
    }

    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);

    if (oldest) {
      disposeRuntimeArtifactCacheEntry(oldest, dispose);
    }
  }
}

function disposeRuntimeArtifactCacheEntry<T>(entry: RuntimeArtifactCacheEntry<T>, dispose: ((value: T) => void) | undefined): void {
  if (!dispose) {
    return;
  }

  entry.promise
    .then((value) => {
      if (value) {
        dispose(value);
      }
    })
    .catch(() => {
      // Failed loads have no artifact resources to release.
    });
}

async function artifactFileVersion(filePath: string): Promise<string> {
  try {
    const fileStats = await stat(filePath);
    return `${fileStats.size}:${fileStats.mtimeMs}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return 'missing';
    }

    return `unreadable:${Date.now()}`;
  }
}

function readPositiveIntegerEnv(key: string, defaultValue: number): number {
  const rawValue = readOptionalEnv(key);

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value < 1) {
    return defaultValue;
  }

  return value;
}
