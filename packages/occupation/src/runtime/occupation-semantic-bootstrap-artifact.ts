import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import type { OccupationSemanticBootstrapThresholds } from '../query/occupation-semantic-bootstrap.js';
import { isRecord, safeFileSegment } from '../utils/validation.js';

export type OccupationSemanticBootstrapKind = 'role_head' | 'domain_modifier' | 'generic_noise' | 'role_phrase' | 'generic_phrase';

export type OccupationSemanticBootstrapTokenRule = {
  token: string;
  kind: OccupationSemanticBootstrapKind;
  occupationSignal: number;
  penaltySignal: number;
  note: string;
};

export type OccupationSemanticBootstrapPhraseRule = {
  phrase: string;
  kind: OccupationSemanticBootstrapKind;
  occupationSignal: number;
  penaltySignal: number;
  note: string;
};

export type OccupationSemanticBootstrapArtifact = {
  schemaVersion: 1;
  locale: string;
  headRule: string;
  thresholds: OccupationSemanticBootstrapThresholds;
  tokenRules: OccupationSemanticBootstrapTokenRule[];
  phraseRules: OccupationSemanticBootstrapPhraseRule[];
};

export type OccupationSemanticBootstrapArtifactCacheEntry = {
  manifestPath: string;
  artifact: OccupationSemanticBootstrapArtifact;
};

const CACHE = new Map<string, OccupationSemanticBootstrapArtifactCacheEntry>();
const DEFAULT_CACHE_SIZE = 4;

export function defaultOccupationSemanticBootstrapManifestPath(locale: string): string {
  return path.join(process.cwd(), 'data', 'taxonomy-review', `semantic-bootstrap.${safeFileSegment(locale)}.json`);
}

export async function loadOccupationSemanticBootstrapArtifactIfAvailable(
  locale: string
): Promise<OccupationSemanticBootstrapArtifactCacheEntry | null> {
  const configuredPath = readOptionalEnv('OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH');
  const manifestPath = configuredPath ?? defaultOccupationSemanticBootstrapManifestPath(locale);
  const cacheKey = path.resolve(manifestPath);
  const cached = CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

  const loaded = await loadArtifact(cacheKey, locale);

  if (loaded) {
    trimCache(CACHE, DEFAULT_CACHE_SIZE);
    CACHE.set(cacheKey, loaded);
  }

  return loaded;
}

export async function loadOccupationSemanticBootstrapArtifactRequired(
  locale: string
): Promise<OccupationSemanticBootstrapArtifactCacheEntry> {
  const manifestPath =
    readOptionalEnv('OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH') ?? defaultOccupationSemanticBootstrapManifestPath(locale);
  const artifactEntry = await loadOccupationSemanticBootstrapArtifactIfAvailable(locale);

  if (!artifactEntry) {
    throw new Error(
      [
        `Missing required occupation semantic bootstrap artifact for locale="${locale}".`,
        `Expected JSON: ${path.resolve(manifestPath)}`,
        'Run `npm run semantic:bootstrap:build` or set OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH.'
      ].join(' ')
    );
  }

  return artifactEntry;
}

async function loadArtifact(manifestPath: string, locale: string): Promise<OccupationSemanticBootstrapArtifactCacheEntry | null> {
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  const raw = await readFile(manifestPath, 'utf8');
  const artifact = validateArtifact(JSON.parse(raw) as unknown, manifestPath);

  if (artifact.locale !== locale) {
    return null;
  }

  return { manifestPath, artifact };
}

function validateArtifact(value: unknown, manifestPath: string): OccupationSemanticBootstrapArtifact {
  if (!isRecord(value)) {
    throw new Error(`Occupation semantic bootstrap JSON at ${manifestPath} must be a JSON object.`);
  }

  const artifact = value as Partial<OccupationSemanticBootstrapArtifact>;

  if (
    artifact.schemaVersion !== 1 ||
    typeof artifact.locale !== 'string' ||
    typeof artifact.headRule !== 'string' ||
    !isRecord(artifact.thresholds) ||
    !Array.isArray(artifact.tokenRules) ||
    !Array.isArray(artifact.phraseRules)
  ) {
    throw new Error(`Invalid occupation semantic bootstrap metadata at ${manifestPath}.`);
  }

  if (!isThresholds(artifact.thresholds)) {
    throw new Error(`Invalid occupation semantic bootstrap thresholds at ${manifestPath}.`);
  }

  for (const [index, rule] of artifact.tokenRules.entries()) {
    validateTokenRule(rule, manifestPath, index);
  }

  for (const [index, rule] of artifact.phraseRules.entries()) {
    validatePhraseRule(rule, manifestPath, index);
  }

  return artifact as OccupationSemanticBootstrapArtifact;
}

function validateTokenRule(value: unknown, manifestPath: string, index: number): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid token rule at ${manifestPath}#tokenRules[${index}].`);
  }

  const rule = value as Partial<OccupationSemanticBootstrapTokenRule>;

  if (
    typeof rule.token !== 'string' ||
    typeof rule.kind !== 'string' ||
    typeof rule.occupationSignal !== 'number' ||
    typeof rule.penaltySignal !== 'number' ||
    typeof rule.note !== 'string'
  ) {
    throw new Error(`Invalid token rule at ${manifestPath}#tokenRules[${index}].`);
  }
}

function validatePhraseRule(value: unknown, manifestPath: string, index: number): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid phrase rule at ${manifestPath}#phraseRules[${index}].`);
  }

  const rule = value as Partial<OccupationSemanticBootstrapPhraseRule>;

  if (
    typeof rule.phrase !== 'string' ||
    typeof rule.kind !== 'string' ||
    typeof rule.occupationSignal !== 'number' ||
    typeof rule.penaltySignal !== 'number' ||
    typeof rule.note !== 'string'
  ) {
    throw new Error(`Invalid phrase rule at ${manifestPath}#phraseRules[${index}].`);
  }
}

function isThresholds(value: unknown): value is OccupationSemanticBootstrapThresholds {
  if (!isRecord(value)) {
    return false;
  }

  return [
    value.tokenHelpMinOccupationSignal,
    value.tokenHelpMaxPenaltySignal,
    value.tokenHurtMinPenaltySignal,
    value.tokenHurtMaxOccupationSignal,
    value.tokenNeutralNetBand,
    value.phraseHelpMinOccupationSignal,
    value.phraseHelpMaxPenaltySignal,
    value.phraseHurtMinPenaltySignal,
    value.phraseHurtMaxOccupationSignal,
    value.phraseNeutralNetBand
  ].every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);
}

function trimCache<T>(cache: Map<string, T>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value as string | undefined;

    if (oldestKey === undefined) {
      return;
    }

    cache.delete(oldestKey);
  }
}
