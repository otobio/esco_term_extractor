import {
  hashVocabularyText,
  loadOccupationSignalVocabularyArtifactRequired,
  type OccupationSignalVocabularyArtifact
} from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from './texts.js';

const SIGNAL_VOCABULARY_ARTIFACT_CACHE = new Map<string, Promise<OccupationSignalVocabularyArtifact>>();

export const FUNCTION_WORDS_BY_LOCALE: Record<'en' | 'ro' | 'hu' | 'et' | 'unknown', Set<string>> = {
  en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'it', 'of', 'on', 'or', 'the', 'to', 'who', 'with']),
  ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'un', 'în', 'și']),
  hu: new Set(['a', 'az', 'egy', 'es', 'és', 'hogy', 'meg', 'vagy']),
  et: new Set(['ja', 'koos', 'ning', 'on', 'voi', 'või']),
  unknown: new Set()
};

async function loadSignalVocabularyArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact> {
  const cachedArtifact = SIGNAL_VOCABULARY_ARTIFACT_CACHE.get(sourceName);

  if (cachedArtifact) {
    return cachedArtifact;
  }

  const artifactPromise = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => entry.artifact);
  SIGNAL_VOCABULARY_ARTIFACT_CACHE.set(sourceName, artifactPromise);
  return artifactPromise;
}

export async function isEnglishWord(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length !== 1) {
    return false;
  }

  const token = tokens[0];

  if (!token) {
    return false;
  }

  const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));
  return tokenIndex >= 0 && (artifact.englishTokenBits.has(tokenIndex) || FUNCTION_WORDS_BY_LOCALE.en.has(token));
}

export async function isEnglishQuery(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length === 0) {
    return false;
  }

  for (const token of tokens) {
    const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));

    if (tokenIndex < 0 || !artifact.englishTokenBits.has(tokenIndex)) {
      if (FUNCTION_WORDS_BY_LOCALE.en.has(token)) {
        continue;
      }
      return false;
    }
  }

  return true;
}
