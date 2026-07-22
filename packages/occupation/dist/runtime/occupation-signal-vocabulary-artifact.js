import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { compareBigInt } from '../utils/operators.js';
import { isNonNegativeInteger, isPositiveInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import { configuredRuntimeArtifactCacheSize, getCachedRuntimeArtifact } from '../utils/runtime-artifact-cache.js';
import { DEFAULT_RUNTIME_DIR } from './runtime-dir.js';
const ARTIFACT_CACHE = new Map();
const DEFAULT_SIGNAL_VOCABULARY_CACHE_SIZE = 2;
const HASH_BYTES = 8;
const COUNT_BYTES = 4;
export function defaultOccupationSignalVocabularyManifestPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.manifest.json`);
}
export function defaultOccupationSignalVocabularyTokensPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.tokens.u64`);
}
export function defaultOccupationSignalVocabularyAnchorsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.anchors.u64`);
}
export function defaultOccupationSignalVocabularyAnchorCountsPath(sourceName) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.anchor-counts.u32`);
}
export function defaultOccupationSignalVocabularyPhrasesPath(sourceName, tokenCount) {
    return path.join(DEFAULT_RUNTIME_DIR, `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.phrases-${tokenCount}.u64`);
}
export async function loadOccupationSignalVocabularyArtifactIfAvailable(sourceName) {
    const configuredPath = readOptionalEnv('OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationSignalVocabularyManifestPath(sourceName);
    const cacheKey = path.resolve(manifestPath);
    return getCachedRuntimeArtifact(ARTIFACT_CACHE, cacheKey, cacheKey, {
        maxSize: configuredRuntimeArtifactCacheSize('OSE_SIGNAL_VOCABULARY_CACHE_SIZE', DEFAULT_SIGNAL_VOCABULARY_CACHE_SIZE),
        load: () => loadArtifact(cacheKey, sourceName)
    });
}
export async function loadOccupationSignalVocabularyArtifactRequired(sourceName) {
    const manifestPath = readOptionalEnv('OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH') ??
        defaultOccupationSignalVocabularyManifestPath(sourceName);
    const artifactEntry = await loadOccupationSignalVocabularyArtifactIfAvailable(sourceName);
    if (!artifactEntry) {
        throw new Error([
            `Missing required occupation signal vocabulary artifact for source="${sourceName}".`,
            `Expected manifest: ${path.resolve(manifestPath)}`,
            'Run `npm run query:signals:export-vocab` after exporting search-meta, or set OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH.'
        ].join(' '));
    }
    return artifactEntry;
}
export class SortedHashFile {
    buffer;
    count;
    constructor(buffer) {
        this.buffer = buffer;
        if (buffer.byteLength % HASH_BYTES !== 0) {
            throw new Error(`Invalid hash file size ${buffer.byteLength}; expected a multiple of ${HASH_BYTES}.`);
        }
        this.count = buffer.byteLength / HASH_BYTES;
    }
    has(hash) {
        let low = 0;
        let high = this.count - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const value = this.buffer.readBigUInt64LE(mid * HASH_BYTES);
            if (value === hash) {
                return true;
            }
            if (value < hash) {
                low = mid + 1;
            }
            else {
                high = mid - 1;
            }
        }
        return false;
    }
    indexOf(hash) {
        let low = 0;
        let high = this.count - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const value = this.buffer.readBigUInt64LE(mid * HASH_BYTES);
            if (value === hash) {
                return mid;
            }
            if (value < hash) {
                low = mid + 1;
            }
            else {
                high = mid - 1;
            }
        }
        return -1;
    }
}
export class CountFile {
    buffer;
    count;
    constructor(buffer) {
        this.buffer = buffer;
        if (buffer.byteLength % COUNT_BYTES !== 0) {
            throw new Error(`Invalid count file size ${buffer.byteLength}; expected a multiple of ${COUNT_BYTES}.`);
        }
        this.count = buffer.byteLength / COUNT_BYTES;
    }
    get(index) {
        if (index < 0 || index >= this.count) {
            return 0;
        }
        return this.buffer.readUInt32LE(index * COUNT_BYTES);
    }
}
export function hashVocabularyText(value) {
    return fnv1a64(value);
}
export function hashTokenSequence(tokens) {
    return hashVocabularyText(tokens.join('\u001f'));
}
export function sortedHashBuffer(values) {
    const sorted = Array.from(new Set(values)).sort(compareBigInt);
    const buffer = Buffer.allocUnsafe(sorted.length * HASH_BYTES);
    sorted.forEach((value, index) => {
        buffer.writeBigUInt64LE(value, index * HASH_BYTES);
    });
    return buffer;
}
export function sortedAnchorBuffers(anchorCounts) {
    const sorted = Array.from(anchorCounts.entries()).sort(([left], [right]) => compareBigInt(left, right));
    const hashes = Buffer.allocUnsafe(sorted.length * HASH_BYTES);
    const counts = Buffer.allocUnsafe(sorted.length * COUNT_BYTES);
    sorted.forEach(([hash, count], index) => {
        hashes.writeBigUInt64LE(hash, index * HASH_BYTES);
        counts.writeUInt32LE(Math.min(count, 0xffffffff), index * COUNT_BYTES);
    });
    return {
        hashes,
        counts,
        count: sorted.length
    };
}
async function loadArtifact(manifestPath, sourceName) {
    try {
        await access(manifestPath);
    }
    catch {
        return null;
    }
    const rawManifest = await readFile(manifestPath, 'utf8');
    const manifest = validateManifest(JSON.parse(rawManifest), manifestPath);
    if (manifest.sourceName !== sourceName) {
        return null;
    }
    const baseDir = path.dirname(manifestPath);
    const tokenHashes = await loadHashFile(path.resolve(baseDir, manifest.tokensPath), manifest.tokenCount);
    const anchorHashes = await loadHashFile(path.resolve(baseDir, manifest.anchorsPath), manifest.anchorCount);
    const anchorCounts = await loadCountFile(path.resolve(baseDir, manifest.anchorCountsPath), manifest.anchorCount);
    const phraseHashesByTokenCount = new Map();
    for (const phraseFile of manifest.phraseFiles) {
        phraseHashesByTokenCount.set(phraseFile.tokenCount, await loadHashFile(path.resolve(baseDir, phraseFile.path), phraseFile.count));
    }
    return {
        manifestPath,
        artifact: {
            ...manifest,
            tokenHashes,
            phraseHashesByTokenCount,
            anchorHashes,
            anchorCounts
        }
    };
}
async function loadHashFile(filePath, expectedCount) {
    const hashFile = new SortedHashFile(await readFile(filePath));
    if (hashFile.count !== expectedCount) {
        throw new Error(`Hash file count mismatch at ${filePath}: manifest=${expectedCount}, records=${hashFile.count}.`);
    }
    return hashFile;
}
async function loadCountFile(filePath, expectedCount) {
    const countFile = new CountFile(await readFile(filePath));
    if (countFile.count !== expectedCount) {
        throw new Error(`Count file count mismatch at ${filePath}: manifest=${expectedCount}, records=${countFile.count}.`);
    }
    return countFile;
}
function validateManifest(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation signal vocabulary manifest at ${manifestPath} must be a JSON object.`);
    }
    const manifest = value;
    if (manifest.schemaVersion !== 1 ||
        manifest.hashAlgorithm !== 'fnv1a64' ||
        typeof manifest.sourceName !== 'string' ||
        typeof manifest.generatedAt !== 'string' ||
        !isPositiveInteger(manifest.maxPhraseTokenCount) ||
        !isNonNegativeInteger(manifest.tokenCount) ||
        !isNonNegativeInteger(manifest.anchorCount) ||
        typeof manifest.tokensPath !== 'string' ||
        typeof manifest.anchorsPath !== 'string' ||
        typeof manifest.anchorCountsPath !== 'string' ||
        !Array.isArray(manifest.phraseFiles) ||
        !manifest.phraseFiles.every(isPhraseHashFileManifest)) {
        throw new Error(`Invalid occupation signal vocabulary manifest metadata at ${manifestPath}.`);
    }
    return manifest;
}
function isPhraseHashFileManifest(value) {
    if (!isRecord(value)) {
        return false;
    }
    return isPositiveInteger(value.tokenCount) &&
        isNonNegativeInteger(value.count) &&
        typeof value.path === 'string';
}
function fnv1a64(value) {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash;
}
