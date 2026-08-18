import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { compareBigInt } from '../utils/operators.js';
import { isNonNegativeInteger, isPositiveInteger, isRecord, safeFileSegment } from '../utils/validation.js';
import {
  configuredRuntimeArtifactCacheSize,
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../utils/runtime-artifact-cache.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';

export type PhraseHashFileManifest = {
  tokenCount: number;
  count: number;
  path: string;
};

export type VocabularyLocaleCode = 'en' | 'ro' | 'hu' | 'et';

export const VOCABULARY_LOCALES: readonly VocabularyLocaleCode[] = ['en', 'ro', 'hu', 'et'];

export type OccupationSignalVocabularyManifest = {
  schemaVersion: 3;
  sourceName: string;
  generatedAt: string;
  hashAlgorithm: 'fnv1a64';
  maxPhraseTokenCount: number;
  tokenCount: number;
  anchorCount: number;
  locales: VocabularyLocaleCode[];
  tokensPath: string;
  localeMaskPath: string;
  anchorsPath: string;
  anchorCountsPath: string;
  phraseFiles: PhraseHashFileManifest[];
};

export type OccupationSignalVocabularyArtifact = OccupationSignalVocabularyManifest & {
  tokenHashes: SortedHashFile;
  localeMask: LocaleMaskFile;
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
  localeMaskByHash: Map<bigint, number>;
  phraseHashesByTokenCount: Map<number, Set<bigint>>;
  anchorCounts: Map<bigint, number>;
};

const ARTIFACT_CACHE = new Map<string, RuntimeArtifactCacheEntry<ArtifactCacheEntry>>();
const DEFAULT_SIGNAL_VOCABULARY_CACHE_SIZE = 2;
const HASH_BYTES = 8;
const COUNT_BYTES = 4;

export function defaultOccupationSignalVocabularyManifestPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.manifest.json`);
}

export function defaultOccupationSignalVocabularyTokensPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.tokens.u64`);
}

export function defaultOccupationSignalVocabularyLocaleMaskPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.locale-mask.u8`);
}

export function defaultOccupationSignalVocabularyAnchorsPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.anchors.u64`);
}

