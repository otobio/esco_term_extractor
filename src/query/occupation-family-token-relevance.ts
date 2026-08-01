import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { DEFAULT_RUNTIME_DIR } from '../runtime/runtime-dir.js';
import { isRecord, isStringArray, safeFileSegment } from '../utils/validation.js';

export type OccupationFamilyTokenStats = {
  occurrences: number;
  tfRatio: number;
  documentFrequency: number;
  relevance: number;
};

export type OccupationFamilyTokenRelevanceFamily = {
  familyNodeId: number;
  familyLabel: string;
  leafCount: number;
  totalTokenOccurrences: number;
  tokens: Record<string, OccupationFamilyTokenStats>;
};

export type OccupationFamilyTokenGenericity = {
  documentFrequency: number;
  maxRelevance: number;
  maxRelevanceFamilyNodeId: number;
};

export type OccupationFamilyTokenRelevanceArtifact = {
  schemaVersion: 1;
  sourceName: string;
  generatedAt: string;
  totalFamilies: number;
  locales: string[];
  lowConfidenceLocales: string[];
  familiesByLocale: Record<string, OccupationFamilyTokenRelevanceFamily[]>;
  genericityByLocale: Record<string, Record<string, OccupationFamilyTokenGenericity>>;
};

export type OccupationFamilyTokenRelevanceArtifactEntry = {
  artifactPath: string;
  artifact: OccupationFamilyTokenRelevanceArtifact;
};

const FAMILY_TOKEN_RELEVANCE_ENV = 'OCCUPATION_FAMILY_TOKEN_RELEVANCE_ARTIFACT_PATH';

export function defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName: string): string {
  return path.join(DEFAULT_RUNTIME_DIR, `occupation-family-token-relevance.${safeFileSegment(sourceName)}.json`);
}

export function loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName: string): OccupationFamilyTokenRelevanceArtifactEntry {
  const artifactPath = readOptionalEnv(FAMILY_TOKEN_RELEVANCE_ENV) ?? defaultOccupationFamilyTokenRelevanceArtifactPath(sourceName);

  return {
    artifactPath,
    artifact: parseOccupationFamilyTokenRelevanceArtifact(readFileSync(artifactPath, 'utf8'), artifactPath)
  };
}

export function parseOccupationFamilyTokenRelevanceArtifact(contents: string, artifactPath: string): OccupationFamilyTokenRelevanceArtifact {
  const parsed: unknown = JSON.parse(contents);

  if (!isOccupationFamilyTokenRelevanceArtifact(parsed)) {
    throw new Error(`Invalid occupation family-token relevance artifact: ${artifactPath}`);
  }

  return parsed;
}

function isOccupationFamilyTokenRelevanceArtifact(value: unknown): value is OccupationFamilyTokenRelevanceArtifact {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.sourceName === 'string' &&
    typeof value.generatedAt === 'string' &&
    typeof value.totalFamilies === 'number' &&
    isStringArray(value.locales) &&
    isStringArray(value.lowConfidenceLocales) &&
    isRecord(value.familiesByLocale) &&
    Object.values(value.familiesByLocale).every((families) => Array.isArray(families) && families.every(isFamilyEntry)) &&
    isRecord(value.genericityByLocale) &&
    Object.values(value.genericityByLocale).every(
      (byToken) => isRecord(byToken) && Object.values(byToken).every(isGenericityEntry)
    )
  );
}

function isFamilyEntry(value: unknown): value is OccupationFamilyTokenRelevanceFamily {
  return (
    isRecord(value) &&
    typeof value.familyNodeId === 'number' &&
    typeof value.familyLabel === 'string' &&
    typeof value.leafCount === 'number' &&
    typeof value.totalTokenOccurrences === 'number' &&
    isRecord(value.tokens) &&
    Object.values(value.tokens).every(isTokenStats)
  );
}

