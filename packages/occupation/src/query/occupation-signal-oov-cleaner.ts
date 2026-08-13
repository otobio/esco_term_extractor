import { hashVocabularyText, loadOccupationSignalVocabularyArtifactRequired, type OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { expandTokenVariants, foldSearchText, normalizeQueryLocale, type SupportedQueryLocale } from './query-preparation.js';

type SignalVocabulary = {
  artifact: OccupationSignalVocabularyArtifact;
};

type VocabularyCacheEntry = {
  sourceName: string;
  vocabulary: SignalVocabulary;
};

type RawToken =
  | {
      kind: 'term';
      surface: string;
    }
  | {
      kind: 'separator';
      surface: string;
    };

type ResolvedToken = {
  surface: string;
  kept: boolean;
};

const VOCABULARY_CACHE = new Map<string, Promise<VocabularyCacheEntry>>();

export async function cleanOccupationTitleSignals(options: {
  sourceName: string;
  locale: string;
  title: string;
}): Promise<string> {
  const locale = normalizeQueryLocale(options.locale);
  const vocabulary = await loadSignalVocabulary(options.sourceName);
  const rawTokens = tokenizeRawOccupationSurface(options.title);
  const termTokens = rawTokens.filter((token): token is Extract<RawToken, { kind: 'term' }> => token.kind === 'term');
  const resolvedTokens = termTokens.map((token) => resolveKnownToken(token.surface, locale, vocabulary.artifact));
  return rebuildKeptSurface(rawTokens, resolvedTokens);
}

async function loadSignalVocabulary(sourceName: string): Promise<SignalVocabulary> {
  const cacheKey = sourceName;
  let cached = VOCABULARY_CACHE.get(cacheKey);

  if (!cached) {
    cached = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => ({
      sourceName,
      vocabulary: {
        artifact: entry.artifact
      }
    }));
    VOCABULARY_CACHE.set(cacheKey, cached);
  }

  return (await cached).vocabulary;
}

function resolveKnownToken(surface: string, locale: SupportedQueryLocale, artifact: OccupationSignalVocabularyArtifact): ResolvedToken {
  const folded = foldSearchText(surface);
  const foldedLower = folded.toLocaleLowerCase('en-US');
  const variants = uniqueVariants([folded, foldedLower, ...expandTokenVariants([foldedLower], locale)]);
  const matched =
    variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant))) ||
    matchHyphenSplitToken(surface, locale, artifact);

  return {
    surface,
    kept: matched
  };
}

function matchHyphenSplitToken(surface: string, locale: SupportedQueryLocale, artifact: OccupationSignalVocabularyArtifact): boolean {
  if (!surface.includes('-')) {
    return false;
  }

  const parts = surface
    .split('-')
    .map((part) => foldSearchText(part).toLocaleLowerCase('en-US'))
    .filter((part) => part.length > 0);

  if (parts.length < 2) {
    return false;
  }

  return parts.every((part) => {
    const variants = uniqueVariants([part, ...expandTokenVariants([part], locale)]);
    return variants.some((variant) => variant.length > 0 && artifact.tokenHashes.has(hashVocabularyText(variant)));
  });
}

function tokenizeRawOccupationSurface(value: string): RawToken[] {
  const tokens: RawToken[] = [];
  const matches = value.matchAll(/[\p{L}\p{N}]+(?:[-+][\p{L}\p{N}]+)*|\/+|\|+|[-–—]+/gu);

  for (const match of matches) {
    const surface = match[0]?.trim();

    if (!surface) {
      continue;
    }

    if (/^(?:\/+|\|+|[-–—]+)$/u.test(surface)) {
      tokens.push({ kind: 'separator', surface });
      continue;
    }

    tokens.push({ kind: 'term', surface });
  }

  return tokens;
}

function rebuildKeptSurface(rawTokens: RawToken[], resolvedTokens: ResolvedToken[]): string {
  const pieces: string[] = [];
  let termIndex = 0;

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];

    if (!token) {
      continue;
    }

    if (token.kind === 'separator') {
      const previousKept = findAdjacentKeptTerm(resolvedTokens, termIndex - 1, -1);
      const nextKept = findAdjacentKeptTerm(resolvedTokens, termIndex, 1);

      if (previousKept && nextKept && pieces[pieces.length - 1] !== token.surface) {
        pieces.push(token.surface);
      }

      continue;
    }

    const resolved = resolvedTokens[termIndex];
    termIndex += 1;

    if (!resolved?.kept) {
      continue;
    }

    pieces.push(resolved.surface);
  }

  return pieces
    .join(' ')
    .replace(/\s+(\/|\||-+|–+|—+)\s+/gu, ' $1 ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function findAdjacentKeptTerm(tokens: ResolvedToken[], startIndex: number, step: -1 | 1): boolean {
  for (let index = startIndex; index >= 0 && index < tokens.length; index += step) {
    const token = tokens[index];

    if (!token) {
      continue;
    }

    return token.kept;
  }

  return false;
}

function uniqueVariants(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}