export function defaultOccupationSignalVocabularyAnchorCountsPath(sourceName: string): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.anchor-counts.u32`);
}

export function defaultOccupationSignalVocabularyPhrasesPath(sourceName: string, tokenCount: number): string {
  return path.join(getDefaultRuntimeDir(), `occupation-signal-vocabulary.${safeFileSegment(sourceName)}.phrases-${tokenCount}.u64`);
}

export async function loadOccupationSignalVocabularyArtifactIfAvailable(sourceName: string): Promise<ArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationSignalVocabularyManifestPath(sourceName);
  const cacheKey = path.resolve(manifestPath);
  return getCachedRuntimeArtifact(ARTIFACT_CACHE, cacheKey, cacheKey, {
    maxSize: configuredRuntimeArtifactCacheSize('OSE_SIGNAL_VOCABULARY_CACHE_SIZE', DEFAULT_SIGNAL_VOCABULARY_CACHE_SIZE),
    load: () => loadArtifact(cacheKey, sourceName)
  });
}

export async function loadOccupationSignalVocabularyArtifactRequired(sourceName: string): Promise<ArtifactCacheEntry> {
  const manifestPath =
    readOptionalEnv('OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH') ?? defaultOccupationSignalVocabularyManifestPath(sourceName);
  const artifactEntry = await loadOccupationSignalVocabularyArtifactIfAvailable(sourceName);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation signal vocabulary artifact for source="${sourceName}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Run `npm run query:signals:export-vocab` after exporting search-meta, or set OCCUPATION_SIGNAL_VOCABULARY_ARTIFACT_PATH.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

export class SortedHashFile {
  public readonly count: number;

  public constructor(private readonly buffer: Buffer) {
    if (buffer.byteLength % HASH_BYTES !== 0) {
      throw new Error(`Invalid hash file size ${buffer.byteLength}; expected a multiple of ${HASH_BYTES}.`);
    }

    this.count = buffer.byteLength / HASH_BYTES;
  }

  public has(hash: bigint): boolean {
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
      } else {
        high = mid - 1;
      }
    }

    return false;
  }

  public indexOf(hash: bigint): number {
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
      } else {
        high = mid - 1;
      }
    }

    return -1;
  }
}

export class CountFile {
  public readonly count: number;

  public constructor(private readonly buffer: Buffer) {
    if (buffer.byteLength % COUNT_BYTES !== 0) {
      throw new Error(`Invalid count file size ${buffer.byteLength}; expected a multiple of ${COUNT_BYTES}.`);
    }

    this.count = buffer.byteLength / COUNT_BYTES;
  }

  public get(index: number): number {
    if (index < 0 || index >= this.count) {
      return 0;
    }

    return this.buffer.readUInt32LE(index * COUNT_BYTES);
  }
}

export class LocaleMaskFile {
  public readonly count: number;

  public constructor(private readonly buffer: Buffer) {
    this.count = buffer.byteLength;
  }

  public has(tokenIndex: number, localeBit: number): boolean {
    if (tokenIndex < 0 || tokenIndex >= this.count) {
      return false;
    }

    const byte = this.buffer[tokenIndex] ?? 0;
    return (byte & (1 << localeBit)) !== 0;
  }
}

export function localeBitOrdinal(locales: readonly VocabularyLocaleCode[], locale: VocabularyLocaleCode): number {
  return locales.indexOf(locale);
}

export function buildLocaleMaskBuffer(
  sortedValues: readonly bigint[],
  locales: readonly VocabularyLocaleCode[],
  localeMaskByHash: Map<bigint, number>
): Buffer {
  const buffer = Buffer.alloc(sortedValues.length);

  for (let index = 0; index < sortedValues.length; index += 1) {
    const hash = sortedValues[index];

    if (hash !== undefined) {
      buffer[index] = localeMaskByHash.get(hash) ?? 0;
    }
  }

  return buffer;
}

export function hashVocabularyText(value: string): bigint {
  return fnv1a64(value);
}

export function hashTokenSequence(tokens: string[]): bigint {
  return hashVocabularyText(tokens.join('\u001f'));
}

export function sortedHashBuffer(values: Iterable<bigint>): Buffer {
  const sorted = sortedHashValues(values);
  return sortedHashBufferFromSortedValues(sorted);
}

export function sortedHashValues(values: Iterable<bigint>): bigint[] {
  return Array.from(new Set(values)).sort(compareBigInt);
}

export function sortedHashBufferFromSortedValues(sortedValues: readonly bigint[]): Buffer {
  const buffer = Buffer.allocUnsafe(sortedValues.length * HASH_BYTES);

  sortedValues.forEach((value, index) => {
    buffer.writeBigUInt64LE(value, index * HASH_BYTES);
  });

  return buffer;
}

export function sortedAnchorBuffers(anchorCounts: Map<bigint, number>): { hashes: Buffer; counts: Buffer; count: number } {
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

async function loadArtifact(manifestPath: string, sourceName: string): Promise<ArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = validateManifest(JSON.parse(rawManifest) as unknown, manifestPath);

  if (manifest.sourceName !== sourceName) {
    return null;
  }

  const baseDir = path.dirname(manifestPath);
  const tokenHashes = await loadHashFile(path.resolve(baseDir, manifest.tokensPath), manifest.tokenCount);
  const localeMask = await loadLocaleMaskFile(path.resolve(baseDir, manifest.localeMaskPath), manifest.tokenCount);
  const anchorHashes = await loadHashFile(path.resolve(baseDir, manifest.anchorsPath), manifest.anchorCount);
  const anchorCounts = await loadCountFile(path.resolve(baseDir, manifest.anchorCountsPath), manifest.anchorCount);
  const phraseHashesByTokenCount = new Map<number, SortedHashFile>();

  for (const phraseFile of manifest.phraseFiles) {
    phraseHashesByTokenCount.set(phraseFile.tokenCount, await loadHashFile(path.resolve(baseDir, phraseFile.path), phraseFile.count));
  }

  return {
    manifestPath,
    artifact: {
      ...manifest,
      tokenHashes,
      localeMask,
      phraseHashesByTokenCount,
      anchorHashes,
      anchorCounts
    }
  };
}

async function loadHashFile(filePath: string, expectedCount: number): Promise<SortedHashFile> {
  const hashFile = new SortedHashFile(await readFile(filePath));

  if (hashFile.count !== expectedCount) {
    throw new Error(`Hash file count mismatch at ${filePath}: manifest=${expectedCount}, records=${hashFile.count}.`);
  }

  return hashFile;
}

async function loadCountFile(filePath: string, expectedCount: number): Promise<CountFile> {
  const countFile = new CountFile(await readFile(filePath));

  if (countFile.count !== expectedCount) {
    throw new Error(`Count file count mismatch at ${filePath}: manifest=${expectedCount}, records=${countFile.count}.`);
  }

  return countFile;
}

async function loadLocaleMaskFile(filePath: string, expectedCount: number): Promise<LocaleMaskFile> {
  const localeMaskFile = new LocaleMaskFile(await readFile(filePath));

  if (localeMaskFile.count !== expectedCount) {
    throw new Error(`Locale mask file count mismatch at ${filePath}: manifest=${expectedCount}, records=${localeMaskFile.count}.`);
  }

  return localeMaskFile;
}

function validateManifest(value: unknown, manifestPath: string): OccupationSignalVocabularyManifest {
  if (!isRecord(value)) {
    throw new Error(`Occupation signal vocabulary manifest at ${manifestPath} must be a JSON object.`);
  }

  const manifest = value as Partial<OccupationSignalVocabularyManifest>;

  if (
    manifest.schemaVersion !== 3 ||
    manifest.hashAlgorithm !== 'fnv1a64' ||
    typeof manifest.sourceName !== 'string' ||
    typeof manifest.generatedAt !== 'string' ||
    !isPositiveInteger(manifest.maxPhraseTokenCount) ||
    !isNonNegativeInteger(manifest.tokenCount) ||
    !isNonNegativeInteger(manifest.anchorCount) ||
    !Array.isArray(manifest.locales) ||
    !manifest.locales.every((locale) => VOCABULARY_LOCALES.includes(locale as VocabularyLocaleCode)) ||
    typeof manifest.tokensPath !== 'string' ||
    typeof manifest.localeMaskPath !== 'string' ||
    typeof manifest.anchorsPath !== 'string' ||
    typeof manifest.anchorCountsPath !== 'string' ||
    !Array.isArray(manifest.phraseFiles) ||
    !manifest.phraseFiles.every(isPhraseHashFileManifest)
  ) {
    throw new Error(`Invalid occupation signal vocabulary manifest metadata at ${manifestPath}.`);
  }

  return manifest as OccupationSignalVocabularyManifest;
}

function isPhraseHashFileManifest(value: unknown): value is PhraseHashFileManifest {
  if (!isRecord(value)) {
    return false;
  }

  return isPositiveInteger(value.tokenCount) && isNonNegativeInteger(value.count) && typeof value.path === 'string';
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash;
}