function isTokenStats(value: unknown): value is OccupationFamilyTokenStats {
  return (
    isRecord(value) &&
    typeof value.occurrences === 'number' &&
    typeof value.tfRatio === 'number' &&
    typeof value.documentFrequency === 'number' &&
    typeof value.relevance === 'number'
  );
}

function isGenericityEntry(value: unknown): value is OccupationFamilyTokenGenericity {
  return (
    isRecord(value) &&
    typeof value.documentFrequency === 'number' &&
    typeof value.maxRelevance === 'number' &&
    typeof value.maxRelevanceFamilyNodeId === 'number'
  );
}

export type OccupationFamilyTokenRelevanceLookup = {
  familyTokensByLocale: Map<string, Map<number, Map<string, number>>>;
  genericityByLocale: Map<string, Map<string, number>>;
};

const RELEVANCE_LOOKUP_CACHE = new Map<string, OccupationFamilyTokenRelevanceLookup | null>();

// The artifact is a first-cut, experimental signal (not part of runtime:artifacts-build), so a
// missing file must degrade to "no discount" rather than take down retrieval.
export function tryLoadOccupationFamilyTokenRelevanceLookup(sourceName: string): OccupationFamilyTokenRelevanceLookup | null {
  const cached = RELEVANCE_LOOKUP_CACHE.get(sourceName);

  if (cached !== undefined) {
    return cached;
  }

  let lookup: OccupationFamilyTokenRelevanceLookup | null = null;

  try {
    lookup = buildOccupationFamilyTokenRelevanceLookup(loadOccupationFamilyTokenRelevanceArtifactRequired(sourceName).artifact);
  } catch {
    lookup = null;
  }

  RELEVANCE_LOOKUP_CACHE.set(sourceName, lookup);

  return lookup;
}

function buildOccupationFamilyTokenRelevanceLookup(artifact: OccupationFamilyTokenRelevanceArtifact): OccupationFamilyTokenRelevanceLookup {
  const familyTokensByLocale = new Map<string, Map<number, Map<string, number>>>();

  for (const [locale, families] of Object.entries(artifact.familiesByLocale)) {
    const familyMap = new Map<number, Map<string, number>>();

    for (const family of families) {
      const tokenMap = new Map<string, number>();

      for (const [token, stats] of Object.entries(family.tokens)) {
        tokenMap.set(token, stats.relevance);
      }

      familyMap.set(family.familyNodeId, tokenMap);
    }

    familyTokensByLocale.set(locale, familyMap);
  }

  const genericityByLocale = new Map<string, Map<string, number>>();

  for (const [locale, genericity] of Object.entries(artifact.genericityByLocale)) {
    const tokenMap = new Map<string, number>();

    for (const [token, entry] of Object.entries(genericity)) {
      tokenMap.set(token, entry.maxRelevance);
    }

    genericityByLocale.set(locale, tokenMap);
  }

  return { familyTokensByLocale, genericityByLocale };
}

// Discounts alias-match evidence for a family by how characteristic the matched tokens actually
// are of that family, relative to the single most-concentrated family for each token (mean across
// matched tokens). Returns 1 (no-op) when there's no lookup, no family, no matched tokens, or no
// genericity data at all for a token (nothing to discount against).
export function familyTokenRelevanceMultiplier(
  lookup: OccupationFamilyTokenRelevanceLookup | null,
  locale: string,
  familyNodeId: number | null,
  matchedTokens: string[]
): number {
  if (!lookup || familyNodeId === null || matchedTokens.length === 0) {
    return 1;
  }

  const familyTokens = lookup.familyTokensByLocale.get(locale)?.get(familyNodeId);
  const genericity = lookup.genericityByLocale.get(locale);

  if (!genericity) {
    return 1;
  }

  let total = 0;

  for (const token of matchedTokens) {
    const maxRelevance = genericity.get(token) ?? 0;

    if (maxRelevance <= 0) {
      total += 1;
      continue;
    }

    total += (familyTokens?.get(token) ?? 0) / maxRelevance;
  }

  return total / matchedTokens.length;
}
