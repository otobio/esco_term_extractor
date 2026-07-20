import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { roundScore } from '../utils/operators.js';
import {
  isRecord,
  safeFileSegment
} from '../utils/validation.js';

export type OccupationVectorRecord = {
  index: number;
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number;
  familyLabel: string;
  vectorNorm: number | null;
};

export type OccupationVectorArtifactManifest = {
  schemaVersion: 1;
  sourceName: string;
  modelKey: string;
  provider: string;
  dimensions: number;
  textRole: 'dense_text';
  localeCode: null;
  generatedAt: string;
  count: number;
  metadataPath: string;
  vectorsPath: string;
  vectorDataType: 'float32_le';
};

export type OccupationVectorArtifact = OccupationVectorArtifactManifest & {
  vectors: OccupationVectorRecord[];
  vectorValues: Float32Array;
};

export type OccupationVectorScore = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number;
  familyLabel: string;
  score: number;
  dot: number;
};

type ArtifactCacheEntry = {
  manifestPath: string;
  metadataPath: string;
  vectorsPath: string;
  artifact: OccupationVectorArtifact;
  vectorsByFamilyNodeId: Map<number, OccupationVectorRecord[]>;
};

const ARTIFACT_CACHE = new Map<string, Promise<ArtifactCacheEntry | null>>();
import { DEFAULT_RUNTIME_DIR as DEFAULT_RUNTIME_VECTOR_DIR } from './runtime-dir.js';

export function defaultOccupationVectorManifestPath(sourceName: string, modelKey: string): string {
  return path.join(DEFAULT_RUNTIME_VECTOR_DIR, `occupation-vectors.${safeFileSegment(sourceName)}.${safeFileSegment(modelKey)}.manifest.json`);
}

export function defaultOccupationVectorMetadataPath(sourceName: string, modelKey: string): string {
  return path.join(DEFAULT_RUNTIME_VECTOR_DIR, `occupation-vectors.${safeFileSegment(sourceName)}.${safeFileSegment(modelKey)}.metadata.jsonl`);
}

export function defaultOccupationVectorValuesPath(sourceName: string, modelKey: string): string {
  return path.join(DEFAULT_RUNTIME_VECTOR_DIR, `occupation-vectors.${safeFileSegment(sourceName)}.${safeFileSegment(modelKey)}.vectors.f32`);
}

export async function loadOccupationVectorArtifactIfAvailable(
  sourceName: string,
  modelKey: string
): Promise<ArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_VECTOR_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationVectorManifestPath(sourceName, modelKey);
  const cacheKey = path.resolve(manifestPath);
  let cached = ARTIFACT_CACHE.get(cacheKey);

  if (!cached) {
    cached = loadArtifact(cacheKey, sourceName, modelKey);
    ARTIFACT_CACHE.set(cacheKey, cached);
  }

  return cached;
}

