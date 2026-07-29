import { stat } from 'node:fs/promises';
import { readOptionalEnv } from '../config/env.js';
export async function getCachedRuntimeArtifact(cache, cacheKey, manifestPath, options) {
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
    const entry = {
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
export function configuredRuntimeArtifactCacheSize(specificEnvKey, defaultSize, fallbackEnvKey = 'OSE_RUNTIME_ARTIFACT_CACHE_SIZE') {
    return readPositiveIntegerEnv(specificEnvKey, readPositiveIntegerEnv(fallbackEnvKey, defaultSize));
}
export function trimRuntimeArtifactCache(cache, maxSize, dispose) {
    while (cache.size > maxSize) {
        const oldestKey = cache.keys().next().value;
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
function disposeRuntimeArtifactCacheEntry(entry, dispose) {
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
async function artifactFileVersion(filePath) {
    try {
        const fileStats = await stat(filePath);
        return `${fileStats.size}:${fileStats.mtimeMs}`;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return 'missing';
        }
        return `unreadable:${Date.now()}`;
    }
}
function readPositiveIntegerEnv(key, defaultValue) {
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