export async function loadOccupationVectorArtifactRequired(
  sourceName: string,
  modelKey: string
): Promise<ArtifactCacheEntry> {
  const manifestPath = readOptionalEnv('OCCUPATION_VECTOR_ARTIFACT_PATH') ??
    defaultOccupationVectorManifestPath(sourceName, modelKey);
  const artifactEntry = await loadOccupationVectorArtifactIfAvailable(sourceName, modelKey);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation vector artifact for source="${sourceName}" model="${modelKey}".`,
        `Expected manifest: ${path.resolve(manifestPath)}`,
        'Dense vector artifacts are not part of the default runtime package. Set OCCUPATION_VECTOR_ARTIFACT_PATH if you intentionally maintain this optional artifact.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

export function scoreOccupationVectorArtifact(
  artifact: OccupationVectorArtifact,
  queryVector: number[],
  queryVectorNorm: number,
  options: {
    limit: number;
    familyNodeIds?: number[];
  }
): OccupationVectorScore[] {
  const familyFilter = options.familyNodeIds ? new Set(options.familyNodeIds) : null;
  const scored: OccupationVectorScore[] = [];

  for (const record of artifact.vectors) {
    if (familyFilter && !familyFilter.has(record.familyNodeId)) {
      continue;
    }

    const vectorNorm = record.vectorNorm ?? undefined;
    const cosine = computeCosineSimilarityForRecord(
      artifact.vectorValues,
      record.index,
      artifact.dimensions,
      queryVector,
      queryVectorNorm,
      vectorNorm
    );

    if (cosine <= 0) {
      continue;
    }

    scored.push({
      graphNodeId: record.graphNodeId,
      canonicalLabel: record.canonicalLabel,
      familyNodeId: record.familyNodeId,
      familyLabel: record.familyLabel,
      score: roundScore(cosine),
      dot: roundScore(cosine * queryVectorNorm * (vectorNorm ?? 1))
    });
  }

  return scored
    .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
    .slice(0, options.limit);
}

export function scoreOccupationVectorRecords(
  records: OccupationVectorRecord[],
  vectorValues: Float32Array,
  dimensions: number,
  queryVector: number[],
  queryVectorNorm: number,
  options: {
    limit: number;
  }
): OccupationVectorScore[] {
  const scored: OccupationVectorScore[] = [];

  for (const record of records) {
    const vectorNorm = record.vectorNorm ?? undefined;
    const cosine = computeCosineSimilarityForRecord(
      vectorValues,
      record.index,
      dimensions,
      queryVector,
      queryVectorNorm,
      vectorNorm
    );

    if (cosine <= 0) {
      continue;
    }

    scored.push({
      graphNodeId: record.graphNodeId,
      canonicalLabel: record.canonicalLabel,
      familyNodeId: record.familyNodeId,
      familyLabel: record.familyLabel,
      score: roundScore(cosine),
      dot: roundScore(cosine * queryVectorNorm * (vectorNorm ?? 1))
    });
  }

  return scored
    .sort((left, right) => right.score - left.score || left.canonicalLabel.localeCompare(right.canonicalLabel))
    .slice(0, options.limit);
}

async function loadArtifact(manifestPath: string, sourceName: string, modelKey: string): Promise<ArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = validateManifest(JSON.parse(rawManifest) as unknown, manifestPath);

  if (manifest.sourceName !== sourceName || manifest.modelKey !== modelKey) {
    return null;
  }

  const metadataPath = path.resolve(path.dirname(manifestPath), manifest.metadataPath);
  const vectorsPath = path.resolve(path.dirname(manifestPath), manifest.vectorsPath);
  const records = await loadVectorMetadataRecords(metadataPath);
  const vectorValues = await loadVectorValues(vectorsPath, manifest.count, manifest.dimensions);

  if (records.length !== manifest.count) {
    throw new Error(`Occupation vector artifact count mismatch: manifest=${manifest.count}, records=${records.length}.`);
  }

  return {
    manifestPath,
    metadataPath,
    vectorsPath,
    artifact: {
      ...manifest,
      vectors: records,
      vectorValues
    },
    vectorsByFamilyNodeId: buildVectorsByFamilyNodeId(records)
  };
}

function buildVectorsByFamilyNodeId(records: OccupationVectorRecord[]): Map<number, OccupationVectorRecord[]> {
  const vectorsByFamilyId = new Map<number, OccupationVectorRecord[]>();

  for (const record of records) {
    const familyRecords = vectorsByFamilyId.get(record.familyNodeId) ?? [];
    familyRecords.push(record);
    vectorsByFamilyId.set(record.familyNodeId, familyRecords);
  }

  return vectorsByFamilyId;
}

async function loadVectorMetadataRecords(metadataPath: string): Promise<OccupationVectorRecord[]> {
  const raw = await readFile(metadataPath, 'utf8');
  const records: OccupationVectorRecord[] = [];
  const lines = raw.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    records.push(validateVectorMetadataRecord(JSON.parse(line) as unknown, metadataPath, index + 1, records.length));
  }

  return records;
}

async function loadVectorValues(vectorsPath: string, count: number, dimensions: number): Promise<Float32Array> {
  const buffer = await readFile(vectorsPath);
  const expectedByteLength = count * dimensions * Float32Array.BYTES_PER_ELEMENT;

  if (buffer.byteLength !== expectedByteLength) {
    throw new Error(`Occupation vector binary size mismatch at ${vectorsPath}: expected=${expectedByteLength}, actual=${buffer.byteLength}.`);
  }

  if (buffer.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, count * dimensions);
  }

  const copiedBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(copiedBuffer);
}

function validateManifest(value: unknown, manifestPath: string): OccupationVectorArtifactManifest {
  if (!isRecord(value)) {
    throw new Error(`Occupation vector manifest at ${manifestPath} must be a JSON object.`);
  }

  const schemaVersion = value.schemaVersion;
  const sourceName = value.sourceName;
  const modelKey = value.modelKey;
  const provider = value.provider;
  const dimensions = value.dimensions;
  const textRole = value.textRole;
  const localeCode = value.localeCode;
  const generatedAt = value.generatedAt;
  const count = value.count;
  const metadataPath = value.metadataPath;
  const vectorsPath = value.vectorsPath;
  const vectorDataType = value.vectorDataType;

  if (
    schemaVersion !== 1 ||
    typeof sourceName !== 'string' ||
    typeof modelKey !== 'string' ||
    typeof provider !== 'string' ||
    typeof dimensions !== 'number' ||
    !Number.isInteger(dimensions) ||
    dimensions <= 0 ||
    textRole !== 'dense_text' ||
    localeCode !== null ||
    typeof generatedAt !== 'string' ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    typeof metadataPath !== 'string' ||
    typeof vectorsPath !== 'string' ||
    vectorDataType !== 'float32_le'
  ) {
    throw new Error(`Invalid occupation vector manifest metadata at ${manifestPath}.`);
  }

  return {
    schemaVersion,
    sourceName,
    modelKey,
    provider,
    dimensions,
    textRole,
    localeCode,
    generatedAt,
    count,
    metadataPath,
    vectorsPath,
    vectorDataType
  };
}

function validateVectorMetadataRecord(value: unknown, metadataPath: string, lineNumber: number, index: number): OccupationVectorRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid vector metadata record at ${metadataPath}:${lineNumber}.`);
  }

  const graphNodeId = value.graphNodeId;
  const canonicalLabel = value.canonicalLabel;
  const familyNodeId = value.familyNodeId;
  const familyLabel = value.familyLabel;
  const vectorNorm = value.vectorNorm;

  if (
    typeof graphNodeId !== 'number' ||
    !Number.isInteger(graphNodeId) ||
    typeof canonicalLabel !== 'string' ||
    typeof familyNodeId !== 'number' ||
    !Number.isInteger(familyNodeId) ||
    typeof familyLabel !== 'string' ||
    !(vectorNorm === null || typeof vectorNorm === 'number')
  ) {
    throw new Error(`Invalid vector metadata record at ${metadataPath}:${lineNumber}.`);
  }

  return {
    index,
    graphNodeId,
    canonicalLabel,
    familyNodeId,
    familyLabel,
    vectorNorm
  };
}

function computeCosineSimilarityForRecord(
  vectorValues: Float32Array,
  recordIndex: number,
  dimensions: number,
  queryVector: number[],
  queryVectorNorm: number,
  vectorNorm: number | undefined
): number {
  if (queryVector.length !== dimensions || queryVectorNorm === 0) {
    return 0;
  }

  let dot = 0;
  let runtimeVectorMagnitudeSquared = 0;
  const offset = recordIndex * dimensions;

  for (let index = 0; index < dimensions; index += 1) {
    const value = vectorValues[offset + index] ?? 0;
    dot += queryVector[index] * value;

    if (vectorNorm === undefined) {
      runtimeVectorMagnitudeSquared += value * value;
    }
  }

  const runtimeVectorNorm = vectorNorm ?? Math.sqrt(runtimeVectorMagnitudeSquared);

  if (runtimeVectorNorm === 0) {
    return 0;
  }

  return dot / (queryVectorNorm * runtimeVectorNorm);
}
